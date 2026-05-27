import { runQuery } from "@/lib/neo4j";

export type MergePersonsResult = {
  canonical: string;
  merged: string[];
  edgesTransferred: number;
};

async function transferEdges(aliasName: string, canonicalName: string): Promise<number> {
  let total = 0;

  // Incoming: Document -[INVOLVES_PERSON]-> alias
  const ipRows = await runQuery<{ count: number }>(
    `MATCH (src:Document)-[r:INVOLVES_PERSON]->(alias:Person {name: $aliasName})
     MATCH (canonical:Person {name: $canonicalName})
     WITH src, r, canonical
     MERGE (src)-[nr:INVOLVES_PERSON]->(canonical)
     ON CREATE SET nr = properties(r), nr.updatedAt = datetime()
     ON MATCH SET
       nr.roles = [x IN coalesce(r.roles, []) WHERE NOT x IN coalesce(nr.roles, [])]
                  + coalesce(nr.roles, []),
       nr.updatedAt = datetime()
     WITH r, nr
     DELETE r
     RETURN count(nr) AS count`,
    { aliasName, canonicalName },
  );
  total += Number(ipRows[0]?.count ?? 0);

  // Incoming: RagChunk -[MENTIONS]-> alias
  const mentionsRows = await runQuery<{ count: number }>(
    `MATCH (src:RagChunk)-[r:MENTIONS]->(alias:Person {name: $aliasName})
     MATCH (canonical:Person {name: $canonicalName})
     MERGE (src)-[nr:MENTIONS]->(canonical)
     ON CREATE SET nr = properties(r), nr.updatedAt = datetime()
     ON MATCH SET nr.updatedAt = datetime()
     WITH r, nr
     DELETE r
     RETURN count(nr) AS count`,
    { aliasName, canonicalName },
  );
  total += Number(mentionsRows[0]?.count ?? 0);

  // Outgoing: alias -[PERFORMS]-> Procedure
  const performsRows = await runQuery<{ count: number }>(
    `MATCH (alias:Person {name: $aliasName})-[r:PERFORMS]->(tgt)
     MATCH (canonical:Person {name: $canonicalName})
     MERGE (canonical)-[nr:PERFORMS]->(tgt)
     ON CREATE SET nr = properties(r)
     ON MATCH SET nr.updatedAt = datetime()
     WITH r, nr
     DELETE r
     RETURN count(nr) AS count`,
    { aliasName, canonicalName },
  );
  total += Number(performsRows[0]?.count ?? 0);

  // Outgoing: alias -[USES]-> System
  const usesRows = await runQuery<{ count: number }>(
    `MATCH (alias:Person {name: $aliasName})-[r:USES]->(tgt)
     MATCH (canonical:Person {name: $canonicalName})
     MERGE (canonical)-[nr:USES]->(tgt)
     ON CREATE SET nr = properties(r)
     ON MATCH SET nr.updatedAt = datetime()
     WITH r, nr
     DELETE r
     RETURN count(nr) AS count`,
    { aliasName, canonicalName },
  );
  total += Number(usesRows[0]?.count ?? 0);

  // Outgoing: alias -[KNOWS_ABOUT]-> Concept
  const knowsRows = await runQuery<{ count: number }>(
    `MATCH (alias:Person {name: $aliasName})-[r:KNOWS_ABOUT]->(tgt)
     MATCH (canonical:Person {name: $canonicalName})
     MERGE (canonical)-[nr:KNOWS_ABOUT]->(tgt)
     ON CREATE SET nr = properties(r)
     ON MATCH SET nr.strength = coalesce(nr.strength, 0) + coalesce(r.strength, 0),
                  nr.updatedAt = datetime()
     WITH r, nr
     DELETE r
     RETURN count(nr) AS count`,
    { aliasName, canonicalName },
  );
  total += Number(knowsRows[0]?.count ?? 0);

  // Outgoing: alias -[BELONGS_TO]-> Sector
  const belongsRows = await runQuery<{ count: number }>(
    `MATCH (alias:Person {name: $aliasName})-[r:BELONGS_TO]->(tgt)
     MATCH (canonical:Person {name: $canonicalName})
     MERGE (canonical)-[nr:BELONGS_TO]->(tgt)
     ON CREATE SET nr = properties(r)
     ON MATCH SET nr.updatedAt = datetime()
     WITH r, nr
     DELETE r
     RETURN count(nr) AS count`,
    { aliasName, canonicalName },
  );
  total += Number(belongsRows[0]?.count ?? 0);

  // Outgoing: alias -[PARTICIPATES_IN]-> Process
  const participatesRows = await runQuery<{ count: number }>(
    `MATCH (alias:Person {name: $aliasName})-[r:PARTICIPATES_IN]->(tgt)
     MATCH (canonical:Person {name: $canonicalName})
     MERGE (canonical)-[nr:PARTICIPATES_IN]->(tgt)
     ON CREATE SET nr = properties(r)
     ON MATCH SET nr.updatedAt = datetime()
     WITH r, nr
     DELETE r
     RETURN count(nr) AS count`,
    { aliasName, canonicalName },
  );
  total += Number(participatesRows[0]?.count ?? 0);

  return total;
}

/**
 * Merges one or more alias Person nodes into a single canonical node.
 * All edges (INVOLVES_PERSON, MENTIONS, PERFORMS, USES, KNOWS_ABOUT,
 * BELONGS_TO, PARTICIPATES_IN) are transferred. Alias nodes are deleted.
 * The canonical node is created if it does not exist yet.
 */
export async function mergePersons(
  canonicalName: string,
  aliasNames: string[],
): Promise<MergePersonsResult> {
  await runQuery(
    `MERGE (p:Person {name: $name})
     ON CREATE SET p.createdAt = datetime(), p.updatedAt = datetime()`,
    { name: canonicalName },
  );

  let totalEdges = 0;
  const merged: string[] = [];

  for (const aliasName of aliasNames) {
    if (aliasName === canonicalName) continue;

    const existing = await runQuery<{ n: unknown }>(
      `MATCH (p:Person {name: $name}) RETURN p AS n LIMIT 1`,
      { name: aliasName },
    );
    if (existing.length === 0) continue;

    const edges = await transferEdges(aliasName, canonicalName);
    totalEdges += edges;

    // Record the absorbed alias on the canonical node
    await runQuery(
      `MATCH (canonical:Person {name: $canonicalName})
       SET canonical.aliases = [x IN coalesce(canonical.aliases, []) WHERE x <> $aliasName]
                                + [$aliasName],
           canonical.updatedAt = datetime()`,
      { canonicalName, aliasName },
    );

    // Remove the alias node (DETACH handles any leftover edges)
    await runQuery(`MATCH (p:Person {name: $name}) DETACH DELETE p`, { name: aliasName });

    merged.push(aliasName);
  }

  return { canonical: canonicalName, merged, edgesTransferred: totalEdges };
}

/**
 * Renames a Person node. If the new name already exists the current node is
 * merged into it (new name wins). Otherwise the `name` property is updated
 * in-place — all existing edges remain attached to the same node.
 */
export async function renamePerson(currentName: string, newName: string): Promise<void> {
  if (!currentName || !newName || currentName === newName) return;

  const existing = await runQuery<{ n: unknown }>(
    `MATCH (p:Person {name: $name}) RETURN p AS n LIMIT 1`,
    { name: newName },
  );

  if (existing.length > 0) {
    // Target already exists — merge current into it
    await mergePersons(newName, [currentName]);
    return;
  }

  await runQuery(
    `MATCH (p:Person {name: $currentName})
     SET p.name = $newName, p.updatedAt = datetime()`,
    { currentName, newName },
  );
}
