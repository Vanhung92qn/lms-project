import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Lightweight Prometheus metrics endpoint — no extra container, no
 * runtime counters, just point-in-time gauges queried from Postgres
 * on every scrape. For a 50-concurrent-users pilot this is enough; if
 * load grows beyond that we swap in `@willsoto/nestjs-prometheus` with
 * in-memory counters + histograms.
 *
 * Scrape target (local): curl http://127.0.0.1:4000/api/v1/metrics
 */
@ApiTags('health')
@Controller({ path: 'metrics', version: '1' })
export class MetricsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({ summary: 'Prometheus text-format metrics (point-in-time gauges)' })
  async metrics(): Promise<string> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [
      userCount,
      lockedUserCount,
      courseCount,
      publishedCourseCount,
      submissionCount,
      acSubmissionCount,
      recentSubmissionCount,
      enrollmentCount,
      pendingTopupAgg,
      approvedTopupAgg,
      walletBalanceAgg,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'locked' } }),
      this.prisma.course.count(),
      this.prisma.course.count({ where: { status: 'published' } }),
      this.prisma.submission.count(),
      this.prisma.submission.count({ where: { verdict: 'ac' } }),
      this.prisma.submission.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      this.prisma.enrollment.count(),
      this.prisma.walletTopup.aggregate({ where: { status: 'pending' }, _sum: { amountCents: true }, _count: true }),
      this.prisma.walletTopup.aggregate({ where: { status: 'approved' }, _sum: { amountCents: true } }),
      this.prisma.user.aggregate({ _sum: { walletBalanceCents: true } }),
    ]);

    const lines: string[] = [];
    const push = (name: string, help: string, value: number, type: 'counter' | 'gauge' = 'gauge'): void => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} ${type}`);
      lines.push(`${name} ${value}`);
    };

    push('lms_users_total', 'Total registered users', userCount);
    push('lms_users_locked', 'Users with status=locked', lockedUserCount);
    push('lms_courses_total', 'Total courses (any status)', courseCount);
    push('lms_courses_published', 'Courses with status=published', publishedCourseCount);
    push('lms_submissions_total', 'Total submissions ever', submissionCount, 'counter');
    push('lms_submissions_ac', 'Submissions with verdict=ac', acSubmissionCount, 'counter');
    push('lms_submissions_recent_7d', 'Submissions in the last 7 days', recentSubmissionCount);
    push('lms_enrollments_total', 'Active enrollments', enrollmentCount);
    push('lms_topups_pending_vnd', 'Pending topup amount (VND)', Math.round((pendingTopupAgg._sum.amountCents ?? 0) / 100));
    push('lms_topups_pending_count', 'Pending topup count', pendingTopupAgg._count);
    push('lms_topups_approved_vnd', 'Approved topup amount lifetime (VND)', Math.round((approvedTopupAgg._sum.amountCents ?? 0) / 100));
    push('lms_wallet_liability_vnd', 'Sum of student wallet balances (VND) — amount owed on mass refund', Math.round((walletBalanceAgg._sum.walletBalanceCents ?? 0) / 100));

    return lines.join('\n') + '\n';
  }
}
