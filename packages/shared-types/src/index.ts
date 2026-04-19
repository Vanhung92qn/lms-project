/**
 * Shared TypeScript contracts between api-core and web.
 * Later, these will be regenerated from the OpenAPI spec via
 * `openapi-typescript`. Hand-edits here are temporary.
 */

export type Locale = 'vi' | 'en';
export type Role = 'student' | 'teacher' | 'admin' | 'ai_engine';

// -------------------- IAM --------------------

export interface RegisterRequest {
  email: string;
  password: string;
  display_name: string;
  locale?: Locale;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  access_expires_in: number; // seconds
  refresh_expires_in: number; // seconds
}

export interface UserSummary {
  id: string;
  email: string;
  display_name: string;
  locale: Locale;
  roles: Role[];
}

export interface AuthResponse {
  user: UserSummary;
  tokens: TokenPair;
}

// -------------------- Errors --------------------

export interface ApiErrorShape {
  error: {
    code: string;
    message: string;
    message_vi?: string;
    details?: Record<string, unknown>;
    correlation_id: string;
  };
}
