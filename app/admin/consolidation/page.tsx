import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ConsolidationWorkbench } from "@/app/admin/consolidation/components/consolidation-workbench";
import { SecureAppShell } from "@/components/secure-app-shell";
import { isSector } from "@/lib/config";
import type { ConsolidationSectorFilter } from "@/lib/consolidation";
import type { Sector } from "@/lib/domain";

type SearchParams = Promise<{ sector?: string }>;

export default async function ConsolidationPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "admin") {
    redirect("/chat");
  }

  const params = await searchParams;
  const rawSector = params.sector;
  const selectedSector: ConsolidationSectorFilter =
    rawSector === "all"
      ? "all"
      : rawSector && isSector(rawSector)
        ? (rawSector as Sector)
        : "all";

  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    sector: session.user.sector,
  };

  return (
    <SecureAppShell
      currentPage="consolidation"
      description="Encontre como um mesmo processo aparece em varios setores e gere um rascunho de procedimento oficial."
      hideHeader={false}
      title="Consolidacao de Processos"
      user={user}
    >
      <ConsolidationWorkbench selectedSector={selectedSector} />
    </SecureAppShell>
  );
}
