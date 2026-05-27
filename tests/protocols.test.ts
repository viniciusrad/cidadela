import { describe, expect, it } from "vitest";

import {
  formatProtocolQuestion,
  getAvailableTargets,
  getProtocol,
} from "../lib/agents/protocols";
import { SECTORS } from "../lib/domain";

describe("protocol catalog", () => {
  it("returns the security protocol for development", () => {
    const protocol = getProtocol(
      "desenvolvimento",
      "seguranca",
      "politica-seguranca",
    );

    expect(protocol?.id).toContain("politica-seguranca");
  });

  it("formats the forwarded question with protocol instructions", () => {
    const prompt = formatProtocolQuestion(
      "Responda como seguranca.",
      "Qual a regra para senhas?",
    );

    expect(prompt).toContain("Responda como seguranca.");
    expect(prompt).toContain("Qual a regra para senhas?");
  });

  it("allows each sector to consult every other sector through protocols", () => {
    for (const sector of SECTORS) {
      const targets = getAvailableTargets(sector).map((target) => target.target);

      expect(targets.sort()).toEqual(
        SECTORS.filter((target) => target !== sector).sort(),
      );
    }
  });
});
