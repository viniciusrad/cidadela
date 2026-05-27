# QA - Cross-Agent Fanout

Data: 2026-05-05

Ambiente:
- Aplicacao: `http://localhost:3030`
- Execucao: `npm run dev`
- Usuario: sessao admin autenticada no navegador

## Fluxos Testados

1. Agente origem: `seguranca`
   Pergunta: `para que serve a transação zsd90?`
   Resultado: aprovado.
   Evidencias:
   - Busca local em `seguranca`: `relevantMatches=0`.
   - Fanout consultou `desenvolvimento`, `suporte` e `desktop`.
   - Consulta a `desenvolvimento`: `sourceFilter=none`, `shareableOnly=true`, `relevantMatches=3`.
   - Resposta final identificou o setor Desenvolvimento/Forja como origem e retornou 3 citacoes de chunks de desenvolvimento.

2. Agente origem: `suporte`
   Pergunta: `para que serve a transação zsd244?`
   Resultado: aprovado.
   Evidencias:
   - Busca local em `suporte`: `relevantMatches=0`.
   - Fanout consultou `desenvolvimento`, `seguranca` e `desktop`.
   - Consulta a `desenvolvimento`: `sourceFilter=none`, `shareableOnly=true`, `relevantMatches=3`.
   - Resposta final explicou que ZSD244 gera arquivos para canais de distribuicao e retornou 3 citacoes de chunks de desenvolvimento.

## Logs Relevantes

Os logs foram gravados em:
- `.agents-docs/dev-server.out.log`
- `.agents-docs/dev-server.err.log`

Trechos esperados observados:
- `[agent] local search sector=seguranca ... relevantMatches=0`
- `[agent] fanout start sector=seguranca ... targets=[ 'desenvolvimento', 'suporte', 'desktop' ]`
- `[agent-rpc] search start from=seguranca to=desenvolvimento ... sourceFilter=none shareableOnly=true`
- `[agent-rpc] search result from=seguranca to=desenvolvimento relevantMatches=3`
- `[agent] fanout complete ... hasRelevantCitations: true`

## Observacoes

- O servidor precisou ser reiniciado depois da correcao porque o processo dev anterior ainda usava o modulo antigo, que consultava `desenvolvimento` com `sourceFilter=1`.
- Apos reinicio, o fluxo validado passou a usar busca ampla nos demais agentes quando o agente inicial nao encontra evidencia local.
