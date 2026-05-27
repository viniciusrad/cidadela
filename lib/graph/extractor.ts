/**
 * lib/graph/extractor.ts
 *
 * Extração de entidades de grafo a partir de texto markdown.
 *
 * Exporta duas funções principais:
 *   - extractPersonsFromText(text): extração determinista via regex (sem Ollama, testável unitariamente).
 *   - extractEntities(markdown): extração completa via Ollama LLM, com fallback para regex quando o
 *     modelo não estiver disponível ou retornar resposta inválida.
 *
 * Convenção de Onda 3 (after_failure_plan.md §3): a lógica de papel (executor/aprovador/owner/etc.)
 * é preservada neste módulo para uso futuro em persistência de arestas.
 */

import { appConfig } from "@/lib/config";

// ─── Tipos exportados ─────────────────────────────────────────────────────────

export type PersonRole = "executor" | "aprovador" | "owner" | "responsavel" | "autor";

export type PersonWithRole = {
  name: string;
  roles: PersonRole[];
};

export type ExtractedEntities = {
  concepts: string[];
  procedures: string[];
  systems: string[];
  regulations: string[];
  persons: string[];
  /** Pessoas com papéis detectados pelo regex. Subconjunto de persons. */
  personsWithRoles: PersonWithRole[];
};

// ─── Listas de ruído ──────────────────────────────────────────────────────────

/**
 * Palavras/frases que nunca são nomes próprios de pessoas, mesmo que o regex
 * de dois tokens capitalizados bata nelas.
 */
const NOISE_PHRASES = new Set([
  "Nova Química",
  "Mercado Farma",
  "Canais Digitais",
  "Canais Digitais Equipe",
  "Squad Web",
  "Times Parceiros",
  "Gestão Comercial",
  "Pricing Farmacêutico",
  "Pricing Farmaceutico",
  "Banco de Dados",
  "Análise de Dados",
  "Analise de Dados",
  "Tecnologia da Informação",
  "Tecnologia da Informacao",
  "Recursos Humanos",
  "Marketing Digital",
  "Setor Comercial",
  "Suporte Técnico",
  "Suporte Tecnico",
  "Central de Atendimento",
  "Business Intelligence",
]);

/**
 * Padrão de sobrenomes / iniciadores que aparecem em ruído e não são nomes.
 * Ex: "Canais Digitais" bate no padrão PrimeiroNome+Sobrenome mas é departamento.
 */
const NOISE_SECOND_WORDS = new Set([
  "Digitais",
  "Farmacêutico",
  "Farmaceutico",
  "Química",
  "Quimica",
  "Farma",
  "Web",
  "Inteligência",
  "Inteligencia",
]);

// ─── Regex helpers ────────────────────────────────────────────────────────────

/** Regex para capturar e-mail profarma com nome extraível do localpart. */
const PROFARMA_EMAIL_RE =
  /\b([a-z][a-z]+)\.([a-z][a-z]+)(?:\.[a-z]+)?@profarma\.com\.br\b/gi;

/** Regex para capturar e-mails externos genéricos (não-profarma), não utilizados diretamente. */
const EXTERNAL_EMAIL_RE = /[^\s]+@[^\s]+\.[^\s]+/g;

/** Linha de papel: "Executor: Nome Sobrenome" ou "- Aprovador: Nome" */
const ROLE_LINE_RE =
  /(?:^|\n)[^\n]*?(?:executor|aprovador|aprovadora|dono do conhecimento|dono|owner|responsável|responsavel|autor|autora)\s*:\s*([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÈÌÒÙÇ][a-záéíóúâêîôûãõàèìòùç]+(?:[^\S\n]+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÈÌÒÙÇ][a-záéíóúâêîôûãõàèìòùç]+)*)/gim;

/** "Last updated by | Nome Sobrenome | data" — padrão wiki */
const WIKI_UPDATED_RE =
  /last updated by\s*\|\s*([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÈÌÒÙÇ][^\|]+?)\s*\|/gi;

/** "Nome Sobrenome - Cargo/Setor" */
const NAME_ROLE_RE =
  /(?:^|\n)\s*([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÈÌÒÙÇ][a-záéíóúâêîôûãõàèìòùç]+(?:\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÈÌÒÙÇ][a-záéíóúâêîôûãõàèìòùç]+)+)\s*[-–]\s*(?!(?:Squad|Time|Equipe|Setor|Departamento|Área|Area)\b)[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÈÌÒÙÇ]/gm;

/** "Nome Sobrenome e Outro Nome (Cargo/Setor)" */
const NAMES_JOINED_E_RE =
  /([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÈÌÒÙÇ][a-záéíóúâêîôûãõàèìòùç]+\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÈÌÒÙÇ][a-záéíóúâêîôûãõàèìòùç]+)\s+e\s+([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÈÌÒÙÇ][a-záéíóúâêîôûãõàèìòùç]+\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÈÌÒÙÇ][a-záéíóúâêîôûãõàèìòùç]+)/g;

/** "Nome Sobrenome (e-mail@externo.com)" — nome antes de parêntese com email */
const NAME_BEFORE_EMAIL_RE =
  /([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÈÌÒÙÇ][a-záéíóúâêîôûãõàèìòùç]+\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÈÌÒÙÇ][a-záéíóúâêîôûãõàèìòùç]+)\s*\([^\)]*@[^\)]+\)/g;

/** "Nome Sobrenome (Cargo)" — nome antes de parêntese sem email */
const NAME_BEFORE_PAREN_RE =
  /([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÈÌÒÙÇ][a-záéíóúâêîôûãõàèìòùç]+\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÈÌÒÙÇ][a-záéíóúâêîôûãõàèìòùç]+)\s*\((?!.*@)[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÈÌÒÙÇ]/g;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function capitalizeLocalPart(first: string, last: string): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return `${cap(first)} ${cap(last)}`;
}

function normalizedKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isNoise(name: string): boolean {
  const trimmed = name.trim();
  if (NOISE_PHRASES.has(trimmed)) return true;
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2 && NOISE_SECOND_WORDS.has(parts[1])) return true;
  return false;
}

function detectRole(line: string): PersonRole[] {
  const l = line.toLowerCase();
  const roles: PersonRole[] = [];
  if (/executor|executora/.test(l)) roles.push("executor");
  if (/aprovador|aprovadora/.test(l)) roles.push("aprovador");
  if (/dono do conhecimento|owner/.test(l)) roles.push("owner");
  if (/responsável|responsavel/.test(l)) roles.push("responsavel");
  if (/autor|autora/.test(l)) roles.push("autor");
  return roles;
}

// ─── Extração determinista (sem LLM) ─────────────────────────────────────────

/**
 * Extrai nomes de pessoas a partir de texto usando regex determinístico.
 * Não chama Ollama. Retorna nomes únicos, deduplicated.
 *
 * Padrões detectados:
 *   - E-mails @profarma.com.br (converte localpart em Nome Sobrenome)
 *   - Linhas de papel: "Executor: Nome Sobrenome"
 *   - Padrão wiki "Last updated by | Nome |"
 *   - "Nome Sobrenome - Cargo"
 *   - "Nome e Outro Nome (Cargo)"
 *   - "Nome Sobrenome (email@externo.com)"
 *   - "Nome Sobrenome (Stakeholder)"
 */
export function extractPersonsFromText(text: string): string[] {
  const seen = new Map<string, string>(); // normalizedKey -> canonical name

  function add(name: string): void {
    const trimmed = name.trim();
    if (!trimmed || isNoise(trimmed)) return;
    const key = normalizedKey(trimmed);
    if (!seen.has(key)) {
      seen.set(key, trimmed);
    }
  }

  // 1. E-mails @profarma.com.br
  for (const match of text.matchAll(PROFARMA_EMAIL_RE)) {
    add(capitalizeLocalPart(match[1], match[2]));
  }

  // 2. Linhas de papel: "Executor: Nome Sobrenome"
  for (const match of text.matchAll(ROLE_LINE_RE)) {
    // O match[1] pode conter um e-mail @profarma — processar ambos
    const raw = match[1].trim();
    const emailMatch = PROFARMA_EMAIL_RE.exec(raw);
    PROFARMA_EMAIL_RE.lastIndex = 0;
    if (emailMatch) {
      add(capitalizeLocalPart(emailMatch[1], emailMatch[2]));
    } else {
      // Remove e-mail externo se presente no final
      const withoutEmail = raw.replace(EXTERNAL_EMAIL_RE, "").trim();
      if (withoutEmail) add(withoutEmail);
    }
  }

  // 3. Wiki "Last updated by"
  for (const match of text.matchAll(WIKI_UPDATED_RE)) {
    add(match[1].trim());
  }

  // 4. "Nome Sobrenome (email@externo.com)"
  for (const match of text.matchAll(NAME_BEFORE_EMAIL_RE)) {
    add(match[1]);
  }

  // 5. "Nome Sobrenome (Stakeholder)"
  for (const match of text.matchAll(NAME_BEFORE_PAREN_RE)) {
    add(match[1]);
  }

  // 6. "Nome e Outro Nome (Cargo)"
  for (const match of text.matchAll(NAMES_JOINED_E_RE)) {
    add(match[1]);
    add(match[2]);
  }

  // 7. "Nome Sobrenome - Cargo"
  for (const match of text.matchAll(NAME_ROLE_RE)) {
    add(match[1]);
  }

  return Array.from(seen.values());
}

/**
 * Como extractPersonsFromText, mas retorna cada pessoa com os papéis detectados.
 * Usado pela Onda 3 para persistir `roles` na aresta INVOLVES_PERSON.
 */
export function extractPersonsWithRoles(text: string): PersonWithRole[] {
  const seen = new Map<string, { name: string; roles: Set<PersonRole> }>();

  function add(name: string, roles: PersonRole[] = []): void {
    const trimmed = name.trim();
    if (!trimmed || isNoise(trimmed)) return;
    const key = normalizedKey(trimmed);
    if (!seen.has(key)) {
      seen.set(key, { name: trimmed, roles: new Set(roles) });
    } else {
      for (const r of roles) seen.get(key)!.roles.add(r);
    }
  }

  // E-mails @profarma
  for (const match of text.matchAll(PROFARMA_EMAIL_RE)) {
    // Tenta inferir papel do contexto imediatamente antes do e-mail
    const before = text.slice(Math.max(0, match.index! - 40), match.index!);
    add(capitalizeLocalPart(match[1], match[2]), detectRole(before));
  }

  // Linhas de papel
  for (const match of text.matchAll(ROLE_LINE_RE)) {
    const line = match[0];
    const raw = match[1].trim();
    const roles = detectRole(line);
    const emailMatch = PROFARMA_EMAIL_RE.exec(raw);
    PROFARMA_EMAIL_RE.lastIndex = 0;
    if (emailMatch) {
      add(capitalizeLocalPart(emailMatch[1], emailMatch[2]), roles);
    } else {
      const withoutEmail = raw.replace(EXTERNAL_EMAIL_RE, "").trim();
      if (withoutEmail) add(withoutEmail, roles);
    }
  }

  // Wiki
  for (const match of text.matchAll(WIKI_UPDATED_RE)) {
    add(match[1].trim(), ["autor"]);
  }

  // Nome antes de e-mail externo
  for (const match of text.matchAll(NAME_BEFORE_EMAIL_RE)) {
    add(match[1]);
  }

  // Nome antes de parêntese sem e-mail
  for (const match of text.matchAll(NAME_BEFORE_PAREN_RE)) {
    add(match[1]);
  }

  // "Nome e Outro"
  for (const match of text.matchAll(NAMES_JOINED_E_RE)) {
    add(match[1]);
    add(match[2]);
  }

  // "Nome - Cargo"
  for (const match of text.matchAll(NAME_ROLE_RE)) {
    add(match[1]);
  }

  return Array.from(seen.values()).map((entry) => ({
    name: entry.name,
    roles: Array.from(entry.roles),
  }));
}

// ─── Extração via LLM (Ollama) ────────────────────────────────────────────────

type LlmEntitiesResponse = {
  concepts?: unknown;
  procedures?: unknown;
  systems?: unknown;
  regulations?: unknown;
  persons?: unknown;
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

/**
 * Extrai entidades de grafo de um documento markdown via Ollama.
 * Utiliza `format: "json"` do endpoint `/api/generate` para forçar saída estruturada.
 *
 * Em caso de falha (Ollama indisponível, timeout, JSON inválido), faz fallback para
 * extração determinista de pessoas e retorna listas vazias para as demais entidades.
 */
export async function extractEntities(markdown: string): Promise<ExtractedEntities> {
  // Limita o texto enviado ao modelo para evitar context overflow
  const MAX_CHARS = 12_000;
  const truncated = markdown.length > MAX_CHARS ? markdown.slice(0, MAX_CHARS) + "\n[texto truncado]" : markdown;

  const prompt = `Você é um extrator de entidades de conhecimento corporativo. Analise o documento abaixo e extraia SOMENTE entidades que aparecem explicitamente no texto.

Retorne um JSON com exatamente estas chaves (arrays de strings, sem objetos aninhados):
- "concepts": conceitos de negócio (ex: "precificação dinâmica", "margem bruta")
- "procedures": procedimentos, processos ou fluxos (ex: "atualização de preços", "abertura de chamado")
- "systems": sistemas, ferramentas ou plataformas citadas (ex: "SAP", "Cervello", "Qdrant")
- "regulations": normas, leis ou políticas (ex: "LGPD", "Política de Preços")
- "persons": nomes completos de pessoas (ex: "João Silva", "Maria Oliveira")

Regras:
- Inclua apenas entidades mencionadas explicitamente. Nada inventado.
- Nomes de pessoas: somente nomes próprios humanos. Não incluir nomes de empresas, equipes, setores ou sistemas.
- Se não houver entidades de um tipo, retorne array vazio.
- Retorne SOMENTE o JSON, sem explicações.

Documento:
${truncated}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);

    const response = await fetch(`${appConfig.ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: appConfig.ollamaClassifierModel,
        prompt,
        stream: false,
        think: false,
        format: "json",
        options: { temperature: 0 },
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Ollama retornou ${response.status}`);
    }

    const payload = (await response.json()) as { response?: string; error?: string };
    if (payload.error) throw new Error(payload.error);

    const raw = (payload.response ?? "").trim();
    if (!raw) throw new Error("Ollama retornou resposta vazia");

    const parsed = JSON.parse(raw) as LlmEntitiesResponse;
    const personsFromLlm = toStringArray(parsed.persons);

    // Complementa com extração regex para garantir cobertura de e-mails e padrões estruturados
    const personsFromRegex = extractPersonsFromText(markdown);
    const allPersonKeys = new Map<string, string>();
    for (const p of [...personsFromLlm, ...personsFromRegex]) {
      const key = normalizedKey(p);
      if (!allPersonKeys.has(key)) allPersonKeys.set(key, p);
    }
    const persons = Array.from(allPersonKeys.values());
    const personsWithRoles = extractPersonsWithRoles(markdown);

    return {
      concepts: toStringArray(parsed.concepts),
      procedures: toStringArray(parsed.procedures),
      systems: toStringArray(parsed.systems),
      regulations: toStringArray(parsed.regulations),
      persons,
      personsWithRoles,
    };
  } catch {
    // Fallback: extração determinista de pessoas, listas vazias para demais
    const persons = extractPersonsFromText(markdown);
    const personsWithRoles = extractPersonsWithRoles(markdown);
    return {
      concepts: [],
      procedures: [],
      systems: [],
      regulations: [],
      persons,
      personsWithRoles,
    };
  }
}
