import type { Role } from '@lms/shared-types';

export interface JwtAccessPayload {
  sub: string; // user id
  email: string;
  roles: Role[];
  locale: string;
  jti: string; // unique token id (for future blacklisting)
}

export interface JwtRefreshPayload {
  sub: string;
  family: string; // family id for reuse detection
  jti: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  roles: Role[];
  locale: string;
}
