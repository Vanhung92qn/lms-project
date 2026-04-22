import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TelemetryService } from '../../telemetry/telemetry.service';
import type { CreateCourseDto } from '../dto/create-course.dto';
import type {
  CreateLessonDto,
  CreateModuleDto,
  UpdateCourseDto,
  UpdateLessonDto,
  UpdateModuleDto,
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly telemetry: TelemetryService,
  ) {}

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

  // ==========================================================================
  // P9.1 — Teacher Insight Layer
  // ==========================================================================

  /**
   * Classroom Heatmap: enrolled students × knowledge concepts tagged in
   * any lesson of this course. Each cell carries the BKT mastery score
   * (0–1) + attempt count. Students are returned in enrolment order;
   * concepts in domain / slug order. The frontend renders the grid with
   * a red-yellow-green gradient so the teacher can spot weak concepts
   * and struggling students at a glance.
   */
  async heatmap(user: AuthenticatedUser, courseId: string) {
    await this.assertOwn(user, courseId);

    const [enrollments, nodeRows] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { courseId },
        orderBy: { enrolledAt: 'asc' },
        select: {
          user: { select: { id: true, displayName: true, email: true } },
        },
      }),
      // concepts this course teaches — only those tagged by at least one lesson.
      this.prisma.knowledgeNode.findMany({
        where: { lessonTags: { some: { lesson: { module: { courseId } } } } },
        orderBy: [{ domain: 'asc' }, { slug: 'asc' }],
        select: { id: true, slug: true, title: true, domain: true },
      }),
    ]);

    const students = enrollments.map((e) => ({
      id: e.user.id,
      display_name: e.user.displayName,
      email: e.user.email,
    }));
    const concepts = nodeRows.map((n) => ({
      id: n.id,
      slug: n.slug,
      title: n.title,
      domain: n.domain,
    }));

    if (students.length === 0 || concepts.length === 0) {
      return { course_id: courseId, students, concepts, cells: [] };
    }

    const masteryRows = await this.prisma.userMastery.findMany({
      where: {
        userId: { in: students.map((s) => s.id) },
        nodeId: { in: concepts.map((c) => c.id) },
      },
      select: { userId: true, nodeId: true, score: true, attempts: true },
    });

    const slugByNodeId = new Map(concepts.map((c) => [c.id, c.slug]));
    const cells = masteryRows.map((r) => ({
      user_id: r.userId,
      node_slug: slugByNodeId.get(r.nodeId) ?? '',
      score: Number(r.score),
      attempts: r.attempts,
    }));

    return { course_id: courseId, students, concepts, cells };
  }

  /**
   * AI Tutor Insights: most-recent student questions (user turns) within
   * the course's lessons, joined with lesson titles. Powers the teacher
   * "top student questions this week" panel — the qualitative half of
   * the analytics view. Empty array when Mongo is offline.
   */
  async tutorInsights(user: AuthenticatedUser, courseId: string) {
    await this.assertOwn(user, courseId);

    const lessons = await this.prisma.lesson.findMany({
      where: { module: { courseId } },
      select: { id: true, title: true },
    });
    if (lessons.length === 0) {
      return { course_id: courseId, window_days: 30, questions: [] };
    }
    const titleById = new Map(lessons.map((l) => [l.id, l.title]));
    const questions = await this.telemetry.recentUserQuestions(
      lessons.map((l) => l.id),
      30,
      20,
    );
    return {
      course_id: courseId,
      window_days: 30,
      questions: questions.map((q) => ({
        lesson_id: q.lessonId,
        lesson_title: q.lessonId ? titleById.get(q.lessonId) ?? null : null,
        question: q.question,
        provider: q.provider,
        at: q.at,
      })),
    };
  }

  /**
   * Concept Coverage Gap: which knowledge nodes are taught by this
   * course's lessons vs which are in the full KG but missing here.
   * Bonus: for every taught node, list its prereqs that ARE NOT taught
   * in this course — those are the most actionable gaps (the teacher
   * is skipping a stepping stone).
   */
  async coverageGap(user: AuthenticatedUser, courseId: string) {
    await this.assertOwn(user, courseId);

    const [allNodes, taughtRows, edges] = await Promise.all([
      this.prisma.knowledgeNode.findMany({
        orderBy: [{ domain: 'asc' }, { slug: 'asc' }],
        select: { id: true, slug: true, title: true, domain: true },
      }),
      this.prisma.knowledgeNode.findMany({
        where: { lessonTags: { some: { lesson: { module: { courseId } } } } },
        select: { id: true, slug: true, title: true, domain: true },
      }),
      this.prisma.knowledgeEdge.findMany({
        where: { relation: 'prereq' },
        select: {
          from: { select: { id: true, slug: true, title: true, domain: true } },
          to: { select: { id: true, slug: true } },
        },
      }),
    ]);

    const taughtIds = new Set(taughtRows.map((n) => n.id));
    const missing = allNodes.filter((n) => !taughtIds.has(n.id));

    // missing_prereqs: for every taught node T, find edges (P→T, prereq)
    // where P is not taught. Those are the lessons the teacher should
    // consider adding.
    const missingPrereqSet = new Map<
      string,
      { node: { slug: string; title: string; domain: string }; required_by: string[] }
    >();
    for (const edge of edges) {
      if (!taughtIds.has(edge.to.id)) continue; // we only care about prereqs of taught concepts
      if (taughtIds.has(edge.from.id)) continue; // already taught — not a gap
      const existing = missingPrereqSet.get(edge.from.slug);
      if (existing) {
        existing.required_by.push(edge.to.slug);
      } else {
        missingPrereqSet.set(edge.from.slug, {
          node: { slug: edge.from.slug, title: edge.from.title, domain: edge.from.domain },
          required_by: [edge.to.slug],
        });
      }
    }

    return {
      course_id: courseId,
      taught_count: taughtRows.length,
      total_kg_size: allNodes.length,
      taught: taughtRows.map((n) => ({ slug: n.slug, title: n.title, domain: n.domain })),
      missing: missing.map((n) => ({ slug: n.slug, title: n.title, domain: n.domain })),
      missing_prereqs: Array.from(missingPrereqSet.values()),
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

  async updateModule(
    user: AuthenticatedUser,
    courseId: string,
    moduleId: string,
    dto: UpdateModuleDto,
  ) {
    await this.assertOwn(user, courseId);
    await this.assertModuleInCourse(courseId, moduleId);
    return this.prisma.module.update({
      where: { id: moduleId },
      data: {
        title: dto.title,
        sortOrder: dto.sort_order,
      },
    });
  }

  async removeModule(user: AuthenticatedUser, courseId: string, moduleId: string) {
    await this.assertOwn(user, courseId);
    await this.assertModuleInCourse(courseId, moduleId);
    // Cascades remove lessons → exercises → test cases (per schema). Orphan
    // submissions remain — they're historical records the student may still
    // want to see on their profile, so we leave them referencing the now-
    // deleted lesson via ON DELETE CASCADE (which also removes submissions).
    await this.prisma.module.delete({ where: { id: moduleId } });
  }

  async getLessonForEdit(
    user: AuthenticatedUser,
    courseId: string,
    moduleId: string,
    lessonId: string,
  ) {
    await this.assertOwn(user, courseId);
    await this.assertLessonInModule(moduleId, lessonId, courseId);
    const lesson = await this.prisma.lesson.findUniqueOrThrow({
      where: { id: lessonId },
      select: {
        id: true,
        title: true,
        sortOrder: true,
        type: true,
        contentMarkdown: true,
        estMinutes: true,
      },
    });
    return {
      id: lesson.id,
      title: lesson.title,
      sort_order: lesson.sortOrder,
      type: lesson.type,
      content_markdown: lesson.contentMarkdown,
      est_minutes: lesson.estMinutes,
    };
  }

  async updateLesson(
    user: AuthenticatedUser,
    courseId: string,
    moduleId: string,
    lessonId: string,
    dto: UpdateLessonDto,
  ) {
    await this.assertOwn(user, courseId);
    await this.assertLessonInModule(moduleId, lessonId, courseId);
    return this.prisma.lesson.update({
      where: { id: lessonId },
      data: {
        title: dto.title,
        sortOrder: dto.sort_order,
        type: dto.type,
        contentMarkdown: dto.content_markdown,
        estMinutes: dto.est_minutes,
      },
    });
  }

  async removeLesson(
    user: AuthenticatedUser,
    courseId: string,
    moduleId: string,
    lessonId: string,
  ) {
    await this.assertOwn(user, courseId);
    await this.assertLessonInModule(moduleId, lessonId, courseId);
    await this.prisma.lesson.delete({ where: { id: lessonId } });
  }

  // ---------------------------------------------------------------------------

  private async assertModuleInCourse(courseId: string, moduleId: string): Promise<void> {
    const mod = await this.prisma.module.findUnique({
      where: { id: moduleId },
      select: { courseId: true },
    });
    if (!mod || mod.courseId !== courseId) {
      throw new NotFoundException({
        code: 'module_not_found',
        message: 'Module not found in this course',
      });
    }
  }

  private async assertLessonInModule(
    moduleId: string,
    lessonId: string,
    courseId: string,
  ): Promise<void> {
    await this.assertModuleInCourse(courseId, moduleId);
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { moduleId: true },
    });
    if (!lesson || lesson.moduleId !== moduleId) {
      throw new NotFoundException({
        code: 'lesson_not_found',
        message: 'Lesson not found in this module',
      });
    }
  }

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
