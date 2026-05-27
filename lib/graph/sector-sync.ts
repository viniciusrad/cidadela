import { listAllSectors } from "@/lib/sectors/sector-repo";
import { upsertSectorNode } from "@/lib/graph/persistence";

export type SyncSectorNodesResult = {
  synced: number;
  failed: Array<{ slug: string; error: string }>;
};

/**
 * Projects every enabled SectorDefinition (Postgres) into a (:Sector) node in
 * Neo4j. Postgres remains the source of truth; this is a one-way sync.
 * Idempotent — safe to call on every bootstrap.
 */
export async function syncSectorNodes(): Promise<SyncSectorNodesResult> {
  const sectors = await listAllSectors();
  const failed: Array<{ slug: string; error: string }> = [];
  let synced = 0;

  for (const sector of sectors) {
    try {
      await upsertSectorNode({
        slug: sector.slug,
        displayName: sector.displayName,
        agentName: sector.agentName,
        qdrantCollection: sector.qdrantCollection,
      });
      synced += 1;
    } catch (error) {
      failed.push({
        slug: sector.slug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { synced, failed };
}
