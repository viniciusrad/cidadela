export type TeamsCardFact = {
  name: string;
  value: string;
};

export type TeamsCard = {
  title: string;
  summary: string;
  facts?: TeamsCardFact[];
  action?: {
    label: string;
    url: string;
  };
  themeColor?: string;
};

export type TeamsSkipReason = "missing_webhook" | "teams_channel_link_not_webhook";

export type TeamsSendResult =
  | { status: "sent"; attempts: number }
  | { status: "skipped"; reason: TeamsSkipReason }
  | { status: "failed"; attempts: number; error: string };

const DEFAULT_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 8000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTeamsChannelLink(value: string) {
  try {
    const url = new URL(value);
    return (
      url.hostname.toLowerCase() === "teams.microsoft.com" &&
      url.pathname.startsWith("/l/channel/")
    );
  } catch {
    return false;
  }
}

function isPowerAutomateWorkflowUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    
    // Reconhece tanto o domínio antigo (powerplatform.com) quanto os novos (logic.azure.com) gerados pelo App Workflows do Teams
    const isPowerAutomateHost = host.endsWith(".environment.api.powerplatform.com") || host.endsWith("logic.azure.com");
    
    return (
      isPowerAutomateHost &&
      url.pathname.includes("/workflows/") &&
      url.pathname.includes("/triggers/")
    );
  } catch {
    return false;
  }
}

function toWorkflowPayload(card: TeamsCard) {
  const body: unknown[] = [
    {
      type: "TextBlock",
      text: card.title,
      weight: "Bolder",
      size: "Medium",
      wrap: true
    },
    {
      type: "TextBlock",
      text: card.summary,
      wrap: true
    }
  ];

  if (card.facts && card.facts.length > 0) {
    const factsText = card.facts.map(f => `**${f.name}:** ${f.value}`).join("\n\n");
    body.push({
      type: "TextBlock",
      text: factsText,
      wrap: true
    });
  }

  const actions = card.action ? [
    {
      type: "Action.OpenUrl",
      title: card.action.label,
      url: card.action.url
    }
  ] : [];

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.2",
          body,
          actions: actions.length > 0 ? actions : undefined
        }
      }
    ]
  };
}

function toMessageCard(card: TeamsCard) {
  return {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    summary: card.summary,
    themeColor: card.themeColor ?? "2563EB",
    title: card.title,
    sections:
      card.facts && card.facts.length > 0
        ? [
            {
              facts: card.facts.map((fact) => ({
                name: fact.name,
                value: fact.value,
              })),
              markdown: true,
            },
          ]
        : undefined,
    potentialAction: card.action
      ? [
          {
            "@type": "OpenUri",
            name: card.action.label,
            targets: [{ os: "default", uri: card.action.url }],
          },
        ]
      : undefined,
  };
}

export async function sendTeamsCard(
  webhookUrl: string | undefined,
  payload: TeamsCard,
  options: { retries?: number; timeoutMs?: number } = {},
): Promise<TeamsSendResult> {
  if (!webhookUrl) {
    return { status: "skipped", reason: "missing_webhook" };
  }

  if (isTeamsChannelLink(webhookUrl)) {
    return { status: "skipped", reason: "teams_channel_link_not_webhook" };
  }

  const requestBody = isPowerAutomateWorkflowUrl(webhookUrl)
    ? toWorkflowPayload(payload)
    : toMessageCard(payload);

  const retries = options.retries ?? DEFAULT_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError = "Erro desconhecido ao enviar card para o Teams.";

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (response.ok) {
        return { status: "sent", attempts: attempt };
      }

      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < retries) {
      await sleep(250 * 2 ** (attempt - 1));
    }
  }

  return { status: "failed", attempts: retries, error: lastError };
}
