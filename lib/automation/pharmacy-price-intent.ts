function normalizeForMatch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const pricePatterns: RegExp[] = [
  /\bquanto custa\b/,
  /\bqual (o |a )?(menor |maior )?(preco|valor|cotacao)\b/,
  /\b(menor|maior|melhor) preco\b/,
  /\bmais barato\b/,
  /\bpreco (de|do|da|dos|das)\b/,
  /\bvalor (de|do|da|dos|das)\b/,
  /\bcotacao (de|do|da|dos|das)\b/,
  /\btem (em|na|no) (estoque|farmacia)\b/,
];

const pharmacyNames =
  /\b(drogasil|pague menos|drogaria sao paulo|pacheco|araujo|panvel|nissei|raia)\b/;

// Words that indicate the user explicitly wants an artifact (relatorio/arquivo/etc.).
// These are reserved for the asynchronous medication-price-survey automation and
// must NOT trigger the synchronous lookup.
const artifactPattern =
  /\b(abrir|criar|gerar|disparar|rodar|registrar|relatorio|arquivo|pesquisa|cotacoes)\b/;

const STOP_WORDS = new Set([
  "a",
  "as",
  "ao",
  "aos",
  "com",
  "como",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "esta",
  "estao",
  "esse",
  "essa",
  "esses",
  "essas",
  "hoje",
  "agora",
  "na",
  "nas",
  "no",
  "nos",
  "o",
  "os",
  "para",
  "pelo",
  "pela",
  "por",
  "qual",
  "quais",
  "que",
  "quanto",
  "quanta",
  "quantos",
  "quantas",
  "tem",
  "ter",
  "um",
  "uma",
  "uns",
  "umas",
  "menor",
  "maior",
  "melhor",
  "barato",
  "mais",
  "preco",
  "precos",
  "valor",
  "valores",
  "cotacao",
  "cotacoes",
  "custa",
  "custar",
  "farmacia",
  "farmacias",
  "estoque",
  "remedio",
  "remedios",
  "medicamento",
  "medicamentos",
  "produto",
  "produtos",
]);

function hasPriceQuery(normalized: string) {
  return pricePatterns.some((pattern) => pattern.test(normalized));
}

function hasPharmacyMention(normalized: string) {
  return pharmacyNames.test(normalized);
}

function hasArtifactRequest(normalized: string) {
  return artifactPattern.test(normalized);
}

function hasMeaningfulToken(normalized: string) {
  const tokens = normalized
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
  return tokens.some((t) => !STOP_WORDS.has(t) && t.length >= 3);
}

const stockQueryPattern = /\b(tem|ha|encontro|achei|acho|onde achar)\b/;

export function shouldTriggerPharmacyPriceLookup(question: string): boolean {
  const normalized = normalizeForMatch(question);
  if (hasArtifactRequest(normalized)) return false;

  if (hasPriceQuery(normalized)) {
    return hasPharmacyMention(normalized) || hasMeaningfulToken(normalized);
  }

  // Availability questions tied to a known pharmacy ("tem dipirona na drogasil?").
  if (hasPharmacyMention(normalized) && stockQueryPattern.test(normalized)) {
    return hasMeaningfulToken(normalized);
  }

  return false;
}

export function extractSearchQuery(question: string): string {
  const normalized = normalizeForMatch(question);
  const tokens = normalized
    .replace(/[?!.,;:()]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .filter((t) => !STOP_WORDS.has(t));

  const joined = tokens.join(" ").trim();
  if (joined.length > 0) return joined;
  return question.trim();
}
