import { describe, expect, it } from "vitest";
import { evaluateProcessStatus } from "@/lib/process-automation-map";

describe("evaluateProcessStatus", () => {
  it("should return needs_graph_extraction if not graph backed", () => {
    const status = evaluateProcessStatus({
      graphBacked: false,
      gaps: [],
    });
    expect(status).toBe("needs_graph_extraction");
  });

  it("should return critical_gaps if there is a high priority open gap", () => {
    const status = evaluateProcessStatus({
      graphBacked: true,
      gaps: [
        { priority: "high", status: "open" },
        { priority: "low", status: "open" },
      ],
    });
    expect(status).toBe("critical_gaps");
  });

  it("should return critical_gaps if there is a high priority promoted gap", () => {
    const status = evaluateProcessStatus({
      graphBacked: true,
      gaps: [
        { priority: "high", status: "promoted" },
      ],
    });
    expect(status).toBe("critical_gaps");
  });

  it("should NOT return critical_gaps if high priority gap is dismissed", () => {
    const status = evaluateProcessStatus({
      graphBacked: true,
      gaps: [
        { priority: "high", status: "dismissed" },
        { priority: "low", status: "open" },
      ],
    });
    expect(status).toBe("needs_curation");
  });

  it("should NOT return critical_gaps if high priority gap is answered", () => {
    const status = evaluateProcessStatus({
      graphBacked: true,
      gaps: [
        { priority: "high", status: "answered" },
        { priority: "low", status: "open" },
      ],
    });
    expect(status).toBe("needs_curation");
  });

  it("should return mapped if all gaps are answered, dismissed or resolved", () => {
    const status = evaluateProcessStatus({
      graphBacked: true,
      gaps: [
        { priority: "high", status: "answered" },
        { priority: "medium", status: "dismissed" },
        { priority: "low", status: "resolved" },
      ],
    });
    expect(status).toBe("mapped");
  });

  it("should return needs_curation if there are only low/medium open gaps", () => {
    const status = evaluateProcessStatus({
      graphBacked: true,
      gaps: [
        { priority: "high", status: "answered" },
        { priority: "medium", status: "open" },
      ],
    });
    expect(status).toBe("needs_curation");
  });
});
