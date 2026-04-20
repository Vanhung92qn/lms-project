import { WorkspacePlayer } from './WorkspacePlayer';

// Thin server wrapper — the real workspace is client-only because it
// hosts Monaco + live state. The server shell just forwards params.
export default async function LessonPlayerPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string; lessonId: string }>;
}) {
  const { slug, lessonId } = await params;
  return <WorkspacePlayer slug={slug} lessonId={lessonId} />;
}
