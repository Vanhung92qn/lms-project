import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Collection, Db, MongoClient } from 'mongodb';

/**
 * Shape of documents persisted to each telemetry collection. Kept loose on
 * purpose — the data-science service is the real consumer and it iterates
 * with `find()` cursors, so we avoid compile-time schema churn here. Add a
 * `schemaVersion` field on every write so we can migrate later without a
 * one-shot backfill.
 */
export interface AiChatDoc {
  schemaVersion: 1;
  userId: string;
  lessonId: string | null;
  provider: 'llama' | 'deepseek';
  locale: 'vi' | 'en';
  messages: Array<{ role: 'user' | 'assistant'; content: string; at: Date }>;
  startedAt: Date;
  lastActivityAt: Date;
}

export interface CodeSnapshotDoc {
  schemaVersion: 1;
  userId: string;
  lessonId: string;
  language: string;
  source: string;
  snapshotAt: Date;
}

export interface LearningEventDoc {
  schemaVersion: 1;
  userId: string;
  lessonId: string | null;
  event: string; // lesson_open | submit | tab_switch | focus | blur | idle
  metadata: Record<string, unknown>;
  at: Date;
}

@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MongoService.name);
  private client: MongoClient | null = null;
  private db: Db | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>('app.mongo.url');
    const dbName = this.config.get<string>('app.mongo.db') ?? 'lms_telemetry';
    if (!url) {
      this.log.warn('MONGO_URL not set — telemetry writes will be no-ops');
      return;
    }
    try {
      this.client = new MongoClient(url, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 3_000,
      });
      await this.client.connect();
      this.db = this.client.db(dbName);
      await this.ensureIndexes();
      this.log.log(`mongo connected db=${dbName}`);
    } catch (e) {
      this.log.error(`mongo connect failed: ${(e as Error).message}`);
      // Keep `db` null — writes become no-ops so the tutor and editor still
      // work if Mongo is down. We never want telemetry to block the user.
      this.client = null;
      this.db = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.close();
  }

  get aiChats(): Collection<AiChatDoc> | null {
    return this.db ? this.db.collection<AiChatDoc>('ai_chats') : null;
  }

  get codeSnapshots(): Collection<CodeSnapshotDoc> | null {
    return this.db ? this.db.collection<CodeSnapshotDoc>('code_snapshots') : null;
  }

  get learningEvents(): Collection<LearningEventDoc> | null {
    return this.db ? this.db.collection<LearningEventDoc>('learning_events') : null;
  }

  /**
   * Idempotent index setup. Safe to call on every boot.
   *
   * - `ai_chats`: query is "last 10 sessions for user on this lesson" → a
   *   compound (userId, lessonId, lastActivityAt) covers it.
   * - `code_snapshots`: TTL of 14 days keeps the collection bounded on a
   *   16 GB VPS. Query is "last N snapshots for user+lesson" for the
   *   data-science service.
   * - `learning_events`: TTL of 90 days, query by (userId, at).
   */
  private async ensureIndexes(): Promise<void> {
    if (!this.db) return;
    await Promise.all([
      this.db
        .collection('ai_chats')
        .createIndex({ userId: 1, lessonId: 1, lastActivityAt: -1 }, { name: 'by_user_lesson_recent' }),
      this.db
        .collection('code_snapshots')
        .createIndex({ userId: 1, lessonId: 1, snapshotAt: -1 }, { name: 'by_user_lesson_recent' }),
      this.db
        .collection('code_snapshots')
        .createIndex({ snapshotAt: 1 }, { name: 'ttl_14d', expireAfterSeconds: 14 * 24 * 60 * 60 }),
      this.db
        .collection('learning_events')
        .createIndex({ userId: 1, at: -1 }, { name: 'by_user_recent' }),
      this.db
        .collection('learning_events')
        .createIndex({ at: 1 }, { name: 'ttl_90d', expireAfterSeconds: 90 * 24 * 60 * 60 }),
    ]);
  }
}
