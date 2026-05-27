import Link from "next/link";

export type TabCountTone = "default" | "alert" | "success" | "info";

export type TabDef = {
  key: string;
  label: string;
  href: string;
  description?: string;
  count?: number;
  countTone?: TabCountTone;
};

const COUNT_TONE_CLASS: Record<TabCountTone, string> = {
  default: "bg-slate-100 text-slate-600",
  alert: "bg-amber-100 text-amber-800",
  success: "bg-emerald-100 text-emerald-700",
  info: "bg-cyan-100 text-cyan-700",
};

export function TabNav({
  tabs,
  activeKey,
}: {
  tabs: TabDef[];
  activeKey: string;
}) {
  return (
    <div className="premium-panel rounded-[2rem] p-2">
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab) => {
          const isActive = tab.key === activeKey;
          const tone = COUNT_TONE_CLASS[tab.countTone ?? "default"];

          return (
            <Link
              aria-current={isActive ? "page" : undefined}
              className={`rounded-[1.5rem] px-5 py-4 text-left transition-colors ${
                isActive
                  ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                  : "text-[var(--foreground-soft)] hover:bg-white/70 hover:text-[var(--foreground-strong)]"
              }`}
              href={tab.href}
              key={tab.key}
            >
              <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.24em]">
                {tab.label}
                {typeof tab.count === "number" && tab.count > 0 ? (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${tone}`}>
                    {tab.count}
                  </span>
                ) : null}
              </span>
              {tab.description ? (
                <span className="mt-1 block text-sm font-semibold">
                  {tab.description}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
