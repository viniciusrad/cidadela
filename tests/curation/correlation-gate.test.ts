import { describe, expect, it } from "vitest";

import {
  correlationGateFromRun,
  hasOpenCorrelationFindings,
  type CorrelationFinding,
} from "@/lib/curation/correlation";

function finding(
  severity: CorrelationFinding["severity"],
  status: CorrelationFinding["status"] = "open",
): CorrelationFinding {
  return {
    id: `finding-${severity}-${status}`,
    type: "contradiction",
    severity,
    status,
    stagedChunkIndex: 0,
    stagedHeadingPathText: "Procedimento",
    stagedContentPreview: "Novo procedimento.",
    relatedChunk: {
      documentId: "doc-prod",
      documentTitle: "SOP validado",
      fileName: "sop.md",
      headingPathText: "Procedimento",
      chunkIndex: 0,
      score: 0.91,
      contentPreview: "Procedimento validado.",
    },
    issue: "Incompatibilidade entre procedimentos.",
    question: "Qual procedimento deve prevalecer?",
  };
}

describe("correlationGateFromRun", () => {
  it("permite aprovacao quando nao ha rodada de correlacao", () => {
    expect(correlationGateFromRun(null)).toMatchObject({
      status: "NOT_RUN",
      canApprove: true,
    });
  });

  it("expoe achados abertos como alertas sem bloquear a aprovacao", () => {
    const findings = [finding("medium"), finding("high")];

    expect(hasOpenCorrelationFindings(findings)).toHaveLength(2);
    expect(
      correlationGateFromRun({
        id: "run-1",
        status: "PASSED",
        createdAt: new Date("2026-05-04T12:00:00Z"),
        summary: "Achados encontrados.",
        findings,
      }),
    ).toMatchObject({
      canApprove: true,
      openFindings: [expect.objectContaining({ severity: "medium" }), expect.objectContaining({ severity: "high" })],
    });
  });

  it("mantem somente os achados ainda abertos para acompanhamento", () => {
    const findings = [finding("critical", "resolved"), finding("medium")];

    expect(hasOpenCorrelationFindings(findings)).toEqual([findings[1]]);
    expect(
      correlationGateFromRun({
        id: "run-2",
        status: "PASSED",
        createdAt: new Date("2026-05-04T12:00:00Z"),
        summary: "Sem bloqueios.",
        findings,
      }),
    ).toMatchObject({
      canApprove: true,
      openFindings: [expect.objectContaining({ severity: "medium" })],
    });
  });
});
