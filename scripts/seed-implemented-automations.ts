/**
 * scripts/seed-implemented-automations.ts
 *
 * Cadastra (ou atualiza) um AutomationCandidate para cada um dos 3 fluxos
 * human-in-captcha já implementados:
 *   1. problemas-pedido-eletronico  (Cervello)
 *   2. medication-price-survey      (Pharmacy prices)
 *   3. coleta-indices-moedas        (Currency/index collection)
 *
 * O script é idempotente: usa upsert pelo fingerprint (processName + sector).
 * Se o candidato já existir, apenas atualiza status e campos descritivos.
 *
 * Uso:
 *   npx tsx scripts/seed-implemented-automations.ts
 *   npx tsx scripts/seed-implemented-automations.ts --dry-run
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

// ─── Definição dos 3 fluxos ───────────────────────────────────────────────────

/**
 * Cada entrada define um AutomationCandidate representando um fluxo
 * já implementado no human-in-captcha. O `processName` deve casar com
 * o processKey usado em lib/config.ts para que a trilha narrativa
 * do chat (app/api/chat/route.ts) associe execuções futuras.
 */
const IMPLEMENTED_AUTOMATIONS = [
  {
    sector: "desenvolvimento" as const,
    title: "Abertura de Chamado Cervello — Problemas no Pedido Eletrônico",
    processName: "problemas-pedido-eletronico",
    automationLevel: "total",
    automationLabel: "Automação completa",
    suggestedScriptType: "workflow_orquestrado",
    confidence: 0.95,
    status: "implemented",
    payload: {
      signals: [
        "Chamado Cervello",
        "Pedido Eletrônico",
        "Abertura de ticket",
        "human-in-captcha",
      ],
      integration: "human-captcha",
      processKey: "problemas-pedido-eletronico",
      description:
        "Automação que abre chamado no Cervello para problemas relacionados ao Pedido Eletrônico. " +
        "Disparada a partir do chat quando o agente detecta intenção de abertura de chamado. " +
        "Implementada via human-in-captcha (lib/integrations/human-captcha.ts).",
      implementedAt: new Date().toISOString(),
      implementedBy: "pfrm-secure-agents seed",
    },
  },
  {
    sector: "desenvolvimento" as const,
    title: "Pesquisa de Preços de Medicamentos — Farmácias Parceiras",
    processName: "medication-price-survey",
    automationLevel: "total",
    automationLabel: "Automação completa",
    suggestedScriptType: "integracao_api",
    confidence: 0.90,
    status: "implemented",
    payload: {
      signals: [
        "Pesquisa de preços",
        "Medicamentos",
        "Farmácias parceiras",
        "Pharmacy prices",
        "human-in-captcha",
      ],
      integration: "human-captcha",
      processKey: "medication-price-survey",
      description:
        "Automação de pesquisa de preços de medicamentos em farmácias parceiras. " +
        "Executada via launchPfrmAutomationScript com processKey medication-price-survey. " +
        "Implementada via human-in-captcha (lib/integrations/human-captcha.ts).",
      implementedAt: new Date().toISOString(),
      implementedBy: "pfrm-secure-agents seed",
    },
  },
  {
    sector: "desenvolvimento" as const,
    title: "Coleta de Índices e Moedas",
    processName: "coleta-indices-moedas",
    automationLevel: "total",
    automationLabel: "Automação completa",
    suggestedScriptType: "integracao_api",
    confidence: 0.90,
    status: "implemented",
    payload: {
      signals: [
        "Índices",
        "Moedas",
        "Coleta de dados financeiros",
        "Currency index",
        "human-in-captcha",
      ],
      integration: "human-captcha",
      processKey: "coleta-indices-moedas",
      description:
        "Automação de coleta de índices econômicos e cotações de moedas. " +
        "Executada via launchPfrmAutomationScript com processKey coleta-indices-moedas. " +
        "Implementada via human-in-captcha (lib/integrations/human-captcha.ts).",
      implementedAt: new Date().toISOString(),
      implementedBy: "pfrm-secure-agents seed",
    },
  },
] as const;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `\nSeed de AutomationCandidates implementados${DRY_RUN ? " [DRY RUN]" : ""}\n`,
  );

  // Para seed idempotente, precisamos de um curationDocumentId válido por setor.
  // Usamos o primeiro documento PROMOTED do setor desenvolvimento como âncora.
  // Se não houver documento promovido, usamos o primeiro disponível.
  const anchorDoc = await prisma.curationDocument.findFirst({
    where: { sector: "desenvolvimento" },
    orderBy: [{ status: "asc" }, { uploadedAt: "desc" }],
    select: { id: true, documentTitle: true, status: true },
  });

  if (!anchorDoc) {
    console.warn(
      "⚠  Nenhum CurationDocument encontrado no setor desenvolvimento.",
    );
    console.warn(
      "   Execute npm run seed e npm run db:migrate antes deste script.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Usando documento âncora: "${anchorDoc.documentTitle}" (${anchorDoc.status}) → id=${anchorDoc.id}\n`,
  );

  for (const automation of IMPLEMENTED_AUTOMATIONS) {
    const label = `[${automation.sector}] ${automation.title}`;

    if (DRY_RUN) {
      console.log(`  DRY   ${label}`);
      console.log(`        processName: ${automation.processName}`);
      console.log(`        status: ${automation.status}`);
      continue;
    }

    try {
      // Upsert: localiza pelo processName + sector.
      // Se já existir, atualiza status e payload; senão cria.
      const existing = await prisma.automationCandidate.findFirst({
        where: {
          processName: automation.processName,
          sector: automation.sector,
        },
        select: { id: true, status: true },
      });

      if (existing) {
        await prisma.automationCandidate.update({
          where: { id: existing.id },
          data: {
            status: automation.status,
            title: automation.title,
            automationLevel: automation.automationLevel,
            automationLabel: automation.automationLabel,
            suggestedScriptType: automation.suggestedScriptType,
            confidence: automation.confidence,
            payload: automation.payload,
          },
        });
        console.log(`  UPDATE ${label} (id=${existing.id})`);
      } else {
        const created = await prisma.automationCandidate.create({
          data: {
            curationDocumentId: anchorDoc.id,
            sector: automation.sector,
            title: automation.title,
            processName: automation.processName,
            automationLevel: automation.automationLevel,
            automationLabel: automation.automationLabel,
            suggestedScriptType: automation.suggestedScriptType,
            confidence: automation.confidence,
            status: automation.status,
            payload: automation.payload,
          },
          select: { id: true },
        });
        console.log(`  CREATE ${label} (id=${created.id})`);
      }
    } catch (err) {
      console.error(`  ERROR  ${label}:`, err);
    }
  }

  console.log("\nConcluído.\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
