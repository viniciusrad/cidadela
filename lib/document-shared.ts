export type ConvertedDocument = {
  markdown: string;
  title: string;
  headings: string[];
  wordCount: number;
  conversionWarnings: string[];
  convertedAt: string;
  frontmatter: string;
};

type FrontmatterValue = string | number | string[];

export function normalizeWhitespace(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ");
}

export function countWords(value: string) {
  const words = value.match(/\S+/g);
  return words ? words.length : 0;
}

export function escapeYamlString(value: string) {
  return JSON.stringify(value);
}

export function buildFrontmatterRecord(fields: Record<string, FrontmatterValue>) {
  const lines = ["---"];

  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);

      if (value.length === 0) {
        lines.push("  []");
        continue;
      }

      for (const item of value) {
        lines.push(`  - ${escapeYamlString(item)}`);
      }

      continue;
    }

    if (typeof value === "number") {
      lines.push(`${key}: ${value}`);
      continue;
    }

    lines.push(`${key}: ${escapeYamlString(value)}`);
  }

  lines.push("---");
  return lines.join("\n");
}

export function normalizeMarkdownBody(value: string) {
  return normalizeWhitespace(value)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractHeadings(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => /^(#{1,6})\s+(.*\S)\s*$/.exec(line)?.[2]?.trim() ?? "")
    .filter(Boolean);
}
