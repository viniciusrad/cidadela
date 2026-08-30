import { describe, expect, it } from "vitest";

import { parseCurationFrontmatter } from "@/lib/frontmatter";

describe("parseCurationFrontmatter", () => {
  it("extrai metadados obrigatorios sem remover o corpo", () => {
    const result = parseCurationFrontmatter(
      [
        "---",
        'title: "Procedimento de Deploy"',
        "sector: desenvolvimento",
        "topic: deploy",
        "owner: dev@cidadela.local",
        "sensitivity: internal",
        "effective_from: 2026-05-04",
        "tags: [deploy, ci-cd]",
        "---",
        "# Procedimento",
      ].join("\n"),
    );

    expect(result.issues).toEqual([]);
    expect(result.metadata).toMatchObject({
      title: "Procedimento de Deploy",
      sector: "desenvolvimento",
      topic: "deploy",
      owner: "dev@cidadela.local",
      sensitivity: "internal",
      tags: ["deploy", "ci-cd"],
    });
    expect(result.metadata.effectiveFrom?.toISOString()).toContain("2026-05-04");
    expect(result.body).toBe("# Procedimento");
  });
});
