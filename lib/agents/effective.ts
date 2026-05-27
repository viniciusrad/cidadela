import { AGENT_PERSONAS } from "@/lib/agents/personas";
import { PROTOCOLS, type ProtocolDefinition } from "@/lib/agents/protocols";
import {
  loadAllAgentConfigs,
  loadAllProtocols,
  protocolKey,
  type AgentConfigOverride,
} from "@/lib/agents/config-repo";
import type { AgentPersona, Capability } from "@/lib/agents/types";
import { appConfig } from "@/lib/config";

export type EffectiveAgent = {
  sector: string;
  persona: AgentPersona;
  params: {
    chatModel: string;
    topK: number;
    localConfidenceThreshold: number;
  };
  override: AgentConfigOverride | null;
  defaults: {
    persona: AgentPersona;
    chatModel: string;
    topK: number;
    localConfidenceThreshold: number;
  };
};

async function mergePersona(sector: string, override: AgentConfigOverride | null): Promise<AgentPersona> {
  const { getPersonaForSector } = await import("@/lib/agents/personas");
  const base = await getPersonaForSector(sector);
  if (!base) {
    throw new Error(`Persona nao encontrada para o setor: ${sector}`);
  }

  if (!override) {
    return base;
  }

  const capabilities: Capability[] =
    override.capabilities && Array.isArray(override.capabilities)
      ? override.capabilities
      : base.capabilities;

  return {
    name: override.displayName?.trim() ? override.displayName : base.name,
    summary: override.summary?.trim() ? override.summary : base.summary,
    instructions: override.instructions?.trim() ? override.instructions : base.instructions,
    capabilities,
  };
}

export async function getEffectiveAgent(sector: string): Promise<EffectiveAgent> {
  const overrides = await loadAllAgentConfigs();
  const override = overrides.get(sector) ?? null;
  const { getPersonaForSector } = await import("@/lib/agents/personas");
  const basePersona = await getPersonaForSector(sector);

  if (!basePersona) {
    throw new Error(`Persona nao encontrada para o setor: ${sector}`);
  }

  return {
    sector,
    persona: await mergePersona(sector, override),
    params: {
      chatModel: override?.chatModel?.trim() ? override.chatModel : appConfig.ollamaChatModel,
      topK: override?.topK ?? appConfig.chatTopK,
      localConfidenceThreshold:
        override?.localConfidenceThreshold ?? appConfig.chatLocalConfidenceThreshold,
    },
    override,
    defaults: {
      persona: basePersona,
      chatModel: appConfig.ollamaChatModel,
      topK: appConfig.chatTopK,
      localConfidenceThreshold: appConfig.chatLocalConfidenceThreshold,
    },
  };
}

export async function getEffectivePersona(sector: string): Promise<AgentPersona> {
  const agent = await getEffectiveAgent(sector);
  return agent.persona;
}

export async function getEffectiveProtocols(): Promise<ProtocolDefinition[]> {
  const rows = await loadAllProtocols();
  if (rows.length === 0) {
    return PROTOCOLS;
  }

  const overrideMap = new Map(rows.map((row) => [row.id, row]));

  return PROTOCOLS.map((proto) => {
    const override = overrideMap.get(protocolKey(proto.from, proto.to, proto.intent));
    if (!override) return proto;
    return {
      ...proto,
      template: override.template,
      maxTokens: override.maxTokens,
      enabled: override.enabled,
    };
  });
}

export async function findEffectiveProtocol(
  from: string,
  to: string,
  intent: string,
): Promise<ProtocolDefinition | undefined> {
  const protocols = await getEffectiveProtocols();
  return protocols.find(
    (p) => p.from === from && p.to === to && p.intent === intent && p.enabled,
  );
}

export async function getEffectiveAvailableTargets(
  origin: string,
): Promise<Array<{ target: string; intent: string }>> {
  const protocols = await getEffectiveProtocols();
  const targets = protocols
    .filter((p) => p.from === origin && p.enabled)
    .map((p) => ({ target: p.to, intent: p.intent }));

  const unique = new Map<string, (typeof targets)[number]>();
  for (const entry of targets) {
    if (!unique.has(entry.target)) {
      unique.set(entry.target, entry);
    }
  }
  return Array.from(unique.values());
}
