import Workspace from "../components/workspace";
import AdminAccess from "../components/admin-access";
import { hasAdmin, listQuizDrafts } from "../lib/local-store";
import { DEFAULT_CONFIG } from "../lib/quiz";
import { isSignedIn } from "./actions";

export default async function Page({ searchParams }: { searchParams: Promise<{ agenda?: string; google?: string }> }) {
  if (!(await isSignedIn())) {
    const configured = hasAdmin();
    if (!configured && process.env.NODE_ENV !== "development") {
      return <main className="access-page"><section className="access-card"><h1>Acesso administrativo indisponível</h1><p>O administrador ainda precisa ser configurado.</p></section></main>;
    }
    return <AdminAccess setup={!configured} />;
  }

  const quizzes = listQuizDrafts().map(quiz => ({ ...quiz, name: quiz.name || DEFAULT_CONFIG.name }));
  if (!quizzes.some(quiz => quiz.id === 1)) {
    quizzes.unshift({ id: 1, name: DEFAULT_CONFIG.name, revision: 0, slug: null, publishedRevision: null });
  }
  const query = await searchParams;
  return <Workspace initialQuizzes={quizzes}
    initialAgenda={query.agenda === "1"} googleConnectionError={query.google === "error"}/>;
}
