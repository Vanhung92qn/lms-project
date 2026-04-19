import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AuthResponse, TokenPair, UserSummary, Role } from '@lms/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/login.dto';
import type { JwtAccessPayload, JwtRefreshPayload } from './auth.types';

/**
 * AuthService owns password hashing, JWT issuance, and the refresh-token
 * rotation ledger (see ADR / security.md). Public API:
 *
 *   register(dto)        → AuthResponse  (also creates default 'student' role)
 *   login(dto)           → AuthResponse
 *   rotateRefresh(token) → TokenPair      (detects & revokes reused families)
 *   logout(userId,token) → void
 */
@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException({ code: 'email_taken', message: 'Email already registered' });

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    const studentRole = await this.prisma.role.findUnique({ where: { name: 'student' } });
    if (!studentRole) throw new Error('Seed error: role "student" missing');

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        displayName: dto.display_name,
        locale: dto.locale ?? 'vi',
        userRoles: { create: [{ roleId: studentRole.id }] },
      },
      include: { userRoles: { include: { role: true } } },
    });

    await this.writeAudit(user.id, 'user_registered');

    return this.buildAuthResponse(user.id, user.email, user.locale, ['student']);
  }

  async login(dto: LoginDto, meta?: { ip?: string; userAgent?: string }): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { userRoles: { include: { role: true } } },
    });
    if (!user || user.status !== 'active') {
      // Use same error for "no such email" and "wrong password" to avoid user enumeration.
      throw new UnauthorizedException({ code: 'invalid_credentials', message: 'Email or password is incorrect' });
    }
    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) {
      await this.writeAudit(user.id, 'login_failed', meta);
      throw new UnauthorizedException({ code: 'invalid_credentials', message: 'Email or password is incorrect' });
    }

    const roles = user.userRoles.map((ur) => ur.role.name as Role);
    await this.writeAudit(user.id, 'login', meta);
    return this.buildAuthResponse(user.id, user.email, user.locale, roles, meta);
  }

  async rotateRefresh(
    rawToken: string,
    meta?: { ip?: string; userAgent?: string },
  ): Promise<TokenPair> {
    const payload = this.verifyRefresh(rawToken);

    const record = await this.prisma.refreshToken.findUnique({ where: { id: payload.jti } });
    if (!record || record.userId !== payload.sub) {
      throw new UnauthorizedException({ code: 'invalid_refresh', message: 'Refresh token not recognized' });
    }

    if (record.revokedAt) {
      // Reuse detection: whole family is now suspect — revoke everything.
      await this.prisma.refreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.writeAudit(record.userId, 'refresh_reuse_detected', meta);
      throw new ForbiddenException({ code: 'refresh_reuse', message: 'Refresh token reuse detected; please log in again' });
    }

    if (record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException({ code: 'refresh_expired', message: 'Refresh token expired' });
    }

    const ok = await argon2.verify(record.tokenHash, rawToken);
    if (!ok) throw new UnauthorizedException({ code: 'invalid_refresh', message: 'Refresh token not recognized' });

    // Rotate: revoke current, issue fresh pair within the same family.
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: record.userId },
      include: { userRoles: { include: { role: true } } },
    });
    const roles = user.userRoles.map((ur) => ur.role.name as Role);
    const tokens = await this.issueTokens(user.id, user.email, user.locale, roles, record.familyId, meta);
    await this.writeAudit(user.id, 'refresh', meta);
    return tokens;
  }

  async logout(userId: string, rawToken?: string): Promise<void> {
    if (!rawToken) return;
    try {
      const payload = this.verifyRefresh(rawToken);
      if (payload.sub !== userId) return;
      await this.prisma.refreshToken.updateMany({
        where: { familyId: payload.family, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.writeAudit(userId, 'logout');
    } catch {
      // ignore — we never surface refresh-token shape issues on logout
    }
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  private verifyRefresh(token: string): JwtRefreshPayload {
    try {
      return this.jwt.verify<JwtRefreshPayload>(token, {
        secret: this.config.get<string>('app.jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException({ code: 'invalid_refresh', message: 'Refresh token not recognized' });
    }
  }

  private async buildAuthResponse(
    userId: string,
    email: string,
    locale: string,
    roles: Role[],
    meta?: { ip?: string; userAgent?: string },
  ): Promise<AuthResponse> {
    const familyId = randomUUID();
    const tokens = await this.issueTokens(userId, email, locale, roles, familyId, meta);
    const user: UserSummary = {
      id: userId,
      email,
      display_name: '', // filled below
      locale: (locale as 'vi' | 'en') ?? 'vi',
      roles,
    };
    const dbUser = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    user.display_name = dbUser.displayName;
    return { user, tokens };
  }

  private async issueTokens(
    userId: string,
    email: string,
    locale: string,
    roles: Role[],
    familyId: string,
    meta?: { ip?: string; userAgent?: string },
  ): Promise<TokenPair> {
    const accessJti = randomUUID();
    const refreshJti = randomUUID();

    const accessPayload: JwtAccessPayload = {
      sub: userId,
      email,
      roles,
      locale,
      jti: accessJti,
    };
    const refreshPayload: JwtRefreshPayload = { sub: userId, family: familyId, jti: refreshJti };

    const accessTtl = this.config.get<string>('app.jwt.accessTtl') ?? '15m';
    const refreshTtl = this.config.get<string>('app.jwt.refreshTtl') ?? '30d';

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.get<string>('app.jwt.accessSecret'),
      expiresIn: accessTtl,
    });
    // Wrap the random material into a JWT so clients have one uniform format.
    // We still store a hash of the raw token in DB and verify on rotate.
    const refreshRaw = randomBytes(48).toString('base64url');
    const refreshToken = await this.jwt.signAsync(
      { ...refreshPayload, seed: refreshRaw },
      {
        secret: this.config.get<string>('app.jwt.refreshSecret'),
        expiresIn: refreshTtl,
        jwtid: refreshJti,
      },
    );

    const expiresAt = new Date(Date.now() + parseDuration(refreshTtl));
    await this.prisma.refreshToken.create({
      data: {
        id: refreshJti,
        userId,
        tokenHash: await argon2.hash(refreshToken, { type: argon2.argon2id }),
        familyId,
        expiresAt,
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      },
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      access_expires_in: Math.floor(parseDuration(accessTtl) / 1000),
      refresh_expires_in: Math.floor(parseDuration(refreshTtl) / 1000),
    };
  }

  private async writeAudit(
    userId: string | null,
    event: string,
    meta?: { ip?: string; userAgent?: string },
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: { userId, event, ip: meta?.ip, userAgent: meta?.userAgent },
      });
    } catch (e) {
      this.log.warn(`audit write failed: ${(e as Error).message}`);
    }
  }
}

/**
 * Parse a short duration string like '15m', '30d', '2h' into milliseconds.
 * Falls back to 15 minutes if the input is malformed — deliberately lenient
 * because this runs at bootstrap and we never want config typos to crash.
 */
function parseDuration(s: string): number {
  const m = /^(\d+)([smhd])$/.exec(s.trim());
  if (!m) return 15 * 60_000;
  const n = Number(m[1]);
  switch (m[2]) {
    case 's':
      return n * 1000;
    case 'm':
      return n * 60_000;
    case 'h':
      return n * 3_600_000;
    case 'd':
      return n * 86_400_000;
    default:
      return 15 * 60_000;
  }
}
