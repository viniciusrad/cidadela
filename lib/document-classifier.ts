import { previewText } from "@/lib/markdown";
import {
  DEFAULT_DOCUMENT_TYPE,
  type DocumentType,
} from "@/lib/document-types";
import { normalizeSensitivity } from "@/lib/sensitivity";

export type AutomationCandidateDraft = {
  title: string;
  automationLevel: "none" | "assistida" | "parcial" | "total";
  automationLabel?: "sem_automacao" | "candidato" | "equivalente_automatizado_criado";
  confidence: number;
  signals: string[];
};

export type DocumentClassification = {
  documentType: DocumentType;
  confidence: number;
  signals: string[];
  title?: string;
  topic?: string;
  sensitivity?: string;
  isHybrid: boolean;
  automationCandidates: AutomationCandidateDraft[];
};

type ClassificationInput = {
  fileName: string;
  markdown: string;
  frontmatter?: {
    title?: string;
    topic?: string;
    sensitivity?: string | null;
  };
};

const TYPE_RULES: Array<{
  type: DocumentType;
  weight: number;
  patterns: Array<{ pattern: RegExp; signal: string; weight?: number }>;
}> = [
  {
    type: "ddp",
    weight: 1,
    patterns: [
      { pattern: /\bprocesso\b|\bfluxo\b|\bworkflow\b/i, signal: "processo/fluxo" },
      { pattern: /\bgatilho\b|\btrigger\b|\binicia\b/i, signal: "gatilhos" },
      { pattern: /\batores?\b|\bresponsaveis?\b|\bhandoff\b/i, signal: "atores/handoffs" },
      { pattern: /\bentradas?\b|\bsaidas?\b|\bregras?\b|\bexcecoes?\b/i, signal: "entradas/saidas/regras", weight: 2 },
    ],
  },
  {
    type: "ata",
    weight: 1,
    patterns: [
      { pattern: /\bata\b/i, signal: "termo ata" },
      { pattern: /\breuniao\b|\bcomite\b|\bparticipantes\b/i, signal: "reuniao/participantes" },
      { pattern: /\bdecis(ao|oes)\b|\bdeliber/i, signal: "decisoes" },
      { pattern: /\bresponsavel\b.*\bprazo\b/i, signal: "acoes com responsavel e prazo", weight: 2 },
    ],
  },
  {
    type: "norma",
    weight: 1,
    patterns: [
      { pattern: /\bpolitica\b|\bnorma\b|\bdiretriz\b/i, signal: "politica/norma" },
      { pattern: /\bobrigatori[ao]\b|\bvedado\b|\bproibido\b/i, signal: "obrigacao/proibicao", weight: 2 },
      { pattern: /\bcompliance\b|\bauditoria\b|\bsancao\b/i, signal: "compliance/auditoria" },
    ],
  },
  {
    type: "doc_tecnica",
    weight: 1,
    patterns: [
      { pattern: /\bapi\b|\bendpoint\b|\bpayload\b|\bjson\b/i, signal: "api/payload", weight: 2 },
      { pattern: /\barquitetura\b|\bintegracao\b|\bdeploy\b/i, signal: "arquitetura/integracao" },
      { pattern: /\btroubleshooting\b|\blog\b|\berro\b/i, signal: "troubleshooting" },
    ],
  },
  {
    type: "faq",
    weight: 1,
    patterns: [
      { pattern: /\bfaq\b|\bperguntas frequentes\b/i, signal: "faq" },
      { pattern: /^\s*(pergunta|p):\s+/im, signal: "pergunta estruturada" },
      { pattern: /^\s*(resposta|r):\s+/im, signal: "resposta estruturada" },
    ],
  },
  {
    type: "comunicado",
    weight: 1,
    patterns: [
      { pattern: /\bcomunicado\b|\baviso\b|\binforme\b/i, signal: "comunicado/aviso" },
      { pattern: /\bjanela\b|\bindisponibilidade\b|\bmanutencao\b/i, signal: "janela/manutencao" },
      { pattern: /\bvalidade\b|\bexpira\b|\btemporari[ao]\b/i, signal: "validade temporal" },
    ],
  },
  {
    type: "relatorio",
    weight: 1,
    patterns: [
      { pattern: /\brelatorio\b|\bdiagnostico\b|\banalise\b/i, signal: "relatorio/diagnostico" },
      { pattern: /\bmetodologia\b|\bachados\b|\brecomendacoes\b/i, signal: "metodologia/achados" },
      { pattern: /\bindicador\b|\bperiodo\b|\bkpi\b/i, signal: "indicador/periodo" },
    ],
  },
  {
    type: "contrato",
    weight: 1,
    patterns: [
      { pattern: /\bcontrato\b|\bacordo\b|\btermo\b/i, signal: "contrato/acordo" },
      { pattern: /\bsla\b|\bobrigacoes\b|\bpenalidade\b/i, signal: "sla/obrigacoes" },
      { pattern: /\bpartes\b|\bvigencia\b/i, signal: "partes/vigencia" },
    ],
  },
  {
    type: "conversa",
    weight: 1.5,
    patterns: [
      { pattern: /^#{1,3}\s*(?:pergunta|questão|question)\b/im, signal: "qa_heading_pergunta", weight: 2 },
      { pattern: /^#{1,3}\s*(?:resposta|answer)\b/im, signal: "qa_heading_resposta", weight: 2 },
      { pattern: /^\s*(?:p|q|pergunta)\s*:\s+/im, signal: "qa_inline_p", weight: 1.5 },
      { pattern: /^\s*(?:r|a|resposta)\s*:\s+/im, signal: "qa_inline_r", weight: 1.5 },
      { pattern: /\b(?:lacuna de conhecimento|pergunta não respondida|unanswered|whatsapp|teams|slack|chat)\b/i, signal: "conversa_keyword", weight: 1 },
      { pattern: /^type:\s*conversa/im, signal: "conversa_frontmatter", weight: 4 },
    ],
  },
  {
    type: "sop",
    weight: 1,
    patterns: [
      { pattern: /\bsop\b|\bprocedimento\b|\bpasso a passo\b/i, signal: "procedimento/sop" },
      { pattern: /^\s*\d+\.\s+\S+/im, signal: "passos numerados", weight: 2 },
      { pattern: /\bpre-?requisito\b|\bentrada\b|\bsaida\b|\bevidencia\b/i, signal: "entradas/saidas/evidencias" },
    ],
  },
  {
    type: "person",
    weight: 1.5,
    patterns: [
      { pattern: /\bperfil\s+funcional\b|\bperfil\s+profissional\b/i, signal: "perfil funcional", weight: 3 },
      { pattern: /\bcargo\b|\bfuncao\b|\bsenioridade\b|\bsenior\b|\bpleno\b|\bjunior\b/i, signal: "cargo/funcao", weight: 2 },
      { pattern: /\bcompetencias?\b|\bhabilidades?\b|\bespecialidades?\b/i, signal: "competencias" },
      { pattern: /\bquando\s+acionar\b|\bquando\s+contatar\b|\bprocurar\s+para\b|\bponto\s+focal\b/i, signal: "quando acionar", weight: 3 },
      { pattern: /\bnao\s+acionar\b|\bnao\s+e\s+referencia\b|\bnao\s+e\s+responsavel\b/i, signal: "nao acionar", weight: 2 },
    ],
  },
  {
    type: "org_chart",
    weight: 1.5,
    patterns: [
      { pattern: /\borganograma\b/i, signal: "organograma", weight: 4 },
      { pattern: /\bestrutura\s+organizacional\b|\bhierarquia\b|\bligacoes\s+hierarquicas\b/i, signal: "hierarquia/estrutura", weight: 3 },
      { pattern: /\breporta\s+(a|ao|para)\b|\bsubordinado\b|\bgestor\b|\bdirigido\s+por\b/i, signal: "relacao de reporte", weight: 2 },
      { pattern: /\bcentros?\s+de\s+decisao\b|\bcomite\b|\bcolegiado\b/i, signal: "centros de decisao" },
      { pattern: /\bvigencia\b|\bvalidade\b|\bultima\s+revisao\b/i, signal: "vigencia/validade" },
    ],
  },
];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const GENERIC_TITLES = [
  "sobre",
  "introducao",
  "objetivo",
  "resumo",
  "contexto",
  "historico",
  "finalidade",
];

function titleFromMarkdown(markdown: string, fileName: string) {
  const headings = Array.from(markdown.matchAll(/^#+\s+(.+)$/gm)).map((m) =>
    m[1].trim()
  );

  for (const heading of headings) {
    const cleanHeading = heading.replace(/\*/g, "").toLowerCase();
    const isGeneric = GENERIC_TITLES.some(
      (generic) =>
        cleanHeading === generic || cleanHeading.startsWith(`${generic} `)
    );

    if (!isGeneric && heading.length > 3) {
      return heading;
    }
  }

  return fileName.replace(/\.[^.]+$/, "");
}

function topicFromSignals(signals: string[], fileName: string) {
  const fileTopic = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();

  return signals[0] ?? fileTopic;
}

function detectAutomationCandidates(markdown: string): AutomationCandidateDraft[] {
  const normalized = normalize(markdown);
  const signals: string[] = [];

  if (/\bautomatiz/.test(normalized)) {
    signals.push("menciona automacao");
  }

  if (/\brobo\b|\bscript\b|\bworkflow\b|\bfila\b|\bportal\b/.test(normalized)) {
    signals.push("menciona script/robo/fila/portal");
  }

  if (/\bdiari[ao]\b|\bsemanal\b|\bmensal\b|\brecorrente\b/.test(normalized)) {
    signals.push("frequencia recorrente");
  }

  if (/\baprova|\bvalidar|\bhumano|\bresponsavel\b/.test(normalized)) {
    signals.push("checkpoint humano");
  }

  if (signals.length === 0) {
    return [];
  }

  const hasHumanLoop = signals.includes("checkpoint humano");
  return [
    {
      title: `Avaliar automacao: ${previewText(markdown).slice(0, 80)}`,
      automationLevel: hasHumanLoop ? "parcial" : "assistida",
      automationLabel: "candidato",
      confidence: Math.min(0.9, 0.45 + signals.length * 0.1),
      signals,
    },
  ];
}

export function classifyDocument(input: ClassificationInput): DocumentClassification {
  const scores = TYPE_RULES.map((rule) => {
    const signals: string[] = [];
    let score = 0;

    for (const { pattern, signal, weight = 1 } of rule.patterns) {
      if (pattern.test(input.markdown) || pattern.test(input.fileName)) {
        score += weight;
        signals.push(signal);
      }
    }

    return {
      type: rule.type,
      score: score * rule.weight,
      signals,
    };
  }).sort((a, b) => b.score - a.score);

  const best = scores[0];
  const second = scores[1];
  const documentType =
    best && best.score > 0 ? best.type : DEFAULT_DOCUMENT_TYPE;
  const confidence =
    best && best.score > 0
      ? Math.min(0.95, 0.45 + best.score * 0.12)
      : 0.35;
  const isHybrid = Boolean(best && second && second.score > 0 && best.score - second.score <= 1);

  return {
    documentType,
    confidence: Number(confidence.toFixed(2)),
    signals: best?.signals ?? ["fallback sop legado"],
    title: input.frontmatter?.title ?? titleFromMarkdown(input.markdown, input.fileName),
    topic: input.frontmatter?.topic ?? topicFromSignals(best?.signals ?? [], input.fileName),
    sensitivity: input.frontmatter?.sensitivity
      ? normalizeSensitivity(input.frontmatter.sensitivity)
      : undefined,
    isHybrid,
    automationCandidates: detectAutomationCandidates(input.markdown),
  };
}
