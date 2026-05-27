import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { PeopleReclassifyPanel } from "@/components/people-reclassify-panel";
import { SecureAppShell } from "@/components/secure-app-shell";

export default async function PeopleReclassifyPage() {
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
      currentPage="peopleReclassify"
      description="Substitua referencias a pessoas por sistemas, conceitos, processos ou regulamentacoes. Atualiza tanto o grafo quanto os trechos no banco vetorial."
      title="Reclassificar pessoas"
      user={user}
    >
      <PeopleReclassifyPanel />
    </SecureAppShell>
  );
}
