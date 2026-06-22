param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$RemoteAlias = "contabo-f",
  [string]$RemotePath = "/home/fernando/projetos/pipeline-orchestrator-codex",
  [switch]$KeepArchive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($message) {
  throw "[sync-contabo-fernando-vps-mirror] $message"
}

function Run-Git($cwd, [string[]]$arguments) {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & git -C $cwd @arguments 2>&1
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($LASTEXITCODE -ne 0) {
    Fail "git -C $cwd $($arguments -join ' ') failed: $output"
  }
  return $output
}

function Get-Sha256($path) {
  $stream = [System.IO.File]::OpenRead($path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $hashBytes = $sha.ComputeHash($stream)
      return ([System.BitConverter]::ToString($hashBytes)).Replace("-", "").ToLowerInvariant()
    } finally {
      $sha.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Count-LocalItems($path) {
  return (Get-ChildItem -LiteralPath $path -Force -Recurse | Measure-Object).Count
}

function Sum-LocalFileBytes($path) {
  $sum = (Get-ChildItem -LiteralPath $path -Force -Recurse -File | Measure-Object -Property Length -Sum).Sum
  if ($null -eq $sum) {
    return 0
  }
  return [Int64]$sum
}

$projectRootFull = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $ProjectRoot).Path)
if (!(Test-Path -LiteralPath (Join-Path $projectRootFull ".git") -PathType Container)) {
  Fail "Project root is not a Git checkout: $projectRootFull"
}
if ($RemotePath -ne "/home/fernando/projetos/pipeline-orchestrator-codex") {
  Fail "Refusing unsafe remote path: $RemotePath"
}

$head = (Run-Git $projectRootFull @("rev-parse", "HEAD")).Trim()
$origin = (Run-Git $projectRootFull @("remote", "get-url", "origin")).Trim()
$localItems = Count-LocalItems $projectRootFull
$localBytes = Sum-LocalFileBytes $projectRootFull

$timestamp = Get-Date -Format "yyyyMMddHHmmss"
$archive = Join-Path $env:TEMP "pipeline-orchestrator-contabo-mirror-$timestamp.tar.gz"
$remoteArchive = "/tmp/pipeline-orchestrator-contabo-mirror-$timestamp.tar.gz"

Write-Host "Creating full local mirror archive from $projectRootFull"
if (Test-Path -LiteralPath $archive) {
  Remove-Item -LiteralPath $archive -Force
}
& tar.exe -czf $archive -C $projectRootFull .
if ($LASTEXITCODE -ne 0) {
  Fail "tar.exe failed while creating local archive"
}

$archiveHash = Get-Sha256 $archive
$archiveBytes = (Get-Item -LiteralPath $archive).Length
Write-Host "ARCHIVE=$archive"
Write-Host "ARCHIVE_SHA256=$archiveHash"
Write-Host "ARCHIVE_BYTES=$archiveBytes"

Write-Host "Uploading archive to ${RemoteAlias}:$remoteArchive"
& scp $archive "${RemoteAlias}:$remoteArchive"
if ($LASTEXITCODE -ne 0) {
  Fail "scp upload failed"
}

$remoteScript = @"
import hashlib
import os
import shutil
import subprocess
import sys

archive = "$remoteArchive"
expected_hash = "$archiveHash"
dest = "$RemotePath"
expected_dest = "/home/fernando/projetos/pipeline-orchestrator-codex"
origin = "$origin"
expected_head = "$head"

if os.path.abspath(dest) != expected_dest:
    raise SystemExit(f"unsafe destination: {dest}")
if not os.path.exists(archive):
    raise SystemExit(f"archive missing: {archive}")

h = hashlib.sha256()
with open(archive, "rb") as f:
    for chunk in iter(lambda: f.read(1024 * 1024), b""):
        h.update(chunk)
actual_hash = h.hexdigest()
if actual_hash != expected_hash:
    raise SystemExit(f"hash mismatch: {actual_hash} != {expected_hash}")

os.makedirs(os.path.dirname(dest), exist_ok=True)
if os.path.exists(dest):
    shutil.rmtree(dest)
os.makedirs(dest, exist_ok=True)

tar_cmd = ["tar", "--warning=no-unknown-keyword", "-xzf", archive, "-C", dest]
result = subprocess.run(tar_cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
if result.returncode != 0:
    print(result.stdout)
    print(result.stderr, file=sys.stderr)
    raise SystemExit(result.returncode)

subprocess.run(["git", "-C", dest, "remote", "remove", "origin"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.run(["git", "-C", dest, "remote", "add", "origin", origin], check=True)
head = subprocess.check_output(["git", "-C", dest, "rev-parse", "HEAD"], text=True).strip()
if head != expected_head:
    raise SystemExit(f"head mismatch: {head} != {expected_head}")

item_count = 0
file_bytes = 0
critical = [
    "scripts/sync-contabo-fernando-vps-mirror.ps1",
    "scripts/enqueue-contabo-vps-sync-request.ps1",
    "hooks/force-pipeline-agents.cjs",
    ".git/HEAD",
]
for root, dirs, files in os.walk(dest):
    item_count += len(dirs) + len(files)
    for name in files:
        file_bytes += os.path.getsize(os.path.join(root, name))

print(f"REMOTE_HEAD={head}")
print(f"REMOTE_ITEMS={item_count}")
print(f"REMOTE_FILE_BYTES={file_bytes}")
print("REMOTE_ORIGIN=" + subprocess.check_output(["git", "-C", dest, "remote", "get-url", "origin"], text=True).strip())
for rel in critical:
    path = os.path.join(dest, rel)
    if os.path.isfile(path):
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        print(f"REMOTE_SHA256 {rel} {h.hexdigest()}")
"@

$remoteOutput = $remoteScript | ssh $RemoteAlias "python3 -"
if ($LASTEXITCODE -ne 0) {
  Fail "remote mirror extraction/validation failed"
}
$remoteOutput | ForEach-Object { Write-Host $_ }

$remoteItemsLine = $remoteOutput | Where-Object { $_ -like "REMOTE_ITEMS=*" } | Select-Object -First 1
$remoteBytesLine = $remoteOutput | Where-Object { $_ -like "REMOTE_FILE_BYTES=*" } | Select-Object -First 1
$remoteOriginLine = $remoteOutput | Where-Object { $_ -like "REMOTE_ORIGIN=*" } | Select-Object -First 1
$remoteItems = [Int64]($remoteItemsLine -replace "^REMOTE_ITEMS=", "")
$remoteBytes = [Int64]($remoteBytesLine -replace "^REMOTE_FILE_BYTES=", "")
$remoteOrigin = $remoteOriginLine -replace "^REMOTE_ORIGIN=", ""

if ($remoteItems -ne $localItems) {
  Fail "item count mismatch: local=$localItems remote=$remoteItems"
}
if ($remoteBytes -ne $localBytes) {
  Fail "file byte sum mismatch: local=$localBytes remote=$remoteBytes"
}
if ($remoteOrigin -ne $origin) {
  Fail "remote origin mismatch: local=$origin remote=$remoteOrigin"
}

if (!$KeepArchive) {
  Remove-Item -LiteralPath $archive -Force
  & ssh $RemoteAlias "rm -f '$remoteArchive'"
}

Write-Host "OK Contabo VPS mirror matches local checkout"
Write-Host "LOCAL_HEAD=$head"
Write-Host "LOCAL_ITEMS=$localItems"
Write-Host "LOCAL_FILE_BYTES=$localBytes"
