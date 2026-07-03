param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [switch]$VerifyOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($message) {
  throw "[sync-codex-plugin-surfaces] $message"
}

function Resolve-ExistingPath($path) {
  return [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $path).Path)
}

function Normalize-PathForJoin($relativePath) {
  return $relativePath -replace '/', [System.IO.Path]::DirectorySeparatorChar
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
      return ([System.BitConverter]::ToString($hashBytes)).Replace("-", "")
    } finally {
      $sha.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Get-CodexCommand {
  $candidates = @(
    "D:\DevTools\npm-global\codex.cmd",
    "C:\Users\win\AppData\Roaming\npm\codex.cmd",
    "C:\Program Files\WindowsApps\OpenAI.Codex_26.616.6631.0_x64__2p2nqsd0c76g0\app\resources\codex.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return $candidate
    }
  }

  $command = Get-Command codex.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) {
    return $command.Source
  }

  $command = Get-Command codex.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) {
    return $command.Source
  }

  Fail "codex CLI was not found"
}

function Get-TrackedFiles($root, [string[]]$excludePrefixes) {
  $files = Run-Git $root @("ls-files")
  $normalizedExcludes = $excludePrefixes | ForEach-Object { $_.Replace('\', '/').TrimEnd('/') + '/' }

  return @(
    $files |
      Where-Object { $_ -and $_.Trim() } |
      Where-Object {
        $file = $_.Replace('\', '/')
        foreach ($prefix in $normalizedExcludes) {
          if ($file.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $false
          }
        }
        return $true
      }
  )
}

function Copy-TrackedFiles($label, $sourceRoot, $targetRoot, [string[]]$excludePrefixes) {
  $sourceRoot = Resolve-ExistingPath $sourceRoot
  if (!(Test-Path -LiteralPath $targetRoot)) {
    if ($VerifyOnly) {
      Fail "$label target does not exist: $targetRoot"
    }
    New-Item -ItemType Directory -Path $targetRoot | Out-Null
  }
  $targetRoot = Resolve-ExistingPath $targetRoot

  $files = Get-TrackedFiles $sourceRoot $excludePrefixes
  foreach ($file in $files) {
    $relative = Normalize-PathForJoin $file
    $sourceFile = Join-Path $sourceRoot $relative
    $targetFile = Join-Path $targetRoot $relative
    if (!(Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
      continue
    }

    if (!$VerifyOnly) {
      $targetDirectory = Split-Path -Parent $targetFile
      if (!(Test-Path -LiteralPath $targetDirectory)) {
        New-Item -ItemType Directory -Path $targetDirectory | Out-Null
      }
      Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force
    }
  }

  foreach ($file in $files) {
    $relative = Normalize-PathForJoin $file
    $sourceFile = Join-Path $sourceRoot $relative
    $targetFile = Join-Path $targetRoot $relative
    if (!(Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
      continue
    }
    if (!(Test-Path -LiteralPath $targetFile -PathType Leaf)) {
      Fail "$label missing synced file: $file"
    }

    $sourceHash = Get-Sha256 $sourceFile
    $targetHash = Get-Sha256 $targetFile
    if ($sourceHash -ne $targetHash) {
      Fail "$label drift detected for $file"
    }
  }

  Write-Host "OK $label synced $($files.Count) tracked files"
}

function Update-GitMetadataFromSource($label, $sourceRoot, $targetRoot) {
  if (!(Test-Path -LiteralPath (Join-Path $sourceRoot ".git"))) {
    return
  }
  if (!(Test-Path -LiteralPath (Join-Path $targetRoot ".git"))) {
    return
  }
  if ($VerifyOnly) {
    return
  }

  Run-Git $targetRoot @("fetch", "--quiet", $sourceRoot, "HEAD") | Out-Null
  Run-Git $targetRoot @("update-ref", "refs/heads/main", "FETCH_HEAD") | Out-Null
  Run-Git $targetRoot @("symbolic-ref", "HEAD", "refs/heads/main") | Out-Null
  Run-Git $targetRoot @("reset", "--mixed", "--quiet", "HEAD") | Out-Null
  Write-Host "OK $label git metadata moved to source HEAD"
}

function Assert-JunctionTarget($label, $path, $expectedTarget) {
  if (!(Test-Path -LiteralPath $path)) {
    Fail "$label marketplace path does not exist: $path"
  }
  $item = Get-Item -LiteralPath $path -Force
  $expected = Resolve-ExistingPath $expectedTarget
  $actualTargets = @(@($item.Target) | Where-Object { $_ })
  if ($actualTargets.Count -eq 0) {
    Fail "$label marketplace path is not a junction/symlink: $path"
  }
  $matches = $actualTargets | Where-Object {
    try {
      (Resolve-ExistingPath $_) -eq $expected
    } catch {
      $false
    }
  }
  if (!$matches) {
    Fail "$label marketplace target mismatch. Expected $expected, got $($actualTargets -join ', ')"
  }
  Write-Host "OK $label marketplace points to $expected"
}

function Assert-PluginEnabled($selector) {
  $codex = Get-CodexCommand
  $pluginList = & $codex plugin list 2>&1
  if ($LASTEXITCODE -ne 0) {
    Fail "codex plugin list failed: $pluginList"
  }
  $line = $pluginList | Select-String -SimpleMatch $selector | Select-Object -First 1
  if (!$line) {
    Fail "plugin not listed by Codex: $selector"
  }
  $text = $pluginList -join "`n"
  if ($text -notmatch [regex]::Escape($selector)) {
    Fail "plugin selector missing from Codex plugin list: $selector"
  }
  Write-Host "OK Codex lists $selector"
}

$projectRootFull = Resolve-ExistingPath $ProjectRoot
$pipelineCommit = (Run-Git $projectRootFull @("rev-parse", "HEAD")).Trim()

# Derive the cache version from the plugin manifest (SSOT) instead of hard-coding it.
# The Codex cache is namespaced by version dir; pinning a literal here silently
# desynced the sync from a version bump (the 0.5.1->0.5.2 lesson). Read it live.
$pluginManifestPath = Join-Path $projectRootFull ".codex-plugin/plugin.json"
if (!(Test-Path -LiteralPath $pluginManifestPath)) {
  Fail "plugin manifest not found: $pluginManifestPath"
}
try {
  $pipelineVersion = (Get-Content -LiteralPath $pluginManifestPath -Raw | ConvertFrom-Json).version
} catch {
  Fail "plugin manifest is not valid JSON: $pluginManifestPath ($($_.Exception.Message))"
}
if ([string]::IsNullOrWhiteSpace($pipelineVersion)) {
  Fail "plugin manifest has no version: $pluginManifestPath"
}
# The version becomes a filesystem path segment; reject anything that isn't a clean
# semver so a stray separator / traversal can't redirect the cache dir.
if ($pipelineVersion -notmatch '^\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$') {
  Fail "plugin manifest version has an unexpected shape: '$pipelineVersion'"
}
Write-Host "Pipeline plugin version (from manifest): $pipelineVersion"

$marketplacePipelinePath = "C:\Users\win\plugins\pipeline-orchestrator-for-codex"
$pipelineCodexCache = "C:\Users\win\.codex\plugins\cache\fx-studio-ai\pipeline-orchestrator-for-codex\$pipelineVersion"
$pipelineAgentsPlugin = "C:\Users\win\.agents\plugins\pipeline-orchestrator-for-codex"

$globalSource = "C:\Users\win\Codex-superpower"
$marketplaceGlobalPath = "C:\Users\win\plugins\superpowers-codex-global"
$globalCodexCache = "C:\Users\win\.codex\plugins\cache\fx-studio-ai\superpowers-codex-global\5.0.9"

Write-Host "Syncing Pipeline Orchestrator surfaces from $projectRootFull at $pipelineCommit"
Assert-JunctionTarget "pipeline marketplace" $marketplacePipelinePath $projectRootFull
Assert-PluginEnabled "pipeline-orchestrator-for-codex@fx-studio-ai"

$pipelineExcludes = @(".agents/")
Copy-TrackedFiles "pipeline Codex cache" $projectRootFull $pipelineCodexCache $pipelineExcludes
Update-GitMetadataFromSource "pipeline Codex cache" $projectRootFull $pipelineCodexCache
Copy-TrackedFiles "pipeline agents plugin copy" $projectRootFull $pipelineAgentsPlugin $pipelineExcludes

if (Test-Path -LiteralPath $globalSource) {
  $globalSourceFull = Resolve-ExistingPath $globalSource
  $globalCommit = (Run-Git $globalSourceFull @("rev-parse", "HEAD")).Trim()
  Write-Host "Syncing Codex Global cache from $globalSourceFull at $globalCommit"
  Assert-JunctionTarget "Codex Global marketplace" $marketplaceGlobalPath $globalSourceFull
  Copy-TrackedFiles "Codex Global cache" $globalSourceFull $globalCodexCache @()
  Update-GitMetadataFromSource "Codex Global cache" $globalSourceFull $globalCodexCache
}

Write-Host "OK all Codex plugin surfaces are synchronized"
