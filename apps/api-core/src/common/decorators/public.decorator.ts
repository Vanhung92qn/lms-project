import { SetMetadata } from '@nestjs/common';

/**
 * Opt routes out of the global JwtAuthGuard.
 * Use sparingly — only on /healthz, auth/register, auth/login, auth/refresh.
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
