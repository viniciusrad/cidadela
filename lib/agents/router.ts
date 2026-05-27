import type { Sector } from "@/lib/domain";

import { classifyDelegationWithLLM } from "@/lib/agents/classifier";
import type { DelegationDecision } from "@/lib/agents/types";
import { getAvailableTargets, getProtocol } from "@/lib/agents/protocols";
import { findShareableKnowledgeTarget } from "@/lib/knowledge/capabilities";

function matchesKeyword(question: string, keywords: string[]) {
  const normalizedQuestion = question.toLowerCase();
  return keywords.some((keyword) => normalizedQuestion.includes(keyword));
}

export async function routeDelegation(
  origin: string,
  question: string,
): Promise<DelegationDecision> {
  const { getOutboundRules } = await import("@/lib/sectors/access-rules");
  const outboundRules = await getOutboundRules(origin);

  for (const rule of outboundRules) {
    if (rule.accessLevel === "denied") continue;

    if (matchesKeyword(question, rule.routingKeywords)) {
      const protocol = getProtocol(origin as Sector, rule.toSector as Sector, "dynamic-routing") 
        ?? getProtocol(origin as Sector, rule.toSector as Sector, "politica-seguranca")
        ?? getProtocol(origin as Sector, rule.toSector as Sector, "impacto-operacional")
        ?? getProtocol(origin as Sector, rule.toSector as Sector, "escalonamento-tecnico")
        ?? getProtocol(origin as Sector, rule.toSector as Sector, "incidente-seguranca")
        ?? getProtocol(origin as Sector, rule.toSector as Sector, "implementacao-tecnica")
        ?? { intent: "dynamic-routing", id: "auto" };

      return {
        delegate: true,
        target: rule.toSector as Sector,
        intent: protocol.intent,
        protocol: protocol.id,
        question,
        rationale: `Tema roteado por palavra-chave para o setor ${rule.toSector}.`,
      };
    }
  }

  return {
    delegate: false,
  };
}

// Removed static routing functions

export async function resolveDelegation(
  origin: string,
  question: string,
): Promise<DelegationDecision> {
  console.log("[router] resolveDelegation origin=%s question=%o", origin, question);
  const llmDecision = await classifyDelegationWithLLM(origin, question);
  if (llmDecision.delegate) {
    console.log("[router] using LLM decision: %o", llmDecision);
    return llmDecision;
  }

  const availableTargets = getAvailableTargets(origin as Sector);
  const knowledgeTarget = await findShareableKnowledgeTarget(
    origin as Sector,
    question,
    availableTargets.map((target) => target.target),
  );

  if (knowledgeTarget) {
    const targetProtocol = availableTargets.find(
      (target) => target.target === knowledgeTarget.sector,
    );
    const protocol = targetProtocol
      ? getProtocol(origin as Sector, targetProtocol.target as Sector, targetProtocol.intent)
      : null;

    if (protocol) {
      const decision = {
        delegate: true,
        target: knowledgeTarget.sector,
        intent: protocol.intent,
        protocol: protocol.id,
        question,
        allowedSourceDocumentIds: knowledgeTarget.sourceDocumentIds,
        rationale: knowledgeTarget.rationale,
      } satisfies DelegationDecision;

      console.log("[router] using shareable knowledge decision: %o", decision);
      return decision;
    }
  }

  const keywordDecision = await routeDelegation(origin, question);
  console.log("[router] LLM did not delegate, keyword decision: %o", keywordDecision);
  return keywordDecision;
}
