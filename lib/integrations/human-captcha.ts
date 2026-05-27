import { appConfig } from "@/lib/config";

export type CervelloTicketLaunchRequest = {
  idempotencyKey: string;
  traceId: string;
  conversationId: string;
  requestedBy: string;
  userSector: string;
  message: string;
  approvalReason?: string;
  requestedByAgent?: string;
  ownerAgent?: string;
};

export type HumanCaptchaAutomationLaunchResponse = {
  runId: string;
  processKey: string | null;
  label: string;
  description: string | null;
  runUrl: string;
  nextTaskId: string | null;
  nextTaskUrl: string | null;
  totalJobs: number;
  duplicate?: boolean;
};

type LaunchRequest = CervelloTicketLaunchRequest;

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function readJson(response: Response) {
  return (await response.json().catch(() => null)) as unknown;
}

export async function launchCervelloElectronicOrderTicket(
  input: LaunchRequest,
): Promise<HumanCaptchaAutomationLaunchResponse> {
  return launchHumanCaptchaAutomation(
    "/integrations/pfrm/cervello/electronic-order-ticket",
    input,
  );
}

export async function launchPfrmAutomationScript(
  scriptKey: string,
  input: LaunchRequest,
): Promise<HumanCaptchaAutomationLaunchResponse> {
  return launchHumanCaptchaAutomation(
    `/integrations/pfrm/automation-scripts/${encodeURIComponent(scriptKey)}/run`,
    input,
  );
}

async function launchHumanCaptchaAutomation(
  path: string,
  input: LaunchRequest,
): Promise<HumanCaptchaAutomationLaunchResponse> {
  if (!appConfig.humanCaptchaInternalToken) {
    throw new Error("HUMAN_CAPTCHA_INTERNAL_TOKEN nao esta configurado.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    appConfig.humanCaptchaAutomationTimeoutMs,
  );

  try {
    const response = await fetch(
      joinUrl(appConfig.humanCaptchaApiUrl, path),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appConfig.humanCaptchaInternalToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          traceId: input.traceId,
          conversationId: input.conversationId,
          requestedBy: input.requestedBy,
          userSector: input.userSector,
          sourceSystem: "pfrm-secure-agents",
          message: input.message,
          approvalReason: input.approvalReason,
          requestedByAgent: input.requestedByAgent,
          ownerAgent: input.ownerAgent,
        }),
        signal: controller.signal,
      },
    );

    const payload = await readJson(response);

    if (!response.ok) {
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "message" in payload &&
        typeof payload.message === "string"
          ? payload.message
          : `Falha ao acionar automacao (${response.status}).`;

      throw new Error(message);
    }

    return payload as HumanCaptchaAutomationLaunchResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Timeout ao acionar o servico de automacao.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
