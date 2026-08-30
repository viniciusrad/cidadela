// Validacao do corpus de demonstracao (demo-corpus/) antes da ingestao.
// Roda o classificador e o extrator de pessoas reais do projeto sobre cada
// arquivo e compara o tipo detectado com a pasta em que o arquivo esta, valida o
// frontmatter e confere se as pessoas do canon estao sendo extraidas com papel.
// Sai com codigo 1 se algo divergir. Uso: npm run check:corpus

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { classifyDocument } from "../lib/document-classifier";
import { parseCurationFrontmatter } from "../lib/frontmatter";
import { extractPersonsWithRoles } from "../lib/graph/extractor";
import { appConfig } from "../lib/config";

const ROOT = path.join(process.cwd(), "demo-corpus");
const SECTORS = ["desenvolvimento", "seguranca", "suporte", "desktop"];

const CANON_PEOPLE = [
  "Paula Ferraz",
  "Bruno Machado",
  "Marina Antunes",
  "Diego Vasques",
  "Camila Rezende",
  "Rafael Nogueira",
  "Beatriz Salgado",
  "Tiago Bracher",
  "Larissa Pimentel",
  "Henrique Dorneles",
  "Gustavo Camargo",
  "Aline Portilho",
];

// Pastas cujo nome nao corresponde a um DocumentType do classificador.
const NON_TYPE_FOLDERS = new Set(["email", "conversa"]);

// Desvios conhecidos e aceitos, documentados em demo-corpus/README.md. Aparecem
// no relatorio como "aceito", mas nao falham a checagem — o que falha e desvio
// novo. Ver a secao "Limitacoes do pipeline" do README.
const ACCEPTED_TYPE_MISMATCHES = new Set([
  // A regra de `conversa` (peso 1.5) vence a de `faq` nos mesmos padroes
  // `Pergunta:`/`Resposta:`. Contorno: ingerir com documentType=faq explicito.
  "suporte/faq/duvidas-frequentes-meridiano-track--larissa-pimentel.md",
]);

// Clientes ficticios que casam com o padrao "Nome Sobrenome" e viram Person.
// Cenario proposital para o painel de reclassificacao de pessoas.
const ACCEPTED_EXTRA_PERSONS = new Set(["Log Aurora", "Expresso Piaui"]);

type Row = {
  file: string;
  sector: string;
  folderType: string;
  detected: string;
  confidence: number;
  frontmatterSector?: string;
  frontmatterIssues: number;
  persons: string[];
  signals: string[];
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith(".md") || entry.endsWith(".txt")) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const files = walk(ROOT).filter((file) => !file.includes("_canon"));
  const rows: Row[] = [];
  const personsSeen = new Map<string, Set<string>>();

  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const [sector, folderType] = rel.split("/");
    if (!SECTORS.includes(sector)) continue;

    const raw = readFileSync(file, "utf8");
    const frontmatter = parseCurationFrontmatter(raw);
    const classification = classifyDocument({
      fileName: path.basename(file),
      markdown: raw,
      frontmatter: {
        title: frontmatter.metadata.title,
        topic: frontmatter.metadata.topic,
        sensitivity: frontmatter.metadata.sensitivity ?? null,
      },
    });

    const persons = extractPersonsWithRoles(raw);
    for (const person of persons) {
      if (!personsSeen.has(person.name)) personsSeen.set(person.name, new Set());
      for (const role of person.roles) personsSeen.get(person.name)!.add(role);
      if (person.roles.length === 0) personsSeen.get(person.name)!.add("-");
    }

    rows.push({
      file: rel,
      sector,
      folderType,
      detected: classification.documentType,
      confidence: classification.confidence,
      frontmatterSector: frontmatter.metadata.sector,
      frontmatterIssues: frontmatter.issues.length,
      persons: persons.map((p) => p.name),
      signals: classification.signals,
    });
  }

  // ── 1. Tipo detectado x pasta ────────────────────────────────────────────
  const typed = rows.filter((row) => !NON_TYPE_FOLDERS.has(row.folderType));
  const allMismatches = typed.filter((row) => row.detected !== row.folderType);
  const mismatches = allMismatches.filter(
    (row) => !ACCEPTED_TYPE_MISMATCHES.has(row.file),
  );
  const accepted = allMismatches.filter((row) =>
    ACCEPTED_TYPE_MISMATCHES.has(row.file),
  );

  console.log(`\nArquivos analisados: ${rows.length} (${typed.length} com tipo esperado pela pasta)\n`);
  console.log("── Tipo detectado != pasta ──");
  if (mismatches.length === 0) {
    console.log("  (nenhum)");
  } else {
    for (const row of mismatches) {
      console.log(
        `  ${row.file}\n      esperado=${row.folderType}  detectado=${row.detected} (conf ${row.confidence.toFixed(2)})\n      sinais do vencedor: ${row.signals.join(" | ")}`,
      );
    }
  }
  for (const row of accepted) {
    console.log(
      `  (aceito) ${row.file}: esperado=${row.folderType} detectado=${row.detected} — ver README`,
    );
  }
  const rate = typed.length
    ? ((typed.length - allMismatches.length) / typed.length) * 100
    : 0;
  console.log(`  acerto: ${rate.toFixed(1)}%\n`);

  // ── 2. Conversas e e-mails: como foram classificados ─────────────────────
  console.log("── conversa/ e email/ (sem tipo de pasta) ──");
  for (const row of rows.filter((r) => NON_TYPE_FOLDERS.has(r.folderType))) {
    console.log(`  ${row.file} -> ${row.detected} (conf ${row.confidence.toFixed(2)})`);
  }

  // ── 3. Frontmatter ───────────────────────────────────────────────────────
  const mdCurated = rows.filter(
    (row) => row.file.endsWith(".md") && !NON_TYPE_FOLDERS.has(row.folderType),
  );
  const fmProblems = mdCurated.filter(
    (row) =>
      row.frontmatterIssues > 0 ||
      !row.frontmatterSector ||
      row.frontmatterSector !== row.sector,
  );
  console.log("\n── Frontmatter ──");
  if (fmProblems.length === 0) {
    console.log(`  ${mdCurated.length}/${mdCurated.length} ok`);
  } else {
    for (const row of fmProblems) {
      console.log(
        `  ${row.file}: sector=${row.frontmatterSector ?? "(ausente)"} issues=${row.frontmatterIssues}`,
      );
    }
  }

  // ── 4. Pessoas ───────────────────────────────────────────────────────────
  console.log(`\n── Pessoas extraidas (PERSON_EMAIL_DOMAIN=${appConfig.personEmailDomain}) ──`);
  for (const name of CANON_PEOPLE) {
    const roles = personsSeen.get(name);
    const docs = rows.filter((row) => row.persons.includes(name)).length;
    console.log(
      `  ${roles ? "ok " : "!! "}${name.padEnd(20)} docs=${String(docs).padStart(2)} papeis=${roles ? [...roles].join(",") : "NENHUM"}`,
    );
  }

  const allExtras = [...personsSeen.keys()].filter(
    (name) => !CANON_PEOPLE.includes(name),
  );
  const extras = allExtras.filter((name) => !ACCEPTED_EXTRA_PERSONS.has(name));
  if (allExtras.length > 0) {
    console.log(`\n  fora do canon (${allExtras.length}):`);
    for (const name of allExtras) {
      const where = rows.filter((row) => row.persons.includes(name)).map((row) => row.file);
      const tag = ACCEPTED_EXTRA_PERSONS.has(name) ? "(aceito) " : "";
      console.log(`    ${tag}${JSON.stringify(name)} <- ${where.slice(0, 3).join(", ")}${where.length > 3 ? ` (+${where.length - 3})` : ""}`);
    }
  }

  const missing = CANON_PEOPLE.filter((name) => !personsSeen.has(name));
  const ok =
    mismatches.length === 0 &&
    extras.length === 0 &&
    fmProblems.length === 0 &&
    missing.length === 0;
  console.log(
    `\nResumo: tipo ${rate.toFixed(1)}% · frontmatter ${mdCurated.length - fmProblems.length}/${mdCurated.length} · pessoas ${CANON_PEOPLE.length - missing.length}/${CANON_PEOPLE.length} — ${ok ? "sem desvios novos" : "HA DESVIOS NOVOS"}`,
  );
  process.exit(ok ? 0 : 1);
}

main();
