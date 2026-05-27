import type { Sector } from "@/lib/domain";
import type { SearchMatch } from "@/lib/markdown";
import { checkNeo4jHealth, runQuery } from "@/lib/neo4j";
import { searchChunks } from "@/lib/qdrant";

// ─── Config ───────────────────────────────────────────────────────────────────

const MIN_SCORE = 0.3;
const MAX_TERMS = 8;
const MAX_GRAPH_DOCS = 3;   // max extra docs fetched from graph
const MAX_ENTITIES_IN_NOTE = 6;

// ─── Stopwords (PT-BR + EN common) ───────────────────────────────────────────

const STOPWORDS = new Set([
  "que", "com", "para", "como", "uma", "nao", "por", "em", "no", "na",
  "do", "da", "de", "dos", "das", "os", "as", "ao", "aos", "seu", "sua",
  "seus", "suas", "ele", "ela", "eles", "elas", "isso", "isto", "aqui",
  "ali", "mas", "mais", "menos", "muito", "bem", "mal", "sao", "foi",
  "ser", "ter", "tem", "este", "esta", "estes", "estas", "esse", "essa",
  "qual", "quando", "onde", "quem", "porque", "pois", "the", "and", "for",
  "are", "not", "that", "this", "with", "have", "from", "foi", "ser",
  "qual", "quais", "voce", "pode", "deve", "sobre", "entre", "apos",
  "antes", "dentro", "fora", "aqui", "ali", "ainda", "tambem",
]);

// ─── Types ────────────────────────────────────────────────────────────────────

type GraphDoc = {
  docId: string;
  title: string;
  sector: string;
  matchedEntities: string[];
};

type GraphProcess = {
  id: string;
  name: string;
  status: string | null;
  recommendedAutomationLevel: string | null;
  procedures: string[];
  systems: string[];
};

export type GraphEnrichmentResult = {
  extraMatches: SearchMatch[];
  graphNote: string | null;
};

const EMPTY: GraphEnrichmentResult = { extraMatches: [], graphNote: null };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractTerms(question: string): string[] {
  return [
    ...new Set(
      question
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .split(/[\s,;:.!?()[\]"']+/)
        .filter((w) => w.length >= 3 && /^[a-z0-9]+$/.test(w))
        .filter((w) => !STOPWORDS.has(w)),
    ),
  ].slice(0, MAX_TERMS);
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Queries Neo4j for documents whose indexed entities match terms extracted from
 * the question. For each graph-discovered document not already covered by vector
 * search, fetches its best-matching chunk from Qdrant and appends it to the
 * context. Returns both extra matches and a short note for the LLM prompt.
 *
 * Designed to be non-blocking: any error silently returns EMPTY so the agent
 * continues normally without graph enrichment.
 */
export async function getGraphContextForQuestion(
  question: string,
  questionVector: number[],
  existingMatches: SearchMatch[],
  sector: Sector,
): Promise<GraphEnrichmentResult> {
  try {
    const healthy = await checkNeo4jHealth();
    if (!healthy) return EMPTY;

    const terms = extractTerms(question);
    if (terms.length === 0) return EMPTY;

    // Find documents in the graph whose entities match the question terms
    const graphDocs = await runQuery<GraphDoc>(
      `MATCH (e)
       WHERE e.name IS NOT NULL
         AND any(term IN $terms WHERE toLower(e.name) CONTAINS toLower(term))
       MATCH (d:Document)-[]->(e)
       WHERE d.sector = $sector
       RETURN DISTINCT
         d.id            AS docId,
         d.title         AS title,
         d.sector        AS sector,
         collect(e.name) AS matchedEntities
       ORDER BY size(collect(e.name)) DESC
       LIMIT 5`,
      { terms, sector },
    );

    // Find Process nodes whose name matches question terms (process-centric layer)
    const graphProcesses = await runQuery<GraphProcess>(
      `MATCH (p:Process)
       WHERE p.sectorSlug = $sector
         AND p.status <> 'archived'
         AND any(term IN $terms WHERE toLower(p.name) CONTAINS toLower(term))
       OPTIONAL MATCH (p)-[:COMPRISES]->(proc:Procedure)
       OPTIONAL MATCH (p)-[:SUPPORTED_BY]->(s:System)
       RETURN p.id AS id,
              p.name AS name,
              p.status AS status,
              p.recommendedAutomationLevel AS recommendedAutomationLevel,
              collect(DISTINCT proc.name) AS procedures,
              collect(DISTINCT s.name) AS systems
       ORDER BY p.automationReadinessScore DESC
       LIMIT 3`,
      { terms, sector },
    ).catch(() => [] as GraphProcess[]);

    if (graphDocs.length === 0 && graphProcesses.length === 0) return EMPTY;

    // Exclude documents whose chunks are already present in vector results
    const coveredDocIds = new Set(existingMatches.map((m) => m.documentId));
    const newDocs = graphDocs.filter((d) => !coveredDocIds.has(d.docId));

    // For each new graph-discovered document, fetch its best chunk from Qdrant
    const extraMatches: SearchMatch[] = [];
    for (const doc of newDocs.slice(0, MAX_GRAPH_DOCS)) {
      const chunks = await searchChunks(questionVector, sector, {
        sourceDocumentIds: [doc.docId],
      });
      const best = chunks[0];
      if (best && best.score >= MIN_SCORE) {
        extraMatches.push({
          ...best,
          // Mark origin so the UI and LLM can distinguish graph-sourced chunks
          headingPathText: `[grafo] ${best.headingPathText}`,
        });
      }
    }

    // Compose a short note for the LLM about what the graph found
    const allEntities = [
      ...new Set(graphDocs.flatMap((d) => d.matchedEntities)),
    ].slice(0, MAX_ENTITIES_IN_NOTE);

    const entityNote = allEntities.length > 0
      ? `Grafo de conhecimento — entidades identificadas na pergunta: "${allEntities.join('", "')}".` +
        (extraMatches.length > 0
          ? ` ${extraMatches.length} trecho(s) de documento(s) relacionados via grafo foram adicionados ao contexto acima.`
          : " Os documentos relacionados via grafo já estão cobertos pelos trechos de contexto acima.")
      : null;

    const processNote = graphProcesses.length > 0
      ? "[processo] Processos consolidados que casam com a pergunta:\n" +
        graphProcesses
          .map((p) => {
            const procs = p.procedures.filter(Boolean);
            const systems = p.systems.filter(Boolean);
            const parts = [
              `• ${p.name}`,
              p.recommendedAutomationLevel ? `automação: ${p.recommendedAutomationLevel}` : null,
              procs.length > 0 ? `procedimentos: ${procs.slice(0, 4).join(", ")}` : null,
              systems.length > 0 ? `sistemas: ${systems.slice(0, 4).join(", ")}` : null,
            ].filter(Boolean);
            return parts.join(" — ");
          })
          .join("\n")
      : null;

    const graphNote = [entityNote, processNote].filter(Boolean).join("\n\n") || null;

    return { extraMatches, graphNote };
  } catch {
    // Graph enrichment never blocks the main query path
    return EMPTY;
  }
}
