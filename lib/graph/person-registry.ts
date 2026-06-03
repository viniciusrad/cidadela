import { runQuery } from "@/lib/neo4j";

export type PersonProfile = {
  name: string;
  email: string | null;
  primarySector: string | null;
  manualSector: string | null;
  jobTitle: string | null;
  documentCount: number;
  chunkCount: number;
  sectors: string[];
  performsCount: number;
  usesCount: number;
  belongsToSectors: string[];
  participatesInProcesses: number;
  knowsAboutCount: number;
  isKeyPerson: boolean;
};

export type UpsertPersonProfileInput = {
  name: string;
  email?: string | null;
  manualSector?: string | null;
  jobTitle?: string | null;
};

/**
 * Upserts canonical metadata on a Person node. Only properties explicitly provided
 * are written; null clears the property, undefined leaves it untouched.
 */
export async function upsertPersonProfile(input: UpsertPersonProfileInput): Promise<void> {
  const sets: string[] = ["p.updatedAt = datetime()"];
  const params: Record<string, unknown> = { name: input.name };

  if (input.email !== undefined) {
    sets.push("p.email = $email");
    params.email = input.email ?? null;
  }
  if (input.manualSector !== undefined) {
    sets.push("p.manualSector = $manualSector");
    params.manualSector = input.manualSector ?? null;
  }
  if (input.jobTitle !== undefined) {
    sets.push("p.jobTitle = $jobTitle");
    params.jobTitle = input.jobTitle ?? null;
  }

  await runQuery(
    `MERGE (p:Person {name: $name})
     ON CREATE SET p.createdAt = datetime()
     SET ${sets.join(", ")}`,
    params,
  );

  // When a manualSector is set, create an authoritative BELONGS_TO edge
  if (input.manualSector) {
    await runQuery(
      `MATCH (p:Person {name: $name})
       MERGE (s:Sector {slug: $sector})
       ON CREATE SET s.updatedAt = datetime()
       MERGE (p)-[r:BELONGS_TO]->(s)
       SET r.confidence = 'human_validated',
           r.isPrimary = true,
           r.updatedAt = datetime()
       WITH p
       SET p.primarySector = $sector`,
      { name: input.name, sector: input.manualSector },
    );
  }
}

/**
 * Returns a list of Person nodes with their relational summary counts.
 * Results are sorted by documentCount descending.
 */
export async function listPersonProfiles(sectorFilter?: string | null): Promise<PersonProfile[]> {
  const sectorWhere = sectorFilter
    ? `WHERE exists { (d:Document {sector: $sector})-[:INVOLVES_PERSON]->(p) }`
    : "";
  const params: Record<string, unknown> = sectorFilter ? { sector: sectorFilter } : {};

  const rows = await runQuery<{
    name: string;
    email: string | null;
    primarySector: string | null;
    manualSector: string | null;
    jobTitle: string | null;
    documentCount: number;
    chunkCount: number;
    sectors: string[];
    performsCount: number;
    usesCount: number;
    belongsToSectors: string[];
    participatesCount: number;
    knowsAboutCount: number;
  }>(
    `MATCH (p:Person)
     ${sectorWhere}
     OPTIONAL MATCH (d:Document)-[:INVOLVES_PERSON]->(p)
     OPTIONAL MATCH (c:RagChunk)-[:MENTIONS]->(p)
     WITH p,
          count(DISTINCT d) AS documentCount,
          count(DISTINCT c) AS chunkCount,
          collect(DISTINCT d.sector) AS sectors
     OPTIONAL MATCH (p)-[:PERFORMS]->()
     WITH p, documentCount, chunkCount, sectors, count(*) AS performsCount
     OPTIONAL MATCH (p)-[:USES]->()
     WITH p, documentCount, chunkCount, sectors, performsCount, count(*) AS usesCount
     OPTIONAL MATCH (p)-[:BELONGS_TO]->(s:Sector)
     WITH p, documentCount, chunkCount, sectors, performsCount, usesCount,
          collect(DISTINCT s.slug) AS belongsToSectors
     OPTIONAL MATCH (p)-[:PARTICIPATES_IN]->()
     WITH p, documentCount, chunkCount, sectors, performsCount, usesCount, belongsToSectors,
          count(*) AS participatesCount
     OPTIONAL MATCH (p)-[:KNOWS_ABOUT]->()
     WITH p, documentCount, chunkCount, sectors, performsCount, usesCount, belongsToSectors,
          participatesCount, count(*) AS knowsAboutCount
     RETURN p.name AS name,
            p.email AS email,
            p.primarySector AS primarySector,
            p.manualSector AS manualSector,
            p.jobTitle AS jobTitle,
            documentCount,
            chunkCount,
            [s IN sectors WHERE s IS NOT NULL] AS sectors,
            performsCount,
            usesCount,
            belongsToSectors,
            participatesCount,
            knowsAboutCount
     ORDER BY documentCount DESC, name ASC`,
    params,
  ).catch(() => []);

  return rows.map((row) => ({
    name: row.name,
    email: row.email ?? null,
    primarySector: row.primarySector ?? null,
    manualSector: row.manualSector ?? null,
    jobTitle: row.jobTitle ?? null,
    documentCount: Number(row.documentCount ?? 0),
    chunkCount: Number(row.chunkCount ?? 0),
    sectors: row.sectors ?? [],
    performsCount: Number(row.performsCount ?? 0),
    usesCount: Number(row.usesCount ?? 0),
    belongsToSectors: row.belongsToSectors ?? [],
    participatesInProcesses: Number(row.participatesCount ?? 0),
    knowsAboutCount: Number(row.knowsAboutCount ?? 0),
    isKeyPerson: Number(row.performsCount ?? 0) >= 3,
  }));
}

export type GoToPerson = {
  personName: string;
  email: string | null;
  situation: string;
  topicLabel: string;
  strength: number;
};

/**
 * Returns persons who are the go-to reference for topics matching the domain
 * keyword. Results are sorted by IS_GO_TO_FOR strength descending.
 */
export async function listGoToPersonsByDomain(
  domain: string,
  sector?: string | null,
): Promise<GoToPerson[]> {
  const normalized = domain.toLowerCase().trim();
  const sectorFilter = sector
    ? `AND (p.primarySector = $sector OR exists { (p)-[:BELONGS_TO]->(:Sector {slug: $sector}) })`
    : "";

  const rows = await runQuery<{
    personName: string;
    email: string | null;
    situation: string;
    topicLabel: string;
    strength: number;
  }>(
    `MATCH (p:Person)-[r:IS_GO_TO_FOR]->(t:Topic)
     WHERE t.label CONTAINS $domain ${sectorFilter}
     RETURN p.name AS personName,
            p.email AS email,
            r.situation AS situation,
            t.label AS topicLabel,
            r.strength AS strength
     ORDER BY r.strength DESC, p.name ASC
     LIMIT 20`,
    { domain: normalized, ...(sector ? { sector } : {}) },
  ).catch(() => []);

  return rows.map((row) => ({
    personName: row.personName,
    email: row.email ?? null,
    situation: row.situation ?? "",
    topicLabel: row.topicLabel,
    strength: Number(row.strength ?? 1),
  }));
}

export type BusFactorRisk = {
  personName: string;
  email: string | null;
  uniqueProcedures: number;
  riskLevel: "high" | "medium";
};

/**
 * Returns persons who are the sole executor for at least one procedure in the
 * sector, indicating a bus-factor risk. high = single owner of 2+ procedures;
 * medium = single owner of 1 procedure.
 */
export async function getBusFactorRisk(sector: string): Promise<BusFactorRisk[]> {
  const rows = await runQuery<{
    personName: string;
    email: string | null;
    uniqueProcedures: number;
  }>(
    `MATCH (p:Person)-[r:PERFORMS]->(proc:Procedure)
     WHERE (p.primarySector = $sector OR exists { (p)-[:BELONGS_TO]->(:Sector {slug: $sector}) })
       AND r.role IN ['executor', 'responsavel', 'owner']
     WITH proc, collect(DISTINCT p) AS owners
     WHERE size(owners) = 1
     WITH owners[0] AS p, count(proc) AS uniqueProcedures
     RETURN p.name AS personName,
            p.email AS email,
            uniqueProcedures
     ORDER BY uniqueProcedures DESC`,
    { sector },
  ).catch(() => []);

  return rows.map((row) => ({
    personName: row.personName,
    email: row.email ?? null,
    uniqueProcedures: Number(row.uniqueProcedures ?? 1),
    riskLevel: Number(row.uniqueProcedures ?? 1) >= 2 ? "high" : "medium",
  }));
}

/**
 * Returns the full profile plus relation details for a single person.
 */
export async function getPersonRelations(personName: string): Promise<{
  performs: Array<{ procedureName: string; role: string; confidence: string }>;
  uses: Array<{ systemName: string; confidence: string }>;
  participatesIn: Array<{ processName: string; roles: string[]; sector: string }>;
  knowsAbout: Array<{ conceptName: string; strength: number }>;
  belongsTo: Array<{ sectorSlug: string; isPrimary: boolean; docCount: number }>;
}> {
  const [performs, uses, participatesIn, knowsAbout, belongsTo] = await Promise.all([
    runQuery<{ procedureName: string; role: string; confidence: string }>(
      `MATCH (p:Person {name: $name})-[r:PERFORMS]->(proc:Procedure)
       RETURN proc.name AS procedureName, r.role AS role, r.confidence AS confidence
       ORDER BY proc.name`,
      { name: personName },
    ).catch(() => []),
    runQuery<{ systemName: string; confidence: string }>(
      `MATCH (p:Person {name: $name})-[r:USES]->(s:System)
       RETURN s.name AS systemName, r.confidence AS confidence
       ORDER BY s.name`,
      { name: personName },
    ).catch(() => []),
    runQuery<{ processName: string; roles: string[]; sector: string }>(
      `MATCH (p:Person {name: $name})-[r:PARTICIPATES_IN]->(proc:Process)
       RETURN proc.name AS processName, r.roles AS roles, proc.sectorSlug AS sector
       ORDER BY proc.name`,
      { name: personName },
    ).catch(() => []),
    runQuery<{ conceptName: string; strength: number }>(
      `MATCH (p:Person {name: $name})-[r:KNOWS_ABOUT]->(c:Concept)
       RETURN c.name AS conceptName, r.strength AS strength
       ORDER BY r.strength DESC`,
      { name: personName },
    ).catch(() => []),
    runQuery<{ sectorSlug: string; isPrimary: boolean; docCount: number }>(
      `MATCH (p:Person {name: $name})-[r:BELONGS_TO]->(s:Sector)
       RETURN s.slug AS sectorSlug, r.isPrimary AS isPrimary, coalesce(r.docCount, 0) AS docCount
       ORDER BY r.docCount DESC`,
      { name: personName },
    ).catch(() => []),
  ]);

  return {
    performs: performs.map((r) => ({
      procedureName: r.procedureName,
      role: r.role ?? "unknown",
      confidence: r.confidence ?? "co_occurrence",
    })),
    uses: uses.map((r) => ({
      systemName: r.systemName,
      confidence: r.confidence ?? "extracted",
    })),
    participatesIn: participatesIn.map((r) => ({
      processName: r.processName,
      roles: r.roles ?? [],
      sector: r.sector ?? "",
    })),
    knowsAbout: knowsAbout.map((r) => ({
      conceptName: r.conceptName,
      strength: Number(r.strength ?? 0),
    })),
    belongsTo: belongsTo.map((r) => ({
      sectorSlug: r.sectorSlug,
      isPrimary: Boolean(r.isPrimary),
      docCount: Number(r.docCount ?? 0),
    })),
  };
}
