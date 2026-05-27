import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import {
  countUserConversations,
  createConversation,
  listUserConversations,
} from "@/lib/db/conversations-repo";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  const url = new URL(request.url);
  const take = parseInt(url.searchParams.get("take") ?? "", 10) || undefined;
  const skip = parseInt(url.searchParams.get("skip") ?? "", 10) || undefined;

  const [conversations, total] = await Promise.all([
    listUserConversations(session.user.id, { take, skip }),
    countUserConversations(session.user.id),
  ]);

  return Response.json({
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt.toISOString(),
      lastMessage: conversation.messages[0]?.content,
    })),
    total,
  });
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
  };

  const conversation = await createConversation(
    session.user.id,
    session.user.sector,
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, 100)
      : "Nova conversa",
  );

  return Response.json({
    conversation: {
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt.toISOString(),
    },
  });
}
