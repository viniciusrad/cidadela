"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { approveCorrection, rejectCorrection } from "@/lib/agents/corrections";
import { canReviewCorrectionSector } from "@/lib/corrections/authorization";
import { prisma } from "@/lib/db/client";

async function requireCorrectionReviewer(feedbackId: string) {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Nao autenticado.");
  }

  const feedback = await prisma.chunkFeedback.findUnique({
    where: { id: feedbackId },
    select: { sector: true },
  });

  if (!feedback) {
    throw new Error("Sugestao de correcao nao encontrada.");
  }

  const allowed = await canReviewCorrectionSector(session.user, feedback.sector);
  if (!allowed) {
    throw new Error("Acao nao permitida para este setor.");
  }

  return session.user;
}

function feedbackIdFromForm(formData: FormData) {
  const feedbackId = formData.get("feedbackId");
  if (typeof feedbackId !== "string" || !feedbackId.trim()) {
    throw new Error("Feedback invalido.");
  }
  return feedbackId.trim();
}

export async function handleApproveCorrection(formData: FormData) {
  const feedbackId = feedbackIdFromForm(formData);
  const user = await requireCorrectionReviewer(feedbackId);

  await approveCorrection(feedbackId, user.id);
  revalidatePath("/admin/governance");
}

export async function handleRejectCorrection(formData: FormData) {
  const feedbackId = feedbackIdFromForm(formData);
  const user = await requireCorrectionReviewer(feedbackId);

  await rejectCorrection(feedbackId, user.id);
  revalidatePath("/admin/governance");
}
