import Link from "next/link";
import { ArrowRight, MessageCircle } from "lucide-react";

import type { Sector } from "@/lib/domain";
import { PERSONA_LABELS, SECTOR_LABELS } from "@/lib/labels";
import type { Salutation } from "@/lib/dashboard/greeting";

export function DashboardHero({
  name,
  sector,
  salutation,
}: {
  name: string;
  sector: Sector;
  salutation: Salutation;
}) {
  const persona = PERSONA_LABELS[sector];
  const sectorLabel = SECTOR_LABELS[sector];

  return (
    <section className="premium-panel mb-6 overflow-hidden rounded-lg p-6 sm:p-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
            Painel inicial
          </p>
          <h2 className="mt-2 text-2xl font-black leading-tight text-[var(--foreground-strong)] sm:text-3xl">
            {salutation}, {name}.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--foreground-soft)]">
            Voce esta no setor <strong className="text-[var(--foreground-strong)]">{sectorLabel}</strong>.{" "}
            Fale com <strong className="text-[var(--foreground-strong)]">{persona}</strong>, o agente da sua area,
            ou explore o que mais o Secure Agents oferece logo abaixo.
          </p>
        </div>

        <Link
          className="group inline-flex shrink-0 items-center gap-3 self-start rounded-2xl bg-[var(--accent)] px-6 py-4 text-base font-black text-white shadow-lg shadow-[var(--accent-soft)] transition-all hover:bg-[var(--accent-strong)] hover:shadow-xl lg:self-auto"
          href="/chat"
        >
          <MessageCircle aria-hidden="true" className="h-5 w-5" />
          <span>Conversar com {persona}</span>
          <ArrowRight
            aria-hidden="true"
            className="h-5 w-5 transition-transform group-hover:translate-x-1"
          />
        </Link>
      </div>
    </section>
  );
}
