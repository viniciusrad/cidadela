import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/client";
import type { Sector } from "@/lib/domain";
import type { Capability } from "@/lib/agents/types";

export type AgentConfigOverride = {
  sector: Sector;
  displayName: string | null;
  summary: string | null;
  instructions: string | null;
  capabilities: Capability[] | null;
  chatModel: string | null;
  topK: number | null;
  localConfidenceThreshold: number | null;
  updatedAt: Date;
  updatedBy: string | null;
};

export type ProtocolOverrideRow = {
  id: string;
  fromSector: string;
  toSector: string;
  intent: string;
  template: string;
  maxTokens: number;
  enabled: boolean;
  updatedAt: Date;
};

const CACHE_TTL_MS = 10_000;

let agentCache: { value: Map<string, AgentConfigOverride>; expiresAt: number } | null = null;
let protocolCache: { value: ProtocolOverrideRow[]; expiresAt: number } | null = null;

export function invalidateAgentConfigCache() {
  agentCache = null;
}

export function invalidateProtocolCache() {
  protocolCache = null;
}

function rowToAgentConfig(row: {
  sector: Sector;
  displayName: string | null;
  summary: string | null;
  instructions: string | null;
  capabilities: Prisma.JsonValue | null;
  chatModel: string | null;
  topK: number | null;
  localConfidenceThreshold: number | null;
  updatedAt: Date;
  updatedBy: string | null;
}): AgentConfigOverride {
  return {
    sector: row.sector,
    displayName: row.displayName,
    summary: row.summary,
    instructions: row.instructions,
    capabilities:
      Array.isArray(row.capabilities) && row.capabilities.length >= 0
        ? (row.capabilities as unknown as Capability[])
        : null,
    chatModel: row.chatModel,
    topK: row.topK,
    localConfidenceThreshold: row.localConfidenceThreshold,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

export async function loadAllAgentConfigs(): Promise<Map<string, AgentConfigOverride>> {
  const now = Date.now();
  if (agentCache && agentCache.expiresAt > now) {
    return agentCache.value;
  }

  try {
    const rows = await prisma.agentConfig.findMany();
    const map = new Map<string, AgentConfigOverride>();
    for (const row of rows) {
      map.set(row.sector, rowToAgentConfig(row));
    }
    agentCache = { value: map, expiresAt: now + CACHE_TTL_MS };
    return map;
  } catch (error) {
    console.warn("[agent-config] failed to load overrides, using defaults:", error);
    return new Map();
  }
}

export async function loadAgentConfig(sector: Sector): Promise<AgentConfigOverride | null> {
  const map = await loadAllAgentConfigs();
  return map.get(sector) ?? null;
}

export async function upsertAgentConfig(
  sector: Sector,
  data: Partial<Omit<AgentConfigOverride, "sector" | "updatedAt">>,
  updatedBy: string | null,
): Promise<AgentConfigOverride> {
  const payload: Prisma.AgentConfigUncheckedCreateInput = {
    sector,
    displayName: data.displayName ?? null,
    summary: data.summary ?? null,
    instructions: data.instructions ?? null,
    capabilities:
      data.capabilities === undefined
        ? undefined
        : data.capabilities === null
          ? Prisma.DbNull
          : (data.capabilities as unknown as Prisma.InputJsonValue),
    chatModel: data.chatModel ?? null,
    topK: data.topK ?? null,
    localConfidenceThreshold: data.localConfidenceThreshold ?? null,
    updatedBy,
  };

  const updateData: Prisma.AgentConfigUncheckedUpdateInput = { updatedBy };
  if (data.displayName !== undefined) updateData.displayName = data.displayName;
  if (data.summary !== undefined) updateData.summary = data.summary;
  if (data.instructions !== undefined) updateData.instructions = data.instructions;
  if (data.capabilities !== undefined) {
    updateData.capabilities =
      data.capabilities === null
        ? Prisma.DbNull
        : (data.capabilities as unknown as Prisma.InputJsonValue);
  }
  if (data.chatModel !== undefined) updateData.chatModel = data.chatModel;
  if (data.topK !== undefined) updateData.topK = data.topK;
  if (data.localConfidenceThreshold !== undefined) {
    updateData.localConfidenceThreshold = data.localConfidenceThreshold;
  }

  const row = await prisma.agentConfig.upsert({
    where: { sector },
    create: payload,
    update: updateData,
  });

  invalidateAgentConfigCache();
  return rowToAgentConfig(row);
}

export async function resetAgentConfig(sector: Sector): Promise<void> {
  await prisma.agentConfig.deleteMany({ where: { sector } });
  invalidateAgentConfigCache();
}

export async function loadAllProtocols(): Promise<ProtocolOverrideRow[]> {
  const now = Date.now();
  if (protocolCache && protocolCache.expiresAt > now) {
    return protocolCache.value;
  }

  try {
    const rows = await prisma.protocol.findMany();
    const value = rows.map((row) => ({
      id: protocolKey(row.fromSector, row.toSector, row.intent),
      fromSector: row.fromSector,
      toSector: row.toSector,
      intent: row.intent,
      template: row.template,
      maxTokens: row.maxTokens,
      enabled: row.enabled,
      updatedAt: row.updatedAt,
    }));
    protocolCache = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  } catch (error) {
    console.warn("[protocol-config] failed to load overrides, using defaults:", error);
    return [];
  }
}

export function protocolKey(from: string, to: string, intent: string) {
  return `${from}->${to}:${intent}`;
}

export async function updateProtocol(
  from: string,
  to: string,
  intent: string,
  data: { enabled?: boolean; template?: string; maxTokens?: number },
): Promise<void> {
  await prisma.protocol.update({
    where: {
      fromSector_toSector_intent: { fromSector: from, toSector: to, intent },
    },
    data,
  });
  invalidateProtocolCache();
}

export async function resetProtocol(
  from: string,
  to: string,
  intent: string,
  defaults: { enabled: boolean; template: string; maxTokens: number },
): Promise<void> {
  await prisma.protocol.update({
    where: {
      fromSector_toSector_intent: { fromSector: from, toSector: to, intent },
    },
    data: defaults,
  });
  invalidateProtocolCache();
}
