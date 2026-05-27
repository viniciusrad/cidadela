import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { SecureAppShell } from "@/components/secure-app-shell";
import { SecureChatWorkbench } from "@/components/secure-chat-workbench";
import { canReviewCorrections } from "@/lib/corrections/authorization";
import {
  countUserConversations,
  listUserConversations,
} from "@/lib/db/conversations-repo";
import { PERSONA_LABELS, SECTOR_LABELS } from "@/lib/labels";

const INITIAL_CONVERSATIONS_LIMIT = 5;

export default async function ChatPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const [conversations, totalConversations, userCanReviewCorrections] =
    await Promise.all([
      listUserConversations(session.user.id, {
        take: INITIAL_CONVERSATIONS_LIMIT,
      }),
      countUserConversations(session.user.id),
      canReviewCorrections(session.user),
    ]);
  const serializedConversations = conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt.toISOString(),
    lastMessage: conversation.messages[0]?.content,
  }));

  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    sector: session.user.sector,
    canReviewCorrections: userCanReviewCorrections,
  };

  return (
    <SecureAppShell
      currentPage="chat"
      description={`Voce esta conversando com ${PERSONA_LABELS[user.sector]}, o agente de ${SECTOR_LABELS[user.sector]}. Quando sua pergunta envolve outra area, ${PERSONA_LABELS[user.sector]} consulta o agente certo e traz a resposta pronta.`}
      title="Consulta setorial"
      user={user}
    >
      <SecureChatWorkbench
        initialConversationId={serializedConversations[0]?.id ?? null}
        initialConversations={serializedConversations}
        totalConversations={totalConversations}
        user={user}
      />
    </SecureAppShell>
  );
}

