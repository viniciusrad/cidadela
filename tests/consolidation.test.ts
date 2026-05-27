import { describe, expect, it, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  searchRows: [] as Array<Record<string, unknown>>,
  promotedDocs: [] as Array<Record<string, unknown>>,
  createdReviews: [] as Array<Record<string, unknown>>,
  createdDrafts: [] as Array<Record<string, unknown>>,
  updatedDrafts: [] as Array<Record<string, unknown>>,
  replacedChunks: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/ollama", () => ({
  getEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
  generateJson: vi.fn(async () => ({
    processSummary: "Resumo consolidado do processo.",
    processObjective: "Executar o processo com evidencia operacional.",
    processContext: "Fluxo acionado quando ha uma nova solicitacao.",
    triggers: ["Nova solicitacao aprovada."],
    actors: ["Atendimento", "Financeiro"],
    systems: ["Portal interno"],
    inputs: ["Cadastro", "Contrato"],
    outputs: ["Conta ativa"],
    rules: ["Confirmar limite antes da ativacao."],
    exceptions: ["Erro de cadastro."],
    steps: ["Validar cadastro.", "Criar conta.", "Registrar evidencia."],
    handoffs: ["Atendimento envia para financeiro."],
    pendingQuestions: [],
    recommendedArtifacts: ["sop", "ddp"],
  })),
}));

vi.mock("@/lib/qdrant", () => ({
  semanticSearchChunksAcrossSources: vi.fn(async () => ({
    rows: state.searchRows,
    total: state.searchRows.length,
  })),
  listSectorChunks: vi.fn(async (_sector: string, input: { sourceDocumentId?: string }) => ({
    rows: state.searchRows.filter(
      (row) => row.source === "promoted" && row.sourceDocumentId === input.sourceDocumentId,
    ),
  })),
  listStagedDocumentChunks: vi.fn(async (_sector: string, sourceDocumentId: string) =>
    state.searchRows.filter(
      (row) => row.source === "staging" && row.sourceDocumentId === sourceDocumentId,
    ),
  ),
  replaceStagedSourceDocumentChunks: vi.fn(async (...args: unknown[]) => {
    state.replacedChunks.push({ args });
  }),
}));

vi.mock("@/lib/db/audit-repo", () => ({
  createAuditEvent: vi.fn(async (payload: Record<string, unknown>) => {
    state.audits.push(payload);
  }),
}));

vi.mock("@/lib/curation/inference", () => ({
  inferAdditionalQuestions: vi.fn(async () => []),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    curationDocument: {
      findMany: vi.fn(async () => state.promotedDocs),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = { id: "cur-doc-1", ...data };
        state.createdDrafts.push(created);
        return created;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const updated = { id: "cur-doc-1", ...data };
        state.updatedDrafts.push(updated);
        return updated;
      }),
    },
    documentReview: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.createdReviews.push(data);
        return data;
      }),
    },
    documentApproval: {
      deleteMany: vi.fn(async () => undefined),
    },
    documentCorrelationRun: {
      deleteMany: vi.fn(async () => undefined),
    },
  },
}));

import { discoverConsolidationCandidates, createConsolidationDraft, previewConsolidationArtifact } from "@/lib/consolidation";
import { classifyDocument } from "@/lib/document-classifier";
import { documentTypeLabel, normalizeDocumentType, sourceTypeForDocumentType } from "@/lib/document-types";
import { generateJson } from "@/lib/ollama";

describe("consolidation flow", () => {
  beforeEach(() => {
    state.searchRows = [];
    state.promotedDocs = [];
    state.createdReviews = [];
    state.createdDrafts = [];
    state.updatedDrafts = [];
    state.replacedChunks = [];
    state.audits = [];
  });

  it("supports ddp as a first-class document type", () => {
    expect(normalizeDocumentType("ddp")).toBe("ddp");
    expect(documentTypeLabel("ddp")).toBe("DDP");
    expect(sourceTypeForDocumentType("ddp")).toBe("process_description");

    const classification = classifyDocument({
      fileName: "processo.md",
      markdown: [
        "# Processo de onboarding",
        "Atores: atendimento e financeiro",
        "Gatilho: novo cliente aprovado",
        "Entradas: cadastro, contrato",
        "Saidas: conta ativa",
        "Regras: validar limite antes do handoff",
      ].join("\n"),
    });

    expect(classification.documentType).toBe("ddp");
  });

  it("discovers process candidates across promoted and staging sources", async () => {
    state.promotedDocs = [
      {
        id: "existing-sop",
        sourceDocumentId: "sop-promoted-1",
        documentTitle: "Onboarding de cliente",
        documentType: "sop",
        sector: "desenvolvimento",
        sopPath: null,
        topic: "Onboarding de cliente",
      },
      {
        id: "existing-ddp",
        sourceDocumentId: "ddp-promoted-1",
        documentTitle: "Onboarding de cliente",
        documentType: "ddp",
        sector: "desenvolvimento",
        sopPath: null,
        topic: "Onboarding de cliente",
      },
    ];
    state.searchRows = [
      {
        id: "1",
        sector: "desenvolvimento",
        documentId: "doc-1",
        sourceDocumentId: "doc-1",
        documentTitle: "Onboarding de cliente",
        fileName: "onboarding.md",
        headingPathText: "Processo",
        chunkIndex: 0,
        contentPreview: "Atores: atendimento e financeiro.",
        content: "Atores: atendimento e financeiro.\nEntradas: cadastro e contrato.\nSaidas: conta ativa.",
        score: 0.91,
        source: "promoted",
      },
      {
        id: "2",
        sector: "suporte",
        documentId: "doc-2",
        sourceDocumentId: "doc-2",
        documentTitle: "Onboarding de cliente",
        fileName: "onboarding-staging.md",
        headingPathText: "Passo a passo",
        chunkIndex: 1,
        contentPreview: "1. Validar cadastro 2. Criar conta",
        content: "1. Validar cadastro\n2. Criar conta\n3. Registrar evidencia\nRegras: confirmar limite.\nExcecoes: erro de cadastro.",
        score: 0.87,
        source: "staging",
      },
    ];

    const candidates = await discoverConsolidationCandidates({
      query: "onboarding cliente",
      sector: "all",
      sourceScope: "both",
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.processName).toContain("Onboarding");
    expect(candidates[0]?.documentRefs).toHaveLength(2);
    expect(candidates[0]?.documentRefs.map((doc) => doc.source)).toEqual(
      expect.arrayContaining(["promoted", "staging"]),
    );
    expect(candidates[0]?.artifactRecommendations).toEqual(
      expect.arrayContaining(["sop", "ddp"]),
    );
    expect(candidates[0]?.existingArtifactMatches.sop?.curationDocumentId).toBe("existing-sop");
    expect(candidates[0]?.existingArtifactMatches.ddp?.curationDocumentId).toBe("existing-ddp");
  });

  it("creates a consolidation draft in curation staging without writing a final artifact", async () => {
    state.searchRows = [
      {
        id: "1",
        sector: "desenvolvimento",
        documentId: "doc-1",
        sourceDocumentId: "doc-1",
        documentTitle: "Fechamento fiscal",
        fileName: "fiscal.md",
        headingPathText: "Passos",
        chunkIndex: 0,
        contentPreview: "1. Extrair relatorio",
        content: "Atores: fiscal.\nEntradas: relatorio.\nSaidas: arquivo final.\n1. Extrair relatorio\n2. Validar impostos\n3. Publicar evidencia",
        score: 0.94,
        source: "staging",
      },
    ];

    const [candidate] = await discoverConsolidationCandidates({
      query: "fechamento fiscal",
      sector: "desenvolvimento",
      sourceScope: "staging",
    });
    const preview = await previewConsolidationArtifact({
      candidate,
      artifactType: "sop",
    });

    const result = await createConsolidationDraft({
      actor: {
        id: "admin-1",
        sector: "desenvolvimento",
      },
      sector: "desenvolvimento",
      candidate,
      artifactType: "sop",
      markdown: preview.markdown!,
    });

    expect(result.documentType).toBe("sop");
    expect(result.status).toBe("IN_REVIEW");
    expect(state.createdDrafts).toHaveLength(1);
    expect(state.createdDrafts[0]?.classificationSource).toBe("script");
    expect(state.createdDrafts[0]?.authorityLevel).toBe("draft");
    expect(state.createdReviews).toHaveLength(1);
    expect(JSON.stringify(state.createdDrafts[0]?.knowledgeExtraction)).toContain("sourceLineage");
    expect(state.replacedChunks).toHaveLength(1);
    expect(state.audits).toHaveLength(1);
  });

  it("asks clarification questions before generating a SOP preview when operational steps are missing", async () => {
    vi.mocked(generateJson).mockResolvedValueOnce({
      processSummary: "Resumo parcial.",
      processObjective: "Cadastrar fornecedor aprovado.",
      processContext: "Fluxo de contexto sem detalhamento operacional.",
      triggers: [],
      actors: ["Compras"],
      systems: ["Portal interno"],
      inputs: [],
      outputs: [],
      rules: [],
      exceptions: [],
      steps: [],
      handoffs: [],
      pendingQuestions: ["Qual e a sequencia operacional completa do processo?"],
    });

    state.searchRows = [
      {
        id: "1",
        sector: "desenvolvimento",
        documentId: "doc-1",
        sourceDocumentId: "doc-1",
        documentTitle: "Cadastro de fornecedor",
        fileName: "fornecedor.md",
        headingPathText: "Contexto",
        chunkIndex: 0,
        contentPreview: "Fluxo de cadastro de fornecedor.",
        content: "Atores: compras.\nSistema: portal interno.\nObjetivo: cadastrar fornecedor aprovado.",
        score: 0.9,
        source: "promoted",
      },
    ];

    const [candidate] = await discoverConsolidationCandidates({
      query: "cadastro fornecedor",
      sector: "desenvolvimento",
      sourceScope: "promoted",
    });

    const preview = await previewConsolidationArtifact({
      candidate,
      artifactType: "sop",
    });

    expect("requiresClarification" in preview && preview.requiresClarification).toBe(true);
    if ("requiresClarification" in preview && preview.requiresClarification) {
      expect(preview.clarificationQuestions.map((question) => question.id)).toEqual(
        expect.arrayContaining(["procedure_steps", "required_inputs", "expected_outputs", "operational_rules"]),
      );
    }
  });

  it("uses clarification answers to generate the SOP preview", async () => {
    vi.mocked(generateJson).mockResolvedValueOnce({
      processSummary: "Resumo consolidado do processo.",
      processObjective: "Executar o processo com evidencia operacional.",
      processContext: "Fluxo acionado quando ha uma nova solicitacao.",
      triggers: ["Nova solicitacao aprovada."],
      actors: ["Atendimento", "Financeiro"],
      systems: ["Portal interno"],
      inputs: ["Cadastro", "Contrato"],
      outputs: ["Conta ativa"],
      rules: ["Confirmar limite antes da ativacao."],
      exceptions: ["Erro de cadastro."],
      steps: ["Validar cadastro.", "Criar conta.", "Registrar evidencia."],
      handoffs: ["Atendimento envia para financeiro."],
      pendingQuestions: [],
    });

    state.searchRows = [
      {
        id: "1",
        sector: "desenvolvimento",
        documentId: "doc-1",
        sourceDocumentId: "doc-1",
        documentTitle: "Cadastro de fornecedor",
        fileName: "fornecedor.md",
        headingPathText: "Contexto",
        chunkIndex: 0,
        contentPreview: "Fluxo de cadastro de fornecedor.",
        content: "Atores: compras.\nSistema: portal interno.\nObjetivo: cadastrar fornecedor aprovado.",
        score: 0.9,
        source: "promoted",
      },
    ];

    const [candidate] = await discoverConsolidationCandidates({
      query: "cadastro fornecedor",
      sector: "desenvolvimento",
      sourceScope: "promoted",
    });

    const preview = await previewConsolidationArtifact({
      candidate,
      artifactType: "sop",
      clarificationAnswers: {
        procedure_steps: "1. Receber solicitacao\n2. Validar cadastro\n3. Cadastrar no portal\n4. Registrar evidencia final",
        required_inputs: "- Solicitacao aprovada\n- Dados cadastrais",
        expected_outputs: "- Fornecedor criado\n- Evidencia anexada",
        operational_rules: "- Nao cadastrar sem aprovacao",
      },
    });

    expect("requiresClarification" in preview).toBe(false);
    if ("requiresClarification" in preview && preview.requiresClarification) {
      throw new Error("Expected SOP preview markdown after clarification answers.");
    }

    expect(preview.markdown).toContain("4. Receber solicitacao");
    expect(preview.markdown).toContain("Fornecedor criado");
    expect(preview.markdown).toContain("Dados cadastrais");
  });
});
