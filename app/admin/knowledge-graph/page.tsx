import Link from "next/link";
import { UserCog } from "lucide-react";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { GraphKnowledgePanel } from "@/components/graph-knowledge-panel";
import { SecureAppShell } from "@/components/secure-app-shell";

export default async function KnowledgeGraphPage() {
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
      currentPage="knowledgeGraph"
      description="Veja como conceitos, sistemas e regulamentacoes dos seus documentos se conectam e descubra o que ainda falta mapear."
      title="Mapa do conhecimento"
      user={user}
    >
      <div className="space-y-4">
        <Link
          className="group flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm transition-colors hover:border-[var(--accent)]"
          href="/admin/people-reclassify"
        >
          <span className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
              <UserCog aria-hidden="true" className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
                Manutencao episodica
              </span>
              <span className="mt-1 block text-sm font-bold text-[var(--foreground-strong)]">
                Reclassificar pessoas mencionadas como sistema, conceito ou regulamentacao
              </span>
            </span>
          </span>
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--accent-strong)] group-hover:underline">
            Abrir
          </span>
        </Link>
        <GraphKnowledgePanel />
      </div>
    </SecureAppShell>
  );
}
