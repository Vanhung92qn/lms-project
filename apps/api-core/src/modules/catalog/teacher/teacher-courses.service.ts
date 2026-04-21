import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateCourseDto } from '../dto/create-course.dto';
import type {
  CreateLessonDto,
  CreateModuleDto,
  UpdateCourseDto,
} from '../dto/update-course.dto';
import type { AuthenticatedUser } from '../../iam/auth/auth.types';
import type { CourseSummary } from '@lms/shared-types';
import { courseSummaryFromPrisma } from '../mappers';

// Owner rules: teachers can CRUD their own courses. Admin bypasses the
// ownership filter entirely. Every public method takes the authenticated
// user and enforces the rule inline — we deliberately do NOT push this to
// Casbin yet because ownership is a data predicate, not a role predicate.

@Injectable()
export class TeacherCoursesService {
  constructor(private readonly prisma: PrismaService) {}

  private isAdmin(user: AuthenticatedUser): boolean {
    return user.roles.includes('admin');
  }

  async listMine(user: AuthenticatedUser): Promise<CourseSummary[]> {
    const where = this.isAdmin(user) ? {} : { teacherId: user.id };
    const rows = await this.prisma.course.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        teacher: { select: { id: true, displayName: true } },
        modules: { select: { _count: { select: { lessons: true } } } },
      },
    });
    return rows.map((c) =>
      courseSummaryFromPrisma(
        c,
        c.modules.reduce((n, m) => n + m._count.lessons, 0),
      ),
    );
  }

  async detail(user: AuthenticatedUser, courseId: string) {
    await this.assertOwn(user, courseId);
    const course = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      include: {
        teacher: { select: { id: true, displayName: true } },
        modules: {
          orderBy: { sortOrder: 'asc' },
          include: {
            lessons: {
              orderBy: { sortOrder: 'asc' },
              select: { id: true, title: true, sortOrder: true, type: true, estMinutes: true },
            },
          },
        },
      },
    });
    // Return the same shape as the public detail endpoint so the frontend
    // can reuse CourseDetail / ModuleWithLessons types.
    const lessonCount = course.modules.reduce((n, m) => n + m.lessons.length, 0);
    return {
      ...courseSummaryFromPrisma(course, lessonCount),
      modules: course.modules.map((m) => ({
        id: m.id,
        title: m.title,
        sort_order: m.sortOrder,
        lessons: m.lessons.map((l) => ({
          id: l.id,
          title: l.title,
          sort_order: l.sortOrder,
          type: l.type,
          est_minutes: l.estMinutes,
        })),
      })),
      is_enrolled: false, // teachers view — not applicable
    };
  }

  async create(user: AuthenticatedUser, dto: CreateCourseDto) {
    const existing = await this.prisma.course.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException({ code: 'slug_taken', message: 'Slug is already in use' });

    return this.prisma.course.create({
      data: {
        slug: dto.slug,
        title: dto.title,
        description: dto.description,
        teacherId: user.id,
        locale: dto.locale ?? 'vi',
        pricingModel: dto.pricing_model ?? 'free',
        priceCents: dto.price_cents ?? null,
        currency: dto.currency ?? null,
        coverUrl: dto.cover_url ?? null,
      },
    });
  }

  async update(user: AuthenticatedUser, courseId: string, dto: UpdateCourseDto) {
    await this.assertOwn(user, courseId);
    return this.prisma.course.update({
      where: { id: courseId },
      data: {
        title: dto.title,
        description: dto.description,
        pricingModel: dto.pricing_model,
        priceCents: dto.price_cents,
        currency: dto.currency,
        coverUrl: dto.cover_url,
        locale: dto.locale,
      },
    });
  }

  async remove(user: AuthenticatedUser, courseId: string) {
    await this.assertOwn(user, courseId);
    await this.prisma.course.delete({ where: { id: courseId } });
  }

  async publish(user: AuthenticatedUser, courseId: string) {
    await this.assertOwn(user, courseId);
    // Invariant: must have at least one module with at least one lesson before we can publish.
    const hasLesson = await this.prisma.course.findFirst({
      where: { id: courseId, modules: { some: { lessons: { some: {} } } } },
      select: { id: true },
    });
    if (!hasLesson) {
      throw new ConflictException({
        code: 'course_empty',
        message: 'A course must have at least one lesson before it can be published',
      });
    }
    return this.prisma.course.update({
      where: { id: courseId },
      data: { status: 'published', publishedAt: new Date() },
    });
  }

  async unpublish(user: AuthenticatedUser, courseId: string) {
    await this.assertOwn(user, courseId);
    return this.prisma.course.update({
      where: { id: courseId },
      data: { status: 'draft', publishedAt: null },
    });
  }

  /**
   * Course-level analytics for the teacher. Returns enrolment + submission
   * summaries plus knowledge-node rollups so the teacher can see which
   * concepts are dragging the class down.
   */
  async analytics(user: AuthenticatedUser, courseId: string) {
    await this.assertOwn(user, courseId);

    // Submissions submitted on exercises belonging to this course.
    const exerciseRows = await this.prisma.exercise.findMany({
      where: { lesson: { module: { courseId } } },
      select: { id: true, lessonId: true },
    });
    const exerciseIds = exerciseRows.map((e) => e.id);

    const [enrollmentCount, submissionRows, lessonRows] = await Promise.all([
      this.prisma.enrollment.count({ where: { courseId } }),
      this.prisma.submission.findMany({
        where: { exerciseId: { in: exerciseIds } },
        select: {
          id: true,
          userId: true,
          exerciseId: true,
          verdict: true,
          createdAt: true,
        },
      }),
      this.prisma.lesson.findMany({
        where: { module: { courseId } },
        select: {
          id: true,
          title: true,
          knowledgeTags: {
            include: { node: { select: { id: true, slug: true, title: true } } },
          },
        },
      }),
    ]);

    const totalSubmissions = submissionRows.length;
    const acSubmissions = submissionRows.filter((s) => s.verdict === 'ac').length;
    const uniqueSubmitters = new Set(submissionRows.map((s) => s.userId)).size;
    const acRate = totalSubmissions === 0 ? 0 : acSubmissions / totalSubmissions;

    // Per-lesson AC rate (sorted by the most-struggled at the top).
    const lessonByExercise = new Map(exerciseRows.map((e) => [e.id, e.lessonId]));
    const perLesson = new Map<string, { total: number; ac: number }>();
    for (const s of submissionRows) {
      const lessonId = lessonByExercise.get(s.exerciseId);
      if (!lessonId) continue;
      const cur = perLesson.get(lessonId) ?? { total: 0, ac: 0 };
      cur.total += 1;
      if (s.verdict === 'ac') cur.ac += 1;
      perLesson.set(lessonId, cur);
    }

    const lessonStats = lessonRows
      .filter((l) => (perLesson.get(l.id)?.total ?? 0) > 0)
      .map((l) => {
        const stat = perLesson.get(l.id) ?? { total: 0, ac: 0 };
        return {
          lessonId: l.id,
          lessonTitle: l.title,
          totalSubmissions: stat.total,
          acSubmissions: stat.ac,
          acRate: stat.total === 0 ? 0 : stat.ac / stat.total,
          knowledgeNodes: l.knowledgeTags.map((t) => t.node.slug),
        };
      })
      .sort((a, b) => a.acRate - b.acRate); // hardest first

    // Weakest concepts across the course: aggregate per-node AC rate.
    const nodeStats = new Map<
      string,
      { slug: string; title: string; total: number; ac: number }
    >();
    for (const lesson of lessonRows) {
      const stat = perLesson.get(lesson.id);
      if (!stat) continue;
      for (const tag of lesson.knowledgeTags) {
        const cur = nodeStats.get(tag.node.id) ?? {
          slug: tag.node.slug,
          title: tag.node.title,
          total: 0,
          ac: 0,
        };
        cur.total += stat.total;
        cur.ac += stat.ac;
        nodeStats.set(tag.node.id, cur);
      }
    }
    const weakestConcepts = Array.from(nodeStats.values())
      .filter((n) => n.total > 0)
      .map((n) => ({
        slug: n.slug,
        title: n.title,
        totalSubmissions: n.total,
        acRate: n.ac / n.total,
      }))
      .sort((a, b) => a.acRate - b.acRate)
      .slice(0, 5);

    return {
      enrollmentCount,
      uniqueSubmitters,
      totalSubmissions,
      acSubmissions,
      acRate,
      perLesson: lessonStats,
      weakestConcepts,
    };
  }

  async addModule(user: AuthenticatedUser, courseId: string, dto: CreateModuleDto) {
    await this.assertOwn(user, courseId);
    return this.prisma.module.create({
      data: { courseId, title: dto.title, sortOrder: dto.sort_order },
    });
  }

  async addLesson(user: AuthenticatedUser, courseId: string, moduleId: string, dto: CreateLessonDto) {
    await this.assertOwn(user, courseId);
    const mod = await this.prisma.module.findUnique({ where: { id: moduleId } });
    if (!mod || mod.courseId !== courseId) {
      throw new NotFoundException({ code: 'module_not_found', message: 'Module not found in this course' });
    }
    return this.prisma.lesson.create({
      data: {
        moduleId,
        title: dto.title,
        sortOrder: dto.sort_order,
        type: dto.type,
        contentMarkdown: dto.content_markdown,
        estMinutes: dto.est_minutes,
      },
    });
  }

  // ---------------------------------------------------------------------------

  private async assertOwn(user: AuthenticatedUser, courseId: string): Promise<void> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, teacherId: true },
    });
    if (!course) {
      throw new NotFoundException({ code: 'course_not_found', message: 'Course not found' });
    }
    if (!this.isAdmin(user) && course.teacherId !== user.id) {
      throw new ForbiddenException({
        code: 'forbidden_by_policy',
        message: 'You do not own this course',
      });
    }
  }
}
