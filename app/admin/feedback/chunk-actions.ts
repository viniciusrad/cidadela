"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { approveCorrection, rejectCorrection } from "@/lib/agents/corrections";

export async function handleApproveCorrection(feedbackId: string) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    throw new Error("Acao nao permitida.");
  }

  if (!session.user.id) {
    throw new Error("ID do usuario nao encontrado.");
  }

  await approveCorrection(feedbackId, session.user.id);
  revalidatePath("/admin/governance");
}

export async function handleRejectCorrection(feedbackId: string) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    throw new Error("Acao nao permitida.");
  }

  if (!session.user.id) {
    throw new Error("ID do usuario nao encontrado.");
  }

  await rejectCorrection(feedbackId, session.user.id);
  revalidatePath("/admin/governance");
}
