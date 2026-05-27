"use client";

import Link from "next/link";
import { BellRing } from "lucide-react";
import { useEffect, useState } from "react";

type NotificationsPayload = {
  unreadCount: number;
};

export function NotificationsBadge() {
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/me/notifications")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: NotificationsPayload | null) => {
        if (!cancelled) {
          setUnread(payload?.unreadCount ?? 0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUnread(0);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const displayUnread = unread ?? 0;

  return (
    <Link
      aria-label={`Notificacoes: ${displayUnread} nao lidas`}
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] bg-white text-[var(--foreground-soft)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
      href="/me/notificacoes"
      title="Notificacoes"
    >
      <BellRing aria-hidden="true" className="h-4 w-4" />
      {displayUnread > 0 ? (
        <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-center text-[10px] font-black leading-none text-white">
          {displayUnread > 99 ? "99+" : displayUnread}
        </span>
      ) : null}
    </Link>
  );
}
