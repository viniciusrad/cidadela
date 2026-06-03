import type { CurationFrontmatter } from "@/lib/frontmatter";
import {
  DEFAULT_DOCUMENT_TYPE,
  type DocumentType,
} from "@/lib/document-types";
import {
  calculateSopReadiness,
  requiredReadinessQuestions,
  type CurationQuestion,
} from "@/lib/sop-readiness";

type ProfileQuestion = {
  id: string;
  type: CurationQuestion["type"];
  prompt: string;
  neverInfer?: boolean; // quando true, inferTemplateAnswers deve pular este campo
};

const PROFILE_QUESTIONS: Record<DocumentType, ProfileQuestion[]> = {
  sop: [],
  ddp: [
    {
      id: "ddp_objective",
      type: "summary",
      prompt: "Qual e o objetivo e o contexto do processo descrito?",
    },
    {
      id: "ddp_flow",
      type: "scope",
      prompt: "Quais gatilhos, atores, sistemas, handoffs e dependencias precisam constar?",
    },
    {
      id: "ddp_rules",
      type: "rules",
      prompt: "Quais regras, excecoes, entradas e saidas devem ser preservadas?",
    },
  ],
  norma: [
    {
      id: "norma_authority",
      type: "authority",
      prompt: "Qual e a autoridade, origem ou aprovador desta norma?",
    },
    {
      id: "norma_scope",
      type: "scope",
      prompt: "Qual e o escopo de aplicacao e quem deve cumprir?",
    },
    {
      id: "norma_obligations",
      type: "rules",
      prompt: "Quais obrigacoes, proibicoes e excecoes devem ser preservadas?",
    },
  ],
  ata: [
    {
      id: "ata_date_participants",
      type: "meeting_context",
      prompt: "Qual foi a data da reuniao e quem participou?",
    },
    {
      id: "ata_decisions",
      type: "decisions",
      prompt: "Quais decisoes foram tomadas e por quem?",
    },
    {
      id: "ata_actions",
      type: "actions",
      prompt: "Quais acoes ficaram com responsavel e prazo?",
    },
  ],
  doc_tecnica: [
    {
      id: "tech_systems",
      type: "systems",
      prompt: "Quais sistemas, APIs, contratos ou dependencias este documento descreve?",
    },
    {
      id: "tech_version_scope",
      type: "scope",
      prompt: "Qual versao, ambiente ou escopo tecnico esta vigente?",
    },
    {
      id: "tech_examples_risks",
      type: "risks",
      prompt: "Quais exemplos, riscos, falhas conhecidas ou cuidados operacionais devem ser destacados?",
    },
  ],
  faq: [
    {
      id: "faq_scope",
      type: "scope",
      prompt: "Qual e o escopo do FAQ e qual publico deve usa-lo?",
    },
    {
      id: "faq_pairs",
      type: "qa_pairs",
      prompt: "Quais perguntas e respostas canonicas devem ser mantidas?",
    },
    {
      id: "faq_authoritative_links",
      type: "references",
      prompt: "Quais respostas precisam citar fontes mais autoritativas?",
    },
  ],
  comunicado: [
    {
      id: "announcement_audience",
      type: "audience",
      prompt: "Qual publico deve receber este comunicado?",
    },
    {
      id: "announcement_validity",
      type: "validity",
      prompt: "Qual e a validade, expiracao ou janela de aplicacao?",
    },
    {
      id: "announcement_impact",
      type: "impact",
      prompt: "Qual impacto pratico e qual acao o publico precisa tomar?",
    },
  ],
  relatorio: [
    {
      id: "report_period",
      type: "period",
      prompt: "Qual periodo e metodologia este relatorio cobre?",
    },
    {
      id: "report_findings",
      type: "findings",
      prompt: "Quais achados, evidencias e limitacoes devem ser preservados?",
    },
    {
      id: "report_recommendations",
      type: "recommendations",
      prompt: "Quais recomendacoes ou proximas acoes foram propostas?",
    },
  ],
  contrato: [
    {
      id: "contract_parties",
      type: "parties",
      prompt: "Quais partes, donos ou fornecedores este contrato envolve?",
    },
    {
      id: "contract_obligations",
      type: "rules",
      prompt: "Quais obrigacoes, SLAs, prazos e penalidades precisam ser rastreados?",
    },
    {
      id: "contract_validity",
      type: "validity",
      prompt: "Qual vigencia, renovacao ou condicao de encerramento se aplica?",
    },
  ],
  conversa: [
    {
      id: "conversation_origin",
      type: "summary",
      prompt: "De onde vem esta conversa (Teams, WhatsApp, outro) e qual foi o contexto?",
    },
    {
      id: "conversation_decisions",
      type: "decisions",
      prompt: "Quais decisoes, combinados ou orientacoes a conversa registra?",
    },
    {
      id: "conversation_followups",
      type: "actions",
      prompt: "Quais acoes ou follow-ups ficaram pendentes e com quem?",
    },
  ],
  generico: [
    {
      id: "generic_summary",
      type: "summary",
      prompt: "Qual resumo util deve representar este conhecimento?",
    },
    {
      id: "generic_authority",
      type: "authority",
      prompt: "Este conteudo e autoritativo, apoio, evidencia ou rascunho?",
    },
    {
      id: "generic_gaps",
      type: "gaps",
      prompt: "Quais lacunas impedem uma classificacao mais especifica?",
    },
  ],
  person: [
    {
      id: "person_expertise",
      type: "summary",
      prompt: "Quais sao as principais competencias tecnicas ou funcionais desta pessoa?",
    },
    {
      id: "person_scope",
      type: "scope",
      prompt: "De quais processos, sistemas ou areas esta pessoa e referencia formal?",
    },
    {
      id: "person_goto_what",
      type: "gaps",
      prompt: "Para qual tipo de situacao ou duvida as pessoas recorrem a esta pessoa? (Descreva cada situacao e os dominios envolvidos)",
      neverInfer: true, // conhecimento tribal — so quem trabalha com ela sabe
    },
    {
      id: "person_goto_not",
      type: "gaps",
      prompt: "Para o que NAO acionar esta pessoa, mesmo que o cargo sugira que ela seria o contato certo?",
      neverInfer: true,
    },
    {
      id: "person_network",
      type: "gaps",
      prompt: "Com quem esta pessoa tem conexao direta que complementa sua area de atuacao? Cite cargo ou nome.",
      neverInfer: true,
    },
  ],
  org_chart: [
    {
      id: "orgchart_scope",
      type: "scope",
      prompt: "Qual area, unidade de negocio ou setor este organograma cobre?",
    },
    {
      id: "orgchart_top",
      type: "authority",
      prompt: "Quem esta no topo desta estrutura? Informe cargo e, se disponivel no documento, o nome.",
    },
    {
      id: "orgchart_decision_centers",
      type: "rules",
      prompt: "Quais sao os centros formais de decisao nesta estrutura? Quem aprova o que?",
    },
    {
      id: "orgchart_vacancies",
      type: "gaps",
      prompt: "Ha posicoes em aberto ou em transicao que afetam quem deve ser consultado?",
      neverInfer: true, // so quem esta dentro da org sabe
    },
    {
      id: "orgchart_validity",
      type: "validity",
      prompt: "Ate quando esta estrutura e valida? Ha revisao agendada?",
      neverInfer: true, // informacao administrativa, nao esta no documento
    },
  ],
};

const TYPE_EVIDENCE: Record<DocumentType, RegExp[]> = {
  sop: [/^\s*\d+\.\s+\S+/m, /\bprocedimento\b/i],
  ddp: [/\bprocesso\b|\bfluxo\b/i, /\batores?\b|\bresponsaveis?\b/i, /\bentradas?\b|\bsaidas?\b|\bregras?\b|\bexce(c|ç)(a|ã)o/i],
  norma: [/\bobrigatori[ao]\b/i, /\bvigencia\b/i, /\bpolitica\b|\bnorma\b/i],
  ata: [/\bparticipantes\b/i, /\bdecis(ao|oes)\b/i, /\bprazo\b/i],
  doc_tecnica: [/\bapi\b|\bendpoint\b|\bpayload\b/i, /\bdependencia\b|\bintegracao\b/i],
  faq: [/^\s*(pergunta|p):/im, /^\s*(resposta|r):/im, /\bfaq\b/i],
  comunicado: [/\bpublico\b|\baudience\b/i, /\bvalidade\b|\bexpira\b|\bjanela\b/i],
  relatorio: [/\bperiodo\b/i, /\bmetodologia\b/i, /\bachados\b/i],
  contrato: [/\bpartes\b/i, /\bsla\b|\bobrigacoes\b/i, /\bvigencia\b/i],
  conversa: [/\b(teams|whatsapp)\b/i, /^\s*\*\*[^*]+\([0-9]{1,2}:[0-9]{2}\)\*\*:/m, /\bmensagens?\b/i],
  generico: [/\S/],
  person: [/\bcargo\b|\bfuncao\b/i, /\bcompetencia\b|\bhabilidade\b|\bexpertise\b/i, /\bresponsavel\b|\brefer(e|ê)ncia\b/i],
  org_chart: [/\borganograma\b/i, /\bhierarquia\b|\bestrutura\b|\bsubordinado\b/i, /\bgerente\b|\bdiret[oa]r\b|\bcoordenad[oa]r\b/i],
};

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function mergeQuestions(
  definitions: ProfileQuestion[],
  existing: CurationQuestion[],
) {
  const byId = new Map(existing.map((question) => [question.id, question]));
  return definitions.map((definition) => ({
    ...definition,
    required: false,
    ...byId.get(definition.id),
  }));
}

export function requiredCurationQuestions(
  documentType: DocumentType = DEFAULT_DOCUMENT_TYPE,
  metadata: CurationFrontmatter,
  existing: CurationQuestion[] = [],
) {
  if (documentType === "sop") {
    return requiredReadinessQuestions(metadata, existing);
  }

  const metadataQuestions: ProfileQuestion[] = [];
  if (!metadata.title) {
    metadataQuestions.push({
      id: "metadata_title",
      type: "metadata_required",
      prompt: "Informe o titulo canonico do documento curado.",
    });
  }

  if (!metadata.owner) {
    metadataQuestions.push({
      id: "metadata_owner",
      type: "metadata_required",
      prompt: "E-mail do responsavel pelo conhecimento.",
    });
  }

  return mergeQuestions(
    [...metadataQuestions, ...PROFILE_QUESTIONS[documentType]],
    existing,
  );
}

export function calculateCurationReadiness(input: {
  documentType: DocumentType;
  metadata: CurationFrontmatter;
  markdown: string;
  questions: CurationQuestion[];
}) {
  const templateQuestions = input.questions.filter(
    (question) => question.source !== "inferred",
  );

  if (input.documentType === "sop") {
    return calculateSopReadiness({
      ...input,
      questions: templateQuestions,
    });
  }

  let score = 0;
  const missing: string[] = [];
  if (hasText(input.metadata.title)) {
    score += 0.7;
  } else {
    missing.push("title");
  }

  const evidenceRules = TYPE_EVIDENCE[input.documentType];
  const evidenceMatches = evidenceRules.filter((rule) => rule.test(input.markdown)).length;
  score += Math.min(0.3, (evidenceMatches / Math.max(1, evidenceRules.length)) * 0.3);

  return {
    score: Number(Math.min(1, score).toFixed(2)),
    missing: Array.from(new Set(missing)),
  };
}
