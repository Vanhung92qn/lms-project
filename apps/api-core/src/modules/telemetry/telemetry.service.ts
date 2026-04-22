import { Injectable, Logger } from '@nestjs/common';
import { MongoService } from './mongo.service';

/**
 * Thin write-only API over the telemetry collections. Every call is
 * try/catch'd and swallows errors — telemetry is best-effort and must
 * never break the student's flow. We log at warn level so Grafana can
 * alert on failure rates without paging.
 */
@Injectable()
export class TelemetryService {
  private readonly log = new Logger(TelemetryService.name);

  constructor(private readonly mongo: MongoService) {}

  /**
   * Append a tutor turn (one user message + one assistant reply) to the
   * student's chat session for this lesson. Creates the session document
   * on first append; updates `messages` + `lastActivityAt` on subsequent.
   */
  async appendChat(params: {
    userId: string;
    lessonId: string | null;
    provider: 'llama' | 'deepseek';
    locale: 'vi' | 'en';
    userMessage: string;
    assistantMessage: string;
  }): Promise<void> {
    const col = this.mongo.aiChats;
    if (!col) return;
    try {
      const now = new Date();
      await col.updateOne(
        { userId: params.userId, lessonId: params.lessonId ?? null },
        {
          $setOnInsert: {
            schemaVersion: 1,
            userId: params.userId,
            lessonId: params.lessonId ?? null,
            locale: params.locale,
            startedAt: now,
          },
          $set: {
            provider: params.provider,
            lastActivityAt: now,
          },
          $push: {
            messages: {
              $each: [
                { role: 'user', content: params.userMessage, at: now },
                { role: 'assistant', content: params.assistantMessage, at: now },
              ],
            },
          },
        },
        { upsert: true },
      );
    } catch (e) {
      this.log.warn(`appendChat failed: ${(e as Error).message}`);
    }
  }

  /**
   * Persist an editor autosave. The client throttles to ~one snapshot per
   * 30s; no throttling on the server side. TTL index drops documents past
   * 14 days to keep the collection bounded.
   */
  async saveSnapshot(params: {
    userId: string;
    lessonId: string;
    language: string;
    source: string;
  }): Promise<void> {
    const col = this.mongo.codeSnapshots;
    if (!col) return;
    try {
      await col.insertOne({
        schemaVersion: 1,
        userId: params.userId,
        lessonId: params.lessonId,
        language: params.language,
        // Hard cap at 32 KB — submissions themselves cap at 16 KB in the
        // sandbox DTO. Anything longer is almost certainly pasted noise.
        source: params.source.slice(0, 32_000),
        snapshotAt: new Date(),
      });
    } catch (e) {
      this.log.warn(`saveSnapshot failed: ${(e as Error).message}`);
    }
  }

  /**
   * Record a learning event. Generic so the frontend can evolve the set of
   * events it fires without server changes. `metadata` is an opaque object
   * — data-science projects the fields it cares about.
   */
  async recordEvent(params: {
    userId: string;
    lessonId: string | null;
    event: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const col = this.mongo.learningEvents;
    if (!col) return;
    try {
      await col.insertOne({
        schemaVersion: 1,
        userId: params.userId,
        lessonId: params.lessonId ?? null,
        event: params.event.slice(0, 64),
        metadata: params.metadata ?? {},
        at: new Date(),
      });
    } catch (e) {
      this.log.warn(`recordEvent failed: ${(e as Error).message}`);
    }
  }

  // ---- Read helpers (P9.1 Teacher Insight) --------------------------------
  //
  // The teacher-insight endpoints aggregate ai_chats to show the most
  // frequent / most recent student questions in a course. We expose a thin
  // read method here rather than injecting MongoService directly into the
  // teacher module so the "every Mongo access goes through telemetry"
  // invariant stays.

  /**
   * Return the most-recent user questions across a set of lessons, flattened
   * out of the per-session ai_chats documents. Each row represents one user
   * turn with its matching lesson id so the caller can join against
   * Postgres lesson titles. Returns [] when Mongo is offline.
   */
  async recentUserQuestions(
    lessonIds: string[],
    sinceDays = 30,
    limit = 20,
  ): Promise<
    Array<{
      lessonId: string | null;
      userId: string;
      provider: string;
      question: string;
      at: Date;
    }>
  > {
    const col = this.mongo.aiChats;
    if (!col || lessonIds.length === 0) return [];
    try {
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
      const rows = await col
        .find({ lessonId: { $in: lessonIds }, lastActivityAt: { $gte: since } })
        .project({ userId: 1, lessonId: 1, provider: 1, messages: 1, lastActivityAt: 1 })
        .sort({ lastActivityAt: -1 })
        .limit(80) // 4 docs worth of turns ≈ 80 messages; trimmed after flatten
        .toArray();

      const out: Array<{
        lessonId: string | null;
        userId: string;
        provider: string;
        question: string;
        at: Date;
      }> = [];
      for (const doc of rows) {
        const messages = (doc as unknown as { messages?: Array<{ role: string; content: string; at: Date }> }).messages ?? [];
        for (const m of messages) {
          if (m.role !== 'user') continue;
          if (!m.content?.trim()) continue;
          out.push({
            lessonId: (doc as unknown as { lessonId: string | null }).lessonId ?? null,
            userId: (doc as unknown as { userId: string }).userId,
            provider: (doc as unknown as { provider: string }).provider,
            question: m.content.trim().slice(0, 500),
            at: m.at,
          });
        }
      }
      // Newest first, capped at `limit`.
      out.sort((a, b) => (b.at.getTime?.() ?? 0) - (a.at.getTime?.() ?? 0));
      return out.slice(0, limit);
    } catch (e) {
      this.log.warn(`recentUserQuestions failed: ${(e as Error).message}`);
      return [];
    }
  }
}
