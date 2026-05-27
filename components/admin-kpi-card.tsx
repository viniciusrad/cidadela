"use client";

import type { ComponentType } from "react";

export function KpiCard({
  label,
  value,
  description,
  tone = "default",
  icon: Icon,
}: {
  label: string;
  value: number | string;
  description?: string;
  tone?: "default" | "alert" | "success" | "info";
  icon?: ComponentType<{ className?: string }>;
}) {
  return (
    <div
      className={`rounded-[1.75rem] border px-5 py-4 ${
        tone === "alert"
          ? "border-rose-200 bg-rose-50"
          : tone === "success"
            ? "border-emerald-200 bg-emerald-50"
            : tone === "info"
              ? "border-sky-200 bg-sky-50"
              : "border-[var(--border)] bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
          {label}
        </p>
        {Icon && <Icon className="h-3.5 w-3.5 text-[var(--muted)]" />}
      </div>
      <p className={`mt-2 text-3xl font-black ${
        tone === "alert" ? "text-rose-800" :
        tone === "success" ? "text-emerald-800" :
        tone === "info" ? "text-sky-800" :
        "text-[var(--foreground-strong)]"
      }`}>
        {value}
      </p>
      {description && (
        <p className="mt-1 text-[10px] leading-relaxed text-[var(--foreground-soft)]">
          {description}
        </p>
      )}
    </div>
  );
}
