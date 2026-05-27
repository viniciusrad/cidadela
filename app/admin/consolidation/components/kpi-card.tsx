export function KpiCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "alert" | "success";
}) {
  return (
    <div
      className={`rounded-[1.75rem] border px-5 py-4 ${
        tone === "alert"
          ? "border-rose-200 bg-rose-50"
          : tone === "success"
            ? "border-emerald-200 bg-emerald-50"
            : "border-[var(--border)] bg-white"
      }`}
    >
      <p className="flex items-center text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-2 text-3xl font-black text-[var(--foreground-strong)]">
        {value}
      </p>
    </div>
  );
}
