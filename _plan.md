# Plano de Implementação: Provisionamento Dinâmico de Setores e Agentes

Este documento registra o progresso da implementação da funcionalidade de criação dinâmica de setores e agentes.

## O Que Foi Feito (Concluído)

- **Fase 1: Schema de Banco de Dados**
  - Adicionado os models `SectorDefinition` e `SectorAccessRule` ao `schema.prisma`.
  - Executada a migration e banco de dados atualizado.
  - Atualizado o script `seed.ts` para popular os setores nativos e regras de acesso iniciais.

- **Fase 2: Repositórios e Lógica de Domínio**
  - Criado `lib/sectors/sector-repo.ts` (gerenciamento no BD).
  - Criado `lib/sectors/provisioner.ts` (orquestração de BD, Qdrant, RabbitMQ).
  - Criado `lib/sectors/access-rules.ts` (gerenciamento das regras de acesso intersetorial).
  - Atualizado `lib/domain.ts` para suportar `DynamicSector` e tipagem de strings no lugar de enums fixos.
  - Dinamizada a resolução de Qdrant (`lib/config.ts`) e rótulos (`lib/labels.ts`).

- **Fase 3: APIs REST Admin**
  - Criadas rotas `/api/admin/sectors` (GET, POST).
  - Criadas rotas `/api/admin/sectors/[slug]` (PATCH).
  - Criadas rotas `/api/admin/sectors/[slug]/access` (GET, PATCH).
  - O backend agora suporta registro e provisionamento de setores dinamicamente via API.

- **Fase 4: Infraestrutura (Message Bus e Qdrant)**
  - O Qdrant já cria dinamicamente `collectionForSector` no provisionamento.
  - O RabbitMQ agora inicializa filas para todos os setores listados no BD (`listAllSectorSlugs`), garantindo que não dependa do enum estático.

- **Fase 5: Roteamento e Classificadores**
  - `lib/agents/personas.ts`: Adicionado fallback assíncrono para carregar personas dinâmicas via `SectorDefinition`.
  - `lib/agents/effective.ts`: Modificado para aceitar `string` e repassar dados dinâmicos para agentes base.
  - `lib/agents/classifier.ts`: Atualizado para usar tipagem `string` e invocar personas não limitadas ao Enum.
  - `lib/agents/router.ts`: Migrado de regras fixas (`DOMAIN_ROUTING`) para uso de `SectorAccessRule` (Regras de Banco) baseadas nas `routingKeywords`.

- **Correção de Tipos Finais (TypeScript) — CONCLUÍDO**
  - `AgentCall.fromAgent` e `AgentCall.toAgent` migrados de `Sector` enum para `String` no schema.
  - `Protocol.fromSector` e `Protocol.toSector` migrados de `Sector` enum para `String` no schema.
  - Migration `20260512115447` criada com `ALTER COLUMN ... TYPE TEXT USING ... ::TEXT` (cast sem perda de dados).
  - `lib/db/audit-repo.ts`: tipos corrigidos para `string`.
  - `lib/agents/config-repo.ts`: `ProtocolOverrideRow`, `loadAllAgentConfigs`, `protocolKey`, `updateProtocol`, `resetProtocol` corrigidos para `string`.
  - `lib/agents/effective.ts`: `findEffectiveProtocol` corrigido para `string`; import de `Sector` removido.
  - `lib/bus/consumer.ts` e `lib/bus/bootstrap.ts`: cast `as Sector` removido.
  - Erros em testes corrigidos (`router.test.ts`, `agent-config.test.ts`, `consolidation.test.ts`).
  - `npx tsc --noEmit` retorna **zero erros**.

- **Fase 6: Interface Frontend (Acesso do Usuário e "Efeito UAU") — CONCLUÍDO**
  - Criado `components/create-agent-drawer.tsx`: Wizard premium de 4 etapas (Detalhes → Identidade IA → Capacidades → Provisionamento) com validação inline e chamada `POST /api/admin/sectors`.
  - Criado `components/sector-access-matrix.tsx`: Matriz visual interativa de regras `SectorAccessRule` com edição inline (nível de acesso + palavras-chave de roteamento), cores por nível (teal = public, azul = full, vermelho = denied).
  - `components/agent-control-center.tsx`: Botão "Novo agente" ativado e conectado ao drawer; seção "Matriz de acesso intersetorial" adicionada com `SectorAccessMatrix`.

## Status Final

Todas as fases planejadas estão concluídas. O sistema suporta provisionamento dinâmico de setores/agentes via UI, com matriz de controle de acesso intersetorial e zero erros TypeScript.
