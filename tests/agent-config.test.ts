import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agentConfigFindMany: vi.fn(),
  protocolFindMany: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    agentConfig: {
      findMany: mocks.agentConfigFindMany,
    },
    protocol: {
      findMany: mocks.protocolFindMany,
    },
  },
}));

beforeEach(() => {
  mocks.agentConfigFindMany.mockReset();
  mocks.protocolFindMany.mockReset();
  mocks.agentConfigFindMany.mockResolvedValue([]);
  mocks.protocolFindMany.mockResolvedValue([]);
});

describe("effective agent config", () => {
  it("returns hardcoded defaults when no override exists", async () => {
    const { invalidateAgentConfigCache } = await import("@/lib/agents/config-repo");
    invalidateAgentConfigCache();
    const { getEffectiveAgent } = await import("@/lib/agents/effective");
    const { AGENT_PERSONAS } = await import("@/lib/agents/personas");

    const agent = await getEffectiveAgent("desenvolvimento");

    expect(agent.persona.name).toBe(AGENT_PERSONAS.desenvolvimento.name);
    expect(agent.persona.instructions).toBe(
      AGENT_PERSONAS.desenvolvimento.instructions,
    );
    expect(agent.override ?? null).toBe(null);
    expect(agent.params.topK).toBeGreaterThan(0);
  });

  it("merges DB override over the hardcoded persona and params", async () => {
    mocks.agentConfigFindMany.mockResolvedValue([
      {
        sector: "desenvolvimento",
        displayName: "Forja-Custom",
        summary: null,
        instructions: "Voce eh um agente customizado.",
        capabilities: [
          { id: "x", name: "X", description: "Y", isExposed: true },
        ],
        chatModel: "llama3:8b",
        topK: 12,
        localConfidenceThreshold: 0.7,
        updatedAt: new Date(),
        updatedBy: "tester",
      },
    ]);

    const { invalidateAgentConfigCache } = await import("@/lib/agents/config-repo");
    invalidateAgentConfigCache();
    const { getEffectiveAgent } = await import("@/lib/agents/effective");

    const agent = await getEffectiveAgent("desenvolvimento");

    expect(agent.persona.name).toBe("Forja-Custom");
    expect(agent.persona.instructions).toBe("Voce eh um agente customizado.");
    expect(agent.persona.capabilities).toHaveLength(1);
    expect(agent.params.chatModel).toBe("llama3:8b");
    expect(agent.params.topK).toBe(12);
    expect(agent.params.localConfidenceThreshold).toBeCloseTo(0.7);
    expect(agent.override).not.toBeNull();
  });
});

describe("effective protocols", () => {
  it("returns hardcoded protocols when DB is empty", async () => {
    const { invalidateProtocolCache } = await import("@/lib/agents/config-repo");
    invalidateProtocolCache();
    const { getEffectiveProtocols } = await import("@/lib/agents/effective");
    const { PROTOCOLS } = await import("@/lib/agents/protocols");

    const result = await getEffectiveProtocols();
    expect(result.length).toBe(PROTOCOLS.length);
    expect(result[0].enabled).toBe(PROTOCOLS[0].enabled);
  });

  it("applies DB overrides on top of defaults", async () => {
    mocks.protocolFindMany.mockResolvedValue([
      {
        fromSector: "desenvolvimento",
        toSector: "seguranca",
        intent: "politica-seguranca",
        template: "TEMPLATE OVERRIDE",
        maxTokens: 999,
        enabled: false,
        updatedAt: new Date(),
      },
    ]);

    const { invalidateProtocolCache } = await import("@/lib/agents/config-repo");
    invalidateProtocolCache();
    const { getEffectiveProtocols, findEffectiveProtocol } = await import(
      "@/lib/agents/effective"
    );

    const all = await getEffectiveProtocols();
    const overridden = all.find(
      (p) =>
        p.from === "desenvolvimento" &&
        p.to === "seguranca" &&
        p.intent === "politica-seguranca",
    );

    expect(overridden?.template).toBe("TEMPLATE OVERRIDE");
    expect(overridden?.maxTokens).toBe(999);
    expect(overridden?.enabled).toBe(false);

    const enabledOnly = await findEffectiveProtocol(
      "desenvolvimento",
      "seguranca",
      "politica-seguranca",
    );
    expect(enabledOnly).toBeUndefined();
  });
});
