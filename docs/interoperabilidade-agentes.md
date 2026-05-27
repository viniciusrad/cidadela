# Interoperabilidade Entre Agentes

Este documento descreve as funcoes existentes entre os agentes do
`pfrm-secure-agents`, quem executa cada funcao, quem pode pedir, como pedir e
como expandir a colaboracao com seguranca.

## Agentes e responsabilidades

| Agente | Setor | Responsabilidade principal |
| --- | --- | --- |
| Forja | `desenvolvimento` | Sistemas, APIs, integracoes, codigo, deploy, automacoes tecnicas e chamadas internas ao `human-in-captcha`. |
| Sentinela | `seguranca` | Politicas de seguranca, credenciais, autenticacao, risco, compliance e controles. |
| Suporte | `suporte` | Atendimento, triagem operacional, impacto ao usuario, SLA e incidentes reportados por usuarios. |

O usuario fala somente com o agente do proprio setor autenticado. Quando outro
dominio precisa contribuir, o agente local usa um protocolo de delegacao ou
solicita uma automacao da Forja com confirmacao.

## Funcoes existentes entre agentes

### Delegacao de conhecimento via RabbitMQ

Estas funcoes consultam outro agente para compor uma resposta. Elas nao
executam automacoes externas.

| Quem pede | Quem executa | Intent | Protocolo | Quando ocorre | Como pedir |
| --- | --- | --- | --- | --- | --- |
| Forja | Sentinela | `politica-seguranca` | `desenvolvimento->seguranca:politica-seguranca:v1` | Perguntas sobre senha, credenciais, autenticacao, MFA, token, acesso ou risco. | `Qual a politica de senha segura para contas privilegiadas?` |
| Forja | Suporte | `impacto-operacional` | `desenvolvimento->suporte:impacto-operacional:v1` | Perguntas sobre chamado, SLA, usuario, atendimento, operacao ou incidente operacional. | `Qual impacto operacional se a API de pedidos ficar indisponivel?` |
| Suporte | Forja | `escalonamento-tecnico` | `suporte->desenvolvimento:escalonamento-tecnico:v1` | Perguntas tecnicas sobre API, endpoint, deploy, codigo, servico, integracao ou implementacao. | `Precisamos entender a causa tecnica do erro na API de pedidos.` |
| Suporte | Sentinela | `incidente-seguranca` | `suporte->seguranca:incidente-seguranca:v1` | Triagem de incidente com risco, credencial, acesso, autenticacao ou controle de seguranca. | `Usuario reportou tentativa suspeita de acesso, como classificar?` |
| Sentinela | Forja | `implementacao-tecnica` | `seguranca->desenvolvimento:implementacao-tecnica:v1` | Seguranca precisa de explicacao tecnica sobre implementacao, API, integracao, servico ou codigo. | `Como implementar controle de acesso nessa API?` |

Modo de operacao:

1. `app/api/chat/route.ts` recebe a pergunta e executa `runSectorAgent()`.
2. `resolveDelegation()` decide se a pergunta deve consultar outro setor.
3. A decisao pode vir do classificador LLM ou das regras de palavras-chave em
   `lib/agents/router.ts`.
4. O agente origem envia um payload `AgentRpcPayload` pela fila
   `agent.<setor>` no exchange `agents.direct`.
5. O agente destino valida o protocolo com `getProtocol()`.
6. O agente destino responde com resumo e citacoes do proprio setor.
7. O agente origem consolida a resposta final para o usuario.
8. A chamada fica registrada em `AgentCall` e em eventos de auditoria.

### Execucao de automacoes da Forja

Estas funcoes criam uma execucao no `human-in-captcha`. A Forja e a dona das
automacoes, mas Sentinela e Suporte podem pedir a execucao com confirmacao
humana.

| Automacao | Dono/executor | Quem pode pedir | Execucao direta | Pedido cross-agent | Exemplo de pedido |
| --- | --- | --- | --- | --- | --- |
| Chamado Cervello para Pedido Eletronico | Forja / `human-in-captcha` | Forja, Sentinela, Suporte | Forja executa direto. | Sentinela/Suporte precisam confirmar com motivo. | `Criar chamado no Cervello para problema no Pedido Eletronico.` |
| Pesquisa de precos de medicamentos | Forja / `human-in-captcha` | Forja, Sentinela, Suporte | Forja executa direto. | Sentinela/Suporte precisam confirmar com motivo. | `Gerar arquivo de preco de medicamentos.` |
| Coleta de indices e moedas | Forja / `human-in-captcha` | Forja, Sentinela, Suporte | Forja executa direto. | Sentinela/Suporte precisam confirmar com motivo. | `Coletar indices e moedas e gerar os arquivos de cotacao.` |

Gatilhos reconhecidos:

- A frase precisa ter verbo de acao, como `abrir`, `criar`, `gerar`,
  `acionar`, `registrar`, `executar`, `rodar`, `disparar`, `iniciar` ou
  `coletar`.
- Para chamado Cervello, a frase precisa mencionar `chamado`, `ticket` ou
  `solicitacao` e tambem `Pedido Eletronico` ou `Cervello`.
- Para medicamentos, a frase precisa mencionar medicamento/remedio/farmacia e
  arquivo/relatorio/pesquisa/preco/cotacao.
- Para moedas e indices, a frase precisa mencionar moeda/cambio/cotacao/PTAX ou
  indice/TR/DI/B3/BCB/CETIP, junto com uma acao de coleta/geracao.

Exemplos aceitos:

```text
Criar chamado no Cervello para problema no Pedido Eletronico.
Gerar arquivo de preco de medicamentos.
Rodar a pesquisa de precos de medicamentos.
Coletar indices e moedas e gerar os arquivos de cotacao.
Executar a coleta de moedas e indices.
```

Exemplos que nao devem executar automacao:

```text
Explique como funciona a politica de precos de medicamentos.
O pedido eletronico esta com problemas e preciso entender o impacto.
Qual a regra de seguranca para abrir chamados?
```

## Fluxo de aprovacao para outros agentes

Quando o usuario esta em `seguranca` ou `suporte`, uma automacao da Forja nunca
e enfileirada na primeira mensagem.

Fluxo:

1. O usuario pede a automacao ao agente local.
2. O chat detecta a intencao com `detectHumanCaptchaAutomationIntent()`.
3. Como o setor nao e `desenvolvimento`, o chat registra
   `automation.approval_requested` em `AuditEvent`.
4. O agente local pede confirmacao com motivo curto.
5. O usuario responde na mesma conversa:

```text
Sim, motivo: incidente reportado pelo time de pedidos.
```

6. O chat registra `automation.approval_confirmed`.
7. O chat chama a integracao interna do `human-in-captcha`.
8. O `human-in-captcha` cria a run na fila e devolve `runUrl` e, quando existir,
   `nextTaskUrl`.

Cancelamento:

```text
cancelar
nao
cancele
```

Se o usuario responder apenas `sim`, o sistema nao executa. Ele pede novamente
um motivo curto.

## Contrato de interoperabilidade com human-in-captcha

O `pfrm-secure-agents` nao acessa banco, Redis ou RabbitMQ do
`human-in-captcha`. A interoperabilidade entre sistemas usa HTTP interno em uma
rede Docker compartilhada.

Configuracao esperada:

- Rede Docker externa: `pfrm-local-internal`.
- URL em container: `http://human-automation-api:3001`.
- URL em host local: `http://127.0.0.1:3001`.
- Token interno: `HUMAN_CAPTCHA_INTERNAL_TOKEN`, igual ao
  `INTERNAL_AUTOMATION_TOKEN` no `human-in-captcha`.

Endpoints usados:

| Funcao | Metodo e rota |
| --- | --- |
| Chamado Cervello | `POST /integrations/pfrm/cervello/electronic-order-ticket` |
| Script de medicamento | `POST /integrations/pfrm/automation-scripts/medication-price-survey/run` |
| Script de moedas/indices | `POST /integrations/pfrm/automation-scripts/coleta-indices-moedas/run` |

Headers obrigatorios:

```http
Authorization: Bearer <HUMAN_CAPTCHA_INTERNAL_TOKEN>
Idempotency-Key: pfrm-secure-agents:<messageId>:<automationSuffix>
Content-Type: application/json
```

Campos enviados no body:

| Campo | Origem |
| --- | --- |
| `traceId` | Trace da mensagem atual no chat. |
| `conversationId` | Conversa do usuario no `pfrm-secure-agents`. |
| `requestedBy` | Email do usuario autenticado. |
| `userSector` | Setor do usuario autenticado. |
| `sourceSystem` | Sempre `pfrm-secure-agents`. |
| `message` | Pedido original que gerou a automacao. |
| `approvalReason` | Motivo informado pelo usuario quando houve pedido cross-agent. |
| `requestedByAgent` | Setor solicitante quando nao for Forja. |
| `ownerAgent` | `desenvolvimento`. |

## Auditoria

Eventos relevantes no `pfrm-secure-agents`:

| Evento | Quando ocorre |
| --- | --- |
| `user.question` | Toda pergunta do usuario. |
| `delegation.ok`, `delegation.timeout`, `delegation.error` | Resultado de uma delegacao de conhecimento entre agentes. |
| `automation.requested` | Forja pediu uma automacao direta. |
| `automation.approval_requested` | Outro setor pediu automacao da Forja e precisa confirmar. |
| `automation.approval_confirmed` | Usuario confirmou com motivo curto. |
| `automation.approval_cancelled` | Usuario cancelou a solicitacao pendente. |
| `automation.queued` | `human-in-captcha` aceitou e enfileirou a execucao. |
| `automation.failed` | Falha ao chamar o servico de automacao. |

Eventos e payloads no `human-in-captcha` tambem preservam o contexto de origem,
incluindo `externalTraceId`, `conversationId`, `requestedBy`, `userSector`,
`approvalReason`, `requestedByAgent` e `ownerAgent`.

## Como expandir a colaboracao entre agentes

### Adicionar uma nova delegacao de conhecimento

1. Adicione um item em `PROTOCOLS` com `from`, `to`, `intent`, `id`,
   `template`, `maxTokens` e `enabled: true`.
2. Atualize `routeDelegation()` com palavras-chave conservadoras para a nova
   rota.
3. Se necessario, ajuste o prompt em `classifier.ts` para explicar melhor o
   dominio do novo fluxo.
4. Adicione testes em `tests/router.test.ts` e `tests/protocols.test.ts`.
5. Atualize este documento e `docs/architecture.md`.

Regras:

- O agente destino sempre valida o protocolo recebido.
- Nao permita destino igual ao setor origem.
- Delegacao de conhecimento nao deve executar automacoes.
- O retorno deve ser usado como contribuicao protocolada, nao como resposta
  direta ao usuario final.

### Adicionar uma nova automacao da Forja

1. Crie ou exponha a automacao no `human-in-captcha`.
2. Defina a chave operacional e o endpoint interno permitido.
3. Adicione a intencao em `HumanCaptchaAutomationIntent`.
4. Adicione a regra de deteccao em `detectHumanCaptchaAutomationIntent()`.
5. Adicione a configuracao em `resolveAutomationLaunchConfig()`.
6. Preserve a idempotencia com `pfrm-secure-agents:<messageId>:<suffix>`.
7. Para setores que nao sejam Forja, mantenha o fluxo de confirmacao com motivo.
8. Adicione testes cobrindo gatilho positivo, pergunta generica e confirmacao.
9. Atualize este documento, `README.md`, `docs/architecture.md` e `memory.md`.

Regras:

- A automacao deve ter dono explicito.
- Outros agentes podem pedir, mas nao devem executar diretamente se nao forem o
  dono.
- Toda execucao deve ser auditavel com setor solicitante, usuario, conversa,
  trace e motivo quando houver aprovacao.
- O sistema nao deve compartilhar banco, Redis ou RabbitMQ entre projetos.

## Checklist de validacao

Ao alterar interoperabilidade, rode:

```powershell
npm test
npm run lint
npm run build
```

Se alterar DTOs ou endpoints do `human-in-captcha`, rode tambem:

```powershell
pnpm --filter @human-captcha/api build
docker compose up -d --build api
```

Teste manual minimo:

1. Como Forja, pedir uma automacao e confirmar que ela executa direto.
2. Como Sentinela, pedir a mesma automacao e confirmar que o sistema pede motivo.
3. Responder `sim` sem motivo e confirmar que nao executa.
4. Responder `sim, motivo: <motivo>` e confirmar que a run e criada.
5. Em outra conversa, responder `cancelar` e confirmar que nada e enfileirado.

## Atualizacao 2026-05-05: descoberta por consulta ampla

Quando o agente local nao encontra chunks relevantes, o chat consulta todos os
demais setores com protocolo ativo. Este fluxo nao tenta redirecionar para um
unico agente por classificador/keyword antes da busca ampla. Todos os setores em
`SECTORS` devem ter fila/consumer no RabbitMQ e protocolo para os outros
setores.

O agente destino busca no Qdrant usando `searchQuestion`, a pergunta limpa do
usuario/agente origem. O campo `question` continua transportando a instrucao
protocolada, mas nao deve contaminar o embedding de recuperacao. Respostas sem
chunks relevantes nao entram no contexto final; se nenhum setor trouxer
evidencia, a pergunta fica sinalizada por `agent.unanswered` para curadoria.
