function normalizeForMatch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export type HumanCaptchaAutomationIntent =
  | "cervello-electronic-order"
  | "medication-price-survey"
  | "currency-index-collection";

const actionPattern =
  /\b(abrir|criar|gerar|acionar|registrar|executar|rodar|disparar|iniciar|coletar)\b/;

export function shouldTriggerCervelloElectronicOrderTicket(question: string) {
  const normalized = normalizeForMatch(question);

  const hasAction = /\b(abrir|criar|gerar|acionar|registrar)\b/.test(normalized);
  const hasTicket = /\b(chamado|ticket|solicitacao)\b/.test(normalized);
  const hasTarget = normalized.includes("pedido eletronico") || normalized.includes("cervello");

  return hasAction && hasTicket && hasTarget;
}

function shouldTriggerMedicationPriceSurvey(normalized: string) {
  const hasAction = actionPattern.test(normalized);
  const hasMedicationTarget =
    /\b(medicamento|medicamentos|remedio|remedios|farmacia|farmacias)\b/.test(
      normalized,
    );
  const hasOutputOrPrice =
    /\b(arquivo|relatorio|pesquisa|preco|precos|cotacao|cotacoes)\b/.test(
      normalized,
    );

  return hasAction && hasMedicationTarget && hasOutputOrPrice;
}

function shouldTriggerCurrencyIndexCollection(normalized: string) {
  const hasAction = actionPattern.test(normalized);
  const hasCurrencyTarget =
    /\b(moeda|moedas|cambio|cotacao|cotacoes|ptax|dolar|euro)\b/.test(
      normalized,
    );
  const hasIndexTarget =
    /\b(indice|indices|indexador|indexadores|tr|di|b3|bcb|cetip)\b/.test(
      normalized,
    );
  const hasOutput =
    /\b(arquivo|relatorio|coleta|coletar|atualizar|gerar|criar)\b/.test(
      normalized,
    );

  return hasAction && hasOutput && (hasCurrencyTarget || hasIndexTarget);
}

export function detectHumanCaptchaAutomationIntent(
  question: string,
): HumanCaptchaAutomationIntent | null {
  const normalized = normalizeForMatch(question);

  if (shouldTriggerCervelloElectronicOrderTicket(question)) {
    return "cervello-electronic-order";
  }

  if (shouldTriggerMedicationPriceSurvey(normalized)) {
    return "medication-price-survey";
  }

  if (shouldTriggerCurrencyIndexCollection(normalized)) {
    return "currency-index-collection";
  }

  return null;
}
