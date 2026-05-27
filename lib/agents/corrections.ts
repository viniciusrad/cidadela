import { QdrantClient } from "@qdrant/js-client-rest";

import { appConfig, collectionForSector } from "@/lib/config";
import { prisma } from "@/lib/db/client";
import { getEmbedding } from "@/lib/ollama";

export async function approveCorrection(feedbackId: string, reviewedById: string) {
  const feedback = await prisma.chunkFeedback.findUnique({
    where: { id: feedbackId },
  });

  if (!feedback) {
    throw new Error("Sugestão de correção não encontrada.");
  }

  // 1. Gerar novo embedding para o conteúdo proposto
  const vector = await getEmbedding(feedback.proposedContent);

  // 2. Atualizar no Qdrant
  const client = new QdrantClient({
    url: appConfig.qdrantUrl,
    apiKey: appConfig.qdrantApiKey,
  });
  const collectionName = collectionForSector(feedback.sector);

  // Localizar o ponto original para preservar metadados
  const points = await client.scroll(collectionName, {
    filter: {
      must: [
        { key: "document_id", match: { value: feedback.documentId } },
        { key: "chunk_index", match: { value: feedback.chunkIndex } },
      ],
    },
    limit: 1,
    with_payload: true,
  });

  if (points.points.length === 0) {
    throw new Error(
      `Chunk original não encontrado no Qdrant (Doc: ${feedback.documentId}, Index: ${feedback.chunkIndex}).`,
    );
  }

  const originalPoint = points.points[0];
  const updatedPayload = {
    ...originalPoint.payload,
    content: feedback.proposedContent,
    content_preview: feedback.proposedContent.slice(0, 200),
    updated_at: new Date().toISOString(),
    correction_feedback_id: feedbackId,
  };

  await client.upsert(collectionName, {
    wait: true,
    points: [
      {
        id: originalPoint.id,
        vector,
        payload: updatedPayload,
      },
    ],
  });

  // 3. Atualizar status no banco relacional
  await prisma.chunkFeedback.update({
    where: { id: feedbackId },
    data: {
      status: "APPROVED",
      reviewedById,
    },
  });

  // 4. Marcar o documento original (SOP) para revisão (Notificação ao curador)
  await prisma.curationDocument.updateMany({
    where: {
      documentId: feedback.documentId,
      sector: feedback.sector,
    },
    data: {
      status: "NEEDS_REVISION",
      rejectionReason: `O conteúdo do Chunk #${feedback.chunkIndex} foi alterado via feedback de usuário e aprovado por um administrador. O Markdown original deve ser revisado para manter a paridade.`,
    },
  });

  return { success: true };
}

export async function rejectCorrection(feedbackId: string, reviewedById: string) {
  await prisma.chunkFeedback.update({
    where: { id: feedbackId },
    data: {
      status: "REJECTED",
      reviewedById,
    },
  });

  return { success: true };
}
