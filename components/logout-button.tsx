import { signOut } from "@/auth";
import { LogOut } from "lucide-react";

export function LogoutButton({ compact = false }: { compact?: boolean }) {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button
        className={`inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-white text-xs font-bold uppercase tracking-[0.14em] text-[var(--foreground-soft)] transition-colors hover:border-[var(--accent)] hover:text-[var(--foreground-strong)] ${
          compact ? "h-10 w-10 px-0" : "w-full px-4 py-2.5"
        }`}
        title="Sair"
        type="submit"
      >
        <LogOut aria-hidden="true" className="h-4 w-4" />
        <span className={compact ? "sr-only" : undefined}>Sair</span>
      </button>
    </form>
  );
}
