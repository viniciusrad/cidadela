import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ContentManager } from "@/app/admin/content/components/content-manager";
import { SecureAppShell } from "@/components/secure-app-shell";

export default async function ContentPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "admin") {
    redirect("/chat");
  }

  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    sector: session.user.sector,
  };

  return (
    <SecureAppShell
      currentPage="content"
      description="Veja os trechos de documento que o chat usa para responder. Util para entender o que esta disponivel em cada setor."
      title="Gerenciamento de conteudo"
      user={user}
    >
      <ContentManager />
    </SecureAppShell>
  );
}
