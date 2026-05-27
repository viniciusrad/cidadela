"use client";

import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { useState } from "react";

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function NotificationsList({
  initialItems,
}: {
  initialItems: NotificationItem[];
}) {
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState(false);

  const unreadCount = items.filter((item) => !item.readAt).length;

  async function markRead(id: string) {
    setItems((current) =>
      current.map((item) =>
        item.id === id && !item.readAt
          ? { ...item, readAt: new Date().toISOString() }
          : item,
      ),
    );
    await fetch("/api/me/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }

  async function markAll() {
    setBusy(true);
    const now = new Date().toISOString();
    setItems((current) =>
      current.map((item) => (item.readAt ? item : { ...item, readAt: now })),
    );
    await fetch("/api/me/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
    setBusy(false);
  }

  if (items.length === 0) {
    return (
      <section className="premium-panel rounded-lg p-6">
        <p className="text-sm text-[var(--foreground-soft)]">
          Voce ainda nao tem notificacoes.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-[var(--foreground-soft)]">
          {unreadCount} nao lida{unreadCount === 1 ? "" : "s"}
        </p>
        {unreadCount > 0 ? (
          <button
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-[var(--accent)] disabled:opacity-50"
            disabled={busy}
            onClick={markAll}
            type="button"
          >
            <CheckCheck aria-hidden="true" className="h-4 w-4" />
            Marcar todas como lidas
          </button>
        ) : null}
      </div>

      <ul className="space-y-2">
        {items.map((item) => {
          const isUnread = !item.readAt;
          return (
            <li
              className={`rounded-lg border p-4 ${
                isUnread
                  ? "border-[var(--accent)] bg-[var(--surface-muted)]"
                  : "border-[var(--border)] bg-white"
              }`}
              key={item.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-black text-[var(--foreground-strong)]">
                    {item.title}
                  </p>
                  <p className="mt-1 text-sm text-[var(--foreground-soft)]">
                    {item.body}
                  </p>
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                    {formatDate(item.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {item.href ? (
                    <Link
                      className="rounded-md bg-[var(--accent)] px-3 py-2 text-xs font-black text-white"
                      href={item.href}
                      onClick={() => markRead(item.id)}
                    >
                      Abrir
                    </Link>
                  ) : null}
                  {isUnread ? (
                    <button
                      className="rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-xs font-bold text-[var(--foreground-soft)]"
                      onClick={() => markRead(item.id)}
                      type="button"
                    >
                      Marcar lida
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
