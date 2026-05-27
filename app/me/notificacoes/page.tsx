import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { NotificationsList } from "@/components/notifications-list";
import { SecureAppShell } from "@/components/secure-app-shell";
import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";

export default async function NotificacoesPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    sector: session.user.sector,
  };

  const notifications = await prisma.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <SecureAppShell
      currentPage="notifications"
      description="Avisos sobre suas perguntas e atualizacoes de conhecimento."
      title="Minhas notificacoes"
      user={user}
    >
      <NotificationsList
        initialItems={notifications.map((item) => ({
          id: item.id,
          type: item.type,
          title: item.title,
          body: item.body,
          href: item.href,
          readAt: item.readAt?.toISOString() ?? null,
          createdAt: item.createdAt.toISOString(),
        }))}
      />
    </SecureAppShell>
  );
}
