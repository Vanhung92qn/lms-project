import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';

// Public catalog for the /challenge arena page (P9.0 groundwork, UI wiring
// 2026-04-22). Surfaces every exercise tagged `isChallenge` grouped by
// course so the student can pick a hard problem to practise. No auth —
// the arena is a public teaser; running the submission still requires
// login + enrolment via the existing submission pipeline.

@ApiTags('public')
@Controller({ path: 'challenges', version: '1' })
export class ChallengesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({ summary: 'List every challenge exercise across published courses' })
  async list() {
    const rows = await this.prisma.exercise.findMany({
      where: {
        isChallenge: true,
        lesson: { module: { course: { status: 'published' } } },
      },
      select: {
        id: true,
        language: true,
        lesson: {
          select: {
            id: true,
            title: true,
            sortOrder: true,
            module: {
              select: {
                title: true,
                course: {
                  select: {
                    slug: true,
                    title: true,
                    pricingModel: true,
                    priceCents: true,
                  },
                },
              },
            },
          },
        },
        submissions: {
          select: { verdict: true },
        },
      },
      orderBy: [{ lesson: { module: { course: { slug: 'asc' } } } }, { lesson: { sortOrder: 'asc' } }],
    });

    return rows.map((ex) => {
      const total = ex.submissions.length;
      const ac = ex.submissions.filter((s) => s.verdict === 'ac').length;
      return {
        exercise_id: ex.id,
        lesson_id: ex.lesson.id,
        lesson_title: ex.lesson.title,
        module_title: ex.lesson.module.title,
        course: {
          slug: ex.lesson.module.course.slug,
          title: ex.lesson.module.course.title,
          pricing_model: ex.lesson.module.course.pricingModel,
          price_cents: ex.lesson.module.course.priceCents,
        },
        language: ex.language,
        total_attempts: total,
        ac_count: ac,
        ac_rate: total > 0 ? ac / total : null,
      };
    });
  }
}
