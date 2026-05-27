import { describe, expect, it } from "vitest";

import {
  parseDateBoundary,
  parsePilotUserEmails,
  parseSnapshotDate,
  renderPilotSnapshotMarkdown,
  type PilotSnapshotData,
} from "@/lib/pilot/snapshot";

describe("pilot snapshot helpers", () => {
  it("parses pilot emails as unique normalized values", () => {
    expect(
      parsePilotUserEmails(" Ana@Example.com,joao@example.com, ana@example.com ,,"),
    ).toEqual(["ana@example.com", "joao@example.com"]);
  });

  it("keeps explicit snapshot dates stable", () => {
    expect(parseSnapshotDate("2026-05-20")).toBe("2026-05-20");
    expect(parseSnapshotDate(undefined, new Date("2026-05-21T10:00:00Z"))).toBe(
      "2026-05-21",
    );
  });

  it("parses date-only boundaries at the local day start", () => {
    const parsed = parseDateBoundary(
      "2026-05-20",
      new Date("2026-05-01T10:00:00Z"),
    );
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(4);
    expect(parsed.getDate()).toBe(20);
    expect(parsed.getHours()).toBe(0);
  });

  it("renders pending configuration without failing the snapshot", () => {
    const data: PilotSnapshotData = {
      configured: false,
      missingUsers: [],
      users: [],
      teamsResponses: [],
      config: {
        pilotUserEmails: [],
        snapshotDate: "2026-05-20",
        windowStart: new Date("2026-05-20T00:00:00Z"),
        windowEnd: new Date("2026-05-20T10:00:00Z"),
      },
      totals: {
        messages: 0,
        userMessages: 0,
        assistantMessages: 0,
        goodFeedback: 0,
        badFeedback: 0,
        openedGaps: 0,
        closedGaps: 0,
        correctionsApplied: 0,
        teamsNotifications: 0,
        teamsResponses: 0,
        averageTeamsResponseMinutes: null,
      },
    };

    expect(renderPilotSnapshotMarkdown(data)).toContain(
      "Definir `PILOT_USER_EMAILS`",
    );
  });
});
