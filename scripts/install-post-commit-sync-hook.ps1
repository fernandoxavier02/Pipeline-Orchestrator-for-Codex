param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRootFull = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $ProjectRoot).Path)
$hookPath = Join-Path $projectRootFull ".git\hooks\post-commit"
$scriptPath = Join-Path $projectRootFull "scripts\sync-codex-plugin-surfaces.ps1"

if (!(Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
  throw "Sync script not found: $scriptPath"
}

$hook = @'
#!/bin/sh
PROJECT_ROOT="$(git rev-parse --show-toplevel)"
SCRIPT="$PROJECT_ROOT/scripts/sync-codex-plugin-surfaces.ps1"

if command -v powershell.exe >/dev/null 2>&1; then
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$SCRIPT" -ProjectRoot "$PROJECT_ROOT"
else
  powershell -NoProfile -ExecutionPolicy Bypass -File "$SCRIPT" -ProjectRoot "$PROJECT_ROOT"
fi

status=$?
if [ "$status" -ne 0 ]; then
  echo "post-commit: Codex plugin surface sync failed" >&2
  exit "$status"
fi
'@

Set-Content -LiteralPath $hookPath -Value $hook -Encoding ASCII
Write-Host "Installed post-commit sync hook at $hookPath"
