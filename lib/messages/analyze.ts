import { extractEntities, type ExtractedEntities } from "@/lib/graph/extractor";
import { checkNeo4jHealth, runQuery } from "@/lib/neo4j";

export type EntityDomain = "concept" | "procedure" | "system" | "regulation" | "person";

export type EntityFinding = {
  name: string;
  domain: EntityDomain;
  existsInGraph: boolean;
  docCount: number;
  sectors: string[];
};

export type ConversationAnalysis = {
  graphAvailable: boolean;
  entities: {
    concepts: EntityFinding[];
    procedures: EntityFinding[];
    systems: EntityFinding[];
    regulations: EntityFinding[];
    persons: EntityFinding[];
  };
  totals: {
    extracted: number;
    existing: number;
    novel: number;
  };
};

const DOMAIN_TO_LABEL: Record<EntityDomain, string> = {
  concept: "Concept",
  procedure: "Procedure",
  system: "System",
  regulation: "Regulation",
  person: "Person",
};

type GraphLookupRow = {
  name: string;
  docCount: number;
  sectors: string[];
};

async function lookupExisting(
  domain: EntityDomain,
  names: string[],
): Promise<Map<string, GraphLookupRow>> {
  const map = new Map<string, GraphLookupRow>();
  if (names.length === 0) return map;

  const label = DOMAIN_TO_LABEL[domain];
  const cypher = `
    UNWIND $names AS rawName
    WITH toLower(trim(rawName)) AS needle, rawName
    MATCH (n:${label})
    WHERE toLower(n.name) = needle
    OPTIONAL MATCH (n)<-[]-(d:Document)
    WITH rawName, n, collect(DISTINCT d) AS docs
    RETURN
      rawName AS name,
      size(docs) AS docCount,
      [d IN docs WHERE d.sector IS NOT NULL | d.sector] AS sectors
  `;
  try {
    const rows = await runQuery<{
      name: string;
      docCount: number;
      sectors: string[];
    }>(cypher, { names });
    for (const row of rows) {
      const dedupedSectors = Array.from(new Set(row.sectors ?? []));
      map.set(row.name.trim().toLowerCase(), {
        name: row.name,
        docCount: Number(row.docCount ?? 0),
        sectors: dedupedSectors,
      });
    }
  } catch {
    // Ignore — análise segue com tudo marcado como "novo".
  }
  return map;
}

function buildFindings(
  domain: EntityDomain,
  names: string[],
  existingMap: Map<string, GraphLookupRow>,
): EntityFinding[] {
  return names.map((name) => {
    const key = name.trim().toLowerCase();
    const hit = existingMap.get(key);
    return {
      name,
      domain,
      existsInGraph: Boolean(hit),
      docCount: hit?.docCount ?? 0,
      sectors: hit?.sectors ?? [],
    };
  });
}

export async function analyzeConversation(markdown: string): Promise<ConversationAnalysis> {
  const entities: ExtractedEntities = await extractEntities(markdown);
  const graphAvailable = await checkNeo4jHealth();

  const [conceptHits, procedureHits, systemHits, regulationHits, personHits] = graphAvailable
    ? await Promise.all([
        lookupExisting("concept", entities.concepts),
        lookupExisting("procedure", entities.procedures),
        lookupExisting("system", entities.systems),
        lookupExisting("regulation", entities.regulations),
        lookupExisting("person", entities.persons ?? []),
      ])
    : [new Map(), new Map(), new Map(), new Map(), new Map()];

  const concepts = buildFindings("concept", entities.concepts, conceptHits);
  const procedures = buildFindings("procedure", entities.procedures, procedureHits);
  const systems = buildFindings("system", entities.systems, systemHits);
  const regulations = buildFindings("regulation", entities.regulations, regulationHits);
  const persons = buildFindings("person", entities.persons ?? [], personHits);

  const all = [...concepts, ...procedures, ...systems, ...regulations, ...persons];
  const existing = all.filter((finding) => finding.existsInGraph).length;

  return {
    graphAvailable,
    entities: { concepts, procedures, systems, regulations, persons },
    totals: {
      extracted: all.length,
      existing,
      novel: all.length - existing,
    },
  };
}
