import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import type { AuthenticatedUser, JwtAccessPayload } from './auth.types';

/**
 * Verifies Bearer access tokens and attaches an AuthenticatedUser onto the
 * request. Public routes (those decorated with @Public()) bypass this guard.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'missing_token', message: 'Authorization header missing' });
    }
    const token = header.slice(7).trim();
    try {
      const payload = this.jwt.verify<JwtAccessPayload>(token, {
        secret: this.config.get<string>('app.jwt.accessSecret'),
      });
      req.user = {
        id: payload.sub,
        email: payload.email,
        roles: payload.roles,
        locale: payload.locale,
      };
      return true;
    } catch {
      throw new UnauthorizedException({ code: 'invalid_token', message: 'Invalid or expired access token' });
    }
  }
}
