import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../iam/auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { SandboxClient, type RunnerVerdict } from './sandbox/sandbox.client';

// Synchronous submission flow — api-core forwards the request to the
// orchestrator, awaits the result, persists it, and returns the fully
// graded submission. When traffic grows past a few rps we'll swap this
// for a BullMQ producer in P4 and a result-polling endpoint; the service
// signature stays the same.

@Injectable()
export class SubmissionsService {
  private readonly log = new Logger(SubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sandbox: SandboxClient,
  ) {}

  async submit(user: AuthenticatedUser, dto: { exercise_id: string; source_code: string }) {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id: dto.exercise_id },
      include: {
        lesson: {
          include: { module: { include: { course: { select: { id: true, status: true } } } } },
        },
        testCases: true,
      },
    });
    if (!exercise) {
      throw new NotFoundException({ code: 'exercise_not_found', message: 'Exercise not found' });
    }
    // Only allow submissions against published courses (except for the
    // exercise author / an admin, who might be previewing a draft).
    const courseStatus = exercise.lesson.module.course.status;
    const isOwnerOrAdmin =
      user.roles.includes('admin') /* owner check belongs to teacher service */;
    if (courseStatus !== 'published' && !isOwnerOrAdmin) {
      throw new ForbiddenException({
        code: 'forbidden_by_policy',
        message: 'Course is not available for submissions',
      });
    }

    // Create a pending row so failures still leave an audit trail.
    const submission = await this.prisma.submission.create({
      data: {
        userId: user.id,
        exerciseId: exercise.id,
        sourceCode: dto.source_code,
        language: exercise.language,
        verdict: 'pending',
      },
    });

    // Map test cases into the orchestrator request shape.
    const runnerTestCases = exercise.testCases.map((tc) => ({
      id: tc.id,
      input: tc.input ?? '',
      expected_output: tc.expectedOutput ?? '',
    }));

    try {
      const runner = await this.sandbox.run({
        language: exercise.language,
        source: dto.source_code,
        test_cases: runnerTestCases,
      });

      // Persist per-test results. Only create rows for test cases that the
      // orchestrator actually evaluated (CE short-circuits after the first
      // test case so the others won't be in `runner.test_results`).
      for (const r of runner.test_results) {
        await this.prisma.submissionTestResult.create({
          data: {
            submissionId: submission.id,
            testCaseId: r.test_case_id,
            passed: r.passed,
            verdict: r.verdict,
            actualOutput: r.actual_output ?? null,
            runtimeMs: r.runtime_ms ?? null,
          },
        });
      }

      const updated = await this.prisma.submission.update({
        where: { id: submission.id },
        data: {
          verdict: runner.verdict,
          runtimeMs: runner.runtime_ms ?? null,
          stderr: runner.compile_error ?? runner.stderr ?? null,
          finishedAt: new Date(),
        },
      });

      return this.hydrate(updated.id);
    } catch (e) {
      this.log.error(`submission ${submission.id} failed: ${(e as Error).message}`);
      await this.prisma.submission.update({
        where: { id: submission.id },
        data: {
          verdict: 'ie',
          stderr: (e as Error).message.slice(0, 4096),
          finishedAt: new Date(),
        },
      });
      throw e;
    }
  }

  async findById(user: AuthenticatedUser, id: string) {
    const sub = await this.prisma.submission.findUnique({
      where: { id },
      include: { results: true },
    });
    if (!sub) throw new NotFoundException({ code: 'submission_not_found', message: 'Not found' });
    if (sub.userId !== user.id && !user.roles.includes('admin')) {
      // Teachers can see submissions on their own exercises — keep it
      // simple for now; full teacher visibility lands with the Studio
      // insights view (P5).
      throw new ForbiddenException({ code: 'forbidden_by_policy', message: 'Not allowed' });
    }
    return this.shape(sub);
  }

  async listForUserAndExercise(user: AuthenticatedUser, exerciseId: string) {
    const rows = await this.prisma.submission.findMany({
      where: { userId: user.id, exerciseId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((s) => ({
      id: s.id,
      verdict: s.verdict,
      runtime_ms: s.runtimeMs,
      created_at: s.createdAt.toISOString(),
    }));
  }

  private async hydrate(id: string) {
    const sub = await this.prisma.submission.findUniqueOrThrow({
      where: { id },
      include: { results: true },
    });
    return this.shape(sub);
  }

  private shape(sub: Awaited<ReturnType<typeof this.prisma.submission.findUniqueOrThrow>> & {
    results: Array<{
      testCaseId: string;
      passed: boolean;
      verdict: RunnerVerdict;
      actualOutput: string | null;
      runtimeMs: number | null;
    }>;
  }) {
    return {
      id: sub.id,
      exercise_id: sub.exerciseId,
      language: sub.language,
      verdict: sub.verdict as RunnerVerdict,
      runtime_ms: sub.runtimeMs,
      memory_kb: sub.memoryKb,
      stderr: sub.stderr,
      created_at: sub.createdAt.toISOString(),
      finished_at: sub.finishedAt?.toISOString() ?? null,
      source_code: sub.sourceCode,
      test_results: (sub.results as Array<{
        testCaseId: string;
        passed: boolean;
        verdict: RunnerVerdict;
        actualOutput: string | null;
        runtimeMs: number | null;
      }>).map((r) => ({
        test_case_id: r.testCaseId,
        passed: r.passed,
        verdict: r.verdict,
        actual_output: r.actualOutput,
        runtime_ms: r.runtimeMs,
      })),
    };
  }
}
