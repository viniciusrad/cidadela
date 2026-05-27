"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

type NavGroup = "operation" | "knowledge" | "governance";

type NavLink = {
  key: string;
  href: string;
  label: string;
  description: string;
  group: NavGroup;
  icon: ReactNode;
};

type NavGroupDef = {
  key: NavGroup;
  label: string;
};

export function SidebarNav({
  currentPage,
  links,
  groups,
}: {
  currentPage: string;
  links: NavLink[];
  groups: NavGroupDef[];
}) {
  const activeGroup = links.find((l) => l.key === currentPage)?.group;

  const [expanded, setExpanded] = useState<Record<NavGroup, boolean>>(
    () =>
      Object.fromEntries(
        groups.map((g) => [g.key, g.key === activeGroup || activeGroup === undefined]),
      ) as Record<NavGroup, boolean>,
  );

  function toggle(key: NavGroup) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <nav className="mt-6 flex flex-1 flex-col gap-3 overflow-y-auto pr-1">
      {groups.map((group) => {
        const groupLinks = links.filter((l) => l.group === group.key);
        if (groupLinks.length === 0) return null;

        const isOpen = expanded[group.key];
        const hasActive = groupLinks.some((l) => l.key === currentPage);

        return (
          <section key={group.key} aria-labelledby={`nav-${group.key}`}>
            <button
              aria-controls={`nav-items-${group.key}`}
              aria-expanded={isOpen}
              className={`group/header flex w-full items-center justify-between rounded-lg px-3 py-1.5 transition-colors hover:bg-[var(--surface-muted)] ${
                hasActive && !isOpen
                  ? "text-[var(--accent)]"
                  : "text-[var(--muted)]"
              }`}
              id={`nav-${group.key}`}
              onClick={() => toggle(group.key)}
              type="button"
            >
              <span className="text-[10px] font-black uppercase tracking-[0.22em]">
                {group.label}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={`h-3 w-3 shrink-0 transition-transform duration-300 ${
                  isOpen ? "rotate-0" : "-rotate-90"
                }`}
              />
            </button>

            <div
              className="grid transition-[grid-template-rows] duration-300 ease-in-out"
              id={`nav-items-${group.key}`}
              style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
            >
              <div className="overflow-hidden">
                <div className="mt-1 space-y-1 pb-1">
                  {groupLinks.map((link) => {
                    const isActive = link.key === currentPage;

                    return (
                      <Link
                        aria-current={isActive ? "page" : undefined}
                        className={`group flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                          isActive
                            ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--foreground-strong)]"
                            : "border-transparent text-[var(--foreground-soft)] hover:border-[var(--border)] hover:bg-white"
                        }`}
                        href={link.href}
                        key={link.key}
                      >
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                            isActive
                              ? "bg-[var(--accent)] text-white"
                              : "bg-[var(--surface-muted)] text-[var(--foreground-soft)] group-hover:text-[var(--accent)]"
                          }`}
                        >
                          {link.icon}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-black">
                            {link.label}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] font-medium text-[var(--muted)]">
                            {link.description}
                          </span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        );
      })}
    </nav>
  );
}
