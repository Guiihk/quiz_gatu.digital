"use client";

import { useState } from "react";
import { ArrowRight, FileText, Plus } from "@phosphor-icons/react";

export type QuizSummary = {
  id: number;
  name: string;
  revision: number;
  slug: string | null;
  publishedRevision: number | null;
};

export default function QuizLibrary({ quizzes, busy, onOpen, onCreate }: {
  quizzes: QuizSummary[];
  busy: boolean;
  onOpen: (id: number) => void;
  onCreate: (name: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  return <>
    <div className="page-heading">
      <div><h1>Quizzes</h1><p>Crie e publique páginas de captação com links independentes.</p></div>
      <button type="button" className="button primary" disabled={busy} aria-expanded={creating}
        aria-controls="create-quiz" onClick={() => setCreating(value => !value)}><Plus size={18}/> Novo quiz</button>
    </div>
    {creating && <form className="quiz-create-form" id="create-quiz" onSubmit={event => {
      event.preventDefault();
      if (name.trim() && !busy) onCreate(name.trim());
    }}>
      <label className="field">Nome do quiz
        <input value={name} maxLength={120} required autoFocus disabled={busy}
          onChange={event => setName(event.target.value)} />
      </label>
      <button type="submit" className="button primary" disabled={!name.trim() || busy}>Criar quiz</button>
      <button type="button" className="button secondary" disabled={busy} onClick={() => setCreating(false)}>Cancelar</button>
    </form>}
    {busy && <p className="muted" role="status">Abrindo o editor…</p>}
    <ul className="quiz-library" aria-label="Quizzes da gatu.digital">
      {quizzes.map(quiz => <li className="quiz-library-item" key={quiz.id}>
        <div className="quiz-library-name">
          <span className="quiz-library-icon"><FileText size={20} aria-hidden="true"/></span>
          <div><h2>{quiz.name}</h2>{quiz.slug && <p><code>/{quiz.slug}</code></p>}</div>
        </div>
        <span className={quiz.slug ? "badge green" : "badge"}>{!quiz.slug ? "Rascunho"
          : quiz.publishedRevision !== quiz.revision ? "Publicado · rascunho atualizado" : "Publicado"}</span>
        <div className="quiz-library-actions">
          {quiz.slug && <a className="button secondary" href={`/${quiz.slug}`} target="_blank" rel="noopener noreferrer"
            aria-label={`Abrir página pública de ${quiz.name}`}>Ver página</a>}
          <button type="button" className="button secondary" disabled={busy} onClick={() => onOpen(quiz.id)}
            aria-label={`Editar ${quiz.name}`}>Editar <ArrowRight size={15} aria-hidden="true"/></button>
        </div>
      </li>)}
    </ul>
  </>;
}
