# Estratégia de Migração: Backend NestJS Multi-Canal

## Objetivo

Extrair o backend do Next.js para um serviço NestJS independente (`pfrm-agent-gateway`) que sirva o frontend web atual e qualquer canal futuro (Teams, Telegram, WhatsApp). O Next.js permanece como frontend puro.

---

## 1. Visão geral da arquitetura alvo

```
┌─────────────────────────────────────────────────────────────────┐
│                        Clients                                  │
│  Next.js (web)  │  Telegram Bot  │  Teams Bot  │  WhatsApp API │
└───────┬─────────┴───────┬────────┴──────┬──────┴───────┬───────┘
        │                 │               │              │
        ▼                 ▼               ▼              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   pfrm-agent-gateway (NestJS)                   │
│                                                                 │
│  ┌───────────┐ ┌──────────┐ ┌─────────┐ ┌──────────────┐      │
│  │ WebModule │ │ TGModule │ │ TMModule │ │ WhatsAppMod. │      │
│  └─────┬─────┘ └────┬─────┘ └────┬────┘ └──────┬───────┘      │
│        └─────────────┴────────────┴─────────────┘              │
│                          │                                      │
│                 OrchestratorService                              │
│                          │                                      │
│        ┌─────────────────┼─────────────────┐                   │
│        ▼                 ▼                 ▼                   │
│  AgentsModule      BusModule        AutomationModule           │
│  (personas,        (RabbitMQ,       (intent detection,         │
│   router,          topology,         approval, launch)          │
│   classifier,      consumers)                                   │
│   RAG/Ollama)                                                   │
│        │                 │                 │                    │
│        └─────────────────┴─────────────────┘                   │
│                          │                                      │
│               ┌──────────┴──────────┐                          │
│               │    PrismaModule     │                          │
│               │  (DB, repos, audit) │                          │
│               └─────────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Inventário do que migra

### Módulos de domínio (migram intactos como services)

| Origem atual | Destino NestJS | Tipo | Observação |
|---|---|---|---|
| `lib/agents/base-agent.ts` | `AgentsService` | Service | `runSectorAgent()` e `answerAgentInternally()` |
| `lib/agents/router.ts` | `RouterService` | Service | `resolveDelegation()` |
| `lib/agents/classifier.ts` | `ClassifierService` | Service | `classifyDelegationWithLLM()` |
| `lib/agents/protocols.ts` | `ProtocolsService` | Service | Dados estáticos + `getProtocol()` |
| `lib/agents/personas.ts` | `PersonasService` ou constante | Provider | Mapa de personas |
| `lib/ollama.ts` | `OllamaService` | Service | Embeddings + generation stream |
| `lib/qdrant.ts` | `QdrantService` | Service | Search + ingest chunks |
| `lib/bus/connection.ts` | `BusConnectionService` | Service | Gerenciamento de conexão AMQP |
| `lib/bus/publisher.ts` | `BusPublisherService` | Service | `requestAgent()` + `publishAuditEvent()` |
| `lib/bus/consumer.ts` | `BusConsumerService` | Service | Consumers por setor |
| `lib/bus/bootstrap.ts` | `BusModule.onModuleInit()` | Lifecycle | Bootstrap na inicialização do módulo |
| `lib/automation/cervello-ticket.ts` | `AutomationDetectorService` | Service | `detectHumanCaptchaAutomationIntent()` |
| `lib/automation/approval.ts` | `ApprovalService` | Service | `parseApprovalDecision()` |
| `lib/integrations/human-captcha.ts` | `HumanCaptchaClient` | Service | HTTP client para automações |
| `lib/document.ts` + `lib/pdf.ts` + `lib/word.ts` + `lib/markdown.ts` | `DocumentService` | Service | Parsing e chunking |
| `lib/upload.ts` | `UploadService` | Service | Validação de uploads |
| `lib/config.ts` | `ConfigModule` (NestJS nativo) | Module | `@nestjs/config` com validação Zod |

### Repositórios de dados (migram como services injetáveis)

| Origem atual | Destino NestJS |
|---|---|
| `lib/db/client.ts` | `PrismaService extends PrismaClient` com `onModuleInit()` |
| `lib/db/users-repo.ts` | `UsersRepository` |
| `lib/db/conversations-repo.ts` | `ConversationsRepository` |
| `lib/db/messages-repo.ts` | `MessagesRepository` |
| `lib/db/audit-repo.ts` | `AuditRepository` |

### API Routes que viram Controllers

| Rota Next.js atual | Controller NestJS | Métodos |
|---|---|---|
| `app/api/chat/route.ts` (POST) | `ChatController` | `POST /api/chat` (SSE para web) |
| `app/api/conversations/route.ts` (GET, POST) | `ConversationsController` | `GET /api/conversations`, `POST /api/conversations` |
| `app/api/conversations/[id]/route.ts` | `ConversationsController` | `GET /api/conversations/:id` |
| `app/api/messages/[messageId]/route.ts` | `MessagesController` | `GET /api/messages/:id` |
| `app/api/ingest/route.ts` (POST) | `IngestController` | `POST /api/ingest` |
| `app/api/admin/chunks/route.ts` | `AdminController` | `GET /api/admin/chunks` |
| `app/api/health/route.ts` (GET) | `HealthController` | `GET /api/health` |

### O que NÃO migra (permanece no Next.js)

| Item | Motivo |
|---|---|
| `app/chat/`, `app/files/`, `app/admin/`, `app/login/` | Páginas React (frontend) |
| `components/` | Componentes React da UI |
| `app/layout.tsx`, `app/globals.css` | Layout e estilos |
| `app/api/auth/` | Auth.js handlers — substituído por JWT emitido pelo gateway |

---

## 3. Estrutura de diretórios do gateway

```
pfrm-agent-gateway/
├── src/
│   ├── main.ts                          # Bootstrap NestJS
│   ├── app.module.ts                    # Root module
│   │
│   ├── config/
│   │   ├── config.module.ts             # @nestjs/config + validação Zod
│   │   └── env.schema.ts               # Schema Zod (vem de lib/config.ts)
│   │
│   ├── prisma/
│   │   ├── prisma.module.ts             # Global module
│   │   ├── prisma.service.ts            # PrismaClient lifecycle
│   │   └── repositories/
│   │       ├── users.repository.ts
│   │       ├── conversations.repository.ts
│   │       ├── messages.repository.ts
│   │       ├── audit.repository.ts
│   │       └── channel-bindings.repository.ts  # NOVO
│   │
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.service.ts              # Login, JWT, validação
│   │   ├── auth.controller.ts           # POST /auth/login, POST /auth/refresh
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts        # Protege rotas web
│   │   │   ├── webhook-signature.guard.ts # Verifica assinatura Telegram/WhatsApp
│   │   │   └── channel-binding.guard.ts # Resolve userId de canal externo
│   │   └── strategies/
│   │       └── jwt.strategy.ts          # Passport JWT strategy
│   │
│   ├── agents/
│   │   ├── agents.module.ts
│   │   ├── agents.service.ts            # runSectorAgent + answerAgentInternally
│   │   ├── router.service.ts            # resolveDelegation
│   │   ├── classifier.service.ts        # classifyDelegationWithLLM
│   │   ├── protocols.service.ts         # getProtocol + PROTOCOLS
│   │   └── personas.ts                  # Constante estática
│   │
│   ├── rag/
│   │   ├── rag.module.ts
│   │   ├── ollama.service.ts            # Embeddings + generation
│   │   └── qdrant.service.ts            # Search + ingest
│   │
│   ├── bus/
│   │   ├── bus.module.ts                # onModuleInit → bootstrap topology
│   │   ├── bus-connection.service.ts
│   │   ├── bus-publisher.service.ts
│   │   └── bus-consumer.service.ts
│   │
│   ├── automation/
│   │   ├── automation.module.ts
│   │   ├── automation-detector.service.ts
│   │   ├── approval.service.ts
│   │   └── human-captcha.client.ts
│   │
│   ├── orchestrator/
│   │   ├── orchestrator.module.ts
│   │   ├── orchestrator.service.ts      # processMessage() — coração do sistema
│   │   └── types.ts                     # CanonicalMessage, CanonicalResponse
│   │
│   ├── channels/
│   │   ├── web/
│   │   │   ├── web.module.ts
│   │   │   ├── chat.controller.ts       # POST /api/chat (SSE stream)
│   │   │   ├── conversations.controller.ts
│   │   │   ├── messages.controller.ts
│   │   │   └── ingest.controller.ts
│   │   ├── telegram/
│   │   │   ├── telegram.module.ts
│   │   │   ├── telegram.controller.ts   # POST /api/channels/telegram/webhook
│   │   │   └── telegram.adapter.ts
│   │   ├── teams/
│   │   │   ├── teams.module.ts
│   │   │   ├── teams.controller.ts      # POST /api/channels/teams/messages
│   │   │   └── teams.adapter.ts
│   │   └── whatsapp/
│   │       ├── whatsapp.module.ts
│   │       ├── whatsapp.controller.ts   # GET+POST /api/channels/whatsapp/webhook
│   │       └── whatsapp.adapter.ts
│   │
│   ├── admin/
│   │   ├── admin.module.ts
│   │   ├── admin.controller.ts
│   │   └── channel-bindings.controller.ts  # CRUD de bindings
│   │
│   ├── health/
│   │   └── health.controller.ts
│   │
│   └── common/
│       ├── interceptors/
│       │   └── audit.interceptor.ts     # Auditoria automática cross-cutting
│       ├── filters/
│       │   └── global-exception.filter.ts
│       └── domain.ts                    # Sector, ChatCitation, etc.
│
├── prisma/
│   └── schema.prisma                    # Mesmo schema + ChannelBinding + channel fields
│
├── test/
│   ├── router.spec.ts
│   ├── protocols.spec.ts
│   ├── approval.spec.ts
│   ├── automation-detector.spec.ts
│   └── orchestrator.spec.ts
│
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
├── nest-cli.json
└── .env.example
```

---

## 4. O coração da migração: OrchestratorService

A peça central é extrair as ~400 linhas de `app/api/chat/route.ts` (L310-610) para uma função pura e injetável.

**Contrato:**

```typescript
// src/orchestrator/types.ts
export type CanonicalMessage = {
  channel: 'web' | 'telegram' | 'teams' | 'whatsapp';
  userId: string;          // userId já resolvido (via JWT ou ChannelBinding)
  sector: Sector;          // setor do usuário
  userEmail: string;
  text: string;
  conversationId?: string; // se continuar conversa existente
};

export type CanonicalResponse = {
  conversationId: string;
  messageId: string;
  traceId: string;
  answer: string;
  citations: ChatCitation[];
  delegationTrace: DelegationTrace[];
  automationResult?: HumanCaptchaAutomationLaunchResponse;
  metrics?: GenerationMetrics;
};
```

**O service:**

```typescript
// src/orchestrator/orchestrator.service.ts
@Injectable()
export class OrchestratorService {
  constructor(
    private agents: AgentsService,
    private automationDetector: AutomationDetectorService,
    private approval: ApprovalService,
    private humanCaptcha: HumanCaptchaClient,
    private conversations: ConversationsRepository,
    private messages: MessagesRepository,
    private audit: AuditRepository,
    private busPublisher: BusPublisherService,
  ) {}

  async processMessage(msg: CanonicalMessage): Promise<CanonicalResponse> {
    // 1. Resolver ou criar conversa
    // 2. Persistir mensagem do usuário
    // 3. Checar pending approval
    // 4. Detectar intent de automação
    // 5. Chamar runSectorAgent() se não for automação
    // 6. Persistir resposta
    // 7. Publicar auditoria
    // 8. Retornar CanonicalResponse
  }
}
```

Cada channel adapter chama `orchestrator.processMessage()` e converte o resultado para o formato do canal.

---

## 5. Autenticação por canal

### Web (JWT)

```
Frontend Next.js  →  POST /auth/login (email+senha)  →  JWT
                  →  POST /api/chat (Authorization: Bearer <JWT>)
```

O `auth.ts` atual com Auth.js/Credentials vira um `AuthService` com bcrypt + `@nestjs/jwt`. O frontend passa a usar JWT em header ao invés de cookie de sessão.

### Canais externos (ChannelBinding)

```
Telegram msg  →  webhook  →  ChannelBindingGuard
              →  busca ChannelBinding(channel='telegram', externalId=chatId)
              →  resolve userId + sector
              →  chama orchestrator
```

**Novo model no Prisma:**

```prisma
model ChannelBinding {
  id         String    @id @default(cuid())
  userId     String    @map("user_id")
  channel    String    // "telegram" | "teams" | "whatsapp"
  externalId String    @map("external_id")
  verifiedAt DateTime? @map("verified_at")
  createdAt  DateTime  @default(now()) @map("created_at")
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([channel, externalId])
  @@map("channel_bindings")
}
```

**Fluxo de vinculação (self-service):**

1. Usuário loga no web → gera token temporário de vinculação (6 dígitos, 10 min TTL)
2. Usuário envia o token no Telegram/Teams/WhatsApp
3. Gateway valida o token e cria o `ChannelBinding`
4. Mensagens futuras daquele chatId são autenticadas automaticamente

---

## 6. Mudanças no schema Prisma

```prisma
# Adições ao schema existente:

model Conversation {
  # campos existentes...
  channel   String  @default("web")    # NOVO
}

model Message {
  # campos existentes...
  channel   String  @default("web")    # NOVO
}

model ChannelBinding {                 # NOVO
  id         String    @id @default(cuid())
  userId     String    @map("user_id")
  channel    String
  externalId String    @map("external_id")
  verifiedAt DateTime? @map("verified_at")
  createdAt  DateTime  @default(now()) @map("created_at")
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([channel, externalId])
  @@map("channel_bindings")
}
```

O schema Prisma é compartilhado — o gateway usa o mesmo banco Postgres.

---

## 7. Mudanças no frontend Next.js

| Mudança | Detalhe |
|---|---|
| Remover `app/api/chat/`, `app/api/conversations/`, `app/api/messages/`, `app/api/ingest/`, `app/api/health/`, `app/api/admin/` | APIs agora vivem no gateway |
| Remover `lib/` inteiro | Domínio migrou para o gateway |
| Remover `auth.ts` | Auth agora é JWT do gateway |
| Remover `prisma/` | Schema vive no gateway |
| Remover `instrumentation.ts` | Bootstrap vive no gateway |
| Adicionar `GATEWAY_URL` env var | Ex: `http://localhost:3040` |
| Adaptar `components/secure-chat-workbench.tsx` | Apontar fetch para `GATEWAY_URL/api/chat` com header `Authorization: Bearer <JWT>` |
| Adaptar `components/sector-ingestion-workbench.tsx` | Idem para ingest |
| Criar `lib/gateway-client.ts` | Helper para chamadas autenticadas ao gateway |
| Adaptar login flow | `POST GATEWAY_URL/auth/login` → armazena JWT em cookie/localStorage → envia em headers |

O Next.js final fica com ~5 arquivos em `lib/` (gateway client, auth helpers) e zero lógica de negócio.

---

## 8. Docker Compose alvo

```yaml
services:
  gateway:
    build:
      context: ./pfrm-agent-gateway
    container_name: pfrm_agent_gateway
    ports:
      - "3040:3040"
    environment:
      DATABASE_URL: postgresql://pfrm:pfrm@postgres:5432/pfrm_agents
      RABBITMQ_URL: amqp://pfrm:pfrm@rabbitmq:5672
      QDRANT_URL: http://qdrant:6333
      OLLAMA_URL: http://ollama-cpu:11434
      JWT_SECRET: ${JWT_SECRET}
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN:-}
      MICROSOFT_APP_ID: ${MICROSOFT_APP_ID:-}
      WHATSAPP_ACCESS_TOKEN: ${WHATSAPP_ACCESS_TOKEN:-}
      # ... demais env vars
    depends_on:
      postgres: { condition: service_healthy }
      qdrant: { condition: service_healthy }
      rabbitmq: { condition: service_healthy }
    networks:
      - default
      - pfrm-local-internal

  web:
    build:
      context: ./pfrm-secure-agents   # Next.js frontend only
    container_name: pfrm_web
    ports:
      - "3030:3030"
    environment:
      GATEWAY_URL: http://gateway:3040
    depends_on:
      - gateway

  # postgres, qdrant, rabbitmq, ollama — sem mudança
```

---

## 9. Dependências do gateway

```json
{
  "dependencies": {
    "@nestjs/common": "^11",
    "@nestjs/core": "^11",
    "@nestjs/config": "^4",
    "@nestjs/jwt": "^11",
    "@nestjs/passport": "^11",
    "@nestjs/platform-express": "^11",
    "passport": "^0.7",
    "passport-jwt": "^4",
    "@prisma/client": "^7.8",
    "@prisma/adapter-pg": "^7.8",
    "pg": "^8",
    "@qdrant/js-client-rest": "^1.17",
    "amqplib": "^1",
    "bcryptjs": "^3",
    "zod": "^4",
    "mammoth": "^1.11",
    "pdf-parse": "^2.4",
    "word-extractor": "1.0.4",
    "turndown": "^7",
    "turndown-plugin-gfm": "^1",
    "grammy": "^1"
  },
  "devDependencies": {
    "@nestjs/cli": "^11",
    "@nestjs/testing": "^11",
    "prisma": "^7.8",
    "vitest": "^3",
    "typescript": "^5"
  }
}
```

---

## 10. Plano de execução faseado

### Fase 1 — Scaffold e infraestrutura (1-2 dias)

- [ ] Criar projeto NestJS com `npx @nestjs/cli new pfrm-agent-gateway`
- [ ] Configurar `ConfigModule` com schema Zod das env vars
- [ ] Configurar `PrismaModule` global com o schema existente
- [ ] Copiar `prisma/schema.prisma` + adicionar `ChannelBinding` e campo `channel`
- [ ] Rodar `prisma migrate dev`
- [ ] Criar `HealthController` para validar stack rodando

### Fase 2 — Migrar domínio (2-3 dias)

- [ ] Criar `AgentsModule` com services: `AgentsService`, `RouterService`, `ClassifierService`, `ProtocolsService`
- [ ] Criar `RagModule` com `OllamaService` e `QdrantService`
- [ ] Criar `BusModule` com connection, publisher, consumer e bootstrap no `onModuleInit`
- [ ] Criar `AutomationModule` com detector, approval e human-captcha client
- [ ] Criar repositories em `PrismaModule`: users, conversations, messages, audit
- [ ] Validar que os testes unitários existentes passam portados para o gateway

### Fase 3 — Orchestrator + Auth (1-2 dias)

- [ ] Criar `OrchestratorModule` com `OrchestratorService.processMessage()`
- [ ] Extrair lógica de `app/api/chat/route.ts` L310-610 para o orchestrator
- [ ] Criar `AuthModule` com login via bcrypt + emissão JWT
- [ ] Criar `JwtAuthGuard` para proteger rotas web

### Fase 4 — Channel Web (1-2 dias)

- [ ] Criar `WebModule` com controllers: Chat, Conversations, Messages, Ingest
- [ ] `ChatController` recebe POST, chama orchestrator, retorna SSE stream
- [ ] Adaptar frontend Next.js para chamar o gateway (trocar `/api/*` por `GATEWAY_URL/api/*`)
- [ ] Remover `app/api/`, `lib/`, `auth.ts`, `prisma/`, `instrumentation.ts` do Next.js
- [ ] Testar fluxo completo: login → chat → delegação → automação → ingestão

### Fase 5 — Channel Telegram (1-2 dias)

- [ ] Criar `TelegramModule` com adapter e controller de webhook
- [ ] Implementar `ChannelBindingGuard` para resolver userId
- [ ] Criar fluxo de vinculação (token temporário)
- [ ] Criar `AdminModule` com CRUD de channel bindings
- [ ] Testar com BotFather + ngrok

### Fase 6 — Channel Teams (2-3 dias)

- [ ] Registrar Azure Bot + App Registration
- [ ] Criar `TeamsModule` com adapter usando `botbuilder`
- [ ] Implementar webhook signature guard
- [ ] Testar com sideloading no Teams

### Fase 7 — Channel WhatsApp (1-2 dias)

- [ ] Configurar WhatsApp Business Account no Meta
- [ ] Criar `WhatsAppModule` com adapter usando fetch puro (Cloud API)
- [ ] Implementar verificação de webhook + assinatura
- [ ] Testar com sandbox Meta

### Fase 8 — Polimento (1-2 dias)

- [ ] `AuditInterceptor` global para logging automático com `channel`
- [ ] Rate limiting por canal
- [ ] Testes de integração end-to-end
- [ ] Atualizar documentação: `docs/architecture.md`, `README.md`, `memory.md`
- [ ] Atualizar `docker-compose.yml` no monorepo

**Estimativa total: 10-16 dias de trabalho focado.**

---

## 11. Invariantes preservados

Todas as regras do sistema atual DEVEM continuar valendo no gateway:

| Regra | Como é preservada no NestJS |
|---|---|
| Usuário fala só com agente do próprio setor | `OrchestratorService` resolve sector do userId, não do canal |
| Delegação cross-sector só via bus | `AgentsService` mantém mesma lógica de RPC |
| Automação cross-sector exige aprovação com motivo | `ApprovalService` é chamado pelo orchestrator antes do launch |
| Ingestão só no setor autenticado | `IngestController` valida sector do JWT/binding |
| Auditoria completa | `AuditInterceptor` + chamadas explícitas no orchestrator |
| Idempotência de automação | Chave baseada no `messageId` do sistema, não do canal |

---

## 12. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Regressão durante migração | Portar os 6 testes existentes antes de migrar lógica. Fase 4 é o gate: se o web funciona igual, a migração está saudável. |
| Autenticação JWT vs cookies | O frontend precisa adaptar fetch para header-based. Mudança localizada em `secure-chat-workbench.tsx` e `sector-ingestion-workbench.tsx`. |
| Streaming SSE via NestJS | NestJS suporta SSE nativamente com `@Sse()` decorator ou retornando `Observable<MessageEvent>`. |
| Complexidade de manter 2 projetos | Manter no mesmo monorepo (`pfrm-secure-chat/pfrm-agent-gateway` + `pfrm-secure-chat/pfrm-secure-agents`). Prisma schema compartilhado. |
| Canais sem streaming nativo | Telegram: typing indicator + mensagem completa. WhatsApp: idem. Teams: streaming parcial via SDK v4.22+. |

---

## 13. Decisão: NestJS vs. Refatorar dentro do Next.js

| Critério | Refatorar no Next.js | Migrar para NestJS |
|---|---|---|
| Esforço imediato | Menor (3-5 dias) | Maior (10-16 dias) |
| Multi-canal | Possível, mas webhooks em API routes são gambiarras | Nativo — cada canal é um module com guards próprios |
| Testabilidade | Difícil testar API routes isoladamente | DI nativo, `@nestjs/testing` pronto |
| Escalabilidade | Frontend e backend escalam juntos | Backend escala independente |
| Auth flexível | Auth.js é cookie-first, adapter para JWT é workaround | JWT/Passport nativo com strategies por canal |
| Lifecycle management | `globalThis` hacks para singletons (bus, prisma) | `onModuleInit/Destroy` nativo |
| Manutenção longo prazo | Lógica de negócio misturada com framework de UI | Separação clara, padrão enterprise TypeScript |

**Recomendação**: Se multi-canal é uma funcionalidade estratégica (não um experimento), o investimento em NestJS se paga. Os hacks de `globalThis` para conexão, o bootstrap em `instrumentation.ts`, e as 622 linhas do route handler são sinais de que o Next.js já está sendo forçado além do seu propósito.

---

Última revisão: 2026-05-02.
