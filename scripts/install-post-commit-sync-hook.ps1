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
SURFACE_SCRIPT="$PROJECT_ROOT/scripts/sync-codex-plugin-surfaces.ps1"
VPS_REQUEST_SCRIPT="$PROJECT_ROOT/scripts/enqueue-contabo-vps-sync-request.ps1"

if command -v powershell.exe >/dev/null 2>&1; then
  POWERSHELL_BIN="powershell.exe"
else
  POWERSHELL_BIN="powershell"
fi

$POWERSHELL_BIN -NoProfile -ExecutionPolicy Bypass -File "$SURFACE_SCRIPT" -ProjectRoot "$PROJECT_ROOT"
status=$?
if [ "$status" -ne 0 ]; then
  echo "post-commit: Codex plugin surface sync failed" >&2
  exit "$status"
fi

$POWERSHELL_BIN -NoProfile -ExecutionPolicy Bypass -File "$VPS_REQUEST_SCRIPT" -ProjectRoot "$PROJECT_ROOT"
status=$?
if [ "$status" -ne 0 ]; then
  echo "post-commit: Contabo VPS NLP sync request failed" >&2
  exit "$status"
fi
'@

Set-Content -LiteralPath $hookPath -Value $hook -Encoding ASCII
Write-Host "Installed post-commit sync hook at $hookPath"
