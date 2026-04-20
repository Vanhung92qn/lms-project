import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Minimal Redis client wrapper scoped to the AI module. We keep it local
 * instead of promoting a global RedisModule yet — only the tier resolver
 * needs Redis right now, and a shared client can be extracted in a later
 * phase when another module (sessions, BullMQ) needs it too.
 *
 * Instance-local fallback: if Redis is down we log once and keep serving,
 * counting in-memory. That degrades the daily cap to per-process but
 * keeps the tutor online, which is the right tradeoff for a pilot.
 */
@Injectable()
export class RedisCounter implements OnModuleDestroy {
  private readonly log = new Logger(RedisCounter.name);
  private readonly fallback = new Map<string, { value: number; expiresAt: number }>();
  private readonly client: Redis;
  private readyLogged = false;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const url = config.get<string>('app.redis.url') ?? 'redis://localhost:6379';
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.client.on('error', (e) => {
      if (!this.readyLogged) {
        this.log.warn(`redis unavailable, falling back to in-memory counters: ${e.message}`);
        this.readyLogged = true;
      }
    });
    this.client.on('ready', () => {
      this.log.log('redis ready');
      this.readyLogged = false;
    });
    void this.client.connect().catch(() => {
      /* swallow — error handler above already logged */
    });
  }

  /**
   * Increment `key` and return the new value, setting a TTL (seconds) on
   * first touch. Returns the current count so callers can compare against
   * their cap.
   */
  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    try {
      if (this.client.status === 'ready') {
        const value = await this.client.incr(key);
        if (value === 1) await this.client.expire(key, ttlSeconds);
        return value;
      }
    } catch (e) {
      this.log.warn(`redis incr failed, using fallback: ${(e as Error).message}`);
    }
    return this.incrFallback(key, ttlSeconds);
  }

  private incrFallback(key: string, ttlSeconds: number): number {
    const now = Date.now();
    const entry = this.fallback.get(key);
    if (!entry || entry.expiresAt <= now) {
      const fresh = { value: 1, expiresAt: now + ttlSeconds * 1000 };
      this.fallback.set(key, fresh);
      return 1;
    }
    entry.value += 1;
    return entry.value;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'end') {
      await this.client.quit().catch(() => {
        /* ignore */
      });
    }
  }
}
