import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  answerProcessGapQuestionMock,
  authMock,
  promoteProcessGapQuestionToCurationMock,
  reprocessProcessGapDocumentAnswersMock,
  updateAutomationCandidateMock,
} =
  vi.hoisted(() => ({
    answerProcessGapQuestionMock: vi.fn(),
    authMock: vi.fn(),
    promoteProcessGapQuestionToCurationMock: vi.fn(),
    reprocessProcessGapDocumentAnswersMock: vi.fn(),
    updateAutomationCandidateMock: vi.fn(),
  }));

vi.mock("@/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/process-automation-map", () => ({
  answerProcessGapQuestion: answerProcessGapQuestionMock,
  isProcessAutomationPersistenceError: vi.fn(() => false),
  PROCESS_AUTOMATION_SETUP_MESSAGE: "Execute as migrations do mapa de processos.",
  promoteProcessGapQuestionToCuration: promoteProcessGapQuestionToCurationMock,
  reprocessProcessGapDocumentAnswers: reprocessProcessGapDocumentAnswersMock,
  updateAutomationCandidate: updateAutomationCandidateMock,
}));

import { POST } from "@/app/api/admin/process-automation-map/questions/[questionId]/promote-to-curation/route";
import { POST as POST_GAP_ANSWER } from "@/app/api/admin/curation/process-gaps/[questionId]/answer/route";
import { POST as POST_DOCUMENT_REPROCESS } from "@/app/api/admin/curation/process-gaps/documents/[documentId]/reprocess/route";
import { PATCH } from "@/app/api/admin/automation-candidates/[candidateId]/route";

describe("process gap promotion and candidate triage routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({
      user: {
        id: "admin-1",
        email: "admin@cidadela.local",
        name: "Admin",
        role: "admin",
        sector: "desenvolvimento",
      },
    });
    promoteProcessGapQuestionToCurationMock.mockResolvedValue({
      questionId: "gap-1",
      targetCurationDocumentId: "cur-1",
      targetDocumentId: "doc-1",
      promoted: true,
      alreadyPresent: false,
    });
    updateAutomationCandidateMock.mockResolvedValue({
      id: "cand-1",
      status: "triaged",
      processMapId: "proc-1",
    });
    answerProcessGapQuestionMock.mockResolvedValue({
      questionId: "gap-1",
      status: "answered",
      answeredAt: "2026-05-11T12:00:00.000Z",
      targetCurationDocumentId: "cur-1",
      targetDocumentId: "doc-1",
    });
    reprocessProcessGapDocumentAnswersMock.mockResolvedValue({
      targetCurationDocumentId: "cur-1",
      targetDocumentId: "doc-1",
      reindexed: true,
      artifactPath: "files/sop/suporte/doc-1.md",
      chunksCreated: 7,
    });
  });

  it("promove a pergunta para a curadoria do documento alvo", async () => {
    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ questionId: "gap-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.promoted).toBe(true);
    expect(promoteProcessGapQuestionToCurationMock).toHaveBeenCalledWith({
      actorId: "admin-1",
      questionId: "gap-1",
    });
  });

  it("permite triagem manual e vínculo do candidato com processo", async () => {
    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "triaged",
          processMapId: "proc-1",
        }),
      }),
      {
        params: Promise.resolve({ candidateId: "cand-1" }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      id: "cand-1",
      status: "triaged",
      processMapId: "proc-1",
    });
    expect(updateAutomationCandidateMock).toHaveBeenCalledWith({
      candidateId: "cand-1",
      status: "triaged",
      processMapId: "proc-1",
    });
  });

  it("responde a lacuna promovida pela inbox de curadoria", async () => {
    const response = await POST_GAP_ANSWER(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: "Use o indicador de SLA mensal." }),
      }),
      {
        params: Promise.resolve({ questionId: "gap-1" }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("answered");
    expect(answerProcessGapQuestionMock).toHaveBeenCalledWith({
      actorId: "admin-1",
      questionId: "gap-1",
      response: "Use o indicador de SLA mensal.",
    });
  });

  it("reprocessa o documento com todas as lacunas respondidas", async () => {
    const response = await POST_DOCUMENT_REPROCESS(
      new Request("http://localhost", { method: "POST" }),
      {
        params: Promise.resolve({ documentId: "cur-1" }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.reindexed).toBe(true);
    expect(payload.chunksCreated).toBe(7);
    expect(reprocessProcessGapDocumentAnswersMock).toHaveBeenCalledWith({
      actorId: "admin-1",
      curationDocumentId: "cur-1",
    });
  });
});
