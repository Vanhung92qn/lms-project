import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';

// Public leaderboard (P9.0 groundwork). Ranks students by number of AC
// submissions then by average BKT mastery as a tiebreaker. The Arena /
// season leaderboard (future P10) will live at a separate endpoint so
// this one stays the simple "all-time best" view.

interface LeaderboardRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  ac_count: number;
  total_submissions: number;
  avg_mastery: number | null;
  mastered_concepts: number;
}

@ApiTags('public')
@Controller({ path: 'leaderboard', version: '1' })
export class LeaderboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiOperation({ summary: 'Top students by AC submission count (all-time)' })
  async list(@Query('limit') limit?: string): Promise<{ top: LeaderboardRow[] }> {
    // Clamp: default 20, max 100. Anything beyond renders poorly in the UI.
    const take = Math.min(100, Math.max(5, Number(limit) || 20));

    const rows: Array<{
      user_id: string;
      display_name: string;
      avatar_url: string | null;
      ac_count: bigint;
      total_submissions: bigint;
      avg_mastery: number | null;
      mastered_concepts: bigint;
    }> = await this.prisma.$queryRaw`
      SELECT
        u.id AS user_id,
        u.display_name,
        u.avatar_url,
        COALESCE(SUM(CASE WHEN s.verdict = 'ac' THEN 1 ELSE 0 END), 0) AS ac_count,
        COALESCE(COUNT(s.id), 0) AS total_submissions,
        (SELECT AVG(score)::float FROM user_mastery um WHERE um.user_id = u.id) AS avg_mastery,
        (SELECT COUNT(*)::bigint FROM user_mastery um WHERE um.user_id = u.id AND um.score >= 0.7) AS mastered_concepts
      FROM users u
      LEFT JOIN submissions s ON s.user_id = u.id
      WHERE u.status = 'active'
      GROUP BY u.id, u.display_name, u.avatar_url
      HAVING COUNT(s.id) > 0
      ORDER BY ac_count DESC, avg_mastery DESC NULLS LAST
      LIMIT ${take}
    `;

    return {
      top: rows.map((r) => ({
        user_id: r.user_id,
        display_name: r.display_name,
        avatar_url: r.avatar_url,
        ac_count: Number(r.ac_count),
        total_submissions: Number(r.total_submissions),
        avg_mastery: r.avg_mastery,
        mastered_concepts: Number(r.mastered_concepts),
      })),
    };
  }
}
