# Roadmap — `pfrm-secure-agents`

Horizonte: 180 dias a partir de 2026-05-02
Princípio: cada fase só começa quando a métrica-âncora da fase anterior estiver atendida.

## Fase 0 — Estabilização (semanas 1-2)

Métrica-âncora: o produto em uso por usuários-piloto não trava o time.

- [ ] Confirmar patrocinador executivo e owner de produto formalmente.
- [ ] Mover `ensureBusBootstrapped()` para inicialização do container.
- [ ] Adicionar política de "não sei": agente recusa quando não há citação acima do threshold.
- [ ] Adicionar suite E2E mínima (Playwright): login, chat, delegação, feedback.
- [ ] Definir setor piloto e mapear seus 5 donos de conhecimento.
- [ ] Iniciar conversa formal com Compliance/Jurídico para DPIA e política de uso.

## Fase 1 — Loop de correção (semanas 3-8)

Métrica-âncora: ≥ 90% das lacunas detectadas atribuídas em até 24h e fechadas em até 7 dias úteis.

- [ ] Modelo de dado: `KnowledgeOwner(topic, sector, userEmail)` no Prisma.
- [ ] Painel `/admin/gaps`: lista perguntas sem citação suficiente + feedback negativo.
- [ ] Atribuição automática de lacuna ao dono do tópico.
- [ ] Notificação por e-mail / Teams ao dono quando lacuna é aberta.
- [ ] Botão "esse trecho está errado" na citação; abre incidente ligado a `chunkId`/`documentId`.
- [ ] Workflow de fechamento: dono ou colaborador anexa documento corrigido / responde inline.
- [ ] Curadoria com staging portada do `pfrm-chat` para fontes corrigidas.
- [ ] Métrica `% feedback positivo`, `lacunas em aberto`, `MTTR de correção` em painel.

## Fase 2 — Qualidade do RAG e governança (semanas 9-14)

Métrica-âncora: % de respostas com pelo menos 1 citação acima do score mínimo ≥ 75%.

- [ ] Reranker (`bge-reranker-v2-m3`) sobre top-K do Qdrant.
- [ ] Frontmatter obrigatório no upload: `effective_from`, `supersedes`, `owner`, `sensitivity`.
- [ ] Filtro de retrieval respeita `effective_from`: descarta versões aposentadas.
- [ ] Detector de tópico sensível pré-resposta; resposta automática de encaminhamento.
- [ ] Versionamento de embedding model por chunk.
- [ ] Memória por conversa (últimas N mensagens da mesma `conversationId` no prompt).
- [ ] Memória por usuário (papel, projetos ativos) no prompt.

## Fase 3 — Conectores e canais (semanas 15-22)

Métrica-âncora: 30 usuários ativos/semana cumulativo entre web e segundo canal.

- [ ] Conector síncrono para uma fonte autoritativa (sugestão: Confluence interno).
- [ ] Reingestão periódica agendada com respeito a ACL da fonte.
- [ ] Camada Channel Adapter (do `MULTICHANNEL-STRATEGY.md`).
- [ ] Adapter Teams como segundo canal.
- [ ] Mapeamento `externalUserId` (UPN do Teams) → `userId` interno.

## Fase 4 — Decisão sobre arquitetura definitiva (semanas 23-26)

Métrica-âncora: decisão informada por dados de produção.

- [ ] Avaliar custo/benefício real de migrar para NestJS (`estrategia-migracao-nest.md`).
- [ ] Avaliar custo/benefício de GPU dedicada baseado em p95 de geração.
- [ ] Avaliar adicionar 4º agente (sugestão: financeiro ou jurídico) com base em demanda real.

## O que não está no roadmap (e por quê)

- **Migração para NestJS** — só justificável quando houver mais de um canal ativo.
- **OCR** — alto custo, baixo retorno; só se perguntas críticas pararem em PDFs escaneados.
- **GPU dedicada** — só se latência observada justificar.
- **Multi-tenant** — fora do problema. O produto é interno.

## Princípios do roadmap

1. **Loop antes de canal:** sem loop, mais canais multiplicam respostas ruins.
2. **Qualidade antes de cobertura:** subir confiança em poucos tópicos é melhor que tentar responder tudo.
3. **Pessoa antes de pipeline:** mapear donos é mais valioso que automatizar atribuição.
4. **Decisão baseada em métrica observada,** não em suposição.
