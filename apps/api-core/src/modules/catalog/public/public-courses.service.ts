import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type {
  CourseDetail,
  CourseSummary,
  PaginatedCourses,
} from '@lms/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtAccessPayload } from '../../iam/auth/auth.types';
import { courseSummaryFromPrisma, courseDetailFromPrisma } from '../mappers';

interface ListArgs {
  cursor?: string; // opaque — currently the last course's published_at ISO
  limit: number;
  locale?: string;
}

@Injectable()
export class PublicCoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async list(args: ListArgs): Promise<PaginatedCourses> {
    const { cursor, limit, locale } = args;

    const cursorDate = cursor ? new Date(cursor) : null;
    const courses = await this.prisma.course.findMany({
      where: {
        status: 'published',
        ...(locale ? { locale } : {}),
        ...(cursorDate ? { publishedAt: { lt: cursorDate } } : {}),
      },
      orderBy: { publishedAt: 'desc' },
      take: limit + 1,
      include: {
        teacher: { select: { id: true, displayName: true } },
        modules: { select: { _count: { select: { lessons: true } } } },
      },
    });

    const hasMore = courses.length > limit;
    const page = hasMore ? courses.slice(0, limit) : courses;
    const nextCursor =
      hasMore && page.length > 0
        ? page[page.length - 1]?.publishedAt?.toISOString() ?? null
        : null;

    const items: CourseSummary[] = page.map((c) =>
      courseSummaryFromPrisma(c, lessonCountOf(c)),
    );

    return {
      items,
      page: { cursor: nextCursor, limit, has_more: hasMore },
    };
  }

  async getBySlug(slug: string, bearerOrNull: string | null): Promise<CourseDetail | null> {
    const course = await this.prisma.course.findUnique({
      where: { slug },
      include: {
        teacher: { select: { id: true, displayName: true } },
        modules: {
          orderBy: { sortOrder: 'asc' },
          include: {
            lessons: {
              orderBy: { sortOrder: 'asc' },
              select: { id: true, title: true, sortOrder: true, type: true, estMinutes: true },
            },
            _count: { select: { lessons: true } },
          },
        },
      },
    });

    if (!course || course.status !== 'published') return null;

    const userId = this.resolveUserId(bearerOrNull);
    const isEnrolled = userId
      ? Boolean(
          await this.prisma.enrollment.findUnique({
            where: { userId_courseId: { userId, courseId: course.id } },
            select: { id: true },
          }),
        )
      : false;

    const lessonCount = course.modules.reduce((n, m) => n + m._count.lessons, 0);
    return courseDetailFromPrisma(course, lessonCount, isEnrolled);
  }

  private resolveUserId(bearer: string | null): string | null {
    if (!bearer) return null;
    try {
      const payload = this.jwt.verify<JwtAccessPayload>(bearer, {
        secret: this.config.get<string>('app.jwt.accessSecret'),
      });
      return payload.sub;
    } catch {
      return null;
    }
  }
}

function lessonCountOf(c: { modules: Array<{ _count: { lessons: number } }> }): number {
  return c.modules.reduce((n, m) => n + m._count.lessons, 0);
}
