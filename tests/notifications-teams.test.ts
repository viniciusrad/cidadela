import { afterEach, describe, expect, it, vi } from "vitest";

import { sendTeamsCard } from "@/lib/notifications/teams";

describe("sendTeamsCard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips delivery when the webhook is not configured", async () => {
    await expect(
      sendTeamsCard(undefined, {
        title: "Titulo",
        summary: "Resumo",
      }),
    ).resolves.toEqual({ status: "skipped", reason: "missing_webhook" });
  });

  it("skips Teams channel deep links because they are not POST webhooks", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendTeamsCard("https://teams.microsoft.com/l/channel/19%3Aabc/teste", {
        title: "Titulo",
        summary: "Resumo",
      }),
    ).resolves.toEqual({
      status: "skipped",
      reason: "teams_channel_link_not_webhook",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a MessageCard payload through fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTeamsCard("https://example.test/webhook", {
      title: "Pendencias",
      summary: "Resumo",
      facts: [{ name: "Lacunas", value: "2" }],
      action: {
        label: "Abrir",
        url: "http://localhost:3030/me/pendencias",
      },
    });

    expect(result).toEqual({ status: "sent", attempts: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/webhook",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(request.body as string)).toMatchObject({
      "@type": "MessageCard",
      title: "Pendencias",
      summary: "Resumo",
    });
  });

  it("posts a text-first payload to Teams Workflows webhooks", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const workflowUrl =
      "https://defaulttenant.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/workflow-id/triggers/manual/paths/invoke?api-version=1&sig=secret";

    const result = await sendTeamsCard(workflowUrl, {
      title: "Pendencias",
      summary: "Resumo",
      facts: [{ name: "Lacunas", value: "2" }],
      action: {
        label: "Abrir",
        url: "http://localhost:3030/me/pendencias",
      },
    });

    expect(result).toEqual({ status: "sent", attempts: 1 });
    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(request.body as string)).toMatchObject({
      text: expect.stringContaining("Pendencias"),
      title: "Pendencias",
      summary: "Resumo",
      facts: [{ name: "Lacunas", value: "2" }],
      actionLabel: "Abrir",
      actionUrl: "http://localhost:3030/me/pendencias",
    });
  });
});
