param (
  [switch]$HostMode,
  [string]$EmbedModel,
  [string]$ChatModel
)
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot

# Le OLLAMA_EMBED_MODEL / OLLAMA_CHAT_MODEL do ambiente local, com a mesma
# precedencia do resto do projeto (.env.local sobrepoe .env).
function Read-EnvValue {
  param ([string]$Key)

  foreach ($file in @(".env.local", ".env")) {
    $path = Join-Path $repoRoot $file
    if (-not (Test-Path $path)) { continue }

    foreach ($line in Get-Content $path) {
      $trimmed = $line.Trim()
      if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
      if ($trimmed -match "^$([regex]::Escape($Key))\s*=\s*(.*)$") {
        return $Matches[1].Trim().Trim('"').Trim("'")
      }
    }
  }

  return $null
}

function Resolve-Model {
  param ([string]$Explicit, [string]$Key, [string]$Fallback)

  if ($Explicit) { return $Explicit }
  $fromEnv = Read-EnvValue -Key $Key
  if ($fromEnv) { return $fromEnv }
  return $Fallback
}

$embed = Resolve-Model -Explicit $EmbedModel -Key "OLLAMA_EMBED_MODEL" -Fallback "bge-m3:latest"
$chat = Resolve-Model -Explicit $ChatModel -Key "OLLAMA_CHAT_MODEL" -Fallback "qwen3.5:4b"

if ($HostMode) {
  Write-Host "Baixando modelos no Ollama nativo do host: $embed, $chat"
  ollama pull $embed
  ollama pull $chat
} else {
  # O servico do compose local chama-se "ollama-cpu" (profile "cpu"); nao existe
  # container com nome fixo "cidadela_agents_ollama".
  Write-Host "Baixando modelos no container ollama-cpu: $embed, $chat"
  $compose = Join-Path $repoRoot "docker-compose.local.yml"
  docker compose -f $compose --profile cpu exec -T ollama-cpu ollama pull $embed
  docker compose -f $compose --profile cpu exec -T ollama-cpu ollama pull $chat
}
