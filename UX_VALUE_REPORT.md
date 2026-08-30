# Avaliação de UX e valor — Cidadela

Data da análise: 2026-05-15
Escopo: aplicação `cidadela-agents` (Next.js MVP), todas as telas mapeadas em `app/**` e componentes em `components/**`.

Objetivo desta análise: olhar o produto pelos olhos de um colaborador comum — alguém que **não** sabe o que é vetor, chunk, grafo, staging ou trace — e julgar se o que está construído entrega a promessa central: **transformar conhecimento tribal em ontologia viva da empresa, alimentando um chat útil e mapeando processos a partir dos documentos**.

A análise é honesta. Há partes muito boas e partes que ainda falam mais para o engenheiro que para o usuário.

---

## 1. Diagnóstico em uma frase

O motor está construído e funcionando — ingestão, vetorização, curadoria, grafo, mapa de processos, feedback. O problema não é técnico; é de **tradução**. A interface ainda fala "engenheiro": chunk, staging, hops, trace, Qdrant, Neo4j, readiness score, SOP/DDP, "promote". Isso afasta o colaborador comum e, mais importante, esconde do usuário a **proposta de valor real** (mapear o conhecimento que mora nas pessoas-chave). O produto sabe fazer; precisa aprender a contar.

---

## 2. O que está bom (manter e celebrar)

| Pilar | Por que funciona |
|---|---|
| Pipeline ingestão → staging → curadoria → publicação | A separação entre "rascunho" e "produtivo" com gate de aprovação é certa para conteúdo crítico. |
| Chat com citações expansíveis (chunk + documento completo) | A confiança nasce de poder verificar a fonte — está bem resolvido. |
| Feedback de resposta (good/bad + comentário no negativo) | Loop curto entre uso e curadoria. Os prompts variáveis (`FEEDBACK_PROMPTS`) têm tom humano correto. |
| Lacunas pendentes ↔ documentos em curadoria | Conectar "pergunta que o agente não soube responder" a "alguém precisa documentar isso" é exatamente onde o produto cria valor. |
| Radar de prioridade (grafo) | Sugerir os próximos documentos a extrair é um *next-best-action* legítimo. |
| Mapa de processos cruzando staging + promoted + grafo | Visão multi-fonte é o diferencial. |
| Documentação viva por domínio (conceitos, procedimentos, sistemas) | Boa contraproposta ao "ler PDF de 80 páginas". |
| Painel "Por que grafo supera busca vetorial aqui" | Já é uma tentativa de educar o usuário — só está no lugar errado e no tom errado (ver §4). |

---

## 3. O gap conceitual mais importante

A proposta declarada é **atacar o conhecimento tribal** — o saber que vive na cabeça de poucos colaboradores-chave. Mas o produto, hoje, **só sabe processar documento que já existe**. Se o conhecimento ainda não foi escrito, ele continua tribal.

O que falta para fechar essa promessa:

1. **Captura ativa**, não só passiva. Hoje o fluxo é "alguém faz upload". Conhecimento tribal raramente é uploadado — ele precisa ser *extraído por entrevista*. Falta um modo "entrevistar especialista": um chat estruturado que faz perguntas dirigidas ao colaborador-chave, transcreve as respostas e gera o rascunho do documento automaticamente.
2. **Visibilidade do risco de barramento ("bus factor")**. O sistema tem `owner` em cada documento e autores nos metadados, mas em nenhum lugar mostra "estes 4 procedimentos críticos têm um único dono — se essa pessoa sair amanhã, o setor perde". Esse painel seria a *killer feature* alinhada com a proposta.
3. **Mapa de pessoas, não só de documentos**. O grafo conecta documentos, conceitos, sistemas e regulamentações. Falta o nó **Pessoa** — quem sabe sobre o quê. Isso transforma a ontologia de "biblioteca" em "rede social do saber operacional".
4. **Linguagem da proposta em algum lugar visível**. Em nenhuma tela aparece "conhecimento tribal", "saber que mora nas pessoas", "mapa do que sua empresa faz de fato". O produto não comunica seu próprio porquê.

> Recomendação central: adicionar uma página `/admin/knowledge-health` (ou rebatizar "Início") com 3 KPIs — **cobertura por setor**, **lacunas críticas em aberto**, **processos com dono único** — e um CTA grande "Iniciar entrevista com especialista". Essa página passa a ser a fachada que conta a história.

---

## 4. Auditoria de texto, tela a tela

Critério: o usuário comum entende sem precisar perguntar? Se não, está marcado como problema.

### Status de implementacao em 2026-05-15

Aplicado nesta rodada:

- Navegacao lateral: menus e descricoes foram trocados para termos de produto (`Conteudo indexado`, `Mapa do conhecimento`, `Historico`, `Validar e publicar`, etc.).
- Cabecalhos de pagina: `/chat`, `/files`, `/admin/content`, `/admin/consolidation`, `/admin/knowledge-graph`, `/admin/process-automation-map`, `/admin/curation`, `/admin/corrections`, `/admin/audit`, `/admin/feedback` e `/admin/agents` receberam descricoes menos tecnicas.
- Workbench de ingestao: `Chunk(s)` virou `Trechos indexados`; `readiness` virou `prontidao para virar procedimento`; a sugestao de tipo documental passou a explicar a classificacao em linguagem natural; foram adicionadas explicacoes para trechos e tipo documental.
- Chat: as citacoes passaram a exibir o selo `Documento oficial` e o seletor interno trocou `Trecho (Chunk)` por `Trecho indexado`.
- Curadoria: `Lacunas Pendentes`/`Lacunas Respondidas` viraram `Perguntas em aberto`/`Perguntas respondidas`, com descricoes mais diretas.
- Mapa de processos: copy de cabecalho, abas, metricas e acoes foi ajustada para reduzir referencias a Neo4j/Qdrant/grafo/base vetorial e trocar `Gaps` por perguntas em aberto.
- Mapa do conhecimento: a tela passou a falar em mapeamento, documentos mapeados e perguntas que a tela responde, removendo referencias visiveis como Cypher, REFERENCIA, SUPERSEDE e CUMPRE_COM do painel explicativo.
- Auditoria: a tela foi reformulada de `Agent Calls`/`Audit Events` para uma linha do tempo em pt-BR, mantendo IDs, payloads e dados crus dentro de `Ver detalhes tecnicos`.
- Agentes: o contador de conhecimento ganhou explicacao por hover e `pub/stg` virou `publicados/em revisao`.
- Login: a hero copy passou a contar melhor a proposta de inteligencia operacional auditavel por setor.

Parcial ou nao aplicado nesta rodada:

- O item de entrada `Visao geral`/`Saude do conhecimento` nao foi criado porque e uma nova pagina/produto, descrita no relatorio como onda posterior.
- O selo de citacao foi aplicado como `Documento oficial` para as citacoes atuais; os estados `Em consolidacao` e `Conhecimento capturado em entrevista` dependem de metadata/fluxos que ainda nao existem no contrato de citacao.
- A auditoria agora e legivel, mas ainda nao reconstrui frases com o nome do usuario e a pergunta original em todos os casos; isso depende de juntar mensagens/conversas no modelo da tela.
- O modo `Entrevistar especialista`, o no `Pessoa` no grafo e o painel de risco de dono unico ficaram fora por serem funcionalidades novas, nao apenas auditoria de texto.

### 4.1 Navegação lateral (`secure-app-shell.tsx`)

| Atual | Problema | Sugestão |
|---|---|---|
| `Base vetorial` / "Arquivos e chunks" | "Vetorial" e "chunks" são jargão | `Conteúdo indexado` / "Arquivos prontos para busca" |
| `Consolidação` / "Artefatos revisados" | "Artefato" é palavra de engenheiro | `Consolidação` / "Procedimentos consolidados" |
| `Curadoria` / "Validação e promote" | "Promote" não é português | `Curadoria` / "Validar e publicar" |
| `Grafo` / "Entidades e relações" | "Entidade" é abstrato | `Mapa do conhecimento` / "Como os assuntos se conectam" |
| `Processos` / "Mapa operacional e automacao" | "Automação" como palavra principal estreita a leitura | `Processos` / "O que sua área faz, passo a passo" |
| `Agentes` / "Prompts, parametros, protocolos" | Trinca técnica | `Agentes` / "Personalidade e regras de cada agente" |
| `Auditoria` / "Eventos e hops" | "Hops" é completamente opaco | `Histórico` / "Decisões e encaminhamentos" |
| `Feedback` / "Qualidade das respostas" | OK | manter |
| `Correções` / "Sugestões de usuários" | OK | manter |

Além disso: para admin há **11 itens** — a hierarquia em 3 grupos (Operação / Conhecimento / Governança) já ajuda, mas falta um item de entrada — uma **Visão geral** que centralize o estado do conhecimento.

### 4.2 Cabeçalhos de página (descrições no shell)

| Página | Texto atual | Diagnóstico | Sugestão |
|---|---|---|---|
| `/chat` | "A consulta permanece isolada em X. Quando o assunto exige outro dominio, {Persona} delega por protocolo e devolve a resposta consolidada." | "Isolada", "domínio", "delega por protocolo" — fala como manual técnico. | "Você está conversando com **{Persona}**, o agente de {Setor}. Quando sua pergunta envolve outra área, {Persona} consulta o agente certo e traz a resposta pronta." |
| `/files` | OK, mas "fila de curadoria do setor selecionado" pode ser melhor. | Razoável | "Arquivos enviados aqui passam por uma revisão antes de entrar no chat do setor." |
| `/admin/content` | "Visualize e pesquise os chunks armazenados em cada colecao vetorial do Qdrant." | Três jargões em uma frase. | "Veja os trechos de documento que o chat usa para responder. Útil para entender o que está disponível em cada setor." |
| `/admin/consolidation` | "Busca guiada cross-sector para descobrir processos e gerar rascunhos de SOP/DDP para curadoria." | "Cross-sector", "SOP/DDP" | "Encontre como um mesmo processo aparece em vários setores e gere um rascunho de procedimento oficial." |
| `/admin/knowledge-graph` | "Extraia entidades, explore relacoes e visualize o grafo Neo4j da base de conhecimento." | "Entidades", "Neo4j" | "Veja como conceitos, sistemas e regulamentações dos seus documentos se conectam — e descubra o que ainda falta mapear." |
| `/admin/process-automation-map` | "Mapeie processos candidatos a automacao a partir de evidencias do grafo, da base vetorial e da curadoria." | Excesso de termos técnicos | "Os processos da sua área, ranqueados pelo potencial de virar rotina automatizada — com as evidências que sustentam cada um." |
| `/admin/curation` | "Validação de documentos em staging, correlação com a base produtiva e gate de aprovação." | "Staging", "base produtiva", "gate" | "Documentos enviados aguardam sua revisão antes de entrarem no chat. Aqui você compara com o que já está publicado e aprova." |
| `/admin/corrections` | "Fila intermediaria de indicacoes de inconformidade enviadas a partir das citacoes do chat. O conteudo produtivo so e alterado apos aprovacao de um revisor autorizado." | "Inconformidade", "conteúdo produtivo" | "Quando alguém sinaliza um erro numa resposta do chat, a correção chega aqui. Nada é alterado sem sua aprovação." |
| `/admin/audit` | "Visibilidade administrativa sobre hops entre agentes e eventos persistidos de auditoria." | "Hops", "persistidos" | "Acompanhe quem perguntou o quê, quais agentes foram acionados e como cada resposta foi montada." |
| `/admin/feedback` (sem resposta) | "Perguntas sem resposta detectadas automaticamente: nenhum chunk relevante foi encontrado..." | "Chunk" | "Perguntas que o agente não soube responder. Cada uma é uma oportunidade de documentar o que ainda está só na cabeça das pessoas." |

### 4.3 Workbench de ingestão (`/files`)

- Métrica visível ao usuário: **`Chunk(s)`** como contador no resumo da fila. Para quem subiu o arquivo, isso não significa nada. Renomear para **`Trechos indexados`** com tooltip "Pedaços do documento que o chat consegue buscar".
- Status `Já indexado`, `Ignorado` — bons.
- "readiness X%" mostrado por item — termo técnico cru. Sugestão: **"Prontidão para virar procedimento: X%"** + tooltip explicando que mede quão completo o documento parece estar.
- "Tipo documental" + "Sugestao: SOP | confianca 87%" — para usuário sem treinamento, "SOP" e "confiança" precisam de tooltips. Sugestão de microcopy: "Achamos que este é um **procedimento operacional** (87% de certeza). Você pode mudar."

### 4.4 Chat (`/chat`)

- Os prompts de feedback variáveis (`FEEDBACK_PROMPTS`, `NEGATIVE_MODAL_PROMPTS`) estão com o **tom certo** — convidativos sem serem invasivos. Manter.
- Cartões de citação: o título `getSectorLabel(citation.sector) | citation.documentTitle` é bom. Falta um **selo de origem**: hoje toda citação parece igual. Sugestão: badge sutil indicando "Documento oficial" vs. "Procedimento em consolidação" vs. (no futuro) "Conhecimento capturado em entrevista". Isso amarra com a §3.
- Modo "ver documento completo" — excelente; pouco descoberto. Considerar microcopy de descoberta no primeiro uso ("Clique para abrir o documento inteiro").

### 4.5 Curadoria (`/admin/curation`)

- Aba **"Lacunas Pendentes"** com contador colorido — boa hierarquia visual.
- Termo "Lacuna" é defensável, mas pode trocar por **"Perguntas em aberto"** que é mais direto.
- Descrição "Validacao de staging, correlacao e aprovacao" usa três termos opacos. Sugestão: "Documentos novos esperando sua aprovação antes de entrar no chat."

### 4.6 Mapa de processos (`/admin/process-automation-map`)

- Já usa `InfoTooltip` em alguns lugares — é o único workbench que faz isso. Boa referência.
- Métricas com nomes razoáveis: "Processos mapeados", "Candidatos a automação", "Lacunas críticas". Manter.
- O termo "Readiness" aparece em scores — substituir por "Prontidão".
- "automationReadinessScore", "documentationCoverageScore", "confidenceScore" não devem aparecer crus, mas isso é hipótese (não confirmei no DOM final).

### 4.7 Grafo (`/admin/knowledge-graph`)

- O painel **"Por que grafo supera busca vetorial aqui"** é tecnicamente correto, mas usa "Cypher", "REFERENCIA", "SUPERSEDE", "CUMPRE_COM" — palavras de quem implementa, não de quem consome. Reformular como **"O que esta tela responde que o chat sozinho não responde"** com 4 perguntas em linguagem natural ("Quais documentos dependem do sistema X?", "Qual norma é mais citada e em quais setores?", "Onde temos contradição entre dois procedimentos?", "Se o sistema Y mudar, o que precisa ser revisto?").
- "Extrair para grafo" / "Re-extrair" — tooltip explicando o que é extrair. Sugestão: "Identifica conceitos, sistemas e regras citados neste documento e adiciona ao mapa".
- Estado vazio "Grafo vazio" — bom; "Extraia entidades dos documentos abaixo para começar a construir o grafo." está claro.
- Badge `no grafo` (minúscula, descontextualizada) — trocar por `Mapeado` (com tooltip explicando o que foi mapeado).

### 4.8 Auditoria (`/admin/audit`)

Esta é a tela mais desalinhada com o resto.

- Títulos em **inglês cru**: `Agent Calls`, `Audit Events`. Em um app em pt-BR, isso destoa muito.
- Conteúdo dos cartões mostra `from -> to | intent`, `Trace XYZ | status` — o usuário não-técnico não tem chance.
- Sugestão de reformulação: virar uma **linha do tempo legível**: "10:42 — Daniel perguntou sobre X. Sentinela (Segurança) precisou consultar Forja (Desenvolvimento). Resposta entregue em 4,2s." Os IDs técnicos (`traceId`, `actorId`) ficam atrás de um "ver detalhes técnicos".

### 4.9 Agentes (`/admin/agents`)

- Cards já corrigidos no passo anterior (texto antes truncava nomes).
- "AGENTES ATIVOS — Edicoes refletem em tempo real no chat de cada setor." — bom, direto.
- "DESE...", "TELE..." setor labels eram problema visual, agora resolvido com 2 colunas.
- Sugestão complementar: tooltip no contador "**CONHECIMENTO 93** (91 pub, 2 stg)" — "93 trechos disponíveis: 91 já no chat, 2 ainda em revisão".

### 4.10 Login (`/login`)

- Sóbrio e funcional. Considerar um subtítulo sob o logo que **comece a contar a história**: "A inteligência operacional da sua empresa. Cada setor com seu agente, todo conhecimento auditável." Pequeno gesto, grande sinalização.

---

## 5. Onde tooltips ajudariam mais (prioridade)

O componente `<InfoTooltip />` já existe (`components/info-tooltip.tsx`) — está sendo usado em **apenas 2 lugares**. Há terreno fértil. Lista priorizada:

### Alta prioridade (afetam compreensão do usuário comum)

1. **"Chunk" / "Trechos indexados"** — em todas as ocorrências.
2. **"Mapeado / no grafo"** — explicar o que significa estar mapeado.
3. **"Prontidão" (readiness)** — o que esse % representa.
4. **"Lacuna" / "Pergunta em aberto"** — por que surgiu, o que se espera do curador.
5. **"Tipo documental: SOP / DDP / Onboarding…"** — explicar cada sigla na primeira ocorrência.
6. **"Override ativo"** (card de agente, ícone pulsante) — hoje não tem explicação visual.
7. **Setor selecionado vs. "delegação"** (chat) — explicar por que às vezes outro agente responde.
8. **"Confiança" da classificação automática** — o que é 87% de confiança.

### Média prioridade (jargão de admin)

9. **"Trace"** — onde for inevitável manter o termo.
10. **"Hops entre agentes"** — preferir reformular para "Encaminhamentos entre agentes".
11. **"Pub / Stg" nos cards de agente** — abreviações duras; tooltip "Publicado / Em revisão".
12. **"Coleção vetorial / Qdrant"** — substituir; se mantido, tooltip.

### Onde NÃO usar tooltip

- Nomes próprios dos agentes (Forja, Sentinela…) — esses são personagens, deixar respirar.
- Labels de setor — já são autoexplicativos.

---

## 6. Reformulações de UI/UX que valem o investimento

Em ordem de impacto vs. esforço.

### A. Página inicial "Saúde do conhecimento" — **alto impacto, médio esforço**

Substituir o redirecionamento `/` → `/chat` por uma landing para admin que mostre:

- **Cobertura por setor** (% de processos com pelo menos 1 documento promovido).
- **Top 5 lacunas críticas** em aberto (linka para curadoria).
- **Processos com dono único** (bus factor risk) — *requer enriquecimento do modelo*.
- **Últimos 7 dias**: documentos publicados, perguntas sem resposta, correções aplicadas.
- CTA principal: **"Capturar conhecimento com especialista"** (entra no fluxo de entrevista — ver F).

Justificativa: hoje o admin precisa saber por onde começar entre 11 menus. Essa página é a *fachada da promessa*.

### B. Renomear menus e descrições — **alto impacto, baixo esforço**

Aplicar a tabela §4.1. Pode ser feito em uma sessão.

### C. Reformular tela de Auditoria como linha do tempo legível — **médio impacto, médio esforço**

Hoje é uma lista de chamadas técnicas. Virar uma timeline em linguagem natural com expansão para detalhes técnicos.

### D. Tooltips do §5 itens 1–8 — **alto impacto, baixo esforço**

Investimento de algumas horas, ganho de compreensão muito grande.

### E. Selo de origem nas citações do chat — **médio impacto, baixo esforço**

`Documento oficial` / `Em consolidação` / (futuro) `Capturado em entrevista`. Cria a base visual para a §F.

### F. Modo "Entrevistar especialista" — **muito alto impacto, alto esforço**

O movimento que mais conecta o produto à sua proposta. Um fluxo onde:

1. Admin escolhe um processo com baixa cobertura ou alta concentração de dono.
2. Sistema gera roteiro de perguntas (a partir das lacunas em aberto + perguntas sem resposta históricas).
3. O especialista responde via chat estruturado (texto ou áudio com transcrição).
4. Sistema monta o rascunho de documento e envia para curadoria.

Sem esse fluxo, a expressão "conhecimento tribal" segue sendo retórica.

### G. Nó "Pessoa" no grafo — **alto impacto, médio esforço**

Adicionar `Person` ao schema do grafo, ligado por `OWNS`, `AUTHORED`, `INTERVIEWED_ABOUT`. Habilita a métrica de bus factor da §A.

### H. Onboarding micro-tour para admin (3 passos) — **médio impacto, baixo esforço**

Na primeira visita do admin: 3 highlights ("aqui você vê a saúde", "aqui você revisa o que entra no chat", "aqui você inicia uma entrevista"). Reusa o `InfoTooltip` em modo "popover sequencial".

---

## 7. Glossário sugerido (microcopy de referência)

Para uniformizar copy. Termo técnico → termo de produto.

| Hoje | Adotar |
|---|---|
| Chunk | Trecho indexado |
| Base vetorial / Qdrant | Conteúdo indexado |
| Grafo / Neo4j | Mapa do conhecimento |
| Staging | Em revisão |
| Produtivo / Promote | Publicado |
| Gate | Aprovação |
| Hop | Encaminhamento |
| Trace | Histórico da pergunta |
| Readiness score | Prontidão |
| Entity / Entidade | Conceito (ou Sistema, Norma, conforme tipo) |
| Override | Personalização ativa |
| SOP | Procedimento operacional |
| DDP | Documento de processo |
| Lacuna | Pergunta em aberto |
| Cross-sector | Entre setores |
| Audit event | Registro de operação |
| Agent call | Encaminhamento entre agentes |

---

## 8. O que **não** mudar (resistir à tentação)

- A divisão Operação / Conhecimento / Governança no menu. Está certa.
- A separação staging vs. publicado. É a coluna vertebral do controle de qualidade.
- Os nomes próprios dos agentes (Forja, Sentinela, Helpdesk…). São identidade — não traduzir para "Agente de Desenvolvimento".
- Os prompts variáveis de feedback no chat. Tom já calibrado.
- Citações expansíveis. Já está bem feito.

---

## 9. Plano sugerido em três ondas

**Onda 1 (1–2 dias, ganho imediato)** — §6 itens **B** + **D** + **E** + §4.10 subtítulo no login.
Renomear, adicionar tooltips, selo de origem. Resultado: copy do produto fala português, não jargão.

**Onda 2 (1 semana)** — §6 itens **A** + **C** + **H**.
Landing de saúde do conhecimento, auditoria como timeline, onboarding tour. Resultado: produto passa a contar a própria história ao abrir.

**Onda 3 (2–4 semanas)** — §6 itens **F** + **G**.
Modo entrevista + nó Pessoa no grafo. Resultado: a promessa de "atacar conhecimento tribal" deixa de ser slogan e vira funcionalidade visível.

---

## 10. Resumo executivo em 5 linhas

1. O motor funciona; a fachada fala engenheiro.
2. Renomear menus, ajustar 10 descrições e adicionar 8 tooltips resolve 70% do problema de compreensão.
3. A proposta de "conhecimento tribal" só será verdade quando houver captura ativa (modo entrevista) e mapa de pessoas no grafo.
4. Uma página inicial de "saúde do conhecimento" é o que falta para o produto se apresentar.
5. A tela de Auditoria precisa virar timeline em pt-BR — hoje destoa do resto.
