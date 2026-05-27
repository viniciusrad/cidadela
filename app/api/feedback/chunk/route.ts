import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { prisma } from "@/lib/db/client";
import type { Sector } from "@/lib/domain";
import { SECTORS } from "@/lib/domain";

type ChunkFeedbackBody = {
  messageId?: unknown;
  chunkIndex?: unknown;
  documentId?: unknown;
  sector?: unknown;
  originalContent?: unknown;
  proposedContent?: unknown;
};

type CitationSnapshot = {
  sector?: unknown;
  documentId?: unknown;
  chunkIndex?: unknown;
  content?: unknown;
  contentPreview?: unknown;
};

function parseSector(value: unknown): Sector | null {
  return typeof value === "string" && SECTORS.includes(value as Sector)
    ? (value as Sector)
    : null;
}

function parseChunkIndex(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isCitationSnapshot(value: unknown): value is CitationSnapshot {
  return typeof value === "object" && value !== null;
}

function isMissingFeedbackTableError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2021"
  );
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  const body = (await request.json().catch(() => ({}))) as ChunkFeedbackBody;
  const messageId =
    typeof body.messageId === "string" ? body.messageId.trim() : "";
  const documentId =
    typeof body.documentId === "string" ? body.documentId.trim() : "";
  const sector = parseSector(body.sector);
  const chunkIndex = parseChunkIndex(body.chunkIndex);
  const proposedContent =
    typeof body.proposedContent === "string" ? body.proposedContent.trim() : "";

  if (
    !messageId ||
    chunkIndex === null ||
    !documentId ||
    !sector ||
    !proposedContent
  ) {
    return jsonError("Dados incompletos para a sugestao de correcao.", 400);
  }

  try {
    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        role: "assistant",
        conversation: {
          userId: session.user.id,
        },
      },
      select: {
        id: true,
        citations: true,
      },
    });

    if (!message) {
      return jsonError("Resposta nao encontrada para este usuario e setor.", 404);
    }

    const citations = Array.isArray(message.citations) ? message.citations : [];
    const citation = citations.find(
      (item) =>
        isCitationSnapshot(item) &&
        item.sector === sector &&
        item.documentId === documentId &&
        item.chunkIndex === chunkIndex,
    );

    if (!citation || !isCitationSnapshot(citation)) {
      return jsonError("Trecho citado nao encontrado nesta resposta.", 404);
    }

    const originalContent =
      typeof citation.content === "string" && citation.content.trim()
        ? citation.content
        : typeof citation.contentPreview === "string" &&
            citation.contentPreview.trim()
          ? citation.contentPreview
          : typeof body.originalContent === "string"
            ? body.originalContent.trim()
            : "";

    if (!originalContent) {
      return jsonError("O trecho citado nao possui conteudo revisavel.", 400);
    }

    if (proposedContent === originalContent.trim()) {
      return jsonError("A sugestao deve alterar o conteudo original.", 400);
    }

    const feedback = await prisma.chunkFeedback.create({
      data: {
        messageId,
        userId: session.user.id,
        sector,
        documentId,
        chunkIndex,
        originalContent,
        proposedContent,
      },
    });

    await prisma.auditEvent.create({
      data: {
        traceId: `correction-${feedback.id}`,
        actorType: "user",
        actorId: session.user.id,
        targetType: "chunk",
        targetId: `${documentId}:${chunkIndex}`,
        eventType: "user.chunk_correction_suggestion",
        payload: {
          feedbackId: feedback.id,
          sector,
          documentId,
          chunkIndex,
        },
      },
    });

    return Response.json({ success: true, id: feedback.id });
  } catch (error) {
    console.error("[api/feedback/chunk] Error creating feedback:", error);
    if (isMissingFeedbackTableError(error)) {
      return jsonError(
        "A tabela de sugestoes de correcao ainda nao esta disponivel. Rode npm run db:migrate e tente novamente.",
        503,
      );
    }
    return jsonError("Falha ao registrar a sugestao de correcao.", 500);
  }
}
