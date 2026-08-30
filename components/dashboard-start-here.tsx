import Link from "next/link";
import { ArrowRight, Compass, type LucideIcon, ClipboardCheck, MessageCircle, FileUp, Workflow, Bot, MessageSquareWarning } from "lucide-react";

import type { Sector, UserRole } from "@/lib/domain";
import { PERSONA_LABELS } from "@/lib/labels";

type Step = {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
};

function adminSteps(): Step[] {
  return [
    {
      label: "Revise a curadoria pendente",
      description:
        "Aprove, ajuste ou rejeite documentos em revisao antes que cheguem ao chat.",
      href: "/admin/curation",
      icon: ClipboardCheck,
    },
    {
      label: "Acompanhe gaps de processo",
      description:
        "Veja onde a documentacao tem lacunas e direcione respostas que enriquecem a base.",
      href: "/admin/process-automation-map",
      icon: Workflow,
    },
    {
      label: "Verifique correcoes sugeridas",
      description:
        "Sugestoes dos usuarios para trechos citados aguardam revisao por setor.",
      href: "/admin/governance?tab=corrections",
      icon: MessageSquareWarning,
    },
  ];
}

function userSteps(persona: string): Step[] {
  return [
    {
      label: `Pergunte ao ${persona}`,
      description:
        "Faca uma pergunta em linguagem natural. Quando o assunto envolve outra area, o agente busca a resposta certa.",
      href: "/chat",
      icon: MessageCircle,
    },
    {
      label: "Suba documentos do seu setor",
      description:
        "Mande PDFs, .docx ou Markdown. Eles passam por curadoria antes de aparecer nas respostas.",
      href: "/files",
      icon: FileUp,
    },
    {
      label: "Marque respostas e proponha ajustes",
      description:
        "Use o joinha bom/ruim no chat e proponha correcoes diretamente em trechos citados.",
      href: "/chat",
      icon: Bot,
    },
  ];
}

export function DashboardStartHere({
  role,
  sector,
}: {
  role: UserRole;
  sector: Sector;
}) {
  const steps = role === "admin" ? adminSteps() : userSteps(PERSONA_LABELS[sector]);
  const heading = role === "admin" ? "Por onde governar hoje" : "Comece por aqui";
  const intro =
    role === "admin"
      ? "Tres acoes que costumam mover a barra: validar conteudo novo, mapear o que falta e reagir ao feedback dos usuarios."
      : "Tres formas rapidas de extrair valor da Cidadela no dia a dia.";

  return (
    <section className="premium-panel mb-6 rounded-lg p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
          <Compass aria-hidden="true" className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-base font-black text-[var(--foreground-strong)]">
            {heading}
          </h3>
          <p className="text-xs text-[var(--foreground-soft)]">{intro}</p>
        </div>
      </div>

      <ol className="mt-5 grid gap-3 sm:grid-cols-3">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <li key={step.label}>
              <Link
                className="group flex h-full flex-col gap-2 rounded-2xl border border-[var(--border)] bg-white p-4 transition-all hover:border-[var(--accent)] hover:shadow-md"
                href={step.href}
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[10px] font-black text-[var(--accent-strong)]">
                    {index + 1}
                  </span>
                  <Icon
                    aria-hidden="true"
                    className="h-4 w-4 text-[var(--muted)]"
                  />
                </div>
                <p className="text-sm font-black text-[var(--foreground-strong)]">
                  {step.label}
                </p>
                <p className="flex-1 text-xs leading-5 text-[var(--foreground-soft)]">
                  {step.description}
                </p>
                <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-[var(--accent-strong)]">
                  Abrir
                  <ArrowRight
                    aria-hidden="true"
                    className="h-3 w-3 transition-transform group-hover:translate-x-1"
                  />
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
