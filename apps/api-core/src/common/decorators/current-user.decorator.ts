import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../../modules/iam/auth/auth.types';

/**
 * Usage: `@CurrentUser() user: AuthenticatedUser`
 *
 * Resolves to whatever JwtAuthGuard attached to `req.user` after verifying
 * the access token. Throws implicitly if no auth happened upstream — a
 * safety net against accidentally exposing the decorator on a public route.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!req.user) {
      throw new Error('CurrentUser used on a route without JwtAuthGuard');
    }
    return req.user;
  },
);
