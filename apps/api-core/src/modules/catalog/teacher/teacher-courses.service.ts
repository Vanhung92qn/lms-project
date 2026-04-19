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
