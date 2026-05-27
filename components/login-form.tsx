"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  type LoginActionState,
  loginAction,
} from "@/app/login/actions";

const initialState: LoginActionState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="w-full rounded-2xl bg-[var(--accent)] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? "Entrando..." : "Entrar"}
    </button>
  );
}

export function LoginForm() {
  const [state, action] = useActionState(loginAction, initialState);

  return (
    <form action={action} className="space-y-4">
      <div>
        <label
          className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]"
          htmlFor="email"
        >
          Email
        </label>
        <input
          className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--accent)]"
          id="email"
          name="email"
          placeholder="dev@pfrm.local"
          type="email"
          required
        />
      </div>

      <div>
        <label
          className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]"
          htmlFor="password"
        >
          Senha
        </label>
        <input
          className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--accent)]"
          id="password"
          name="password"
          placeholder="••••••••"
          type="password"
          required
        />
      </div>

      {state.error ? (
        <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-[var(--danger)]">
          {state.error}
        </div>
      ) : null}

      <SubmitButton />
    </form>
  );
}
