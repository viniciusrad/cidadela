import { type NextRequest } from "next/server";

import { auth } from "@/auth";
import { isSector } from "@/lib/config";
import { generateAnswerStream } from "@/lib/ollama";
import { fetchDocumentChunks } from "@/lib/qdrant";

type DocType =
  | "executive_briefing"
  | "operational_playbook"
  | "onboarding_primer"
  | "risk_compliance";

type RequestBody = {
  concept: string;
  itemName?: string;
  itemDomain?: KnowledgeDomain;
  docType: DocType;
  documents: { id: string; title: string; sector: string }[];
  related?: string[];
};

type KnowledgeDomain = "document" | "concept" | "procedure" | "system";

const DOMAIN_LABELS: Record<KnowledgeDomain, string> = {
  document: "documento",
  concept: "conceito",
  procedure: "procedimento",
  system: "sistema",
};

function normalizeDomain(value: unknown): KnowledgeDomain {
  if (
    value === "document" ||
    value === "concept" ||
    value === "procedure" ||
    value === "system"
  ) {
    return value;
  }
  return "concept";
}

const DOC_TYPE_INSTRUCTIONS: Record<DocType, { label: string; instruction: string }> = {
  executive_briefing: {
    label: "Briefing Executivo",
    instruction: `Gere um BRIEFING EXECUTIVO de uma página, com tom estratégico para liderança (C-level / diretoria).
Estrutura obrigatória (em markdown):
# {{conceito}} — Briefing Executivo
## Em uma frase
(definição precisa do conceito em UMA frase de impacto)
## Por que importa agora
- 3 a 4 bullets ligando ao negócio (risco, custo, vantagem, compliance)
## Estado atual na empresa
(síntese do que aparece nos documentos: o que está mapeado, o que está em uso, lacunas visíveis)
## Decisões em aberto
- 2 a 4 perguntas estratégicas que a liderança precisa responder
## Próximos passos sugeridos
- 3 ações concretas, priorizadas

## Mapa de prioridade
Após os próximos passos, insira obrigatoriamente um diagrama Mermaid mostrando as ações em sequência de prioridade.
Use exatamente este bloco (substitua os rótulos pelos dados reais do conceito; máximo 5 nós):
\`\`\`mermaid
graph LR
  A["Ação prioritária 1"] --> B["Ação 2"]
  B --> C["Ação 3"]
\`\`\``,
  },
  operational_playbook: {
    label: "Mapa Operacional",
    instruction: `Gere um MAPA OPERACIONAL / PLAYBOOK do conceito.
Estrutura obrigatória (em markdown):
# {{conceito}} — Mapa Operacional
## O que é, na prática
(definição operacional curta)
## Quem participa
- papéis/áreas envolvidas
## Fluxo principal
Descreva o fluxo em texto e logo em seguida insira obrigatoriamente um diagrama Mermaid com o fluxo de ponta a ponta.
Use exatamente este bloco (substitua os rótulos pelos passos reais extraídos dos documentos; máximo 7 nós):
\`\`\`mermaid
flowchart LR
  A["Início / Gatilho"] --> B["Passo 1"]
  B --> C["Passo 2"]
  C --> D{"Decisão?"}
  D -- Sim --> E["Passo 3a"]
  D -- Não --> F["Passo 3b"]
  E --> G["Fim"]
  F --> G
\`\`\`
## Sistemas e ferramentas envolvidos
- listar nomes mencionados nos documentos
## Pontos de atenção / handoffs
- gargalos, dependências, sinais de falha
## Indicadores observáveis
- como medir se está funcionando`,
  },
  onboarding_primer: {
    label: "Primer de Onboarding",
    instruction: `Gere um PRIMER DE ONBOARDING para um colaborador novo entender o conceito em 5 minutos.
Estrutura obrigatória (em markdown):
# {{conceito}} — Primer de Onboarding
## A ideia em 30 segundos
(linguagem simples, sem jargão)
## Glossário rápido
- 3 a 5 termos auxiliares com definição em uma linha
## Como o conceito aparece no dia a dia
(exemplos concretos extraídos dos documentos)
## Mapa de conexões
Insira obrigatoriamente um diagrama Mermaid mostrando como o conceito se conecta com os conceitos relacionados e com as áreas envolvidas.
Use exatamente este bloco (substitua os rótulos pelos dados reais; use os itens relacionados fornecidos):
\`\`\`mermaid
mindmap
  root(({{conceito}}))
    Área 1
      Conceito relacionado A
    Área 2
      Conceito relacionado B
    Área 3
      Conceito relacionado C
\`\`\`
## Onde aprofundar
- listar os documentos-fonte mais relevantes para leitura completa`,
  },
  risk_compliance: {
    label: "Análise de Riscos & Compliance",
    instruction: `Gere uma ANÁLISE DE RISCOS E COMPLIANCE focada no conceito.
Estrutura obrigatória (em markdown):
# {{conceito}} — Riscos & Compliance
## Síntese do conceito sob ótica de risco
## Riscos identificados
| # | Risco | Impacto | Probabilidade | Mitigação sugerida |
|---|-------|---------|---------------|--------------------|
(preencha 3 a 5 linhas)
## Fluxo de escalada de risco
Após a tabela, insira obrigatoriamente um diagrama Mermaid mostrando o caminho de detecção → escalada → mitigação dos principais riscos.
Use exatamente este bloco (substitua os rótulos pelos dados reais dos documentos):
\`\`\`mermaid
flowchart LR
  A["Sinal de alerta"] --> B["Triagem"]
  B --> C{"Crítico?"}
  C -- Sim --> D["Escalada imediata"]
  C -- Não --> E["Monitoramento"]
  D --> F["Mitigação"]
  E --> F
\`\`\`
## Controles e normas mencionados
- listar políticas, normas e controles que aparecem nos documentos
## Lacunas de cobertura
- onde os documentos NÃO falam claramente, mas deveriam
## Recomendação final
(uma recomendação acionável e priorizada)`,
  },
};

const MAX_CHARS_PER_DOC = 1800;
const MAX_DOCS = 6;

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await request.json()) as RequestBody;
  const itemName = (body.itemName || body.concept || "").trim();
  const itemDomain = normalizeDomain(body.itemDomain);
  const itemDomainLabel = DOMAIN_LABELS[itemDomain];
  const meta = DOC_TYPE_INSTRUCTIONS[body.docType];
  if (!meta) {
    return new Response(JSON.stringify({ error: "docType inválido" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!itemName || !Array.isArray(body.documents) || body.documents.length === 0) {
    return new Response(
      JSON.stringify({ error: "itemName e documents sao obrigatorios" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Carrega trechos dos documentos relacionados ao item do grafo (max N)
  const slice = body.documents.slice(0, MAX_DOCS);
  const sources = await Promise.all(
    slice.map(async (doc) => {
      if (!isSector(doc.sector)) {
        return { ...doc, content: "" };
      }
      try {
        const raw = await fetchDocumentChunks(doc.sector, doc.id);
        return { ...doc, content: raw.slice(0, MAX_CHARS_PER_DOC) };
      } catch {
        return { ...doc, content: "" };
      }
    }),
  );

  const usable = sources.filter((s) => s.content.trim().length > 0);

  const sourcesBlock = usable
    .map(
      (s, i) =>
        `--- DOCUMENTO ${i + 1} ---\nTítulo: ${s.title}\nSetor: ${s.sector}\nConteúdo:\n${s.content}\n`,
    )
    .join("\n");

  const relatedLine =
    body.related && body.related.length > 0
      ? `Itens relacionados no grafo de conhecimento: ${body.related.join(", ")}.`
      : "Nao ha itens correlatos relevantes no grafo.";

  const instruction = meta.instruction.replaceAll("{{conceito}}", itemName);

  const prompt = `Você é um redator técnico sênior produzindo documentação corporativa de alto padrão para a Profarma.
Use APENAS as informações dos documentos fornecidos. Quando os documentos forem insuficientes para um item, escreva "informação não coberta pelos documentos" em vez de inventar.
Linguagem: português do Brasil, tom executivo, frases curtas, sem floreio.
Saída: somente markdown, sem preâmbulos, sem comentários sobre a tarefa.

Item alvo (${itemDomainLabel}): "${itemName}"
${relatedLine}
Total de documentos da base conectados a este ${itemDomainLabel}: ${body.documents.length}.

${instruction}

DOCUMENTOS DE REFERÊNCIA (extratos):
${sourcesBlock || "(sem extratos disponíveis — aponte essa limitação no resultado)"}
`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, payload: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
        );
      }

      try {
        send("meta", {
          concept: itemName,
          itemName,
          itemDomain,
          itemDomainLabel,
          docType: body.docType,
          docTypeLabel: meta.label,
          documentsUsed: usable.map((s) => ({ id: s.id, title: s.title, sector: s.sector })),
          documentsRequested: body.documents.length,
          related: body.related ?? [],
        });

        let accText = "";
        for await (const part of generateAnswerStream(prompt)) {
          if (part.chunk) {
            accText += part.chunk;
            send("chunk", { text: part.chunk });
          }
          if (part.metrics) {
            send("metrics", part.metrics);
          }
        }

        // Generate pertinent questions based on the produced document
        const questionsPrompt = `Você é um assistente que responde SOMENTE com JSON, sem nenhum texto adicional.

Leia o documento abaixo e gere exatamente 4 perguntas curtas (máximo 12 palavras cada) que um leitor desse documento gostaria de aprofundar.
As perguntas DEVEM ser específicas ao conteúdo do documento — mencione termos, seções, ou detalhes concretos que aparecem no texto.
NÃO gere perguntas genéricas como "Quais são os riscos?" ou "Como isso se conecta?".

Formato de saída — responda APENAS com este JSON, sem blocos de código, sem explicações:
{"questions": ["pergunta específica 1", "pergunta específica 2", "pergunta específica 3", "pergunta específica 4"]}

DOCUMENTO GERADO:
${accText.slice(0, 3000)}`;

        let questionsRaw = "";
        try {
          for await (const part of generateAnswerStream(questionsPrompt)) {
            if (part.chunk) questionsRaw += part.chunk;
          }
          // Strip <think>...</think> blocks that some models emit despite think:false
          const stripped = questionsRaw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
          const match = /\{[\s\S]*?\}/.exec(stripped);
          if (match) {
            const parsed = JSON.parse(match[0]) as Record<string, unknown>;
            // Accept "questions" or "perguntas" as the key (small models answer in Portuguese)
            const qs = parsed.questions ?? parsed.perguntas;
            if (Array.isArray(qs) && qs.length > 0) {
              send("questions", { questions: (qs as string[]).slice(0, 4) });
            }
          }
        } catch {
          // Questions generation is best-effort — proceed without them
        }

        send("done", { ok: true });
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : "Falha ao gerar documentação",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
