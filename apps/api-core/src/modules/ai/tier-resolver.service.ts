import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisCounter } from './redis.provider';
import type { AuthenticatedUser } from '../iam/auth/auth.types';

export type TutorProvider = 'llama' | 'deepseek';

export interface TierDecision {
  provider: TutorProvider;
  /** Why we picked this provider — surfaced in logs and the `done` event. */
  reason:
    | 'deepseek-not-configured'
    | 'no-lesson-context'
    | 'lesson-not-found'
    | 'free-course'
    | 'paid-entitlement'
    | 'teacher-owner'
    | 'admin'
    | 'daily-cap-reached';
  /** Remaining daily DeepSeek budget after this call (null when Llama). */
  remaining?: number;
}

/**
 * Decides whether this request gets DeepSeek or falls back to Llama.
 *
 * Policy (locked in project memory — course-specific AI premium, no global VIP):
 *   - Missing DEEPSEEK_API_KEY at boot → always Llama.
 *   - No lesson context → Llama (e.g. ad-hoc gateway test).
 *   - Admin role → DeepSeek with same 200/day cap as teachers.
 *   - Teacher owning the course the lesson belongs to → DeepSeek, 200/day cap.
 *   - Student enrolled in a paid course → DeepSeek, 200/day cap.
 *   - Everyone else → Llama.
 *   - Any user who exceeds their cap is downgraded to Llama silently;
 *     the client just sees model="llama3:8b-instruct-q4_K_M" in `done`.
 */
@Injectable()
export class TutorTierResolver {
  private readonly log = new Logger(TutorTierResolver.name);
  private static readonly DAILY_CAP = 200;
  private static readonly DAY_SECONDS = 24 * 60 * 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly redis: RedisCounter,
  ) {}

  private get deepseekConfigured(): boolean {
    return Boolean(this.config.get<string>('app.ai.deepseek.apiKey'));
  }

  async resolve(user: AuthenticatedUser, lessonId?: string): Promise<TierDecision> {
    if (!this.deepseekConfigured) {
      return { provider: 'llama', reason: 'deepseek-not-configured' };
    }
    if (user.roles.includes('admin')) {
      return this.applyCap(user.id, 'admin');
    }
    if (!lessonId) {
      return { provider: 'llama', reason: 'no-lesson-context' };
    }

    // Resolve lesson → course without loading the whole tree.
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { module: { select: { course: { select: { id: true, teacherId: true, pricingModel: true } } } } },
    });
    const course = lesson?.module?.course;
    if (!course) {
      return { provider: 'llama', reason: 'lesson-not-found' };
    }

    if (user.roles.includes('teacher') && course.teacherId === user.id) {
      return this.applyCap(user.id, 'teacher-owner');
    }

    // Student on this course's paid track (enrollment acts as the
    // entitlement record until P6 adds a real `entitlements` table —
    // the decision logic doesn't change, only the source of truth).
    if (course.pricingModel === 'paid') {
      const enrolled = await this.prisma.enrollment.findUnique({
        where: { userId_courseId: { userId: user.id, courseId: course.id } },
        select: { userId: true },
      });
      if (enrolled) return this.applyCap(user.id, 'paid-entitlement');
    }

    return { provider: 'llama', reason: 'free-course' };
  }

  private async applyCap(
    userId: string,
    reason: Extract<TierDecision['reason'], 'admin' | 'teacher-owner' | 'paid-entitlement'>,
  ): Promise<TierDecision> {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD in UTC
    const key = `ai:deepseek:daily:${userId}:${today}`;
    const used = await this.redis.incrWithTtl(key, TutorTierResolver.DAY_SECONDS);
    if (used > TutorTierResolver.DAILY_CAP) {
      this.log.warn(`user=${userId} exceeded deepseek daily cap (${used}/${TutorTierResolver.DAILY_CAP})`);
      return { provider: 'llama', reason: 'daily-cap-reached' };
    }
    return {
      provider: 'deepseek',
      reason,
      remaining: TutorTierResolver.DAILY_CAP - used,
    };
  }
}
