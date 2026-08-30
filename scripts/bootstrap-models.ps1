param ([switch]$HostMode)
$ErrorActionPreference = "Stop"

if ($HostMode) {
  Write-Host "Baixando modelos nativamente..."
  ollama pull bge-m3:latest
  ollama pull qwen3.5:4b
} else {
  Write-Host "Baixando modelos no container..."
  docker exec cidadela_agents_ollama ollama pull bge-m3:latest
  docker exec cidadela_agents_ollama ollama pull qwen3.5:4b
}
