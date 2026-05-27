# QA - Admin Curation Flow

**Data:** 2026-05-04  
**Ambiente:** `http://localhost:3030/admin/curation`  
**Usuario:** `admin@pfrm.local` / setor `desenvolvimento`  
**Evidencia:** `qa-admin-curation-flow.png`

## Testes Executados

| # | Cenario | Resultado | Status |
|---|---|---|---|
| 1 | Acesso sem admin | Sessao anterior de usuario comum foi redirecionada para `/chat` | PASS |
| 2 | Login admin e acesso a `/admin/curation` | Pagina carregou com menu admin e fila setorial | PASS |
| 3 | Carregamento de detalhe | `GET /api/curation/<documentId>` retornou 200 | PASS |
| 4 | Visualizacao de chunks | Tela exibiu 7 chunks de staging com conteudo completo, indice, secao e hash | PASS |
| 5 | Estado de readiness pendente | Documento `NEEDS_REVISION` exibiu 0% e 8 perguntas obrigatorias pendentes | PASS |
| 6 | Gate de aprovacao | Botoes de owner/admin/promote ficaram desabilitados enquanto o documento nao esta pronto | PASS |
| 7 | Console do navegador | Sem erros, warnings ou issues apos ajuste de acessibilidade | PASS |
| 8 | Pos-promote | Documento promovido saiu da fila de curadoria apos reload e `/admin/curation` exibiu estado vazio sem erros de console | PASS |
| 9 | Build do ajuste de perguntas | Perguntas respondidas agora renderizam recolhidas com resumo e acao de edicao; documentos promovidos ficam somente leitura | PASS |

## Bugs Encontrados

Nenhum bug bloqueante encontrado no fluxo testado. A issue inicial de acessibilidade em campo sem `id/name` foi corrigida durante a implementacao.

## Analise de Rede

| Operacao | Metodo | Endpoint | Status |
|---|---|---|---|
| Login admin | POST | `/login` | 303 |
| Navegacao curadoria | GET | `/admin/curation?_rsc=...` | 200 |
| Detalhe com chunks | GET | `/api/curation/<documentId>` | 200 |

## Observacoes

- Nao registrei aprovacao nem promote pelo navegador porque isso seria uma decisao de negocio sobre o conteudo real ingerido.
- O fluxo visual esta pronto para o usuario revisar chunks, responder pendencias de SOP, aprovar e promover quando o readiness atingir o threshold.
- Apos o promote real do documento de Desenvolvimento, nao havia novo documento pendente para validar uma edicao interativa sem criar dados artificiais. A validacao desta rodada cobriu estado vazio no navegador, console limpo, testes automatizados, lint e build.
