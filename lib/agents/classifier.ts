import { AGENT_PERSONAS } from "@/lib/agents/personas";
import { getProtocol, getAvailableTargets } from "@/lib/agents/protocols";
import type { DelegationDecision } from "@/lib/agents/types";
import { SECTORS, type Sector } from "@/lib/domain";
import { generateJson } from "@/lib/ollama";

type ClassifierOutput = {
  delegate?: boolean;
  target?: string | null;
  rationale?: string;
};

async function buildClassifierPrompt(origin: string, question: string) {
  const targets = getAvailableTargets(origin as Sector);
  const { getPersonaForSector } = await import("@/lib/agents/personas");
  const originPersona = await getPersonaForSector(origin);
  if (!originPersona) throw new Error("Persona nao encontrada");

    const targetsBlock = await Promise.all(targets
    .map(async (entry) => {
      const persona = await getPersonaForSector(entry.target);
      if (!persona) return "";
      const exposedCaps = persona.capabilities
        .filter((c) => c.isExposed)
        .map((c) => `  * ${c.name}: ${c.description}`)
        .join("\n");

      return `- Setor: ${entry.target} (Intent=${entry.intent})\n  Capacidades disponiveis para voce consultar:\n${exposedCaps}`;
    }));
    
  const targetsBlockJoined = targetsBlock.filter(Boolean).join("\n\n");

  return [
    `Voce e o roteador do agente "${originPersona.name}" do setor ${origin}.`,
    `Escopo do seu setor (${origin}): ${originPersona.instructions}`,
    "",
    "Sua missao e decidir se a pergunta do usuario exige uma consulta a outro setor especializado.",
    "REGRAS DE DELEGACAO:",
    "1. Delegue apenas se a pergunta tratar de uma CAPACIDADE que outro setor explicitamente oferece.",
    "2. Se a pergunta pode ser respondida com o conhecimento do seu setor, NAO delegue.",
    "3. Use as capacidades listadas abaixo para entender o que voce pode perguntar a cada setor.",
    "",
    "Setores e Capacidades disponiveis para consulta:",
    targetsBlockJoined || "- (nenhum)",
    "",
    `Pergunta do usuario: ${question}`,
    "",
    'Responda estritamente com JSON no formato: {"delegate": boolean, "target": "<setor ou null>", "rationale": "<motivo curto>"}',
    `O campo "target" deve ser um dos: ${targets.map((t) => `"${t.target}"`).join(", ") || "null"} ou null.`,
  ].join("\n");
}

function isSector(value: unknown): value is Sector {
  return typeof value === "string" && (SECTORS as readonly string[]).includes(value);
}

export async function classifyDelegationWithLLM(
  origin: string,
  question: string,
): Promise<DelegationDecision> {
  const targets = getAvailableTargets(origin as Sector);
  console.log(
    "[classifier] origin=%s question=%o targets=%o",
    origin,
    question,
    targets.map((t) => t.target),
  );
  if (targets.length === 0) {
    console.log("[classifier] no available targets, skipping LLM call");
    return { delegate: false };
  }

  const prompt = await buildClassifierPrompt(origin, question);

  let parsed: ClassifierOutput;
  try {
    const started = Date.now();
    parsed = await generateJson<ClassifierOutput>(prompt);
    console.log(
      "[classifier] LLM decision in %dms: %o",
      Date.now() - started,
      parsed,
    );
  } catch (error) {
    console.warn(
      "[classifier] LLM call failed, falling back to keyword router:",
      error,
    );
    return { delegate: false };
  }

  if (!parsed?.delegate || !isSector(parsed.target) || parsed.target === origin) {
    console.log(
      "[classifier] LLM did not delegate (delegate=%o target=%o rationale=%o)",
      parsed?.delegate,
      parsed?.target,
      parsed?.rationale,
    );
    return { delegate: false };
  }

  const match = targets.find((entry) => entry.target === parsed.target);
  if (!match) {
    console.warn(
      "[classifier] LLM returned invalid target %o for origin %s",
      parsed.target,
      origin,
    );
    return { delegate: false };
  }

  const protocol = getProtocol(origin as Sector, match.target as Sector, match.intent);
  if (!protocol) {
    console.warn(
      "[classifier] no protocol for %s->%s intent=%s",
      origin,
      match.target,
      match.intent,
    );
    return { delegate: false };
  }

  console.log(
    "[classifier] delegating %s -> %s via protocol %s (rationale=%o)",
    origin,
    match.target,
    protocol.id,
    parsed.rationale,
  );

  return {
    delegate: true,
    target: match.target,
    intent: match.intent,
    protocol: protocol.id,
    question,
    rationale:
      parsed.rationale?.trim() ||
      `Classificador LLM indicou consulta ao setor ${match.target}.`,
  };
}
