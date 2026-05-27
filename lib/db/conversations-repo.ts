import { prisma } from "@/lib/db/client";
import type { Sector } from "@/lib/domain";

export function listUserConversations(
  userId: string,
  opts?: { take?: number; skip?: number },
) {
  return prisma.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    ...(opts?.take ? { take: opts.take } : {}),
    ...(opts?.skip ? { skip: opts.skip } : {}),
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
}

export function countUserConversations(userId: string) {
  return prisma.conversation.count({ where: { userId } });
}

export function createConversation(
  userId: string,
  sector: Sector,
  title = "Nova conversa",
) {
  return prisma.conversation.create({
    data: {
      userId,
      sector,
      title,
    },
  });
}

export function findConversationForUser(conversationId: string, userId: string) {
  return prisma.conversation.findFirst({
    where: {
      id: conversationId,
      userId,
    },
  });
}

export function getConversationWithMessages(
  conversationId: string,
  userId: string,
) {
  return prisma.conversation.findFirst({
    where: {
      id: conversationId,
      userId,
    },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export function updateConversationTitle(conversationId: string, title: string) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { title },
  });
}
