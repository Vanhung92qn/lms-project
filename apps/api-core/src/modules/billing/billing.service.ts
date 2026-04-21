import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../iam/auth/auth.types';

type Method = 'momo' | 'bank';

export interface PaymentDto {
  id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  amountCents: number;
  currency: string;
  method: Method;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  userNote: string | null;
  adminNote: string | null;
  createdAt: string;
  approvedAt: string | null;
}

/**
 * Billing v1 — manual-approval top-up for a specific paid course.
 *
 * The student creates a `pending` Payment referencing the course they
 * want to buy. An admin verifies the real-world MoNey / bank transfer
 * and approves — the approval creates an `Entitlement` row (source=
 * purchase) that grants access. Rejected payments leave an audit trail.
 *
 * We intentionally keep a 1:1 mapping from Payment → Entitlement for
 * now. When we add recurring subscriptions or multi-course bundles
 * in P7+, we'll relax this to many-to-many behind a dedicated
 * entitlement service.
 */
@Injectable()
export class BillingService {
  private readonly log = new Logger(BillingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Student-initiated: create a pending payment for a paid course. */
  async createPending(
    user: AuthenticatedUser,
    input: { courseSlug: string; method: Method; userNote?: string },
  ): Promise<PaymentDto> {
    const course = await this.prisma.course.findUnique({
      where: { slug: input.courseSlug },
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        pricingModel: true,
        priceCents: true,
      },
    });
    if (!course) {
      throw new NotFoundException({ code: 'course_not_found', message: 'Course not found' });
    }
    if (course.status !== 'published') {
      throw new BadRequestException({
        code: 'course_not_published',
        message: 'Course is not available for purchase',
      });
    }
    if (course.pricingModel !== 'paid' || !course.priceCents || course.priceCents <= 0) {
      throw new BadRequestException({
        code: 'course_not_paid',
        message: 'Course is free — no payment needed',
      });
    }

    // Already entitled? Don't let the student double-pay.
    const entitled = await this.prisma.entitlement.findUnique({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
    });
    if (entitled && !entitled.revokedAt) {
      throw new ConflictException({
        code: 'already_entitled',
        message: 'You already have access to this course',
      });
    }

    // Reuse any existing pending row so a trigger-happy student doesn't
    // create a queue of duplicates. Front-end also disables submit, but
    // we defend server-side.
    const existing = await this.prisma.payment.findFirst({
      where: { userId: user.id, courseId: course.id, status: 'pending' },
    });
    if (existing) {
      // Refresh note + method if provided, keep the same row.
      const updated = await this.prisma.payment.update({
        where: { id: existing.id },
        data: {
          method: input.method,
          userNote: input.userNote?.slice(0, 2_000) ?? null,
        },
      });
      return this.shape(updated.id);
    }

    const row = await this.prisma.payment.create({
      data: {
        userId: user.id,
        courseId: course.id,
        amountCents: course.priceCents,
        currency: 'VND',
        method: input.method,
        status: 'pending',
        userNote: input.userNote?.slice(0, 2_000) ?? null,
      },
    });
    this.log.log(
      `payment created pending user=${user.id} course=${course.slug} amount=${course.priceCents}`,
    );
    return this.shape(row.id);
  }

  /** Student-scoped: list the caller's own payments. */
  async listMine(userId: string): Promise<PaymentDto[]> {
    const rows = await this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        course: { select: { slug: true, title: true } },
        user: { select: { email: true, displayName: true } },
      },
    });
    return rows.map((r) => this.shapeRow(r));
  }

  /** Student cancels their own pending payment (change of mind). */
  async cancelMine(userId: string, paymentId: string): Promise<{ ok: true }> {
    const row = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!row || row.userId !== userId) {
      throw new NotFoundException({ code: 'payment_not_found', message: 'Payment not found' });
    }
    if (row.status !== 'pending') {
      throw new BadRequestException({
        code: 'payment_not_pending',
        message: 'Only pending payments can be cancelled',
      });
    }
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'cancelled' },
    });
    return { ok: true };
  }

  /** Admin-scoped: list payments, optionally filtered by status. */
  async listForAdmin(
    user: AuthenticatedUser,
    status?: 'pending' | 'approved' | 'rejected' | 'cancelled',
  ): Promise<PaymentDto[]> {
    this.assertAdmin(user);
    const rows = await this.prisma.payment.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        course: { select: { slug: true, title: true } },
        user: { select: { email: true, displayName: true } },
      },
      take: 500,
    });
    return rows.map((r) => this.shapeRow(r));
  }

  /**
   * Admin approves a pending payment. Creates the Entitlement in the same
   * transaction so the student's access is atomic with the approval.
   */
  async approve(
    admin: AuthenticatedUser,
    paymentId: string,
    adminNote?: string,
  ): Promise<PaymentDto> {
    this.assertAdmin(admin);
    const row = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!row) {
      throw new NotFoundException({ code: 'payment_not_found', message: 'Payment not found' });
    }
    if (row.status !== 'pending') {
      throw new BadRequestException({
        code: 'payment_not_pending',
        message: 'Only pending payments can be approved',
      });
    }

    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'approved',
          approvedById: admin.id,
          approvedAt: new Date(),
          adminNote: adminNote?.slice(0, 2_000) ?? null,
        },
      }),
      this.prisma.entitlement.upsert({
        where: { userId_courseId: { userId: row.userId, courseId: row.courseId } },
        update: { source: 'purchase', paymentId: row.id, revokedAt: null, grantedAt: new Date() },
        create: {
          userId: row.userId,
          courseId: row.courseId,
          source: 'purchase',
          paymentId: row.id,
        },
      }),
      // Auto-enroll so the course appears in /dashboard. Idempotent.
      this.prisma.enrollment.upsert({
        where: { userId_courseId: { userId: row.userId, courseId: row.courseId } },
        update: {},
        create: { userId: row.userId, courseId: row.courseId },
      }),
    ]);
    this.log.log(`payment approved id=${paymentId} by=${admin.id}`);
    return this.shape(paymentId);
  }

  async reject(
    admin: AuthenticatedUser,
    paymentId: string,
    adminNote?: string,
  ): Promise<PaymentDto> {
    this.assertAdmin(admin);
    const row = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!row) {
      throw new NotFoundException({ code: 'payment_not_found', message: 'Payment not found' });
    }
    if (row.status !== 'pending') {
      throw new BadRequestException({
        code: 'payment_not_pending',
        message: 'Only pending payments can be rejected',
      });
    }
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'rejected',
        approvedById: admin.id,
        approvedAt: new Date(),
        adminNote: adminNote?.slice(0, 2_000) ?? null,
      },
    });
    this.log.log(`payment rejected id=${paymentId} by=${admin.id}`);
    return this.shape(paymentId);
  }

  /** Entitlement helper used by catalog / lesson access gates. */
  async isEntitled(userId: string, courseId: string): Promise<boolean> {
    const ent = await this.prisma.entitlement.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    return !!ent && !ent.revokedAt && (!ent.expiresAt || ent.expiresAt > new Date());
  }

  // --- helpers -----------------------------------------------------------

  private assertAdmin(user: AuthenticatedUser): void {
    if (!user.roles.includes('admin')) {
      throw new ForbiddenException({
        code: 'forbidden_by_policy',
        message: 'Admin role required',
      });
    }
  }

  private async shape(id: string): Promise<PaymentDto> {
    const row = await this.prisma.payment.findUniqueOrThrow({
      where: { id },
      include: {
        course: { select: { slug: true, title: true } },
        user: { select: { email: true, displayName: true } },
      },
    });
    return this.shapeRow(row);
  }

  private shapeRow(row: {
    id: string;
    userId: string;
    courseId: string;
    amountCents: number;
    currency: string;
    method: Method;
    status: 'pending' | 'approved' | 'rejected' | 'cancelled';
    userNote: string | null;
    adminNote: string | null;
    createdAt: Date;
    approvedAt: Date | null;
    course: { slug: string; title: string };
    user: { email: string; displayName: string };
  }): PaymentDto {
    return {
      id: row.id,
      userId: row.userId,
      userEmail: row.user.email,
      userDisplayName: row.user.displayName,
      courseId: row.courseId,
      courseSlug: row.course.slug,
      courseTitle: row.course.title,
      amountCents: row.amountCents,
      currency: row.currency,
      method: row.method,
      status: row.status,
      userNote: row.userNote,
      adminNote: row.adminNote,
      createdAt: row.createdAt.toISOString(),
      approvedAt: row.approvedAt?.toISOString() ?? null,
    };
  }
}
