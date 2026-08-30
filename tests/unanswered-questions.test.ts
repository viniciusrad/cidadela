import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, createAuditEventMock, authMock } = vi.hoisted(() => ({
  prismaMock: {
    unansweredQuestion: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
  },
  createAuditEventMock: vi.fn(),
  authMock: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: prismaMock }));
vi.mock("@/lib/db/audit-repo", () => ({ createAuditEvent: createAuditEventMock }));
vi.mock("@/auth", () => ({ auth: authMock }));

import { linkUnansweredToCuration } from "@/lib/curation/create";
import { notifyAskersOnPromotion } from "@/lib/notifications/unanswered";
import { POST as dismiss } from "@/app/api/admin/curation/unanswered/[id]/dismiss/route";

beforeEach(() => {
  vi.clearAllMocks();
  createAuditEventMock.mockResolvedValue({ id: "audit-1" });
});

describe("linkUnansweredToCuration", () => {
  it("moves an open question to answered and audits it", async () => {
    prismaMock.unansweredQuestion.findUnique.mockResolvedValue({
      id: "q1",
      status: "open",
      sector: "suporte",
    });
    prismaMock.unansweredQuestion.update.mockResolvedValue({
      id: "q1",
      status: "answered",
    });

    const result = await linkUnansweredToCuration({
      unansweredQuestionId: "q1",
      curationDocumentId: "doc-row-1",
      resolvedById: "admin-1",
      answerType: "direct",
      answerText: "Resposta",
    });

    expect(result?.status).toBe("answered");
    expect(prismaMock.unansweredQuestion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "q1" },
        data: expect.objectContaining({
          status: "answered",
          answerType: "direct",
          curationDocumentId: "doc-row-1",
          resolvedById: "admin-1",
        }),
      }),
    );
    expect(createAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "unanswered.answered", targetId: "q1" }),
    );
  });

  it("does not overwrite a question that is not open", async () => {
    prismaMock.unansweredQuestion.findUnique.mockResolvedValue({
      id: "q1",
      status: "answered",
      sector: "suporte",
    });

    const result = await linkUnansweredToCuration({
      unansweredQuestionId: "q1",
      curationDocumentId: "doc-row-1",
      resolvedById: "admin-1",
      answerType: "upload",
    });

    expect(result).toBeNull();
    expect(prismaMock.unansweredQuestion.update).not.toHaveBeenCalled();
    expect(createAuditEventMock).not.toHaveBeenCalled();
  });
});

describe("notifyAskersOnPromotion", () => {
  it("notifies each asker once and flags notifiedAt", async () => {
    prismaMock.unansweredQuestion.findMany.mockResolvedValue([
      { id: "q1", askedById: "u1", question: "Q1?", conversationId: "c1", sector: "suporte" },
      { id: "q2", askedById: "u2", question: "Q2?", conversationId: "c2", sector: "suporte" },
    ]);
    prismaMock.notification.create.mockResolvedValue({ id: "n" });
    prismaMock.unansweredQuestion.update.mockResolvedValue({ id: "q" });

    const result = await notifyAskersOnPromotion("doc-row-1");

    expect(result.notified).toBe(2);
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.unansweredQuestion.update).toHaveBeenCalledTimes(2);
    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "u1", type: "unanswered_resolved" }),
      }),
    );
    // findMany must filter to the document, answered status and not-yet-notified.
    expect(prismaMock.unansweredQuestion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { curationDocumentId: "doc-row-1", status: "answered", notifiedAt: null },
      }),
    );
  });

  it("does nothing when there is no answered question to notify", async () => {
    prismaMock.unansweredQuestion.findMany.mockResolvedValue([]);

    const result = await notifyAskersOnPromotion("doc-row-1");

    expect(result.notified).toBe(0);
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/curation/unanswered/[id]/dismiss", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({
      user: { id: "admin-1", email: "admin@cidadela.local", name: "Admin", role: "admin", sector: "desenvolvimento" },
    });
  });

  it("dismisses an open question", async () => {
    prismaMock.unansweredQuestion.findUnique.mockResolvedValue({
      id: "q1",
      status: "open",
      sector: "suporte",
    });
    prismaMock.unansweredQuestion.update.mockResolvedValue({ id: "q1", status: "dismissed" });

    const response = await dismiss(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: "q1" }) },
    );

    expect(response.status).toBe(200);
    expect(prismaMock.unansweredQuestion.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "dismissed" }) }),
    );
    expect(createAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "unanswered.dismissed" }),
    );
  });

  it("rejects dismissing a non-open question", async () => {
    prismaMock.unansweredQuestion.findUnique.mockResolvedValue({
      id: "q1",
      status: "answered",
      sector: "suporte",
    });

    const response = await dismiss(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: "q1" }) },
    );

    expect(response.status).toBe(409);
    expect(prismaMock.unansweredQuestion.update).not.toHaveBeenCalled();
  });

  it("blocks non-admins", async () => {
    authMock.mockResolvedValue({
      user: { id: "u1", email: "u@cidadela.local", name: "User", role: "user", sector: "suporte" },
    });

    const response = await dismiss(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: "q1" }) },
    );

    expect(response.status).toBe(403);
    expect(prismaMock.unansweredQuestion.findUnique).not.toHaveBeenCalled();
  });
});
