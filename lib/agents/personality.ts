import { prisma } from "@/lib/db/client";

export type AgentPersonality = {
  sector: string;
  tone: number;
  verbosity: number;
  formality: number;
  proactivity: number;
  escalationThreshold: number;
  domainEmphasis: { topic: string; weight: number }[];
  updatedAt: Date;
  updatedBy: string | null;
};

const CACHE_TTL_MS = 30_000;
let personalityCache: {
  value: Map<string, AgentPersonality>;
  expiresAt: number;
} | null = null;

export function invalidatePersonalityCache() {
  personalityCache = null;
}

async function loadAllPersonalities(): Promise<Map<string, AgentPersonality>> {
  if (personalityCache && personalityCache.expiresAt > Date.now()) {
    return personalityCache.value;
  }
  const rows = await prisma.agentPersonality.findMany();
  const map = new Map<string, AgentPersonality>();
  for (const row of rows) {
    map.set(row.sector, {
      sector: row.sector,
      tone: row.tone,
      verbosity: row.verbosity,
      formality: row.formality,
      proactivity: row.proactivity,
      escalationThreshold: row.escalationThreshold,
      domainEmphasis: (row.domainEmphasis ?? []) as {
        topic: string;
        weight: number;
      }[],
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    });
  }
  personalityCache = { value: map, expiresAt: Date.now() + CACHE_TTL_MS };
  return map;
}

export async function getAgentPersonality(
  sector: string,
): Promise<AgentPersonality | null> {
  try {
    const map = await loadAllPersonalities();
    return map.get(sector) ?? null;
  } catch {
    return null;
  }
}

export async function upsertAgentPersonality(
  sector: string,
  data: Partial<Omit<AgentPersonality, "sector" | "updatedAt">>,
  updatedBy: string | null,
): Promise<AgentPersonality> {
  const row = await prisma.agentPersonality.upsert({
    where: { sector },
    create: {
      sector,
      tone: data.tone ?? 3,
      verbosity: data.verbosity ?? 3,
      formality: data.formality ?? 3,
      proactivity: data.proactivity ?? 3,
      escalationThreshold: data.escalationThreshold ?? 0.4,
      domainEmphasis: data.domainEmphasis ?? [],
      updatedBy,
    },
    update: {
      ...(data.tone !== undefined && { tone: data.tone }),
      ...(data.verbosity !== undefined && { verbosity: data.verbosity }),
      ...(data.formality !== undefined && { formality: data.formality }),
      ...(data.proactivity !== undefined && { proactivity: data.proactivity }),
      ...(data.escalationThreshold !== undefined && {
        escalationThreshold: data.escalationThreshold,
      }),
      ...(data.domainEmphasis !== undefined && {
        domainEmphasis: data.domainEmphasis,
      }),
      updatedBy,
    },
  });
  invalidatePersonalityCache();
  return {
    sector: row.sector,
    tone: row.tone,
    verbosity: row.verbosity,
    formality: row.formality,
    proactivity: row.proactivity,
    escalationThreshold: row.escalationThreshold,
    domainEmphasis: (row.domainEmphasis ?? []) as {
      topic: string;
      weight: number;
    }[],
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

const TONE_LABELS = [
  "",
  "Muito formal",
  "Formal",
  "Neutro",
  "Acessivel",
  "Informal",
];
const VERBOSITY_LABELS = [
  "",
  "Muito conciso",
  "Conciso",
  "Moderado",
  "Detalhado",
  "Muito detalhado",
];
const FORMALITY_LABELS = [
  "",
  "Casual",
  "Semi-formal",
  "Neutro",
  "Formal",
  "Protocolar",
];
const PROACTIVITY_LABELS = [
  "",
  "Reativo",
  "Levemente proativo",
  "Equilibrado",
  "Proativo",
  "Muito proativo",
];

export function buildPersonalityBlock(p: AgentPersonality): string {
  const lines: string[] = [
    "--- PERFIL DE PERSONALIDADE ---",
    `Tom: ${TONE_LABELS[p.tone] ?? String(p.tone)}`,
    `Verbosidade: ${VERBOSITY_LABELS[p.verbosity] ?? String(p.verbosity)}`,
    `Formalidade: ${FORMALITY_LABELS[p.formality] ?? String(p.formality)}`,
    `Proatividade: ${PROACTIVITY_LABELS[p.proactivity] ?? String(p.proactivity)}`,
  ];
  if (p.domainEmphasis.length > 0) {
    lines.push(
      `Enfase de dominio: ${p.domainEmphasis.map((e) => `${e.topic} (peso ${e.weight.toFixed(1)})`).join(", ")}`,
    );
  }
  if (p.escalationThreshold > 0) {
    lines.push(
      `Quando sua confianca estiver abaixo de ${Math.round(p.escalationThreshold * 100)}%, indique explicitamente que esta em zona de incerteza e sugira validacao ao usuario.`,
    );
  }
  lines.push("--- FIM DO PERFIL ---");
  return lines.join("\n");
}
