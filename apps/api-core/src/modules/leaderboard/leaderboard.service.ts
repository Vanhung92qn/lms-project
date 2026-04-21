import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type LeaderboardScope } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type RankRow = {
  user_id: string;
  score: number;
  solved_count: number;
  penalty_seconds: number;
  last_submission_at: Date | null;
};

@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    await this.ensureGlobalLeaderboard();
    await this.ensureCourseLeaderboards();
    const rows = await this.prisma.leaderboard.findMany({
      orderBy: [{ scope: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        scope: true,
        title: true,
        courseId: true,
        updatedAt: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      scope: row.scope,
      title: row.title,
      course_id: row.courseId,
      updated_at: row.updatedAt.toISOString(),
    }));
  }

  async detail(leaderboardId: string) {
    const lb = await this.prisma.leaderboard.findUnique({
      where: { id: leaderboardId },
      select: {
        id: true,
        scope: true,
        title: true,
        courseId: true,
        updatedAt: true,
      },
    });
    if (!lb) {
      throw new NotFoundException({ code: 'leaderboard_not_found', message: 'Leaderboard not found' });
    }
    await this.recomputeLeaderboard(lb.id, lb.scope, lb.courseId);
    return {
      id: lb.id,
      scope: lb.scope,
      title: lb.title,
      course_id: lb.courseId,
      updated_at: lb.updatedAt.toISOString(),
    };
  }

  async entries(leaderboardId: string, cursor?: string, limit = 20) {
    const lb = await this.getLeaderboardOrThrow(leaderboardId);
    await this.recomputeLeaderboard(lb.id, lb.scope, lb.courseId);

    const cursorRank = this.safeCursor(cursor);
    const rows = await this.prisma.leaderboardEntry.findMany({
      where: {
        leaderboardId,
        ...(cursorRank ? { rank: { gt: cursorRank } } : {}),
      },
      orderBy: { rank: 'asc' },
      take: limit,
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    });

    return {
      items: rows.map((row) => ({
        rank: row.rank,
        user_id: row.userId,
        display_name: row.user.displayName,
        avatar_url: row.user.avatarUrl,
        score: row.score,
        solved_count: row.solvedCount,
        penalty_seconds: row.penaltySeconds,
        last_submission_at: row.lastSubmissionAt?.toISOString() ?? null,
      })),
      page: {
        cursor: rows.length ? String(rows[rows.length - 1].rank) : null,
        limit,
        has_more: rows.length === limit,
      },
    };
  }

  async aroundMe(leaderboardId: string, userId: string) {
    const lb = await this.getLeaderboardOrThrow(leaderboardId);
    await this.recomputeLeaderboard(lb.id, lb.scope, lb.courseId);

    const me = await this.prisma.leaderboardEntry.findUnique({
      where: { leaderboardId_userId: { leaderboardId, userId } },
      select: { rank: true },
    });
    if (!me) {
      return { items: [] };
    }
    const from = Math.max(1, me.rank - 5);
    const to = me.rank + 5;
    const rows = await this.prisma.leaderboardEntry.findMany({
      where: { leaderboardId, rank: { gte: from, lte: to } },
      orderBy: { rank: 'asc' },
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    });
    return {
      items: rows.map((row) => ({
        rank: row.rank,
        user_id: row.userId,
        display_name: row.user.displayName,
        avatar_url: row.user.avatarUrl,
        score: row.score,
        solved_count: row.solvedCount,
        penalty_seconds: row.penaltySeconds,
        last_submission_at: row.lastSubmissionAt?.toISOString() ?? null,
        is_me: row.userId === userId,
      })),
    };
  }

  private safeCursor(cursor?: string): number | undefined {
    if (!cursor) return undefined;
    const n = Number(cursor);
    if (!Number.isFinite(n) || n < 1) return undefined;
    return Math.floor(n);
  }

  private async getLeaderboardOrThrow(leaderboardId: string) {
    const lb = await this.prisma.leaderboard.findUnique({
      where: { id: leaderboardId },
      select: { id: true, scope: true, courseId: true },
    });
    if (!lb) {
      throw new NotFoundException({ code: 'leaderboard_not_found', message: 'Leaderboard not found' });
    }
    return lb;
  }

  private async ensureGlobalLeaderboard() {
    const existing = await this.prisma.leaderboard.findFirst({
      where: { scope: 'global', courseId: null },
      select: { id: true },
    });
    if (existing) return;
    await this.prisma.leaderboard.create({
      data: { scope: 'global', courseId: null, title: 'Global leaderboard' },
    });
  }

  private async ensureCourseLeaderboards() {
    const courses = await this.prisma.course.findMany({
      where: { status: 'published' },
      select: { id: true, title: true },
    });
    for (const course of courses) {
      const exists = await this.prisma.leaderboard.findFirst({
        where: { scope: 'course', courseId: course.id },
        select: { id: true },
      });
      if (exists) continue;
      await this.prisma.leaderboard.create({
        data: {
          scope: 'course',
          courseId: course.id,
          title: `${course.title} leaderboard`,
        },
      });
    }
  }

  private async recomputeLeaderboard(leaderboardId: string, scope: LeaderboardScope, courseId: string | null) {
    const rows =
      scope === 'global'
        ? await this.computeGlobalRows()
        : await this.computeCourseRows(courseId);

    await this.prisma.$transaction(async (tx) => {
      await tx.leaderboardEntry.deleteMany({ where: { leaderboardId } });
      if (!rows.length) return;
      await tx.leaderboardEntry.createMany({
        data: rows.map((row, idx) => ({
          leaderboardId,
          userId: row.user_id,
          rank: idx + 1,
          score: Number(row.score),
          solvedCount: Number(row.solved_count),
          penaltySeconds: Number(row.penalty_seconds),
          lastSubmissionAt: row.last_submission_at,
        })),
      });
    });
  }

  private computeGlobalRows() {
    return this.prisma.$queryRaw<RankRow[]>(Prisma.sql`
      WITH first_attempt AS (
        SELECT s.user_id, s.exercise_id, MIN(s.created_at) AS first_attempt_at
        FROM submissions s
        GROUP BY s.user_id, s.exercise_id
      ),
      first_ac AS (
        SELECT s.user_id, s.exercise_id, MIN(s.created_at) AS first_ac_at
        FROM submissions s
        WHERE s.verdict = 'ac'
        GROUP BY s.user_id, s.exercise_id
      ),
      scored AS (
        SELECT
          fa.user_id,
          COUNT(*)::int AS solved_count,
          (COUNT(*) * 100)::int AS score,
          COALESCE(SUM(EXTRACT(EPOCH FROM (fa.first_ac_at - fat.first_attempt_at))), 0)::int AS penalty_seconds,
          MAX(fa.first_ac_at) AS last_submission_at
        FROM first_ac fa
        JOIN first_attempt fat ON fat.user_id = fa.user_id AND fat.exercise_id = fa.exercise_id
        GROUP BY fa.user_id
      )
      SELECT user_id, score, solved_count, penalty_seconds, last_submission_at
      FROM scored
      ORDER BY score DESC, penalty_seconds ASC, last_submission_at ASC
    `);
  }

  private computeCourseRows(courseId: string | null) {
    if (!courseId) return Promise.resolve([]);
    return this.prisma.$queryRaw<RankRow[]>(Prisma.sql`
      WITH first_attempt AS (
        SELECT s.user_id, s.exercise_id, MIN(s.created_at) AS first_attempt_at
        FROM submissions s
        JOIN exercises e ON e.id = s.exercise_id
        JOIN lessons l ON l.id = e.lesson_id
        JOIN modules m ON m.id = l.module_id
        WHERE m.course_id = ${courseId}::uuid
        GROUP BY s.user_id, s.exercise_id
      ),
      first_ac AS (
        SELECT s.user_id, s.exercise_id, MIN(s.created_at) AS first_ac_at
        FROM submissions s
        JOIN exercises e ON e.id = s.exercise_id
        JOIN lessons l ON l.id = e.lesson_id
        JOIN modules m ON m.id = l.module_id
        WHERE m.course_id = ${courseId}::uuid
          AND s.verdict = 'ac'
        GROUP BY s.user_id, s.exercise_id
      ),
      scored AS (
        SELECT
          fa.user_id,
          COUNT(*)::int AS solved_count,
          (COUNT(*) * 100)::int AS score,
          COALESCE(SUM(EXTRACT(EPOCH FROM (fa.first_ac_at - fat.first_attempt_at))), 0)::int AS penalty_seconds,
          MAX(fa.first_ac_at) AS last_submission_at
        FROM first_ac fa
        JOIN first_attempt fat ON fat.user_id = fa.user_id AND fat.exercise_id = fa.exercise_id
        GROUP BY fa.user_id
      )
      SELECT user_id, score, solved_count, penalty_seconds, last_submission_at
      FROM scored
      ORDER BY score DESC, penalty_seconds ASC, last_submission_at ASC
    `);
  }
}
