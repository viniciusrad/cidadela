import { describeImage, generateJson } from "@/lib/ollama";
import type { MessageOrigin } from "@/lib/messages/normalize";

export type DistilledKnowledge = {
  summary: string;
  decisions: Array<{ text: string; rationale?: string | null }>;
  procedures: Array<{ name: string; steps?: string[]; context?: string | null }>;
  systems: Array<{ name: string; usage?: string | null }>;
  rules: Array<{ text: string; scope?: string | null }>;
  concepts: Array<{ name: string; definition?: string | null }>;
  pendings: Array<{ text: string; owner?: string | null }>;
};

export type DistillResult = {
  knowledge: DistilledKnowledge;
  markdown: string;
  itemCount: number;
};

const EMPTY_KNOWLEDGE: DistilledKnowledge = {
  summary: "",
  decisions: [],
  procedures: [],
  systems: [],
  rules: [],
  concepts: [],
  pendings: [],
};

const ORIGIN_LABEL: Record<MessageOrigin, string> = {
  teams: "Microsoft Teams",
  whatsapp: "WhatsApp",
  other: "Conversa importada",
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNullableString(value: unknown): string | null {
  const s = asString(value);
  return s.length > 0 ? s : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item))
    .filter((item) => item.length > 0);
}

function coerceKnowledge(raw: unknown): DistilledKnowledge {
  if (!raw || typeof raw !== "object") return { ...EMPTY_KNOWLEDGE };
  const obj = raw as Record<string, unknown>;

  const decisions = Array.isArray(obj.decisions)
    ? obj.decisions
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const e = entry as Record<string, unknown>;
          const text = asString(e.text);
          if (!text) return null;
          return { text, rationale: asNullableString(e.rationale) };
        })
        .filter((x): x is { text: string; rationale: string | null } => x !== null)
    : [];

  const procedures = Array.isArray(obj.procedures)
    ? obj.procedures
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const e = entry as Record<string, unknown>;
          const name = asString(e.name);
          if (!name) return null;
          return {
            name,
            steps: asStringArray(e.steps),
            context: asNullableString(e.context),
          };
        })
        .filter((x): x is { name: string; steps: string[]; context: string | null } => x !== null)
    : [];

  const systems = Array.isArray(obj.systems)
    ? obj.systems
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const e = entry as Record<string, unknown>;
          const name = asString(e.name);
          if (!name) return null;
          return { name, usage: asNullableString(e.usage) };
        })
        .filter((x): x is { name: string; usage: string | null } => x !== null)
    : [];

  const rules = Array.isArray(obj.rules)
    ? obj.rules
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const e = entry as Record<string, unknown>;
          const text = asString(e.text);
          if (!text) return null;
          return { text, scope: asNullableString(e.scope) };
        })
        .filter((x): x is { text: string; scope: string | null } => x !== null)
    : [];

  const concepts = Array.isArray(obj.concepts)
    ? obj.concepts
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const e = entry as Record<string, unknown>;
          const name = asString(e.name);
          if (!name) return null;
          return { name, definition: asNullableString(e.definition) };
        })
        .filter((x): x is { name: string; definition: string | null } => x !== null)
    : [];

  const pendings = Array.isArray(obj.pendings)
    ? obj.pendings
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const e = entry as Record<string, unknown>;
          const text = asString(e.text);
          if (!text) return null;
          return { text, owner: asNullableString(e.owner) };
        })
        .filter((x): x is { text: string; owner: string | null } => x !== null)
    : [];

  return {
    summary: asString(obj.summary),
    decisions,
    procedures,
    systems,
    rules,
    concepts,
    pendings,
  };
}

function buildPrompt(input: {
  cleanedText: string;
  origin: MessageOrigin;
  sectorLabel: string;
  mentions: string[];
  dateRange: string | null;
}): string {
  const mentionsLine =
    input.mentions.length > 0
      ? `Pessoas mencionadas no texto: ${input.mentions.join(", ")}.`
      : "Nenhum nome proprio foi detectado no texto.";
  const dateLine = input.dateRange
    ? `Periodo aproximado mencionado: ${input.dateRange}.`
    : "Periodo nao foi detectado explicitamente.";

  return `Voce e um analista de conhecimento corporativo. Recebeu um trecho de conversa de ${ORIGIN_LABEL[input.origin]} de colaboradores do setor "${input.sectorLabel}". Sua tarefa e DESTILAR apenas o conhecimento operacional util da conversa, descartando saudacoes, ruido, especulacao e dados tecnicos brutos.

${mentionsLine}
${dateLine}

REGRAS RIGOROSAS:
- Responda APENAS em JSON valido conforme o schema abaixo.
- Use portugues do Brasil.
- Inclua somente itens claramente expressos ou implicados no texto. NUNCA invente nada.
- Se uma categoria nao tem itens, retorne array vazio.
- Seja conciso: cada texto deve ter no maximo 1-2 frases.
- Nao reproduza dados tecnicos brutos (IDs, payloads, URLs longas) — apenas o conhecimento que eles ilustram.
- Nao atribua autoria de fala a pessoas — em chat de grupo a autoria e ambigua.

SCHEMA:
{
  "summary": "1-2 frases resumindo o conhecimento extraido (string)",
  "decisions": [
    { "text": "decisao tomada", "rationale": "motivo, se mencionado, ou null" }
  ],
  "procedures": [
    { "name": "nome curto do procedimento", "steps": ["passo 1", "passo 2"], "context": "quando se aplica, ou null" }
  ],
  "systems": [
    { "name": "nome do sistema/ferramenta", "usage": "como e usado no contexto, ou null" }
  ],
  "rules": [
    { "text": "regra, excecao ou restricao operacional", "scope": "onde se aplica, ou null" }
  ],
  "concepts": [
    { "name": "termo ou conceito tecnico do dominio", "definition": "definicao curta vinda da conversa, ou null" }
  ],
  "pendings": [
    { "text": "acao pendente ou follow-up", "owner": "responsavel mencionado, ou null" }
  ]
}

TEXTO DA CONVERSA:
"""
${input.cleanedText}
"""

Responda apenas com o JSON.`;
}

function renderSection<T>(
  title: string,
  items: T[],
  render: (item: T) => string[],
): string[] {
  if (items.length === 0) return [];
  const out: string[] = [];
  out.push(`## ${title}`);
  out.push("");
  for (const item of items) {
    for (const line of render(item)) {
      out.push(line);
    }
  }
  out.push("");
  return out;
}

function renderMarkdown(input: {
  knowledge: DistilledKnowledge;
  origin: MessageOrigin;
  sectorLabel: string;
  dateFrom: string | null;
  dateTo: string | null;
  mentions: string[];
  authorName: string;
  payloadsDropped: number;
  title: string;
}): { markdown: string; itemCount: number } {
  const k = input.knowledge;
  const itemCount =
    k.decisions.length +
    k.procedures.length +
    k.systems.length +
    k.rules.length +
    k.concepts.length +
    k.pendings.length;

  const out: string[] = [];
  out.push(`# ${input.title}`);
  out.push("");
  out.push(`> **Origem:** ${ORIGIN_LABEL[input.origin]}`);
  out.push(`> **Setor:** ${input.sectorLabel}`);
  out.push(`> **Importado por:** ${input.authorName}`);
  if (input.dateFrom && input.dateTo) {
    out.push(
      `> **Periodo da conversa:** ${
        input.dateFrom === input.dateTo
          ? input.dateFrom
          : `${input.dateFrom} a ${input.dateTo}`
      }`,
    );
  }
  if (input.mentions.length > 0) {
    out.push(
      `> **Pessoas mencionadas:** ${input.mentions.slice(0, 10).join(", ")}${
        input.mentions.length > 10 ? "..." : ""
      }`,
    );
  }
  out.push("");
  out.push(
    "_Este markdown foi destilado automaticamente a partir de uma conversa. Apenas conhecimento operacional foi preservado; texto bruto, saudacoes e payloads tecnicos foram descartados para manter o banco de conhecimento enxuto._",
  );
  out.push("");

  if (k.summary) {
    out.push("## Resumo");
    out.push("");
    out.push(k.summary);
    out.push("");
  }

  out.push(
    ...renderSection("Decisoes", k.decisions, (d) => {
      const line = d.rationale ? `- **${d.text}** — ${d.rationale}` : `- ${d.text}`;
      return [line];
    }),
  );

  out.push(
    ...renderSection("Procedimentos descobertos ou refinados", k.procedures, (p) => {
      const lines: string[] = [];
      lines.push(`### ${p.name}`);
      if (p.context) lines.push(`_${p.context}_`);
      if (p.steps && p.steps.length > 0) {
        for (let i = 0; i < p.steps.length; i++) {
          lines.push(`${i + 1}. ${p.steps[i]}`);
        }
      }
      lines.push("");
      return lines;
    }),
  );

  out.push(
    ...renderSection("Sistemas mencionados", k.systems, (s) => {
      return [s.usage ? `- **${s.name}** — ${s.usage}` : `- **${s.name}**`];
    }),
  );

  out.push(
    ...renderSection("Regras e excecoes", k.rules, (r) => {
      return [r.scope ? `- ${r.text} _(${r.scope})_` : `- ${r.text}`];
    }),
  );

  out.push(
    ...renderSection("Conceitos do dominio", k.concepts, (c) => {
      return [c.definition ? `- **${c.name}**: ${c.definition}` : `- **${c.name}**`];
    }),
  );

  out.push(
    ...renderSection("Pendencias e follow-ups", k.pendings, (p) => {
      return [p.owner ? `- ${p.text} _(responsavel: ${p.owner})_` : `- ${p.text}`];
    }),
  );

  if (input.payloadsDropped > 0) {
    out.push("---");
    out.push("");
    out.push(
      `_${input.payloadsDropped} bloco(s) de payload tecnico foram descartados na ingestao._`,
    );
    out.push("");
  }

  return { markdown: out.join("\n"), itemCount };
}

export async function distillConversation(input: {
  cleanedText: string;
  origin: MessageOrigin;
  sectorLabel: string;
  dateFrom: string | null;
  dateTo: string | null;
  mentions: string[];
  authorName: string;
  payloadsDropped: number;
  title: string;
  images?: string[];
}): Promise<DistillResult> {
  const dateRange =
    input.dateFrom && input.dateTo
      ? input.dateFrom === input.dateTo
        ? input.dateFrom
        : `${input.dateFrom} a ${input.dateTo}`
      : null;

  let cleanedTextWithImages = input.cleanedText;
  if (input.images && input.images.length > 0) {
    const transcripts: string[] = [];
    for (let i = 0; i < input.images.length; i++) {
      try {
        const description = await describeImage(input.images[i]);
        if (description) {
          transcripts.push(
            `--- Imagem ${i + 1} (anexada pelo autor) ---\n${description}`,
          );
        }
      } catch (error) {
        transcripts.push(
          `--- Imagem ${i + 1} (anexada pelo autor) ---\n[Falha ao transcrever: ${
            error instanceof Error ? error.message : "erro desconhecido"
          }]`,
        );
      }
    }
    if (transcripts.length > 0) {
      cleanedTextWithImages = `${transcripts.join("\n\n")}\n\n${input.cleanedText}`;
    }
  }

  let knowledge: DistilledKnowledge;
  try {
    const raw = await generateJson<unknown>(
      buildPrompt({
        cleanedText: cleanedTextWithImages,
        origin: input.origin,
        sectorLabel: input.sectorLabel,
        mentions: input.mentions,
        dateRange,
      }),
      { temperature: 0 },
    );
    knowledge = coerceKnowledge(raw);
  } catch (error) {
    knowledge = { ...EMPTY_KNOWLEDGE };
    knowledge.summary = `Falha na destilacao automatica: ${
      error instanceof Error ? error.message : "erro desconhecido"
    }. O texto bruto nao foi preservado para evitar poluir o banco; reimporte a conversa quando o modelo estiver disponivel.`;
  }

  const { markdown, itemCount } = renderMarkdown({
    knowledge,
    origin: input.origin,
    sectorLabel: input.sectorLabel,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    mentions: input.mentions,
    authorName: input.authorName,
    payloadsDropped: input.payloadsDropped,
    title: input.title,
  });

  return { knowledge, markdown, itemCount };
}
