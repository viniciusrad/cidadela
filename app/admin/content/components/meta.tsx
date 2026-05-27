export function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <dt className="text-[9px] font-black uppercase tracking-[0.15em] text-[var(--muted)]">
        {label}
      </dt>
      <dd
        className={`text-[var(--foreground-strong)] leading-tight ${mono ? "font-mono break-all text-[10px]" : "text-[12px] font-bold"}`}
      >
        {value}
      </dd>
    </div>
  );
}
