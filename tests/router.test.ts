import { describe, expect, it } from "vitest";

import { routeDelegation } from "../lib/agents/router";

describe("routeDelegation", () => {
  it("delegates password policy questions from development to security", async () => {
    const decision = await routeDelegation(
      "desenvolvimento",
      "Qual e a politica de senha segura para contas privilegiadas?",
    );

    expect(decision.delegate).toBe(true);
    expect(decision.target).toBe("seguranca");
    expect(decision.intent).toBe("politica-seguranca");
  });

  it("keeps local questions in development when no cross-sector trigger is found", async () => {
    const decision = await routeDelegation(
      "desenvolvimento",
      "Como versionar a API de pedidos sem quebrar compatibilidade?",
    );

    expect(decision.delegate).toBe(false);
  });
});
