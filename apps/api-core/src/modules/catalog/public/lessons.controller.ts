import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../iam/auth/jwt.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/auth/auth.types';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Student-facing lesson detail. Returns the full markdown body + (if the
 * lesson is an exercise) the starter code and the SAMPLE test cases only.
 * Hidden test cases and the solution_code are never exposed here.
 *
 * Gate: caller must be enrolled in the course, OR be the teacher who owns
 * it, OR be an admin. Draft courses are only visible to their owner.
 */
@ApiTags('catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'lessons', version: '1' })
export class LessonsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Detail of a lesson (theory body + exercise + sample test cases)' })
  async detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id },
      include: {
        module: {
          include: {
            course: { select: { id: true, slug: true, title: true, status: true, teacherId: true } },
          },
        },
        exercise: {
          include: {
            testCases: {
              where: { isSample: true },
              orderBy: { id: 'asc' },
              select: { id: true, input: true, expectedOutput: true },
            },
          },
        },
      },
    });

    if (!lesson) {
      throw new NotFoundException({ code: 'lesson_not_found', message: 'Lesson not found' });
    }

    const { course } = lesson.module;
    const isOwner = course.teacherId === user.id;
    const isAdmin = user.roles.includes('admin');

    // Draft course: only owner + admin can peek.
    if (course.status !== 'published' && !isOwner && !isAdmin) {
      throw new NotFoundException({ code: 'lesson_not_found', message: 'Lesson not found' });
    }

    // Published course: must be enrolled (or owner / admin) to view the body.
    if (!isOwner && !isAdmin) {
      const enrollment = await this.prisma.enrollment.findUnique({
        where: { userId_courseId: { userId: user.id, courseId: course.id } },
        select: { id: true },
      });
      if (!enrollment) {
        throw new ForbiddenException({
          code: 'not_enrolled',
          message: 'Enroll in this course to access the lesson',
        });
      }
    }

    // Prev / next within the same course. One query per direction keeps the
    // payload compact and lets the client render nav without a second round-trip.
    const [prev, next] = await Promise.all([
      this.prisma.lesson.findFirst({
        where: {
          moduleId: lesson.moduleId,
          sortOrder: { lt: lesson.sortOrder },
        },
        orderBy: { sortOrder: 'desc' },
        select: { id: true, title: true },
      }),
      this.prisma.lesson.findFirst({
        where: {
          moduleId: lesson.moduleId,
          sortOrder: { gt: lesson.sortOrder },
        },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, title: true },
      }),
    ]);

    return {
      id: lesson.id,
      title: lesson.title,
      type: lesson.type,
      content_markdown: lesson.contentMarkdown ?? '',
      sort_order: lesson.sortOrder,
      est_minutes: lesson.estMinutes,
      course: {
        id: course.id,
        slug: course.slug,
        title: course.title,
      },
      module: {
        id: lesson.moduleId,
        title: lesson.module.title,
      },
      prev_lesson: prev ? { id: prev.id, title: prev.title } : null,
      next_lesson: next ? { id: next.id, title: next.title } : null,
      exercise: lesson.exercise
        ? {
            id: lesson.exercise.id,
            language: lesson.exercise.language,
            starter_code: lesson.exercise.starterCode ?? '',
            time_limit_ms: lesson.exercise.timeLimitMs,
            memory_limit_mb: lesson.exercise.memoryLimitMb,
            sample_test_cases: lesson.exercise.testCases.map((tc) => ({
              id: tc.id,
              input: tc.input ?? '',
              expected_output: tc.expectedOutput ?? '',
            })),
          }
        : null,
    };
  }
}
