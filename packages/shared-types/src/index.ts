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

// -------------------- Catalog --------------------

export type CourseStatus = 'draft' | 'published' | 'archived';
export type PricingModel = 'free' | 'paid';
export type LessonType = 'markdown' | 'exercise' | 'quiz';
export type CodeLanguage = 'c' | 'cpp' | 'js' | 'python';

export interface CourseSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  teacher: { id: string; display_name: string };
  status: CourseStatus;
  pricing_model: PricingModel;
  price_cents: number | null;
  currency: string | null;
  cover_url: string | null;
  locale: string;
  published_at: string | null;
  lesson_count: number;
}

export interface LessonSummary {
  id: string;
  title: string;
  sort_order: number;
  type: LessonType;
  est_minutes: number | null;
}

export interface ModuleWithLessons {
  id: string;
  title: string;
  sort_order: number;
  lessons: LessonSummary[];
}

export interface CourseDetail extends CourseSummary {
  modules: ModuleWithLessons[];
  is_enrolled: boolean;
}

export interface PaginatedCourses {
  items: CourseSummary[];
  page: { cursor: string | null; limit: number; has_more: boolean };
}

export interface EnrollRequest {
  // no body — derived from authenticated user
  course_id?: string;
}

export interface EnrollResponse {
  enrollment: {
    id: string;
    user_id: string;
    course_id: string;
    enrolled_at: string;
    progress_pct: number;
  };
}
