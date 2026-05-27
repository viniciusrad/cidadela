import { prisma } from "@/lib/db/client";
import { SECTORS } from "@/lib/domain";
import { listAllSectorSlugs } from "@/lib/sectors/sector-repo";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AccessLevel = "public" | "full" | "denied";

export type AccessRuleRow = {
  id: string;
  fromSector: string;
  toSector: string;
  accessLevel: AccessLevel;
  routingKeywords: string[];
  enabled: boolean;
};

// ─── Cache ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 10_000;
let ruleCache: { value: AccessRuleRow[]; expiresAt: number } | null = null;

export function invalidateAccessRulesCache() {
  ruleCache = null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseAccessLevel(value: string): AccessLevel {
  if (value === "full" || value === "denied") return value;
  return "public";
}

function parseKeywords(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((k): k is string => typeof k === "string" && k.trim().length > 0);
  }
  return [];
}

function toRow(row: {
  id: string;
  fromSector: string;
  toSector: string;
  accessLevel: string;
  routingKeywords: unknown;
  enabled: boolean;
}): AccessRuleRow {
  return {
    id: row.id,
    fromSector: row.fromSector,
    toSector: row.toSector,
    accessLevel: parseAccessLevel(row.accessLevel),
    routingKeywords: parseKeywords(row.routingKeywords),
    enabled: row.enabled,
  };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function listAllAccessRules(): Promise<AccessRuleRow[]> {
  const now = Date.now();
  if (ruleCache && ruleCache.expiresAt > now) {
    return ruleCache.value;
  }

  const rows = await prisma.sectorAccessRule.findMany({
    orderBy: [{ fromSector: "asc" }, { toSector: "asc" }],
  });

  const value = rows.map(toRow);
  ruleCache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

export async function getAccessRule(
  from: string,
  to: string,
): Promise<AccessRuleRow | null> {
  const all = await listAllAccessRules();
  return all.find((r) => r.fromSector === from && r.toSector === to) ?? null;
}

export async function getAccessRulesForSector(
  slug: string,
): Promise<AccessRuleRow[]> {
  const all = await listAllAccessRules();
  return all.filter(
    (r) => r.fromSector === slug || r.toSector === slug,
  );
}

export async function getOutboundRules(
  from: string,
): Promise<AccessRuleRow[]> {
  const all = await listAllAccessRules();
  return all.filter((r) => r.fromSector === from && r.enabled);
}

export async function isAccessDenied(
  from: string,
  to: string,
): Promise<boolean> {
  const rule = await getAccessRule(from, to);
  if (!rule) return false;
  return !rule.enabled || rule.accessLevel === "denied";
}

export async function getRoutingKeywords(
  from: string,
  to: string,
): Promise<string[]> {
  const rule = await getAccessRule(from, to);
  return rule?.routingKeywords ?? [];
}

export async function isFullAccess(
  from: string,
  to: string,
): Promise<boolean> {
  const rule = await getAccessRule(from, to);
  return rule?.accessLevel === "full" && rule.enabled;
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function updateAccessRule(
  from: string,
  to: string,
  data: {
    accessLevel?: AccessLevel;
    routingKeywords?: string[];
    enabled?: boolean;
  },
): Promise<AccessRuleRow> {
  const row = await prisma.sectorAccessRule.upsert({
    where: {
      fromSector_toSector: { fromSector: from, toSector: to },
    },
    create: {
      fromSector: from,
      toSector: to,
      accessLevel: data.accessLevel ?? "public",
      routingKeywords: data.routingKeywords ?? [],
      enabled: data.enabled ?? true,
    },
    update: {
      ...(data.accessLevel !== undefined ? { accessLevel: data.accessLevel } : {}),
      ...(data.routingKeywords !== undefined
        ? { routingKeywords: data.routingKeywords }
        : {}),
      ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
    },
  });

  invalidateAccessRulesCache();
  return toRow(row);
}

// ─── Provisioning ─────────────────────────────────────────────────────────────

/**
 * Creates bidirectional access rules between a new sector and all existing
 * sectors. Default access level is "public" (only shareable documents).
 */
export async function provisionAccessRules(
  newSlug: string,
): Promise<number> {
  const allSlugs = await listAllSectorSlugs();
  const others = allSlugs.filter((s) => s !== newSlug);
  let count = 0;

  for (const other of others) {
    // newSlug → other
    await prisma.sectorAccessRule.upsert({
      where: {
        fromSector_toSector: { fromSector: newSlug, toSector: other },
      },
      create: {
        fromSector: newSlug,
        toSector: other,
        accessLevel: "public",
        routingKeywords: [],
      },
      update: {},
    });

    // other → newSlug
    await prisma.sectorAccessRule.upsert({
      where: {
        fromSector_toSector: { fromSector: other, toSector: newSlug },
      },
      create: {
        fromSector: other,
        toSector: newSlug,
        accessLevel: "public",
        routingKeywords: [],
      },
      update: {},
    });

    count += 2;
  }

  invalidateAccessRulesCache();
  return count;
}

// ─── Seed native access rules ─────────────────────────────────────────────────

/**
 * Seeds access rules between native sectors based on the existing static
 * DOMAIN_ROUTING keywords from base-agent.ts.
 */
export async function seedNativeAccessRules(): Promise<void> {
  const securityKeywords = [
    "senha", "password", "credencial", "credenciais", "autenticacao",
    "acesso", "seguranca", "mfa", "token", "brecha", "vazamento",
    "comprometid", "incidente de seguranca", "revogar", "revocacao",
    "privilegiad", "politica de acesso", "conta de servico", "service account",
    "segredo", "secret",
  ];
  const supportKeywords = [
    "suporte", "chamado", "sla", "usuario", "atendimento", "operacao", "incidente",
  ];
  const devKeywords = [
    "api", "endpoint", "deploy", "codigo", "servico", "integracao", "implementacao",
  ];

  // Create bidirectional rules for all native sector pairs
  for (const from of SECTORS) {
    for (const to of SECTORS) {
      if (from === to) continue;

      let keywords: string[] = [];

      // Map the existing DOMAIN_ROUTING into persistent rules
      if (from === "desenvolvimento" && to === "seguranca") {
        keywords = securityKeywords;
      } else if (from === "desenvolvimento" && to === "suporte") {
        keywords = supportKeywords;
      } else if (from === "suporte" && to === "desenvolvimento") {
        keywords = devKeywords;
      } else if (from === "suporte" && to === "seguranca") {
        keywords = securityKeywords;
      } else if (from === "seguranca" && to === "desenvolvimento") {
        keywords = devKeywords;
      } else if (from === "desktop" && to === "seguranca") {
        keywords = securityKeywords;
      }

      await prisma.sectorAccessRule.upsert({
        where: {
          fromSector_toSector: { fromSector: from, toSector: to },
        },
        create: {
          fromSector: from,
          toSector: to,
          accessLevel: "public",
          routingKeywords: keywords,
        },
        update: {
          routingKeywords: keywords,
        },
      });
    }
  }

  invalidateAccessRulesCache();
}
