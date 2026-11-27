"use client";

import { useActionState } from "react";
import { authenticate } from "../app/actions";

export default function AdminAccess({ setup }: { setup: boolean }) {
  const [error, submit, pending] = useActionState(authenticate, "");

  return (
    <main className="access-page">
      <section className="access-card">
        <div className="brand"><span className="brand-mark">g.</span><span>gatu.digital</span></div>
        <h1>{setup ? "Crie seu acesso administrativo" : "Entre no Agendador"}</h1>
        <form action={submit}>
          <input type="hidden" name="mode" value={setup ? "setup" : "login"}/>
          <label className="field">E-mail
            <input name="email" type="email" autoComplete="username" maxLength={254} required/>
          </label>
          <label className="field">Senha
            <input name="password" type="password" autoComplete={setup ? "new-password" : "current-password"}
              minLength={setup ? 12 : undefined} maxLength={128} required/>
            {setup && <small>Mínimo de 12 caracteres.</small>}
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button primary" type="submit" disabled={pending}>
            {pending ? "Aguarde…" : setup ? "Criar acesso" : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}
