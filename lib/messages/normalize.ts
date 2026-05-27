export type MessageOrigin = "teams" | "whatsapp" | "other";

export type NormalizedConversation = {
  cleanedText: string;
  fileName: string;
  suggestedTitle: string;
  lineCount: number;
  peopleMentioned: string[];
  peopleMentionedCount: number;
  dateFrom: string | null;
  dateTo: string | null;
  payloadsDropped: number;
  payloadLinesDropped: number;
  format: "structured" | "freeform";
};

const DATE_PATTERN = /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g;
const ISO_DATE_PATTERN = /\b(20\d{2}-\d{2}-\d{2})\b/g;

// Menções inline: 2-4 palavras Title Case. Mantemos para o cabeçalho e
// para alimentar a análise contra o grafo (nunca como inferência de autoria).
const INLINE_MENTION_PATTERN =
  /\b([A-ZÀ-Ý][a-zà-ý'’]{1,}(?:\s+[A-ZÀ-Ýa-zà-ý'’.]{1,}){1,3})\b/g;

// Limiar para considerar um bloco com chaves/colchetes como "payload técnico"
// que deve ser descartado (em vez de preservado no markdown).
const PAYLOAD_MIN_LINES = 3;
const PAYLOAD_MIN_CHARS = 200;

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDate(raw: string, fallback: string): string | null {
  const parts = raw.split("/").map((p) => p.trim());
  if (parts.length < 2) return null;
  const day = Number(parts[0]);
  const month = Number(parts[1]);
  let year = parts[2] ? Number(parts[2]) : Number(fallback.slice(0, 4));
  if (year < 100) year += 2000;
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function sanitizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 80);
}

// ────────────────────────────────────────────────────────────────────────────
// Descarte de payloads JSON/colchetes balanceados (com awareness de strings)
// ────────────────────────────────────────────────────────────────────────────

function findBalancedEnd(
  lines: string[],
  start: number,
  opener: "{" | "[",
): number | null {
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  let seenAny = false;

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === opener) {
        depth += 1;
        seenAny = true;
      } else if (ch === closer) {
        depth -= 1;
      }
    }
    if (seenAny && depth === 0) {
      return i;
    }
    if (i - start > 2000) return null;
  }
  return null;
}

type CleanResult = {
  cleanedLines: string[];
  payloadsDropped: number;
  payloadLinesDropped: number;
};

function stripPayloads(text: string): CleanResult {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let payloadsDropped = 0;
  let payloadLinesDropped = 0;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const stripped = line.trimStart();
    const opener = stripped.startsWith("{") ? "{" : stripped.startsWith("[") ? "[" : null;

    if (opener) {
      const end = findBalancedEnd(lines, i, opener);
      if (end !== null && end > i) {
        const blockLines = end - i + 1;
        const blockText = lines.slice(i, end + 1).join("\n");
        if (blockLines >= PAYLOAD_MIN_LINES || blockText.length >= PAYLOAD_MIN_CHARS) {
          out.push(`_[payload tecnico omitido — ${blockLines} linhas]_`);
          payloadsDropped += 1;
          payloadLinesDropped += blockLines;
          i = end + 1;
          continue;
        }
      }
    }

    out.push(line);
    i += 1;
  }

  return { cleanedLines: out, payloadsDropped, payloadLinesDropped };
}

// ────────────────────────────────────────────────────────────────────────────
// Coleta de menções e datas
// ────────────────────────────────────────────────────────────────────────────

function collectMentions(lines: string[]): string[] {
  const set = new Set<string>();
  for (const line of lines) {
    INLINE_MENTION_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = INLINE_MENTION_PATTERN.exec(line)) !== null) {
      const candidate = sanitizeName(match[1]);
      const tokens = candidate.split(/\s+/);
      if (tokens.length < 2) continue;
      if (tokens.some((t) => t.length < 2)) continue;
      set.add(candidate);
    }
  }
  return [...set].sort();
}

function collectDates(text: string, fallback: string): { from: string | null; to: string | null } {
  const dates: string[] = [];
  let match: RegExpExecArray | null;
  DATE_PATTERN.lastIndex = 0;
  while ((match = DATE_PATTERN.exec(text)) !== null) {
    const parsed = parseDate(match[1], fallback);
    if (parsed) dates.push(parsed);
  }
  ISO_DATE_PATTERN.lastIndex = 0;
  while ((match = ISO_DATE_PATTERN.exec(text)) !== null) {
    dates.push(match[1]);
  }
  if (dates.length === 0) return { from: null, to: null };
  dates.sort();
  return { from: dates[0], to: dates[dates.length - 1] };
}

// ────────────────────────────────────────────────────────────────────────────
// Título sugerido a partir das primeiras linhas com conteúdo útil
// ────────────────────────────────────────────────────────────────────────────

function buildSuggestedTitle(lines: string[], origin: MessageOrigin): string {
  const originLabel =
    origin === "teams" ? "Teams" : origin === "whatsapp" ? "WhatsApp" : "Conversa";
  const candidate = lines
    .map((line) => line.trim())
    .find(
      (line) =>
        line.length >= 25 &&
        line.length <= 200 &&
        !line.startsWith("_[payload") &&
        !/^(ok|certo|sim|nao|valeu|obrigado|blz|isso)\b/i.test(line),
    );
  if (candidate) {
    const base = candidate.replace(/\s+/g, " ").trim().slice(0, 70);
    return `${originLabel}: ${base}${base.length === 70 ? "..." : ""}`;
  }
  return `${originLabel}: conversa importada`;
}

function buildFileName(origin: MessageOrigin, dateFrom: string | null): string {
  const stamp = dateFrom ?? todayIso();
  const rand = Math.random().toString(36).slice(2, 8);
  return `conversa-${origin}-${stamp}-${rand}.md`;
}

// ────────────────────────────────────────────────────────────────────────────
// Entrada principal
// ────────────────────────────────────────────────────────────────────────────

export function normalizeConversation(input: {
  text: string;
  origin: MessageOrigin;
}): NormalizedConversation {
  const { cleanedLines, payloadsDropped, payloadLinesDropped } = stripPayloads(input.text);

  // Colapsa runs de >2 linhas em branco para no máximo uma, sem reescrever o conteúdo.
  const compacted: string[] = [];
  let blankRun = 0;
  for (const line of cleanedLines) {
    if (line.trim() === "") {
      blankRun += 1;
      if (blankRun <= 1) compacted.push("");
    } else {
      blankRun = 0;
      compacted.push(line);
    }
  }
  while (compacted.length > 0 && compacted[compacted.length - 1].trim() === "") {
    compacted.pop();
  }
  while (compacted.length > 0 && compacted[0].trim() === "") {
    compacted.shift();
  }

  const peopleMentioned = collectMentions(compacted);
  const { from: dateFrom, to: dateTo } = collectDates(input.text, todayIso());
  const suggestedTitle = buildSuggestedTitle(compacted, input.origin);
  const lineCount = compacted.filter((line) => line.trim().length > 0).length;

  const cleanedText =
    compacted.length > 0 ? compacted.join("\n") : input.text.trim();

  const isStructured =
    lineCount > 0 || peopleMentioned.length > 0 || payloadsDropped > 0;

  return {
    cleanedText,
    fileName: buildFileName(input.origin, dateFrom),
    suggestedTitle,
    lineCount,
    peopleMentioned,
    peopleMentionedCount: peopleMentioned.length,
    dateFrom,
    dateTo,
    payloadsDropped,
    payloadLinesDropped,
    format: isStructured ? "structured" : "freeform",
  };
}

export function isValidOrigin(value: unknown): value is MessageOrigin {
  return value === "teams" || value === "whatsapp" || value === "other";
}
