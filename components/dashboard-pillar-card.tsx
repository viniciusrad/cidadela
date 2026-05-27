import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

type PillarAccent = "operation" | "knowledge" | "automation" | "agents" | "quality";

const ACCENT_STYLES: Record<
  PillarAccent,
  { ring: string; iconBg: string; iconColor: string }
> = {
  operation: {
    ring: "border-[var(--border)] hover:border-[var(--accent)]",
    iconBg: "bg-[var(--accent-soft)]",
    iconColor: "text-[var(--accent-strong)]",
  },
  knowledge: {
    ring: "border-[var(--border)] hover:border-emerald-400",
    iconBg: "bg-emerald-50",
    iconColor: "text-emerald-700",
  },
  automation: {
    ring: "border-[var(--border)] hover:border-sky-400",
    iconBg: "bg-sky-50",
    iconColor: "text-sky-700",
  },
  agents: {
    ring: "border-[var(--border)] hover:border-amber-400",
    iconBg: "bg-amber-50",
    iconColor: "text-amber-700",
  },
  quality: {
    ring: "border-[var(--border)] hover:border-rose-400",
    iconBg: "bg-rose-50",
    iconColor: "text-rose-700",
  },
};

export function DashboardPillarCard({
  title,
  description,
  href,
  metric,
  bullets,
  icon: Icon,
  accent,
  interactive = true,
}: {
  title: string;
  description: string;
  href?: string;
  metric?: { label: string; value: string | number };
  bullets?: string[];
  icon: LucideIcon;
  accent: PillarAccent;
  interactive?: boolean;
}) {
  const styles = ACCENT_STYLES[accent];

  const content = (
    <div
      className={`group flex h-full flex-col gap-4 rounded-[1.75rem] border bg-white p-5 transition-all sm:p-6 ${
        interactive ? `${styles.ring} hover:shadow-lg` : "border-[var(--border)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${styles.iconBg} ${styles.iconColor}`}
        >
          <Icon aria-hidden="true" className="h-5 w-5" />
        </span>
        {metric && (
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
              {metric.label}
            </p>
            <p className="text-2xl font-black text-[var(--foreground-strong)]">
              {metric.value}
            </p>
          </div>
        )}
      </div>

      <div className="flex-1">
        <h3 className="text-lg font-black text-[var(--foreground-strong)]">
          {title}
        </h3>
        <p className="mt-1 text-sm leading-6 text-[var(--foreground-soft)]">
          {description}
        </p>
        {bullets && bullets.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {bullets.map((bullet) => (
              <li
                className="flex items-start gap-2 text-xs leading-5 text-[var(--foreground-soft)]"
                key={bullet}
              >
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]"
                />
                {bullet}
              </li>
            ))}
          </ul>
        )}
      </div>

      {interactive && href && (
        <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.16em] text-[var(--accent-strong)]">
          Abrir
          <ArrowRight
            aria-hidden="true"
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1"
          />
        </div>
      )}
    </div>
  );

  if (interactive && href) {
    return (
      <Link className="block h-full" href={href}>
        {content}
      </Link>
    );
  }

  return content;
}
