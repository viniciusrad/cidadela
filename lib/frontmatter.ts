export type CurationFrontmatter = {
  title?: string;
  sector?: string;
  topic?: string;
  owner?: string;
  sensitivity?: "public" | "internal" | "confidential" | "restricted";
  effectiveFrom?: Date;
  supersedes?: string;
  sopTarget?: boolean;
  tags?: string[];
};

export type FrontmatterParseResult = {
  metadata: CurationFrontmatter;
  body: string;
  issues: Array<{ field: string; message: string }>;
};

const VALID_SENSITIVITY = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;

type Sensitivity = (typeof VALID_SENSITIVITY)[number];
const SECTOR_SLUG_RE = /^[a-z][a-z0-9-]{1,48}[a-z0-9]$/;

function stripQuotes(value: string) {
  return value.trim().replace(/^["']|["']$/g, "").trim();
}

function parseBoolean(value: string) {
  const normalized = stripQuotes(value).toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
}

function parseStringArray(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [stripQuotes(trimmed)].filter(Boolean);
  }

  return trimmed
    .slice(1, -1)
    .split(",")
    .map(stripQuotes)
    .filter(Boolean);
}

export function parseCurationFrontmatter(markdown: string): FrontmatterParseResult {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const issues: FrontmatterParseResult["issues"] = [];

  if (!normalized.startsWith("---\n")) {
    return { metadata: {}, body: normalized.trim(), issues };
  }

  const closingIndex = normalized.indexOf("\n---", 4);
  if (closingIndex === -1) {
    return {
      metadata: {},
      body: normalized.trim(),
      issues: [{ field: "frontmatter", message: "Frontmatter sem fechamento." }],
    };
  }

  const rawFrontmatter = normalized.slice(4, closingIndex);
  const body = normalized.slice(closingIndex + 4).trim();
  const rawValues = new Map<string, string>();

  for (const line of rawFrontmatter.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) {
      issues.push({
        field: "frontmatter",
        message: `Linha invalida: ${trimmed}`,
      });
      continue;
    }

    rawValues.set(
      trimmed.slice(0, separatorIndex).trim(),
      trimmed.slice(separatorIndex + 1).trim(),
    );
  }

  const metadata: CurationFrontmatter = {};
  const title = rawValues.get("title");
  if (title) {
    metadata.title = stripQuotes(title);
  }

  const sector = rawValues.get("sector");
  if (sector) {
    const normalizedSector = stripQuotes(sector);
    if (SECTOR_SLUG_RE.test(normalizedSector)) {
      metadata.sector = normalizedSector;
    } else {
      issues.push({ field: "sector", message: "Setor do frontmatter invalido." });
    }
  }

  const topic = rawValues.get("topic");
  if (topic) {
    metadata.topic = stripQuotes(topic);
  }

  const owner = rawValues.get("owner");
  if (owner) {
    metadata.owner = stripQuotes(owner);
  }

  const sensitivity = rawValues.get("sensitivity");
  if (sensitivity) {
    const normalizedSensitivity = stripQuotes(sensitivity);
    if (VALID_SENSITIVITY.includes(normalizedSensitivity as Sensitivity)) {
      metadata.sensitivity = normalizedSensitivity as Sensitivity;
    } else {
      issues.push({
        field: "sensitivity",
        message: "Classificacao de sensibilidade invalida.",
      });
    }
  }

  const effectiveFrom = rawValues.get("effective_from");
  if (effectiveFrom) {
    const parsed = new Date(stripQuotes(effectiveFrom));
    if (Number.isNaN(parsed.getTime())) {
      issues.push({ field: "effective_from", message: "Data invalida." });
    } else {
      metadata.effectiveFrom = parsed;
    }
  }

  const supersedes = rawValues.get("supersedes");
  if (supersedes) {
    metadata.supersedes = stripQuotes(supersedes);
  }

  const sopTarget = rawValues.get("sop_target");
  if (sopTarget) {
    metadata.sopTarget = parseBoolean(sopTarget);
  }

  const tags = rawValues.get("tags");
  if (tags) {
    metadata.tags = parseStringArray(tags);
  }

  return { metadata, body, issues };
}
