# Comunicação entre Agentes

Este documento descreve em profundidade como os agentes do `pfrm-secure-agents` se comunicam entre si. O objetivo é servir de referência tanto para desenvolvedores que precisam entender o fluxo quanto para quem vai estender protocolos ou adicionar novos setores.

---

## 1. Visão geral

O sistema opera com **três agentes setoriais**, cada um responsável por um domínio de conhecimento:

| Setor             | Agente (persona) | Escopo                                                       |
| ----------------- | ----------------- | ------------------------------------------------------------ |
| `desenvolvimento` | **Forja**         | Código, APIs, deploy, integrações, engenharia                |
| `seguranca`       | **Sentinela**     | Políticas, compliance, credenciais, controle de acesso       |
| `suporte`         | **Helpdesk**      | Atendimento ao usuário, triagem, SLA, operações              |

**Invariante central:** o usuário conversa apenas com o agente do próprio setor. Quando a pergunta exige conhecimento de outro setor, o agente **delega** a consulta via barramento de mensagens — o usuário nunca interage diretamente com um agente de outro setor.

---

## 2. Arquitetura do barramento (RabbitMQ)

A comunicação entre agentes acontece sobre o RabbitMQ usando o padrão **RPC sobre AMQP**.

### 2.1 Topologia

```
┌──────────────────────────────────────────────────────────────┐
│                     RabbitMQ Broker                           │
│                                                              │
│  Exchange: agents.direct  (type: direct, durable)            │
│  ├── routing key: agent.desenvolvimento → Queue: agent.desenvolvimento │
│  ├── routing key: agent.seguranca       → Queue: agent.seguranca       │
│  └── routing key: agent.suporte         → Queue: agent.suporte         │
│                                                              │
│  Exchange: audit.fanout   (type: fanout, durable)            │
│  └── (broadcast) → Queue: audit.log                         │
│                                                              │
│  Reply Queues: amq.gen-*  (exclusive, auto-delete)           │
│  └── criadas sob demanda pelo publisher para RPC             │
└──────────────────────────────────────────────────────────────┘
```

A topologia é criada automaticamente no bootstrap da aplicação (`lib/bus/bootstrap.ts`) e garantida via `ensureBusTopology()` a cada publicação.

### 2.2 Componentes do bus

| Arquivo                    | Responsabilidade                                                                 |
| -------------------------- | -------------------------------------------------------------------------------- |
| `lib/bus/connection.ts`    | Singleton de conexão AMQP (reusa conexão global via `globalThis`)                |
| `lib/bus/publisher.ts`     | Publica mensagens RPC e eventos de auditoria; cria topologia sob demanda         |
| `lib/bus/consumer.ts`      | Consome filas setoriais; processa requisições RPC e devolve resposta              |
| `lib/bus/audit-consumer.ts`| Consome a fila `audit.log` e persiste eventos no banco via Prisma                |
| `lib/bus/bootstrap.ts`     | Orquestra inicialização: topologia, coleções Qdrant, protocolos e consumers      |

### 2.3 Inicialização

O bootstrap é acionado pelo `instrumentation.ts` do Next.js no startup do runtime Node.js:

```
instrumentation.ts
  └─ ensureBusBootstrapped()       (idempotente, via singleton global)
       ├─ ensureBusTopology()       (exchanges + queues + bindings)
       ├─ ensureAllSectorCollections() (Qdrant)
       ├─ syncProtocols()           (upsert no banco)
       ├─ startAuditConsumer()      (fila audit.log)
       ├─ startSectorConsumer("desenvolvimento")
       ├─ startSectorConsumer("seguranca")
       └─ startSectorConsumer("suporte")
```

---

## 3. Protocolos de delegação

Todo tráfego entre agentes é governado por **protocolos explícitos** definidos em `lib/agents/protocols.ts`. Um protocolo especifica quem pode falar com quem, sob qual intenção e com quais restrições.

### 3.1 Estrutura de um protocolo

```typescript
type ProtocolDefinition = {
  from: Sector;       // setor de origem
  to: Sector;         // setor de destino
  intent: string;     // identificador da intenção
  id: string;         // ID único no formato "from->to:intent:versão"
  template: string;   // instruções para o agente destino
  maxTokens: number;  // limite de resposta
  enabled: boolean;   // ativado/desativado
};
```

### 3.2 Protocolos ativos

| Origem              | Destino             | Intent                    | ID do protocolo                                          |
| -------------------- | -------------------- | ------------------------- | -------------------------------------------------------- |
| `desenvolvimento`    | `seguranca`          | `politica-seguranca`      | `desenvolvimento->seguranca:politica-seguranca:v1`       |
| `desenvolvimento`    | `suporte`            | `impacto-operacional`     | `desenvolvimento->suporte:impacto-operacional:v1`        |
| `suporte`            | `desenvolvimento`    | `escalonamento-tecnico`   | `suporte->desenvolvimento:escalonamento-tecnico:v1`      |
| `suporte`            | `seguranca`          | `incidente-seguranca`     | `suporte->seguranca:incidente-seguranca:v1`              |
| `seguranca`          | `desenvolvimento`    | `implementacao-tecnica`   | `seguranca->desenvolvimento:implementacao-tecnica:v1`    |

> **Nota:** `seguranca → suporte` não possui protocolo ativo atualmente.

### 3.3 Validação de protocolo

Ao receber uma requisição, o agente destino valida o protocolo (`answerAgentInternally`). Se o protocolo informado não corresponde a um protocolo válido e ativo para o par `from→to+intent`, a resposta retorna com status `protocol_violation`.

---

## 4. Fluxo completo de delegação

O diagrama abaixo mostra o ciclo de vida de uma pergunta que aciona delegação:

```
Usuário (setor: desenvolvimento)
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│  runSectorAgent(sector="desenvolvimento", question="...")       │
│                                                                 │
│  1. Busca contexto local (embedding + Qdrant no setor local)    │
│                                                                 │
│  2. Decide se delega:                                           │
│     ├─ classifyDelegationWithLLM() → LLM analisa a pergunta     │
│     │   (prompt com persona do setor + alvos disponíveis)       │
│     │                                                           │
│     └─ routeDelegation() → fallback por keywords                │
│        (se LLM não delegou, tenta correspondência textual)      │
│                                                                 │
│  3. Se delegate=true:                                           │
│     ├─ Busca protocolo válido via getProtocol(from, to, intent) │
│     ├─ Monta AgentRpcPayload com traceId, parentTraceId,        │
│     │  fromAgent, toAgent, intent, protocol, question            │
│     │                                                           │
│     ├─ Publica via requestAgent() no RabbitMQ:                  │
│     │   Exchange: agents.direct                                 │
│     │   Routing key: agent.seguranca                            │
│     │   Reply-to: fila exclusiva temporária                     │
│     │   Correlation-id: traceId                                 │
│     │                                                           │
│     ▼                                                           │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  Consumer (setor: seguranca)                         │       │
│  │  handleSectorMessage()                               │       │
│  │   ├─ Valida protocolo                                │       │
│  │   ├─ Busca contexto local (embedding + Qdrant)       │       │
│  │   ├─ Sumariza trechos encontrados                    │       │
│  │   └─ Devolve resposta na reply queue                 │       │
│  └──────────────────────────────────────────────────────┘       │
│     │                                                           │
│     ▼                                                           │
│  4. Recebe resposta (ou timeout após BUS_RPC_TIMEOUT_MS)        │
│                                                                 │
│  5. Monta prompt final com:                                     │
│     ├─ Contexto local (trechos do setor origem)                 │
│     ├─ Contribuições protocoladas (resposta do setor destino)   │
│     └─ Pergunta original do usuário                             │
│                                                                 │
│  6. Gera resposta final via Ollama (streaming)                  │
│                                                                 │
│  7. Persiste e audita:                                          │
│     ├─ AgentCall (tabela agent_calls)                           │
│     ├─ AuditEvent (tabela audit_events, via bus ou fallback)    │
│     └─ Message (tabela messages, com citations)                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Classificação e roteamento

A decisão de delegação passa por três camadas, configuradas em `lib/agents/router.ts`:

### 5.1 Classificador LLM (`classifier.ts`)

O classificador monta um prompt que:

1. Apresenta o escopo do setor de origem (persona + instruções).
2. Lista os setores disponíveis para consulta (baseado nos protocolos ativos).
3. Aplica regras explícitas (ex: APIs → desenvolvimento, credenciais → segurança).
4. Solicita resposta em JSON: `{"delegate": bool, "target": "setor|null", "rationale": "motivo"}`.

O modelo usado é `OLLAMA_CLASSIFIER_MODEL` (ou `OLLAMA_CHAT_MODEL` se não definido).

### 5.2 Descoberta por documentos compartilháveis

Antes do fallback por keywords, o roteador consulta o catálogo `knowledge_capabilities`.
Esse catálogo é sincronizado a partir dos documentos promovidos pela curadoria com `sensitivity=public` ou `sensitivity=internal`.
Se uma pergunta mencionar um termo presente em documento compartilhável de outro setor, por exemplo uma transação SAP como `ZSD90`, o agente de origem pode delegar ao setor dono usando o protocolo já existente para aquele par.
Documentos `confidential` e `restricted` não entram no catálogo e também não são liberados na busca delegada.

O catálogo pode ser atualizado de duas formas:

- Automaticamente no bootstrap do barramento e após promote de documento.
- Diretamente por admin via `POST /api/admin/knowledge-capabilities`; a listagem atual fica em `GET /api/admin/knowledge-capabilities`.
- Por agendamento operacional via `npm run sync:knowledge-capabilities`.

### 5.3 Roteamento por keywords (`router.ts`)

Se o LLM decide não delegar, o sistema ainda tenta um roteamento baseado em palavras-chave:

| Origem              | Keywords detectadas                                        | Destino             | Intent                  |
| -------------------- | --------------------------------------------------------- | -------------------- | ----------------------- |
| `desenvolvimento`    | senha, credencial, autenticação, segurança, mfa, token... | `seguranca`          | politica-seguranca      |
| `desenvolvimento`    | suporte, chamado, sla, atendimento, incidente...          | `suporte`            | impacto-operacional     |
| `suporte`            | api, endpoint, deploy, código, integração...              | `desenvolvimento`    | escalonamento-tecnico   |
| `suporte`            | senha, credencial, autenticação, segurança...             | `seguranca`          | incidente-seguranca     |
| `seguranca`          | api, endpoint, deploy, código, integração...              | `desenvolvimento`    | implementacao-tecnica   |

---

## 6. Payload RPC entre agentes

A mensagem trafegada no RabbitMQ segue o tipo `AgentRpcPayload`:

```typescript
type AgentRpcPayload = {
  traceId: string;        // ID único desta chamada RPC
  parentTraceId?: string; // traceId da conversa que originou a delegação
  fromAgent: Sector;      // setor que está solicitando
  toAgent: Sector;        // setor que vai responder
  intent: string;         // intenção do protocolo (ex: "politica-seguranca")
  protocol: string;       // ID completo do protocolo
  question: string;       // pergunta formatada com template do protocolo
};
```

A resposta devolvida na reply queue contém:

```typescript
{
  answer: string;                              // resposta sumarizada
  citations: ChatCitation[];                   // trechos de origem (Qdrant)
  status: "ok" | "protocol_violation";         // resultado da validação
}
```

---

## 7. Resiliência e fallback

O sistema possui mecanismos de recuperação quando o RabbitMQ está indisponível:

### 7.1 Fallback local

Se a publicação RPC falha (timeout, conexão recusada, etc.), o agente de origem **executa localmente** a mesma consulta via `answerAgentInternally()`:

1. Valida o protocolo.
2. Gera embedding da pergunta.
3. Busca trechos no Qdrant do setor destino.
4. Sumariza os trechos encontrados.
5. Retorna a resposta com `transport: "local-fallback"`.

Esse fallback é transparente para o usuário — a resposta aparece normalmente, e um evento `delegation.local_fallback` é registrado na auditoria.

### 7.2 Timeout configurável

O timeout RPC é controlado pela variável `BUS_RPC_TIMEOUT_MS` (padrão: 60.000 ms). Se a resposta não chega nesse intervalo, o sistema aciona o fallback local.

### 7.3 Auditoria como fallback

A publicação de eventos de auditoria (`safePublishAuditEvent`) também tem fallback: se o RabbitMQ falha, o evento é gravado diretamente no banco via Prisma, garantindo que nenhum registro de delegação se perde.

---

## 8. Auditoria e rastreabilidade

Toda delegação produz registros em duas tabelas:

### 8.1 `agent_calls`

Armazena cada chamada entre agentes com:

- `traceId` / `parentTraceId` — correlação com a conversa original
- `fromAgent` / `toAgent` — par de setores envolvidos
- `intent` / `protocol` — contrato utilizado
- `request` / `response` — payload completo (JSON)
- `status` — resultado (`ok`, `timeout`, `bus_unavailable`, `protocol_violation`, `error`)
- `latencyMs` — tempo de resposta em milissegundos

### 8.2 `audit_events`

Registra eventos granulares ao longo do fluxo:

| Evento                       | Significado                                                    |
| ---------------------------- | -------------------------------------------------------------- |
| `delegation.ok`              | Delegação concluída com sucesso via bus                        |
| `delegation.timeout`         | Resposta não chegou dentro do timeout                          |
| `delegation.bus_unavailable` | RabbitMQ inacessível no momento da publicação                  |
| `delegation.error`           | Erro genérico durante a delegação                              |
| `delegation.local_fallback`  | Fallback local acionado após falha no bus                      |
| `delegation.fulfilled`       | Consumer processou e devolveu a resposta com sucesso           |
| `delegation.failed`          | Consumer falhou ao processar a requisição                      |
| `automation.approval_requested` | Solicitação de aprovação de automação inter-setor criada     |
| `automation.approval_confirmed` | Automação confirmada pelo usuário com justificativa válida   |
| `automation.approval_cancelled` | Automação cancelada ou rejeitada                             |

### 8.3 DelegationTrace (frontend)

A UI recebe eventos de streaming que incluem o trace de delegação:

```typescript
type DelegationTrace = {
  from: Sector;
  to: Sector;
  intent: string;
  protocol: string;
  question: string;
  answer?: string;
  status: "pending" | "ok" | "timeout" | "bus_unavailable" | "protocol_violation" | "error";
  citations: ChatCitation[];
};
```

A interface exibe esses dados como "contribuições de outros setores" na resposta do agente.

---

## 9. Fluxo de dados no prompt final

O agente de origem combina todas as fontes para montar o prompt de geração:

```
┌─────────────────────────────────────────────────┐
│  Prompt final para o LLM (Ollama)               │
│                                                  │
│  1. Instruções da persona do setor               │
│  2. Regras gerais (responder em pt-BR, etc.)     │
│  3. Regras de citação numerada                   │
│  4. Contexto local:                              │
│     [Trecho 1] ... [Trecho N]                    │
│  5. Contribuições protocoladas (delegação):      │
│     [Consulta 1] setor=X, intent=Y               │
│       Pergunta enviada / Resposta recebida       │
│       [Trecho N+1] ... [Trecho N+M]              │
│  6. Pergunta original do usuário                 │
└─────────────────────────────────────────────────┘
```

Os trechos são numerados sequencialmente — primeiro os locais, depois os de delegação — e o agente é instruído a citar usando exatamente o número do trecho correspondente.

---

## 10. Como adicionar um novo protocolo

1. Adicione a entrada em `PROTOCOLS` no arquivo `lib/agents/protocols.ts`.
2. Defina `from`, `to`, `intent`, `id`, `template`, `maxTokens` e `enabled`.
3. Adicione regras de keywords no `lib/agents/router.ts` se quiser fallback por texto.
4. Rode a aplicação — o `syncProtocols()` no bootstrap faz upsert automático no banco.
5. Verifique que o classificador LLM reconhece o novo alvo listando-o nos targets disponíveis (isso é automático, baseado nos protocolos com `enabled: true`).

---

## 11. Automações Cross-Agent (human-in-captcha)

O sistema integra-se com o serviço `human-in-captcha` para disparar automações. Atualmente, o setor `desenvolvimento` (Forja) é o "proprietário" de automações como:
- Criação de tickets no Cervello (electronic-order)
- Pesquisa de preços de medicamentos (`medication-price-survey`)
- Coleta de índices de moedas (`coleta-indices-moedas`)

Pedidos de automação feitos diretamente pelo usuário do setor de desenvolvimento são disparados nativamente. Porém, quando um usuário de **outro setor** (ex: `seguranca` ou `suporte`) solicita uma automação de desenvolvimento, o sistema aciona um **fluxo de aprovação em duas etapas (Two-Step Approval Flow)**:

1. **Solicitação de Aprovação**: O agente de origem não enfileira a automação diretamente. Ele exige uma confirmação e gera um evento de auditoria `automation.approval_requested`.
2. **Confirmação do Usuário**: O usuário deve responder confirmando e fornecendo uma justificativa curta (ex: `sim, motivo: falha no sistema`). O agente avalia a resposta e, se o motivo for aceito (mínimo de 6 caracteres), o estado passa a ser confirmado.
3. **Despacho HTTP**: Uma vez aprovado (`automation.approval_confirmed`), a automação é despachada (ou cancelada caso rejeitada, `automation.approval_cancelled`).
   - O disparo **não usa RabbitMQ**, mas sim chamadas **HTTP-only** via rede Docker interna para o endpoint da API de automação (`HUMAN_CAPTCHA_API_URL`).
   - A requisição usa um token interno (`HUMAN_CAPTCHA_INTERNAL_TOKEN`) e chaves de idempotência baseadas no ID da mensagem persistida.

---

## 12. Variáveis de ambiente relevantes

| Variável                 | Descrição                                         | Padrão                                 |
| ------------------------ | ------------------------------------------------- | -------------------------------------- |
| `RABBITMQ_URL`           | URL de conexão AMQP                               | `amqp://pfrm:pfrm@127.0.0.1:5673`     |
| `RABBITMQ_MANAGEMENT_URL`| URL do painel de gestão do RabbitMQ                | `http://127.0.0.1:15673`              |
| `BUS_RPC_TIMEOUT_MS`     | Timeout para RPC entre agentes (ms)               | `60000`                                |
| `BUS_BOOTSTRAP_ENABLED`  | Habilita bootstrap automático do bus               | `true` (exceto se `"false"`)           |
| `CHAT_LOCAL_CONFIDENCE_THRESHOLD` | Score minimo do melhor chunk local para responder sem consultar outros setores | `0.50` |
| `OLLAMA_CLASSIFIER_MODEL`| Modelo para classificação de delegação             | Mesmo que `OLLAMA_CHAT_MODEL`          |
| `HUMAN_CAPTCHA_API_URL`  | URL da API de automações (human-in-captcha)       | `http://human-automation-api:3001`     |
| `HUMAN_CAPTCHA_INTERNAL_TOKEN` | Token de autenticação interna para automações | (obrigatório)                          |

---

## 13. Referência de arquivos

| Arquivo                         | Papel no fluxo de comunicação                              |
| ------------------------------- | ---------------------------------------------------------- |
| `lib/agents/base-agent.ts`      | Orquestra o ciclo completo: busca local, delegação, prompt |
| `lib/agents/classifier.ts`     | Classificador LLM para decidir delegação                   |
| `lib/agents/router.ts`         | Descoberta por catálogo, roteamento por keywords e resolução final |
| `lib/knowledge/capabilities.ts`| Sincroniza e ranqueia documentos `public/internal` disponíveis para delegação |
| `lib/agents/protocols.ts`      | Definição dos protocolos entre setores                     |
| `lib/agents/personas.ts`       | Persona (nome + instruções) de cada agente                 |
| `lib/agents/types.ts`          | Tipos compartilhados (payload, response, events)           |
| `lib/agents/registry.ts`       | Ponto de entrada para execução de agentes                  |
| `lib/bus/connection.ts`        | Gerencia conexão AMQP singleton                            |
| `lib/bus/publisher.ts`         | Publica RPC e eventos de auditoria                         |
| `lib/bus/consumer.ts`          | Consome filas setoriais e responde RPC                     |
| `lib/bus/audit-consumer.ts`    | Consome fila de auditoria e persiste no banco              |
| `lib/bus/bootstrap.ts`         | Bootstrap de toda a infraestrutura do bus                  |
| `lib/db/audit-repo.ts`         | Persistência de AgentCall e AuditEvent                     |
| `instrumentation.ts`           | Gatilho de inicialização no startup do Next.js             |
| `prisma/schema.prisma`         | Schema das tabelas AgentCall, AuditEvent, Protocol         |
