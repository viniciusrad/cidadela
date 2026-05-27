import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AuditPanel } from "@/components/governance/audit-panel";
import { SecureAppShell } from "@/components/secure-app-shell";

export default async function AuditPage() {
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
      currentPage="audit"
      description="Acompanhe quem perguntou o que, quais agentes foram acionados e como cada resposta foi montada."
      title="Historico operacional"
      user={user}
    >
      <AuditPanel />
    </SecureAppShell>
  );
}
