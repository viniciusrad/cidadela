import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { SECTORS, type Sector } from "@/lib/domain";
import { AGENT_PERSONAS } from "@/lib/agents/personas";
import { SECTOR_LABELS } from "@/lib/labels";
import {
  SECTOR_COLLECTIONS,
  STAGING_SECTOR_COLLECTIONS,
} from "@/lib/config";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SectorRow = {
  slug: string;
  displayName: string;
  description: string | null;
  agentName: string;
  agentSummary: string;
  agentInstructions: string;
  capabilities: unknown;
  chatModel: string | null;
  topK: number | null;
  localConfidenceThreshold: number | null;
  qdrantCollection: string;
  qdrantStagingCollection: string;
  isNative: boolean;
  enabled: boolean;
  provisionedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
};

export type CreateSectorInput = {
  slug: string;
  displayName: string;
  description?: string;
  agentName: string;
  agentSummary: string;
  agentInstructions: string;
  capabilities?: unknown;
  chatModel?: string;
  topK?: number;
  localConfidenceThreshold?: number;
  createdBy?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SLUG_RE = /^[a-z][a-z0-9-]{1,48}[a-z0-9]$/;

function slugToCollectionName(slug: string) {
  return `rag_${slug.replace(/-/g, "_")}`;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 10_000;
let sectorCache: { value: SectorRow[]; expiresAt: number } | null = null;

export function invalidateSectorCache() {
  sectorCache = null;
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function listAllSectors(): Promise<SectorRow[]> {
  const now = Date.now();
  if (sectorCache && sectorCache.expiresAt > now) {
    return sectorCache.value;
  }

  const rows = await prisma.sectorDefinition.findMany({
    where: { enabled: true },
    orderBy: [{ isNative: "desc" }, { slug: "asc" }],
  });

  sectorCache = { value: rows, expiresAt: now + CACHE_TTL_MS };
  return rows;
}

export async function listAllSectorSlugs(): Promise<string[]> {
  const rows = await listAllSectors();
  return rows.map((r) => r.slug);
}

export async function listDynamicSectors(): Promise<SectorRow[]> {
  const rows = await listAllSectors();
  return rows.filter((r) => !r.isNative);
}

export async function getSectorDefinition(
  slug: string,
): Promise<SectorRow | null> {
  const rows = await listAllSectors();
  return rows.find((r) => r.slug === slug) ?? null;
}

export async function isSectorSlug(value: string): Promise<boolean> {
  if ((SECTORS as readonly string[]).includes(value)) return true;
  const def = await getSectorDefinition(value);
  return def !== null && def.enabled;
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function createSector(
  input: CreateSectorInput,
): Promise<SectorRow> {
  if (!SLUG_RE.test(input.slug)) {
    throw new Error(
      "Slug invalido. Use apenas letras minusculas, numeros e hifens (3-50 chars).",
    );
  }

  if ((SECTORS as readonly string[]).includes(input.slug)) {
    throw new Error(
      `O slug "${input.slug}" conflita com um setor nativo.`,
    );
  }

  const existing = await prisma.sectorDefinition.findUnique({
    where: { slug: input.slug },
  });
  if (existing) {
    throw new Error(`O setor "${input.slug}" ja existe.`);
  }

  const qdrantCollection = slugToCollectionName(input.slug);
  const qdrantStagingCollection = `${qdrantCollection}_staging`;

  const row = await prisma.sectorDefinition.create({
    data: {
      slug: input.slug,
      displayName: input.displayName,
      description: input.description ?? null,
      agentName: input.agentName,
      agentSummary: input.agentSummary,
      agentInstructions: input.agentInstructions,
      capabilities: input.capabilities ?? undefined,
      chatModel: input.chatModel ?? null,
      topK: input.topK ?? null,
      localConfidenceThreshold: input.localConfidenceThreshold ?? null,
      qdrantCollection,
      qdrantStagingCollection,
      isNative: false,
      createdBy: input.createdBy ?? null,
    },
  });

  invalidateSectorCache();
  return row;
}

export async function updateSector(
  slug: string,
  data: Partial<
    Pick<
      CreateSectorInput,
      | "displayName"
      | "description"
      | "agentName"
      | "agentSummary"
      | "agentInstructions"
      | "capabilities"
      | "chatModel"
      | "topK"
      | "localConfidenceThreshold"
    >
  >,
): Promise<SectorRow> {
  const updateData: Record<string, unknown> = {};
  if (data.displayName !== undefined) updateData.displayName = data.displayName;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.agentName !== undefined) updateData.agentName = data.agentName;
  if (data.agentSummary !== undefined) updateData.agentSummary = data.agentSummary;
  if (data.agentInstructions !== undefined) updateData.agentInstructions = data.agentInstructions;
  if (data.capabilities !== undefined) updateData.capabilities = data.capabilities as Prisma.InputJsonValue;
  if (data.chatModel !== undefined) updateData.chatModel = data.chatModel;
  if (data.topK !== undefined) updateData.topK = data.topK;
  if (data.localConfidenceThreshold !== undefined) updateData.localConfidenceThreshold = data.localConfidenceThreshold;

  const row = await prisma.sectorDefinition.update({
    where: { slug },
    data: updateData,
  });
  invalidateSectorCache();
  return row;
}

export async function markSectorProvisioned(slug: string): Promise<void> {
  await prisma.sectorDefinition.update({
    where: { slug },
    data: { provisionedAt: new Date() },
  });
  invalidateSectorCache();
}

export async function disableSector(slug: string): Promise<void> {
  const def = await getSectorDefinition(slug);
  if (def?.isNative) {
    throw new Error("Nao e possivel desabilitar um setor nativo.");
  }
  await prisma.sectorDefinition.update({
    where: { slug },
    data: { enabled: false },
  });
  invalidateSectorCache();
}

// ─── Seed nativos ─────────────────────────────────────────────────────────────

export async function seedNativeSectors(): Promise<void> {
  for (const sector of SECTORS) {
    const persona = AGENT_PERSONAS[sector];
    await prisma.sectorDefinition.upsert({
      where: { slug: sector },
      create: {
        slug: sector,
        displayName: SECTOR_LABELS[sector],
        agentName: persona.name,
        agentSummary: persona.summary,
        agentInstructions: persona.instructions,
        capabilities: persona.capabilities as unknown as undefined,
        qdrantCollection: SECTOR_COLLECTIONS[sector],
        qdrantStagingCollection: STAGING_SECTOR_COLLECTIONS[sector],
        isNative: true,
        provisionedAt: new Date(),
      },
      update: {
        displayName: SECTOR_LABELS[sector],
        agentName: persona.name,
        agentSummary: persona.summary,
        agentInstructions: persona.instructions,
        capabilities: persona.capabilities as unknown as undefined,
        qdrantCollection: SECTOR_COLLECTIONS[sector],
        qdrantStagingCollection: STAGING_SECTOR_COLLECTIONS[sector],
        isNative: true,
      },
    });
  }
  invalidateSectorCache();
}
