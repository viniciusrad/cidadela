import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ProcessAutomationMapWorkbench } from "@/components/process-automation-map-workbench";
import { SecureAppShell } from "@/components/secure-app-shell";

export default async function ProcessAutomationMapPage() {
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
      currentPage="processAutomationMap"
      description="Os processos da sua area, ranqueados pelo potencial de virar rotina automatizada, com as evidencias que sustentam cada um."
      title="Mapa de processos"
      user={user}
    >
      <ProcessAutomationMapWorkbench />
    </SecureAppShell>
  );
}
