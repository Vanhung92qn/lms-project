/**
 * Client-side telemetry helpers. Every call is fire-and-forget: we never
 * block a student's flow on whether Mongo acknowledged a write. The
 * browser stops firing these helpers when offline because `fetch` will
 * reject — we intentionally swallow that.
 *
 * Endpoints map 1:1 to apps/api-core/src/modules/telemetry/telemetry.controller.ts.
 */

const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'
).replace(/\/$/, '');

function token(): string | null {
  try {
    return sessionStorage.getItem('lms-access');
  } catch {
    return null;
  }
}

async function post(path: string, body: unknown): Promise<void> {
  const tok = token();
  if (!tok) return;
  try {
    // keepalive so a fetch fired during `beforeunload` still flushes.
    await fetch(`${API_BASE}/telemetry/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tok}`,
      },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    /* swallow — telemetry is best-effort */
  }
}

export const telemetry = {
  event(event: string, lessonId: string | null, metadata?: Record<string, unknown>): void {
    void post('event', { event, lesson_id: lessonId ?? undefined, metadata });
  },
  snapshot(lessonId: string, language: string, source: string): void {
    if (!source.trim()) return;
    void post('snapshot', { lesson_id: lessonId, language, source });
  },
};
