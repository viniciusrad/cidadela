"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useEffect, useState } from "react";

type PendencyPayload = {
  counts: {
    total: number;
  };
};

export function PendenciesBadge() {
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/me/pendencies")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: PendencyPayload | null) => {
        if (!cancelled) {
          setTotal(payload?.counts.total ?? 0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTotal(0);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const displayTotal = total ?? 0;

  return (
    <Link
      aria-label={`Pendencias: ${displayTotal}`}
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] bg-white text-[var(--foreground-soft)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
      href="/me/pendencias"
      title="Pendencias"
    >
      <Bell aria-hidden="true" className="h-4 w-4" />
      {displayTotal > 0 ? (
        <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-rose-600 px-1.5 py-0.5 text-center text-[10px] font-black leading-none text-white">
          {displayTotal > 99 ? "99+" : displayTotal}
        </span>
      ) : null}
    </Link>
  );
}
