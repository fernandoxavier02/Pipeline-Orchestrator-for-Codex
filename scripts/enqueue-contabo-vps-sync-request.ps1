param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$RemoteAlias = "contabo-f",
  [string]$RemotePath = "/home/fernando/projetos/pipeline-orchestrator-codex"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Run-Git($cwd, [string[]]$arguments) {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & git -C $cwd @arguments 2>&1
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($LASTEXITCODE -ne 0) {
    throw "git -C $cwd $($arguments -join ' ') failed: $output"
  }
  return $output
}

$projectRootFull = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $ProjectRoot).Path)
$head = (Run-Git $projectRootFull @("rev-parse", "HEAD")).Trim()
$origin = (Run-Git $projectRootFull @("remote", "get-url", "origin")).Trim()
$requestPath = Join-Path $projectRootFull ".git\codex-contabo-vps-sync-request.md"
$createdAt = [DateTimeOffset]::UtcNow.ToString("o")

$message = @"
CODEX_NLP_REQUEST: Atualize o espelho da VPS Contabo deste projeto.

Regra principal: a VPS deve ficar igual ao repositorio local deste computador, nao necessariamente igual ao GitHub.

Fonte local:
$projectRootFull

Destino remoto:
ssh $RemoteAlias
$RemotePath

Commit local atual:
$head

Remote GitHub configurado no projeto:
$origin

Acao esperada do Codex:
1. Executar scripts/sync-contabo-fernando-vps-mirror.ps1 a partir da raiz local.
2. Espelhar o diretorio local completo para o destino remoto, incluindo .git e artefatos locais.
3. Garantir que o Git na VPS aponte para o mesmo origin do projeto local.
4. Conferir paridade local x VPS por HEAD, contagem de itens, soma de bytes e hashes criticos, incluindo .gitignore.
5. Lembrar que GitHub nao e fonte de verdade para a VPS; o local e a fonte de verdade.

Criado em UTC:
$createdAt
"@

Set-Content -LiteralPath $requestPath -Value $message -Encoding UTF8
Write-Host $message
Write-Host "NLP sync request written to $requestPath"
