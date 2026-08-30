for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile?.(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
}

import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

import { getReferenceUsers } from "../lib/reference-users";
import { AGENT_PERSONAS } from "../lib/agents/personas";
import { SECTOR_LABELS } from "../lib/labels";
import { SECTORS } from "../lib/domain";
import {
  SECTOR_COLLECTIONS,
  STAGING_SECTOR_COLLECTIONS,
} from "../lib/config";

async function seedSectorDefinitions(db: PrismaClient) {
  // Seed native sector definitions
  for (const sector of SECTORS) {
    const persona = AGENT_PERSONAS[sector];
    await db.sectorDefinition.upsert({
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
        isNative: true,
      },
    });
  }

  // Seed native access rules
  const securityKw = [
    "senha", "password", "credencial", "credenciais", "autenticacao",
    "acesso", "seguranca", "mfa", "token", "brecha", "vazamento",
    "comprometid", "incidente de seguranca", "revogar", "revocacao",
    "privilegiad", "politica de acesso", "conta de servico", "service account",
    "segredo", "secret",
  ];
  const supportKw = [
    "suporte", "chamado", "sla", "usuario", "atendimento", "operacao", "incidente",
  ];
  const devKw = [
    "api", "endpoint", "deploy", "codigo", "servico", "integracao", "implementacao",
  ];

  const kwMap: Record<string, string[]> = {
    "desenvolvimento->seguranca": securityKw,
    "desenvolvimento->suporte": supportKw,
    "suporte->desenvolvimento": devKw,
    "suporte->seguranca": securityKw,
    "seguranca->desenvolvimento": devKw,
    "desktop->seguranca": securityKw,
  };

  for (const from of SECTORS) {
    for (const to of SECTORS) {
      if (from === to) continue;
      const key = `${from}->${to}`;
      await db.sectorAccessRule.upsert({
        where: {
          fromSector_toSector: { fromSector: from, toSector: to },
        },
        create: {
          fromSector: from,
          toSector: to,
          accessLevel: "public",
          routingKeywords: kwMap[key] ?? [],
        },
        update: {},
      });
    }
  }

  console.log("  ✓ Seeded sector definitions and access rules");
}

async function seedAgentPersonalities() {
  const defaults: Array<{
    sector: string;
    tone: number;
    verbosity: number;
    formality: number;
    proactivity: number;
    escalationThreshold: number;
    domainEmphasis: { topic: string; weight: number }[];
  }> = [
    {
      sector: "desenvolvimento",
      tone: 3,
      verbosity: 4,
      formality: 2,
      proactivity: 4,
      escalationThreshold: 0.35,
      domainEmphasis: [
        { topic: "arquitetura", weight: 0.8 },
        { topic: "deploy", weight: 0.7 },
        { topic: "codigo", weight: 0.9 },
      ],
    },
    {
      sector: "seguranca",
      tone: 2,
      verbosity: 3,
      formality: 4,
      proactivity: 3,
      escalationThreshold: 0.45,
      domainEmphasis: [
        { topic: "compliance", weight: 0.9 },
        { topic: "risco", weight: 0.85 },
        { topic: "controle-de-acesso", weight: 0.8 },
      ],
    },
    {
      sector: "suporte",
      tone: 4,
      verbosity: 3,
      formality: 3,
      proactivity: 4,
      escalationThreshold: 0.4,
      domainEmphasis: [
        { topic: "incidentes", weight: 0.85 },
        { topic: "usuario", weight: 0.9 },
        { topic: "sla", weight: 0.75 },
      ],
    },
    {
      sector: "desktop",
      tone: 3,
      verbosity: 3,
      formality: 3,
      proactivity: 3,
      escalationThreshold: 0.4,
      domainEmphasis: [
        { topic: "hardware", weight: 0.85 },
        { topic: "sistema-operacional", weight: 0.8 },
      ],
    },
  ];

  for (const p of defaults) {
    await prisma.agentPersonality.upsert({
      where: { sector: p.sector },
      create: p,
      update: {},
    });
  }
  console.log("Personalities seeded.");
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL nao definida para o seed.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString,
  }),
});

async function main() {
  const users = getReferenceUsers();

  for (const user of users) {
    const passwordHash = await bcrypt.hash(user.password, 10);

    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        passwordHash,
        role: user.role,
        sector: user.sector,
      },
      create: {
        email: user.email,
        name: user.name,
        passwordHash,
        role: user.role,
        sector: user.sector,
      },
    });
  }

  await prisma.knowledgeOwner.upsert({
    where: {
      topic_sector: {
        topic: "piloto",
        sector: "desenvolvimento",
      },
    },
    update: {
      userEmail: "admin@cidadela.local",
    },
    create: {
      topic: "piloto",
      sector: "desenvolvimento",
      userEmail: "admin@cidadela.local",
    },
  });

  // Seed native sector definitions and access rules
  await seedSectorDefinitions(prisma);
  await seedAgentPersonalities();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
