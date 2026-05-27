import { describe, expect, it } from "vitest";

import { parseApprovalDecision } from "../lib/automation/approval";
import {
  detectHumanCaptchaAutomationIntent,
  shouldTriggerCervelloElectronicOrderTicket,
} from "../lib/automation/cervello-ticket";

describe("shouldTriggerCervelloElectronicOrderTicket", () => {
  it("detects explicit electronic order ticket creation requests", () => {
    expect(
      shouldTriggerCervelloElectronicOrderTicket(
        "Criar chamado no Cervello para problema no Pedido Eletronico",
      ),
    ).toBe(true);
  });

  it("requires an explicit ticket action", () => {
    expect(
      shouldTriggerCervelloElectronicOrderTicket(
        "O pedido eletronico esta com problemas e preciso entender o impacto",
      ),
    ).toBe(false);
  });

  it("does not trigger for generic support ticket requests", () => {
    expect(
      shouldTriggerCervelloElectronicOrderTicket(
        "Abrir chamado para revisar a politica de senhas",
      ),
    ).toBe(false);
  });
});

describe("parseApprovalDecision", () => {
  it("requires a short reason for confirmations", () => {
    expect(parseApprovalDecision("sim")).toEqual({ status: "needs_reason" });
  });

  it("accepts confirmation with a reason", () => {
    expect(
      parseApprovalDecision(
        "Sim, motivo: incidente reportado pelo time de pedidos",
      ),
    ).toEqual({
      status: "confirmed",
      reason: "incidente reportado pelo time de pedidos",
    });
  });

  it("detects approval cancellation", () => {
    expect(parseApprovalDecision("cancelar")).toEqual({ status: "cancelled" });
  });
});

describe("detectHumanCaptchaAutomationIntent", () => {
  it("detects medication price report requests", () => {
    expect(
      detectHumanCaptchaAutomationIntent(
        "Gerar arquivo de preco de medicamentos para acompanhamento",
      ),
    ).toBe("medication-price-survey");
  });

  it("detects currency and index collection requests", () => {
    expect(
      detectHumanCaptchaAutomationIntent(
        "Coletar indices e moedas e gerar os arquivos de cotacao",
      ),
    ).toBe("currency-index-collection");
  });

  it("does not trigger automations for generic analysis questions", () => {
    expect(
      detectHumanCaptchaAutomationIntent(
        "Explique como funciona a politica de precos de medicamentos",
      ),
    ).toBeNull();
  });
});
