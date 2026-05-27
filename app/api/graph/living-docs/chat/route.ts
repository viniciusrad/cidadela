import { type NextRequest } from "next/server";

import { auth } from "@/auth";
import { isSector } from "@/lib/config";
import { checkNeo4jHealth, runQuery } from "@/lib/neo4j";
import { generateAnswerStream } from "@/lib/ollama";
import { fetchDocumentChunks } from "@/lib/qdrant";

type DocumentRef = { id: string; title: string; sector: string };

type ChatTurn = { role: "user" | "assistant"; content: string };

type RequestBody = {
  concept: string;
  itemId?: string;
  itemName?: string;
  itemDomain?: KnowledgeDomain;
  docTypeLabel?: string;
  generatedDocument: string;
  documents: DocumentRef[];
  history: ChatTurn[];
  question: string;
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

const ENTITY_DOMAIN_CONFIG: Record<
  Exclude<KnowledgeDomain, "document">,
  {
    nodeLabel: "Concept" | "Procedure" | "System";
    relType: "HAS_CONCEPT" | "DESCRIBES" | "REFERENCES_SYSTEM";
  }
> = {
  concept: { nodeLabel: "Concept", relType: "HAS_CONCEPT" },
  procedure: { nodeLabel: "Procedure", relType: "DESCRIBES" },
  system: { nodeLabel: "System", relType: "REFERENCES_SYSTEM" },
};

const MAX_CHARS_PER_DOC = 1400;
const MAX_DOCS = 6;
const MAX_HISTORY_TURNS = 6;
const MAX_GENERATED_CHARS = 4000;

type GraphEdge = {
  related: string;
  bridgeDocs: { id: string; title: string; sector: string }[];
};

async function getGraphEdgesForItem(
  domain: KnowledgeDomain,
  name: string,
  id: string,
) {
  if (domain === "document") {
    return runQuery<GraphEdge>(
      `MATCH (d:Document {id: $id})-[:HAS_CONCEPT|DESCRIBES|REFERENCES_SYSTEM|COMPLIES_WITH]->(shared)
             <-[:HAS_CONCEPT|DESCRIBES|REFERENCES_SYSTEM|COMPLIES_WITH]-(other:Document)
       WHERE other.id <> d.id
       WITH shared, collect(DISTINCT {id: other.id, title: coalesce(other.title, other.id), sector: coalesce(other.sector,'?')})[0..3] AS bridgeDocs
       RETURN shared.name AS related, bridgeDocs
       ORDER BY size(bridgeDocs) DESC, related ASC
       LIMIT 8`,
      { id },
    );
  }

  const config = ENTITY_DOMAIN_CONFIG[domain];
  return runQuery<GraphEdge>(
    `MATCH (item:${config.nodeLabel} {name: $name})<-[:${config.relType}]-(:Document)-[:${config.relType}]->(other:${config.nodeLabel})
     WHERE other.name <> item.name
     WITH other
     MATCH (other)<-[:${config.relType}]-(d:Document)
     WITH other, collect(DISTINCT {id: d.id, title: coalesce(d.title, d.id), sector: coalesce(d.sector,'?')})[0..3] AS bridgeDocs
     RETURN other.name AS related, bridgeDocs
     ORDER BY size(bridgeDocs) DESC, related ASC
     LIMIT 8`,
    { name },
  );
}

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
  const itemId = (body.itemId || itemName).trim();
  const itemDomain = normalizeDomain(body.itemDomain);
  const itemDomainLabel = DOMAIN_LABELS[itemDomain];

  if (!itemName || !body.question?.trim()) {
    return new Response(
      JSON.stringify({ error: "itemName e question sao obrigatorios" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // 1. Documentos-fonte (mesmos usados na geração)
  const slice = (body.documents ?? []).slice(0, MAX_DOCS);
  const sources = await Promise.all(
    slice.map(async (doc) => {
      if (!isSector(doc.sector)) return { ...doc, content: "" };
      try {
        const raw = await fetchDocumentChunks(doc.sector, doc.id);
        return { ...doc, content: raw.slice(0, MAX_CHARS_PER_DOC) };
      } catch {
        return { ...doc, content: "" };
      }
    }),
  );
  const usable = sources.filter((s) => s.content.trim().length > 0);

  // 2. Vizinhanca no grafo: itens relacionados + documentos-ponte
  let graphEdges: GraphEdge[] = [];
  try {
    if (await checkNeo4jHealth()) {
      graphEdges = await getGraphEdgesForItem(itemDomain, itemName, itemId);
    }
  } catch {
    graphEdges = [];
  }

  const sourcesBlock = usable
    .map(
      (s, i) =>
        `--- DOCUMENTO ${i + 1} ---\nTítulo: ${s.title}\nSetor: ${s.sector}\nConteúdo:\n${s.content}\n`,
    )
    .join("\n");

  const graphBlock =
    graphEdges.length > 0
      ? graphEdges
          .map(
            (e) =>
              `- ${e.related} — também aparece em: ${e.bridgeDocs
                .map((d) => `"${d.title}" (${d.sector})`)
                .join("; ")}`,
          )
          .join("\n")
      : "(sem vizinhança disponível no grafo)";

  const history = (body.history ?? [])
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => `${t.role === "user" ? "USUÁRIO" : "ASSISTENTE"}: ${t.content}`)
    .join("\n");

  const generatedDoc = (body.generatedDocument ?? "").slice(0, MAX_GENERATED_CHARS);

  const prompt = `Você é um assistente que responde perguntas sobre um documento gerencial recém-gerado para o ${itemDomainLabel} "${itemName}"${
    body.docTypeLabel ? ` (tipo: ${body.docTypeLabel})` : ""
  }.

Use, em ordem de prioridade:
1. O DOCUMENTO GERADO abaixo (é o que o usuário acabou de ler).
2. Os trechos dos DOCUMENTOS DE REFERÊNCIA que originaram esse documento.
3. A VIZINHANÇA NO GRAFO (itens relacionados e documentos-ponte) para responder perguntas que extrapolem o item.

Regras:
- Responda em português, tom executivo, frases curtas.
- Se a resposta exigir informação que NÃO está nas fontes, diga "essa informação não está coberta pela base atual" e sugira em qual documento ou item vizinho buscar.
- Quando citar fato relevante, indique entre parênteses o documento-fonte (ex.: "(ver: Política de Acesso)").
- Não repita o documento inteiro; seja direto.
- Saída em markdown leve (negrito, listas curtas quando ajudar).

=== DOCUMENTO GERADO ===
${generatedDoc || "(sem documento gerado)"}

=== DOCUMENTOS DE REFERÊNCIA (extratos) ===
${sourcesBlock || "(sem extratos)"}

=== VIZINHANÇA NO GRAFO DE CONHECIMENTO ===
${graphBlock}

${history ? `=== HISTÓRICO DA CONVERSA ===\n${history}\n` : ""}
=== PERGUNTA ATUAL ===
${body.question.trim()}

Resposta:`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, payload: unknown) =>
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
        );

      try {
        send("meta", {
          documentsUsed: usable.length,
          graphNeighbors: graphEdges.length,
        });

        for await (const part of generateAnswerStream(prompt)) {
          if (part.chunk) send("chunk", { text: part.chunk });
          if (part.metrics) send("metrics", part.metrics);
        }
        send("done", { ok: true });
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : "Falha ao responder",
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
