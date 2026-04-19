import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../iam/auth/auth.types';
import type {
  CourseSummary,
  EnrollResponse,
} from '@lms/shared-types';
import { courseSummaryFromPrisma } from '../mappers';

@Injectable()
export class EnrollmentService {
  constructor(private readonly prisma: PrismaService) {}

  async enrollBySlug(user: AuthenticatedUser, slug: string): Promise<EnrollResponse> {
    const course = await this.prisma.course.findUnique({
      where: { slug },
      select: { id: true, status: true, pricingModel: true },
    });
    if (!course) {
      throw new NotFoundException({ code: 'course_not_found', message: 'Course not found' });
    }
    if (course.status !== 'published') {
      throw new NotFoundException({ code: 'course_not_found', message: 'Course not found' });
    }
    // Paid courses require a successful order (Billing phase — P6).
    // In P2 we short-circuit to a free enrollment so the flow is testable.
    if (course.pricingModel === 'paid') {
      throw new ConflictException({
        code: 'payment_required',
        message: 'Paid courses require a completed order — available from P6',
      });
    }

    const enrollment = await this.prisma.enrollment.upsert({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
      update: {}, // idempotent — re-enrolling is a no-op
      create: { userId: user.id, courseId: course.id },
    });

    return {
      enrollment: {
        id: enrollment.id,
        user_id: enrollment.userId,
        course_id: enrollment.courseId,
        enrolled_at: enrollment.enrolledAt.toISOString(),
        progress_pct: Number(enrollment.progressPct),
      },
    };
  }

  async myEnrolledCourses(user: AuthenticatedUser): Promise<CourseSummary[]> {
    const rows = await this.prisma.enrollment.findMany({
      where: { userId: user.id },
      orderBy: { enrolledAt: 'desc' },
      include: {
        course: {
          include: {
            teacher: { select: { id: true, displayName: true } },
            modules: { select: { _count: { select: { lessons: true } } } },
          },
        },
      },
    });
    return rows.map((row) =>
      courseSummaryFromPrisma(
        row.course,
        row.course.modules.reduce((n, m) => n + m._count.lessons, 0),
      ),
    );
  }
}
