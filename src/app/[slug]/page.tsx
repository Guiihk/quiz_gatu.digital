import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { QuizFlow } from "../../components/quiz-flow";
import { readPublication } from "../../lib/local-store";
import { parseCampaignSource, parseConfig } from "../../lib/quiz";
import { validMetaClickId } from "../../lib/meta-tracking";

export const dynamic = "force-dynamic";

export default async function PublicQuizPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,70}$/.test(slug)) notFound();
  const publication = readPublication(slug);
  if (!publication) notFound();
  const config = parseConfig(JSON.parse(publication.config));
  if (!config) notFound();
  const query = await searchParams;
  const fbclid = validMetaClickId(query.fbclid);

  return <main className="public-quiz">
    <div className="public-quiz-frame">
      <QuizFlow config={config} publication={{ slug, revision: publication.revision, responseId: randomUUID(),
        source: parseCampaignSource(query), click: fbclid ? { fbclid, seenAt: Date.now() } : undefined }}/>
    </div>
  </main>;
}
