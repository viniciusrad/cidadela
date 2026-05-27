# failure.md — Análise conceitual do projeto de ontologia de processos (revisada)

Data: 2026-05-20
Revisão: 2 (a primeira versão usou referenciais desatualizados; esta versão foi reescrita após inspeção do estado real do código em `lib/`, `app/`, `prisma/schema.prisma`, `memory.md`, e dos referenciais corrigidos em `docs/diagnostico-ecossistema-conhecimento.md`, `docs/neo4j-domains.md` e `plano-classificacao-documentos.md`).
Tipo: análise estratégica/conceitual.

> **Por que essa revisão existe.** A primeira versão deste arquivo apoiou-se em documentos escritos entre 2026-05-02 e 2026-05-05 e tratou como "faltando" várias peças que foram efetivamente implementadas entre 2026-05-04 e 2026-05-19. Isso distorceu a análise: criticou-se o que já existia e perdeu-se o foco no que de fato continua não resolvido. Esta versão recalibra.

---

## 1. Resumo executivo

O projeto **não falhou por falta de engenharia**, e essa frase tem peso maior agora do que tinha na análise anterior: depois de revisitar o código, o conjunto entregue é mais robusto e completo do que os documentos de referência sugeriam. Curadoria por tipo, mapa de processos, grafo bidirecional, classificador pré-upload, política de "não sei" com fan-out cross-sector, fila de correções de chunks, lacunas roteadas para curadoria com reprocesso do artefato — tudo isso existe, foi testado e está validado em build/lint/test locais.

A falha real é mais sutil e mais incômoda: **a engenharia continuou correndo enquanto a adoção não saiu do lugar**. Cada peça nova endereçava um problema técnico legítimo, mas a sequência de entregas nunca chegou ao degrau em que o sistema sai da sala da equipe e encontra usuários que não são os próprios desenvolvedores. O ecossistema declarado pelo patrocinador — "lacuna → dono → correção" — está implementado **dentro do app web**; o que não existe é a parte que faz esse loop encontrar o humano onde ele já está, com cadência regular, sem depender de alguém abrir `/admin/curation`.

Em uma frase: **construímos o motor inteiro e ainda não ligamos o carro na rua**.

---

## 2. O que efetivamente existe hoje (correção da análise anterior)

A análise anterior tratou os itens abaixo como pendências. Eles **não são** pendências:

### 2.1. Loop "lacuna → dono → correção" — implementado dentro do app

- `agent.unanswered` é gravado em `AuditEvent` **e** alimenta o `ProcessMap` como sinal de baixa cobertura.
- `bad feedback` ganhou modal com pergunta variável e comentário do usuário (até 1000 caracteres), persistido no `payload`.
- Sugestão de correção por chunk existe ponta a ponta: usuário clica na citação, propõe novo texto, vai para `chunk_feedbacks` (PENDING/APPROVED/REJECTED), revisor admin ou setorial aprova/aplica em `/admin/corrections`, e o conteúdo do chunk é regravado com novo embedding.
- `ProcessGapQuestion` promovida para curadoria aparece em `/admin/curation` aba "Lacunas Operacionais"; resposta do curador é gravada na última `DocumentReview` e **reprocessa o documento promovido**: regrava o markdown curado físico, recalcula `document_id`, regera chunks, remove staleness em outros setores, refaz embeddings.

### 2.2. Granularidade de responsabilidade — primeira classe no modelo de dados

- `ProcessMap` (fingerprint estável, `automationReadinessScore`, `documentationCoverageScore`, `confidenceScore`, `processSignals`, `systemNames`, `documentRefs`, `graphEvidence`, `vectorEvidence`) consolidado em 2026-05-09. O mapa é refreshable, idempotente e reaproveita gap questions existentes.
- `KnowledgeOwner(topic, sector, userEmail)` modelado e seedado para piloto.
- `KnowledgeCapability` sintetiza por setor o que é compartilhável (filtrando `confidential`/`restricted`) e participa do roteamento cross-sector.

### 2.3. Ontologia consumida pelo retrieval — não é só decorativa

- Modos de recuperação no chat: `RAG ON + Grafo ON` (default), `RAG OFF + Grafo ON` (grafo seleciona documentos por entidade, Postgres lê o conteúdo), `RAG OFF + Grafo OFF` (busca SQL em promovidos). O grafo é caminho real de resposta, não só painel.
- Provenance bidirecional Qdrant ↔ Neo4j via nó `RagChunk` com `pointId`, `collectionName`, `chunkIndex`, `contentHash`, `headingPathText`. Arestas `RagChunk-[:MENTIONS]->Entity` permitem ir do nó da entidade até o chunk citado e voltar. Arestas `Document-[:Entity]->...` agora carregam `evidenceChunkIds` quando o nome aparece literalmente em algum chunk.
- Fan-out cross-sector ativado por `CHAT_LOCAL_CONFIDENCE_THRESHOLD=0.50` (configurável). Quando o melhor chunk local cai abaixo, o agente consulta todos os setores com protocolo habilitado, prefere evidência delegada mais forte e atribui a fonte no texto final ("Segundo o agente Helpdesk (setor suporte)...").

### 2.4. Curadoria com staging — implementada e refinada várias vezes

- Toda ingestão via `/api/ingest` ou `/api/curation/upload` vai para `rag_<setor>_staging`. Promoção exige resolver `DocumentCorrelationRun` críticos e ter ao menos uma aprovação (owner OU admin, decisão de 2026-05-06).
- Perguntas template viraram opcionais; perguntas inferidas pelo modelo local complementam quando há lacuna; respostas-padrão deterministas pré-preenchem o que dá para inferir; `source="process_gap"` traz perguntas vindas do mapa de processos sem contar para o readiness.
- Promote produz artefato físico sob `files/sop/<setor>/` ou `files/curated/<setor>/<tipo>/`, recalcula chunks, e mantém `source_document_id` para bloquear reenvio duplicado.

### 2.5. Classificação documental — pré-upload com confirmação humana

- 11 tipos documentais (`sop`, `ddp`, `norma`, `ata`, `doc_tecnica`, `faq`, `comunicado`, `relatorio`, `contrato`, `conversa`, `generico`).
- `POST /api/classify` retorna sugestão heurística com confiança e motivo; UI mostra antes do envio e permite corrigir.
- Renderizadores por tipo (`lib/curation/renderers.ts`) cobrem todos os promovidos; `source_type` deixa de ser sempre `sop`.

### 2.6. Plataforma de agentes dinâmica

- `SectorDefinition` + `SectorAccessRule` (2026-05-12) permitem criar setores além dos 4 nativos, com coleções Qdrant próprias, persona, regras outbound/inbound (`public`/`full`/`denied`) e palavras-chave de roteamento.
- `/admin/agents` (Agent Control Center) permite override por setor de `displayName`, `summary`, `instructions`, `capabilities`, `chatModel`, `topK`, `localConfidenceThreshold`. Protocolos editáveis pela UI. Bootstrap insert-only para não sobrescrever edições.

### 2.7. Dashboard, auditoria e linha de visão

- `/` (a partir de 2026-05-19) é dashboard com KPI cards, tira de saúde, feed de atividade e trilha guiada — adaptado por role.
- `/admin/audit` apresenta timeline pt-BR com detalhes técnicos atrás de "Ver detalhes técnicos".
- `/admin/feedback` mostra mensagens, hops, comentários do usuário e modelo do agente.
- `/admin/content` permite navegação file-level e chunk-level com badges de sensibilidade e navegação por documento.
- `/admin/people-reclassify` (2026-05-18) reescreve referências a pessoas como entidades semânticas e re-embeda os chunks afetados.

### Conclusão da §2

A lista de coisas que **não estão prontas** ficou bem menor do que a primeira análise indicava. Ela cabe agora em quatro frases:

1. Não há notificação que saia do app (e-mail, Teams, WhatsApp).
2. Não existe pilotagem real em produção com usuários que não sejam a própria equipe.
3. A ponte explícita "automação X nasceu do documento Y" não está contada como narrativa visível.
4. Person ainda não é cidadão de primeira classe do grafo de processo (papel inferido por regex de extração, não persistido na aresta).

---

## 3. Por que mesmo assim a adoção não veio — análise estrutural revisada

### 3.1. O sistema fica esperando o usuário, o usuário não fica esperando o sistema

O loop de lacuna foi fechado **dentro do navegador**. Para alguém saber que existe uma lacuna esperando resposta, precisa abrir `/admin/curation` ou `/admin/feedback`. Em uma operação real, o dono do processo já tem dez canais competindo pela atenção dele (Teams, e-mail, Outlook, chamados, reuniões) — e nenhum deles é "checar o admin do bot". A ausência de canal de saída neutraliza, na prática, o loop que foi construído com tanto cuidado.

Essa é a falha mais cara, e é estrutural: o sistema entrega muito do que prometeu **mas continua passivo na borda final**. Uma rotina que percorre `KnowledgeOwner`, casa por `topic`/`sector`/setor responsável do documento alvo da lacuna, e dispara um e-mail simples uma vez por dia ("você tem N lacunas pendentes nestes processos: …, responda em [link]") seria uma das peças de menor esforço relativo e maior efeito de ativação. Não existir é um sintoma claro de que a equipe priorizou profundidade do motor em detrimento de borda de adoção.

### 3.2. Velocidade de evolução > velocidade de onboarding

Entre 2026-05-04 e 2026-05-19 foram ~60 entradas substantivas em `memory.md`. Cada uma melhora algo — perguntas opcionais, perfis por tipo, política de aprovação, sensibilidade, dashboard, modos de retrieval, mapa de processos, grafo bidirecional, dynamic sectors, reclassificação de pessoas. Mas cada uma também muda como o sistema se comporta para o usuário final.

Um patrocinador ou um champion interno que tenta apresentar o sistema a um colega numa quinta-feira de uma semana específica está mostrando algo diferente da versão que viu numa terça. Isso desgasta a narrativa: "veja como funciona" vira "espera, deixa eu lembrar como tá funcionando hoje". O custo cognitivo recai em quem deveria evangelizar.

A engenharia confunde **maturidade do código** com **maturidade do produto**. As duas crescem com velocidades diferentes; quando a primeira fica muito à frente, o produto fica sempre em "pronto na próxima semana".

### 3.3. O sistema cresceu em complexidade conceitual mais rápido do que em superfície de uso

Hoje o sistema oferece, para o admin:

- 11 tipos de documento.
- 4 modos de retrieval (RAG/Grafo combinatórios).
- 4 níveis de sensibilidade.
- 4 níveis de automação + 1 label de equivalência.
- 5 estados de candidato de automação.
- 8 estados de documento de curadoria.
- 5 fontes de pergunta de curadoria (template, default, inferida, manual, process_gap).
- 6 domínios de grafo (5 entidades + Document + RagChunk).
- 2 tipos de aresta de grafo persistida + 2 virtuais (CO_MENTIONED, SHARES_ENTITY).
- 3 KPIs de adoção, 3 de qualidade, 3 de operação, 2 de segurança, ainda não medidos contra real.
- N setores nativos + N dinâmicos.

Cada decisão isolada faz sentido. O acúmulo cria um produto que **precisa de um administrador dedicado para extrair valor**. Sem essa pessoa, mesmo um piloto interessado se perde no menu. O risco operacional de "o sistema é complexo demais para ser mantido" — listado em §5 do diagnóstico original como "Mais um sistema para manter" — cresce em silêncio a cada feature.

### 3.4. KPI baseline existe, mas nunca foi medido contra real

`docs/pmo/kpi-baseline.md` define as metas (≥75% de respostas com citação suficiente, ≥70% de feedback positivo, ≤15% de `agent.unanswered`, lacunas atribuídas em 24h em ≥90%, MTTR ≤7 dias, WAU ≥30, retenção W2/W1 ≥50%, latência p95 ≤15s, etc.). É bom; está atribuído a donos; está honesto em dizer que "baseline ainda não foi medido em ambiente real".

O problema é que esse "baseline ainda não foi medido" não muda há semanas. Sem ter virado linha vermelha, ele continua na placa. E como continuou na placa, as decisões de prioridade ficaram capturadas pela próxima feature em vez de pela próxima medição. Esse é o ciclo que mantém o projeto em "quase pronto para piloto".

### 3.5. A história "automação nasceu do documento" não está sendo contada

`human-in-captcha` integra três automações reais (Cervello, pharmacy-prices, índices/moedas). `AutomationCandidate` existe como tabela com lineage para o documento de origem. Mas a peça narrativa "olha, este chamado Cervello foi aberto porque o documento Y descreve o procedimento Z e a equipe Forja implementou esse desenho" **não aparece visível** na trilha de delegação, no `/admin/process-automation-map`, ou no painel de auditoria de forma que um patrocinador consiga ler como prova de ROI.

Sem essa amarração visível, as automações parecem nascer de outro mundo, e a tabela `AutomationCandidate` parece backlog burocrático. O sistema está entregando o que prometeu, mas não está contando a história de que está entregando. Em projeto de plataforma, narrativa é metade do produto.

### 3.6. Person continua coadjuvante onde deveria ser protagonista

A peça que falta para o roteamento de lacuna ser de pessoa para pessoa: persistir o **papel** na aresta. Hoje `Document-[:INVOLVES_PERSON]->Person` informa "essa pessoa aparece no documento". O regex que extraiu o nome **sabia** se era Executor, Aprovador, Owner, autor — mas essa informação não vira propriedade da aresta. Sem isso, o sistema não pode dizer ao patrocinador "envie a lacuna do processo X para a pessoa Y porque ela é a Owner declarada do processo X em N documentos".

`KnowledgeOwner(topic, sector, userEmail)` existe como modelo, mas o pareamento desse modelo com `ProcessMap` continua frouxo: o mapa traz `documentRefs` e `processSignals`, não `ownerEmail`. A jornada `ProcessGapQuestion → Owner → e-mail` ainda exige passos manuais.

### 3.7. Custo de manutenção da ontologia cresceu mais do que a capacidade de curar

11 tipos de documento, com perguntas template por tipo, com renderizador por tipo, com artefato físico por tipo. 6 domínios de grafo, com extrator por domínio, com persistência por domínio, com painel por domínio. Cada documento ingerido pode gerar staging, correlação, perguntas template, perguntas inferidas, candidatos de automação, atualização de capability, refresh de mapa, extração de grafo.

Nada disso é supérfluo. Mas há um número não escrito no projeto: **quantos documentos por semana um curador consegue absorver com esse fluxo?** Sem essa medição, o gap entre capacidade real de curadoria e ritmo de ingestão é invisível. Se o ritmo de ingestão pretender ser parecido com o ritmo real da operação (dezenas/semana), o piloto vai descobrir que precisa de mais curadores do que se imaginou. Isso atrasa o piloto. O piloto atrasado abre espaço para mais features. As features aumentam o ritmo necessário de curadoria. O ciclo se realimenta.

### 3.8. Não há piloto real registrado em nenhum lugar

Em todo `memory.md`, em todo `docs/pmo/`, em todo o repositório, os registros de validação dizem "browser QA passou", "smokes locais passaram", "npm run build/lint/test passaram". Não há um único registro do formato "rodamos com N usuários reais durante M dias, observamos isso, ajustamos aquilo". A engenharia validou para si mesma; a operação ainda não validou em campo.

Isso é o que justifica a §1: o motor foi montado, mas não rodou na rua. Toda análise de "por que não pegou adesão" parte dessa observação. Não dá para diagnosticar adesão sem antes ter tentado adesão.

### 3.9. Riscos do diagnóstico original que continuam vivos

Da §5 do diagnóstico (2026-05-02), três continuam plausíveis e merecem atenção independente do estado da engenharia:

- **"A IA vai me substituir"** — incentivo subliminar de quem detém conhecimento tácito a documentar pouco. Mitigado em parte pelo design "humano é fonte da verdade", mas só fica visível para quem usa.
- **"Não vou ficar corrigindo bot"** — quem tem que validar correção sem ver ganho próprio. Continua um risco direto da falta de notificação fora do app (§3.1).
- **"A documentação que temos é uma vergonha"** — risco de o piloto travar em "vamos primeiro organizar". O sistema reduziu esse risco porque aceita `generico` e `conversa`, mas não eliminou: o curador precisa engolir o "estado atual" antes de extrair valor.

---

## 4. O que ainda faria diferença para um sucesso avassalador

Esta seção foi reescrita para refletir o estado real. Não inclui mais coisas que já existem. Cada item abaixo é uma ação de **baixo esforço relativo e alto efeito de ativação**.

### 4.1. Notificação fora do app — uma vez por dia, e-mail simples

Cron job diário que percorre `ProcessGapQuestion` em `status="promoted"`, casa com `KnowledgeOwner` via `topic`/`sector`, agrupa por `userEmail` e envia: "você tem N lacunas operacionais pendentes nos processos A, B, C. Link direto." Idem para `chunk_feedbacks` em `PENDING` atribuíveis ao dono. Sem isso, o loop não fecha em produção; com isso, fecha em uma semana de trabalho.

Versão V1.1: assim que Teams/Outlook/WhatsApp estiverem disponíveis como canal, a mesma rotina pluga lá. A primeira tração não precisa do canal certo, precisa de **algum** canal.

### 4.2. Piloto real com cinco pessoas, em uma semana

Escolher um processo concreto, um patrocinador específico, cinco usuários reais, congelar features por sete dias, e rodar. Métrica única: "no fim da semana, esses cinco usaram o sistema sem que alguém os lembrasse?". Tudo o que aparecer no piloto e não combinar com o que está construído entra como item de roadmap **com base na evidência**, não em hipótese.

Sem esse piloto, a discussão sobre adoção continua circular.

### 4.3. Persistir o papel na aresta `INVOLVES_PERSON`

Trivial em termos de código: o regex que extraiu o nome já sabe se era `executor`, `aprovador`, `owner`, `responsavel`, `author`. Persistir esse rótulo como propriedade da aresta destrava:

- Roteamento de lacuna para `owner`/`responsavel` declarado.
- Filtro do dashboard "meus processos" para o usuário logado.
- Métrica "% de processos com Owner explicitamente declarado".

Sem isso, ProcessMap continua orfão de ponte com pessoa.

### 4.4. Contar a história "automação nasceu do documento"

Trilha visual em `/admin/process-automation-map`: para cada processo com `AutomationCandidate.status="implemented"`, mostrar o documento que originou, a data, o autor, e o caminho até a integração `human-in-captcha`. Idealmente, quando uma automação dispara no chat, a trilha de delegação cita o processo + documento de origem.

Isso transforma a integração Cervello/pharmacy/índices de "feature solta" em **evidência de plataforma**. Sem isso, o argumento "vale a pena alimentar o sistema porque ele vira automação" continua sem prova visível.

### 4.5. Aceitar que a complexidade conceitual virou risco e congelar tipos novos

A combinatória descrita em §3.3 deveria ser tratada como limite, não como ponto de partida. Sugestão concreta:

- Congelar a lista de tipos de documento em 11. Não adicionar `email`, `voice_transcript`, `dashboard_screenshot`, etc., até o piloto definir necessidade.
- Congelar modos de retrieval em 4. Não criar o quinto.
- Congelar domínios de grafo em 6. O próximo (Role, API, BusinessRule, Risk, Automation) só entra se o piloto mostrar dor concreta.

Esse congelamento intencional libera energia para o que falta: borda de adoção, narrativa, piloto.

### 4.6. Medir o KPI baseline esta semana, mesmo com tráfego sintético

A planilha em `docs/pmo/kpi-baseline.md` está pronta. Rodar 100 perguntas por setor, medir os KPIs, gravar como linha de base. Pequena energia, alto valor: dá ao patrocinador o primeiro número real desde o início do projeto, e abre a conversa de prioridade baseada em medição em vez de em hipótese.

### 4.7. Marketing interno mínimo — toda semana, um e-mail

Toda sexta-feira, e-mail curto para a lista do patrocinador: "esta semana o sistema respondeu N perguntas, fechou M lacunas, recebeu K correções de chunk, processou L documentos curados. Destaques: …". Nada elaborado. Faz parte do produto. Em ferramenta de conhecimento corporativo, produto que não conta sua própria história não é percebido como existente.

### 4.8. Bootstrap separado, suite E2E, reranker — débitos que ainda valem a pena

Não bloqueiam adoção, mas continuam débitos legítimos do diagnóstico original:

- Bootstrap do bus/Qdrant separado do caminho `POST /api/chat` (§3.7 do diagnóstico).
- Pelo menos um teste E2E ponta a ponta (§3.9).
- Reranker leve (cross-encoder) por cima do retrieval cosine (§3.4).

Estes são bem documentados e bem dimensionados. Não são a estrela; são manutenção de confiança.

---

## 5. Síntese — a inversão que continua faltando

A análise anterior dizia: "construímos a ontologia antes do uso". Essa frase era apenas parcialmente verdadeira e o restante já tinha sido endereçado. A frase mais correta agora é:

> Construímos a ontologia e o loop, e ainda não construímos a borda. O sinal foi capturado, o sinal foi processado, o sinal não atravessa a porta da aplicação.

O caminho original "ontologia → curadoria → catálogo → automação → adesão" foi quase todo percorrido. O degrau que falta é o último: **fazer o sistema chegar até onde a pessoa já está, com cadência regular, com narrativa visível**.

O segundo gap é mais sistêmico: a engenharia precisa parar de correr para deixar o produto alcançá-la. Congelar features por uma semana, rodar piloto real, medir KPI baseline, contar a história — essas quatro coisas, feitas em sequência, valem mais do que qualquer feature nova nos próximos trinta dias.

A boa notícia é maior agora do que era na análise anterior: o que existe é mais sólido do que o diagnóstico de 2026-05-02 sugeria. A má notícia é a mesma: nada disso conta enquanto não chegar em um usuário real que não esteja na equipe.

---

## 6. Observação metodológica

Esta segunda análise foi escrita após:

1. Releitura do schema Prisma atual (`prisma/schema.prisma`), confirmando que `ProcessMap`, `ProcessGapQuestion`, `KnowledgeOwner`, `KnowledgeCapability`, `AutomationCandidate`, `ChunkFeedback`, `AgentConfig`, `SectorDefinition`, `SectorAccessRule` estão modelados e em uso.
2. Inspeção dos diretórios `lib/curation/`, `lib/graph/`, `lib/automation/`, `lib/dashboard/`, `lib/agents/`, `lib/integrations/`, e das rotas `app/admin/*` e `app/api/admin/*` para confirmar que as funcionalidades descritas em `memory.md` estão fisicamente presentes.
3. Inspeção do extrator de grafo (`lib/graph/extractor.ts`) e do persistidor (`lib/graph/persistence.ts`) para confirmar o conjunto atual de labels (Document, Concept, Procedure, System, Regulation, Person, RagChunk) e arestas persistidas (HAS_CONCEPT, DESCRIBES, REFERENCES_SYSTEM, COMPLIES_WITH, INVOLVES_PERSON, HAS_RAG_CHUNK, MENTIONS).
4. Releitura completa de `memory.md` (171 linhas, cobrindo 2026-04-30 a 2026-05-19).
5. Cruzamento com o `kpi-baseline.md` do PMO para confirmar que o baseline real ainda não foi medido.
6. Atualização cirúrgica dos referenciais que estavam desatualizados (`docs/diagnostico-ecossistema-conhecimento.md`, `docs/neo4j-domains.md`, `plano-classificacao-documentos.md`), preservando o conteúdo original como histórico.

Continua válido o aviso final da versão anterior: nada substitui (a) dados reais de uso, (b) entrevistas com 3-5 usuários que tentaram e desistiram, e (c) conversa direta com o patrocinador sobre o KPI de negócio esperado. Esta análise é a melhor leitura possível com base no código e nos registros; ela aponta para um piloto real como única forma de transformar inferência em fato.
