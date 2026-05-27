"use client";

import { Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function InfoTooltip({ text }: { text: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative inline-block ml-1.5 align-middle" ref={containerRef}>
      <button
        className={`flex items-center justify-center rounded-full transition-colors ${
          isOpen ? "text-[var(--accent)] bg-[var(--accent-soft)]" : "text-[var(--muted)] hover:text-[var(--accent)]"
        }`}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        type="button"
      >
        <Info className="h-3.5 w-3.5" />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-1/2 mb-2 w-56 -translate-x-1/2 rounded-xl border border-[var(--border)] bg-white p-3 text-xs font-medium leading-relaxed text-[var(--foreground-soft)] shadow-xl animate-in fade-in zoom-in duration-200 z-[100]">
          {text}
          <div className="absolute top-full left-1/2 -mt-1 h-2 w-2 -translate-x-1/2 rotate-45 border-b border-r border-[var(--border)] bg-white"></div>
        </div>
      )}
    </div>
  );
}
