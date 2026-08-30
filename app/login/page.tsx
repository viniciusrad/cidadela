import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { LoginForm } from "@/components/login-form";

export default async function LoginPage() {
  const session = await auth();

  if (session?.user) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-6 py-10 sm:px-8">
      <div className="grid w-full gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="premium-panel rounded-[2rem] p-8 lg:p-12">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-[var(--accent)]">
            Cidadela
          </p>
          <h1 className="mt-4 text-4xl font-black leading-tight text-[var(--foreground-strong)]">
            A inteligencia operacional da sua empresa, por setor e com auditoria.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--foreground-soft)]">
            Cada setor tem seu agente, todo conhecimento importante fica rastreavel
            e as respostas mostram de onde vieram.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-[var(--border)] bg-white/90 p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                Setores
              </p>
              <p className="mt-3 text-xl font-black text-[var(--foreground-strong)]">
                3 agentes
              </p>
              <p className="mt-2 text-sm text-[var(--foreground-soft)]">
                Desenvolvimento, Seguranca e Suporte.
              </p>
            </div>
            <div className="rounded-3xl border border-[var(--border)] bg-white/90 p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                Historico
              </p>
              <p className="mt-3 text-xl font-black text-[var(--foreground-strong)]">
                Auditavel
              </p>
              <p className="mt-2 text-sm text-[var(--foreground-soft)]">
                Conversas, encaminhamentos e decisoes registrados.
              </p>
            </div>
            <div className="rounded-3xl border border-[var(--border)] bg-white/90 p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                Encaminhamento
              </p>
              <p className="mt-3 text-xl font-black text-[var(--foreground-strong)]">
                Entre agentes
              </p>
              <p className="mt-2 text-sm text-[var(--foreground-soft)]">
                Quando precisa de outra area, o agente certo e consultado.
              </p>
            </div>
          </div>
        </section>

        <section className="premium-panel rounded-[2rem] p-8 lg:p-10">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-[var(--accent)]">
            Login
          </p>
          <h2 className="mt-3 text-2xl font-black text-[var(--foreground-strong)]">
            Acesso controlado por usuarios de referencia.
          </h2>
          <p className="mt-3 text-sm leading-6 text-[var(--foreground-soft)]">
            Entre com um usuario do arquivo de referencia seedado no banco. O
            setor do usuario define qual agente atende e quais documentos ele
            pode consultar diretamente.
          </p>

          <div className="mt-6 rounded-3xl border border-[var(--border)] bg-[var(--surface-soft)] p-6">
            <LoginForm />
          </div>

          <div className="mt-6 rounded-3xl border border-[var(--border)] bg-white/80 p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
              Credenciais seed
            </p>
            <div className="mt-3 space-y-2 text-sm text-[var(--foreground-soft)]">
              <p>`dev@cidadela.local` / `dev123`</p>
              <p>`sec@cidadela.local` / `sec123`</p>
              <p>`suporte@cidadela.local` / `sup123`</p>
              <p>`admin@cidadela.local` / `admin123`</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
