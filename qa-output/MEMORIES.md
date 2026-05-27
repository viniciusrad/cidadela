## /admin/corrections - Fila de correcoes - 2026-05-04

Fluxo resumido: a rota autenticada `/admin/corrections` apresenta as indicacoes de inconformidade salvas em `chunk_feedbacks`, agrupadas por status. Admins veem todos os setores; usuarios de referencia veem os setores em que sao `KnowledgeOwner` ou owner de documento.

Campos identificados: a tela nao possui inputs editaveis. As acoes principais sao filtros por link, expansao de detalhe e formularios server action para rejeitar ou aprovar/aplicar.

Observacoes tecnicas:
- A tela usa Server Component em `app/admin/corrections/page.tsx`.
- As acoes usam server actions em `app/admin/corrections/actions.ts`.
- O acesso usa `lib/corrections/authorization.ts`.
- QA de navegador confirmou carregamento HTTP 200 e ausencia de erros de console; aprovar/rejeitar nao foi submetido para nao alterar o dado real pendente.

## /admin/content - Visao consolidada de arquivos - 2026-05-07

Fluxo resumido: a rota autenticada `/admin/content` agora inicia pela visao `Arquivos`, agrupando chunks carregados por `sector + sourceDocumentId`. A visao `Chunks` continua disponivel para inspecao granular, e selecionar um arquivo usa o carregamento relacionado existente para montar o conteudo consolidado do documento.

Campos identificados: filtro `Filtrar por Setor`, modo de busca `Texto/Semantica`, campo de busca textual/semantica e botoes `Arquivos`, `Chunks`, `Buscar`, `Limpar`, `Carregar mais`.

Observacoes tecnicas:
- A implementacao fica em `components/content-manager.tsx`.
- O agrupamento e client-side sobre as rows ja carregadas por `/api/admin/chunks`; a chave inclui setor para evitar misturar arquivos iguais entre bancos/setores.
- A API foi validada por HTTP autenticado: `sector=todos` retornou 40 chunks agrupaveis em 15 arquivos, e `sector=desenvolvimento` retornou somente rows de desenvolvimento.
- Chrome MCP ficou indisponivel por perfil ja em uso; a validacao de UI foi feita por HTML renderizado, API e build.
