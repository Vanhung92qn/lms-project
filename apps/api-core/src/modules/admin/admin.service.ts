import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../iam/auth/auth.types';

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  locale: string;
  status: UserStatus;
  roles: string[];
  walletBalanceCents: number;
  createdAt: string;
}

export interface AdminMetrics {
  users: { total: number; active: number; locked: number; byRole: Record<string, number> };
  courses: { total: number; published: number; draft: number; freeCount: number; paidCount: number };
  submissions: { total: number; ac: number; last7d: number };
  revenue: {
    approvedTopupCents: number;
    approvedTopupCount: number;
    pendingTopupCents: number;
    pendingTopupCount: number;
    walletLiabilityCents: number; // sum of all users' current balances
  };
}

/**
 * Platform-admin view over every bounded context. Role-gated in each
 * method (not at the controller) so we can surface better 403 messages
 * and avoid leaking which collections exist.
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Users -----------------------------------------------------------

  async listUsers(
    caller: AuthenticatedUser,
    filter: { q?: string; role?: string; status?: UserStatus; limit?: number } = {},
  ): Promise<AdminUserRow[]> {
    this.assertAdmin(caller);
    const { q, role, status, limit = 200 } = filter;

    const where: Parameters<typeof this.prisma.user.findMany>[0] extends infer A
      ? A extends { where?: infer W }
        ? W
        : never
      : never = {
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { displayName: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(status ? { status } : {}),
      ...(role
        ? {
            userRoles: { some: { role: { name: role as 'student' | 'teacher' | 'admin' | 'ai_engine' } } },
          }
        : {}),
    };

    const rows = await this.prisma.user.findMany({
      where,
      include: { userRoles: { include: { role: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
    });

    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      locale: u.locale,
      status: u.status,
      roles: u.userRoles.map((ur) => ur.role.name),
      walletBalanceCents: u.walletBalanceCents,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  async setStatus(
    caller: AuthenticatedUser,
    userId: string,
    status: UserStatus,
  ): Promise<AdminUserRow> {
    this.assertAdmin(caller);
    // Refuse to lock yourself or another admin — prevents lockout and
    // accidental escalation gaps.
    if (userId === caller.id && status === 'locked') {
      throw new ForbiddenException({
        code: 'cannot_lock_self',
        message: 'You cannot lock your own account',
      });
    }
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { include: { role: true } } },
    });
    if (!target) {
      throw new NotFoundException({ code: 'user_not_found', message: 'User not found' });
    }
    if (status === 'locked' && target.userRoles.some((ur) => ur.role.name === 'admin')) {
      throw new ForbiddenException({
        code: 'cannot_lock_admin',
        message: 'Cannot lock another admin account',
      });
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status },
      include: { userRoles: { include: { role: true } } },
    });
    // Revoke active refresh tokens on lock so the session can't survive.
    if (status === 'locked') {
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return {
      id: updated.id,
      email: updated.email,
      displayName: updated.displayName,
      avatarUrl: updated.avatarUrl,
      locale: updated.locale,
      status: updated.status,
      roles: updated.userRoles.map((ur) => ur.role.name),
      walletBalanceCents: updated.walletBalanceCents,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  // ---- Metrics ---------------------------------------------------------

  async metrics(caller: AuthenticatedUser): Promise<AdminMetrics> {
    this.assertAdmin(caller);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers,
      lockedUsers,
      roleRows,
      totalCourses,
      publishedCourses,
      draftCourses,
      freeCourses,
      paidCourses,
      totalSubmissions,
      acSubmissions,
      recentSubmissions,
      approvedTopupAgg,
      pendingTopupAgg,
      walletAgg,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.user.count({ where: { status: 'locked' } }),
      this.prisma.userRole.groupBy({
        by: ['roleId'],
        _count: { userId: true },
      }),
      this.prisma.course.count(),
      this.prisma.course.count({ where: { status: 'published' } }),
      this.prisma.course.count({ where: { status: 'draft' } }),
      this.prisma.course.count({ where: { pricingModel: 'free' } }),
      this.prisma.course.count({ where: { pricingModel: 'paid' } }),
      this.prisma.submission.count(),
      this.prisma.submission.count({ where: { verdict: 'ac' } }),
      this.prisma.submission.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      this.prisma.walletTopup.aggregate({
        where: { status: 'approved' },
        _sum: { amountCents: true },
        _count: true,
      }),
      this.prisma.walletTopup.aggregate({
        where: { status: 'pending' },
        _sum: { amountCents: true },
        _count: true,
      }),
      this.prisma.user.aggregate({ _sum: { walletBalanceCents: true } }),
    ]);

    const roles = await this.prisma.role.findMany();
    const byRole: Record<string, number> = {};
    for (const r of roles) {
      byRole[r.name] = roleRows.find((row) => row.roleId === r.id)?._count.userId ?? 0;
    }

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        locked: lockedUsers,
        byRole,
      },
      courses: {
        total: totalCourses,
        published: publishedCourses,
        draft: draftCourses,
        freeCount: freeCourses,
        paidCount: paidCourses,
      },
      submissions: {
        total: totalSubmissions,
        ac: acSubmissions,
        last7d: recentSubmissions,
      },
      revenue: {
        approvedTopupCents: approvedTopupAgg._sum.amountCents ?? 0,
        approvedTopupCount: approvedTopupAgg._count,
        pendingTopupCents: pendingTopupAgg._sum.amountCents ?? 0,
        pendingTopupCount: pendingTopupAgg._count,
        walletLiabilityCents: walletAgg._sum.walletBalanceCents ?? 0,
      },
    };
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
}
