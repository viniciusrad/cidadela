import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { SecureAppShell } from "@/components/secure-app-shell";
import { SectorIngestionWorkbench } from "@/components/sector-ingestion-workbench";
import { canReviewCorrections } from "@/lib/corrections/authorization";
import { getSectorLabel } from "@/lib/labels";
import { listAllSectors } from "@/lib/sectors/sector-repo";

export default async function FilesPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const [canReview, allSectors] = await Promise.all([
    canReviewCorrections(session.user),
    session.user.role === "admin" ? listAllSectors() : Promise.resolve([]),
  ]);

  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    sector: session.user.sector,
    canReviewCorrections: canReview,
  };
  const sectorOptions =
    session.user.role === "admin"
      ? allSectors.map((sector) => ({
          slug: sector.slug,
          displayName: sector.displayName,
          agentName: sector.agentName,
          isNative: sector.isNative,
        }))
      : [
          {
            slug: session.user.sector,
            displayName: getSectorLabel(session.user.sector),
            agentName: getSectorLabel(session.user.sector),
            isNative: true,
          },
        ];

  return (
    <SecureAppShell
      currentPage="files"
      description="Arquivos enviados aqui passam por uma revisao antes de entrar no chat do setor."
      title="Ingestao de arquivos"
      user={user}
    >
      <SectorIngestionWorkbench sectorOptions={sectorOptions} user={user} />
    </SecureAppShell>
  );
}
