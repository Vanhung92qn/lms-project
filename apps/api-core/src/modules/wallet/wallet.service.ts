import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../iam/auth/auth.types';

type Method = 'momo' | 'bank';
type TopupStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface TopupDto {
  id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  amountCents: number;
  currency: string;
  method: Method;
  status: TopupStatus;
  referenceCode: string;
  userNote: string | null;
  adminNote: string | null;
  /**
   * Pre-rendered VietQR image URL with amount + reference baked in. The
   * student's banking app scans it and auto-fills the transfer form.
   * Empty when method=momo (MoMo's QR format is not open).
   */
  qrImageUrl: string | null;
  createdAt: string;
  approvedAt: string | null;
}

/**
 * Wallet-based billing v1.
 *
 * The student tops up their wallet once (any amount) by transferring via
 * MoMo or bank with a unique reference code as the memo. Admin verifies
 * the transfer and approves → wallet balance credits. The student then
 * spends wallet balance on courses instantly — no per-course admin
 * round-trip.
 *
 * Design decisions:
 *  - Single source of truth for balance = `users.wallet_balance_cents`.
 *    Updated only inside Prisma transactions so it can never drift from
 *    the entitlement + topup history.
 *  - No separate ledger table yet. If a refund or dispute needs an
 *    audit trail we can reconstruct it by joining approved topups with
 *    entitlements (both carry `amount_cents` + timestamps). Add a real
 *    ledger when the platform has real revenue and real disputes.
 *  - Reference codes are 8 chars of crypto-random hex, prefixed
 *    `TOPUP-`. ~4 billion possibilities — collisions are astronomical
 *    at pilot scale. We fail-fast with a retry loop if one ever hits.
 */
@Injectable()
export class WalletService {
  private readonly log = new Logger(WalletService.name);
  private static readonly MIN_TOPUP_CENTS = 1_000_00;   // 10,000 VND
  private static readonly MAX_TOPUP_CENTS = 50_000_000_00; // 500M VND (sanity cap)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ---- Student: balance + topups ---------------------------------------

  async getBalance(userId: string): Promise<{ balanceCents: number; currency: 'VND' }> {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { walletBalanceCents: true },
    });
    return { balanceCents: u.walletBalanceCents, currency: 'VND' };
  }

  async createTopup(
    user: AuthenticatedUser,
    input: { amountCents: number; method: Method; userNote?: string },
  ): Promise<TopupDto> {
    if (!Number.isInteger(input.amountCents) || input.amountCents < WalletService.MIN_TOPUP_CENTS) {
      throw new BadRequestException({
        code: 'amount_too_small',
        message: `Số tiền tối thiểu là ${WalletService.MIN_TOPUP_CENTS / 100} VND`,
      });
    }
    if (input.amountCents > WalletService.MAX_TOPUP_CENTS) {
      throw new BadRequestException({
        code: 'amount_too_large',
        message: 'Số tiền vượt quá giới hạn cho phép',
      });
    }

    // Collision-retry loop — 8 random hex chars = 16^8 = 4.3B possibilities.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `TOPUP-${randomBytes(4).toString('hex').toUpperCase()}`;
      try {
        const row = await this.prisma.walletTopup.create({
          data: {
            userId: user.id,
            amountCents: input.amountCents,
            method: input.method,
            status: 'pending',
            referenceCode: code,
            userNote: input.userNote?.slice(0, 2_000) ?? null,
          },
        });
        this.log.log(
          `topup created user=${user.id} ref=${code} amount=${input.amountCents} method=${input.method}`,
        );
        return this.shape(row.id);
      } catch (e) {
        // Unique-constraint violation on referenceCode — retry.
        if ((e as { code?: string }).code !== 'P2002') throw e;
      }
    }
    throw new ConflictException({
      code: 'reference_code_collision',
      message: 'Không tạo được mã tham chiếu duy nhất — thử lại.',
    });
  }

  async listMine(userId: string): Promise<TopupDto[]> {
    const rows = await this.prisma.walletTopup.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true, displayName: true } } },
    });
    return rows.map((r) => this.shapeRow(r));
  }

  async cancelMine(userId: string, topupId: string): Promise<{ ok: true }> {
    const row = await this.prisma.walletTopup.findUnique({ where: { id: topupId } });
    if (!row || row.userId !== userId) {
      throw new NotFoundException({ code: 'topup_not_found', message: 'Topup not found' });
    }
    if (row.status !== 'pending') {
      throw new BadRequestException({
        code: 'topup_not_pending',
        message: 'Chỉ có thể huỷ yêu cầu đang chờ duyệt',
      });
    }
    await this.prisma.walletTopup.update({
      where: { id: topupId },
      data: { status: 'cancelled' },
    });
    return { ok: true };
  }

  // ---- Student: spending on courses ------------------------------------

  /**
   * One-click course purchase. Atomically:
   *   1. Deduct priceCents from user.walletBalanceCents (aborts if insufficient).
   *   2. Create Entitlement (source=purchase, snapshot of amount).
   *   3. Upsert Enrollment so the course lands on the dashboard.
   */
  async purchase(
    user: AuthenticatedUser,
    courseSlug: string,
  ): Promise<{ entitlementId: string; remainingBalanceCents: number }> {
    const course = await this.prisma.course.findUnique({
      where: { slug: courseSlug },
      select: { id: true, status: true, pricingModel: true, priceCents: true },
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
        message: 'Khoá này miễn phí — không cần mua',
      });
    }

    const existing = await this.prisma.entitlement.findUnique({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
    });
    if (existing && !existing.revokedAt) {
      throw new ConflictException({
        code: 'already_entitled',
        message: 'Bạn đã có quyền truy cập khoá này rồi',
      });
    }

    const price = course.priceCents;

    // All three writes in one tx — if balance dropped below price between
    // our read and write, Prisma's updateMany with the guard clause makes
    // the update a no-op and we throw.
    const result = await this.prisma.$transaction(async (tx) => {
      const deduct = await tx.user.updateMany({
        where: { id: user.id, walletBalanceCents: { gte: price } },
        data: { walletBalanceCents: { decrement: price } },
      });
      if (deduct.count !== 1) {
        throw new ConflictException({
          code: 'insufficient_balance',
          message: 'Số dư ví không đủ — vui lòng nạp thêm',
        });
      }
      const ent = await tx.entitlement.upsert({
        where: { userId_courseId: { userId: user.id, courseId: course.id } },
        update: {
          source: 'purchase',
          amountCents: price,
          revokedAt: null,
          grantedAt: new Date(),
        },
        create: {
          userId: user.id,
          courseId: course.id,
          source: 'purchase',
          amountCents: price,
        },
      });
      await tx.enrollment.upsert({
        where: { userId_courseId: { userId: user.id, courseId: course.id } },
        update: {},
        create: { userId: user.id, courseId: course.id },
      });
      const fresh = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { walletBalanceCents: true },
      });
      return { entitlementId: ent.id, remainingBalanceCents: fresh.walletBalanceCents };
    });

    this.log.log(`purchase user=${user.id} course=${courseSlug} price=${price}`);
    return result;
  }

  // ---- Admin: approve / reject ------------------------------------------

  async listForAdmin(user: AuthenticatedUser, status?: TopupStatus): Promise<TopupDto[]> {
    this.assertAdmin(user);
    const rows = await this.prisma.walletTopup.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true, displayName: true } } },
      take: 500,
    });
    return rows.map((r) => this.shapeRow(r));
  }

  async approve(
    admin: AuthenticatedUser,
    topupId: string,
    adminNote?: string,
  ): Promise<TopupDto> {
    this.assertAdmin(admin);
    const row = await this.prisma.walletTopup.findUnique({ where: { id: topupId } });
    if (!row) throw new NotFoundException({ code: 'topup_not_found', message: 'Topup not found' });
    if (row.status !== 'pending') {
      throw new BadRequestException({
        code: 'topup_not_pending',
        message: 'Chỉ có thể duyệt yêu cầu đang chờ',
      });
    }

    await this.prisma.$transaction([
      this.prisma.walletTopup.update({
        where: { id: topupId },
        data: {
          status: 'approved',
          approvedById: admin.id,
          approvedAt: new Date(),
          adminNote: adminNote?.slice(0, 2_000) ?? null,
        },
      }),
      this.prisma.user.update({
        where: { id: row.userId },
        data: { walletBalanceCents: { increment: row.amountCents } },
      }),
    ]);
    this.log.log(`topup approved id=${topupId} ref=${row.referenceCode} amount=${row.amountCents}`);
    return this.shape(topupId);
  }

  async reject(
    admin: AuthenticatedUser,
    topupId: string,
    adminNote?: string,
  ): Promise<TopupDto> {
    this.assertAdmin(admin);
    const row = await this.prisma.walletTopup.findUnique({ where: { id: topupId } });
    if (!row) throw new NotFoundException({ code: 'topup_not_found', message: 'Topup not found' });
    if (row.status !== 'pending') {
      throw new BadRequestException({
        code: 'topup_not_pending',
        message: 'Chỉ có thể từ chối yêu cầu đang chờ',
      });
    }
    await this.prisma.walletTopup.update({
      where: { id: topupId },
      data: {
        status: 'rejected',
        approvedById: admin.id,
        approvedAt: new Date(),
        adminNote: adminNote?.slice(0, 2_000) ?? null,
      },
    });
    this.log.log(`topup rejected id=${topupId}`);
    return this.shape(topupId);
  }

  // ---- helpers ---------------------------------------------------------

  private assertAdmin(user: AuthenticatedUser): void {
    if (!user.roles.includes('admin')) {
      throw new ForbiddenException({
        code: 'forbidden_by_policy',
        message: 'Admin role required',
      });
    }
  }

  private async shape(id: string): Promise<TopupDto> {
    const row = await this.prisma.walletTopup.findUniqueOrThrow({
      where: { id },
      include: { user: { select: { email: true, displayName: true } } },
    });
    return this.shapeRow(row);
  }

  private shapeRow(row: {
    id: string;
    userId: string;
    amountCents: number;
    currency: string;
    method: Method;
    status: TopupStatus;
    referenceCode: string;
    userNote: string | null;
    adminNote: string | null;
    createdAt: Date;
    approvedAt: Date | null;
    user: { email: string; displayName: string };
  }): TopupDto {
    return {
      id: row.id,
      userId: row.userId,
      userEmail: row.user.email,
      userDisplayName: row.user.displayName,
      amountCents: row.amountCents,
      currency: row.currency,
      method: row.method,
      status: row.status,
      referenceCode: row.referenceCode,
      userNote: row.userNote,
      adminNote: row.adminNote,
      qrImageUrl: row.method === 'bank' ? this.buildVietQrUrl(row.amountCents, row.referenceCode) : null,
      createdAt: row.createdAt.toISOString(),
      approvedAt: row.approvedAt?.toISOString() ?? null,
    };
  }

  /**
   * Build a VietQR image URL. Returns empty string if the bank info is
   * not configured yet. Uses the free img.vietqr.io endpoint — no API
   * key needed, just a hosted PNG that every VN bank app can scan and
   * auto-fill (recipient + amount + memo).
   */
  private buildVietQrUrl(amountCents: number, reference: string): string {
    const bin = this.config.get<string>('app.billing.bankBin') ?? '';
    const account = this.config.get<string>('app.billing.bankAccount') ?? '';
    const holder = this.config.get<string>('app.billing.bankHolder') ?? '';
    if (!bin || !account) return '';
    const amount = Math.round(amountCents / 100); // VietQR uses VND, not cents
    const params = new URLSearchParams({
      amount: String(amount),
      addInfo: reference,
      accountName: holder,
    });
    return `https://img.vietqr.io/image/${bin}-${account}-compact2.png?${params.toString()}`;
  }
}
