import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { PersonRegistryPanel } from "@/components/person-registry-panel";
import { SecureAppShell } from "@/components/secure-app-shell";

export default async function PersonsPage() {
  const session = await auth();

  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/chat");

  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    sector: session.user.sector,
  };

  return (
    <SecureAppShell
      currentPage="persons"
      description="Cadastre pessoas, valide relações inferidas (setor, processos, sistemas, procedimentos) e identifique riscos de concentração de conhecimento."
      title="Pessoas e relações"
      user={user}
    >
      <PersonRegistryPanel />
    </SecureAppShell>
  );
}
