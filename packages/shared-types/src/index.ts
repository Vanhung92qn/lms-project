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
  avatar_url?: string | null;
  locale: Locale;
  roles: Role[];
  created_at?: string;
}

export interface UpdateProfileRequest {
  display_name?: string;
  locale?: Locale;
  avatar_url?: string; // '' clears
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

// -------------------- Assessment / Submissions --------------------

export type Verdict = 'pending' | 'ac' | 'wa' | 'tle' | 'mle' | 'ce' | 're' | 'ie';

export interface SubmissionTestResult {
  test_case_id: string;
  passed: boolean;
  verdict: Verdict;
  actual_output: string | null;
  runtime_ms: number | null;
}

export interface Submission {
  id: string;
  exercise_id: string;
  language: CodeLanguage;
  verdict: Verdict;
  runtime_ms: number | null;
  memory_kb: number | null;
  stderr: string | null;
  created_at: string;
  finished_at: string | null;
  source_code: string;
  test_results: SubmissionTestResult[];
}

export interface SubmissionSummary {
  id: string;
  verdict: Verdict;
  runtime_ms: number | null;
  created_at: string;
}

export interface SubmitRequest {
  exercise_id: string;
  source_code: string;
}

// -------------------- Lesson player --------------------

export interface LessonExerciseDetail {
  id: string;
  language: CodeLanguage;
  starter_code: string;
  time_limit_ms: number;
  memory_limit_mb: number;
  sample_test_cases: Array<{ id: string; input: string; expected_output: string }>;
}

export interface LessonNavLink {
  id: string;
  title: string;
}

export interface LessonDetail {
  id: string;
  title: string;
  type: LessonType;
  content_markdown: string;
  sort_order: number;
  est_minutes: number | null;
  course: { id: string; slug: string; title: string };
  module: { id: string; title: string };
  prev_lesson: LessonNavLink | null;
  next_lesson: LessonNavLink | null;
  exercise: LessonExerciseDetail | null;
}

// -------------------- Leaderboards --------------------

export type LeaderboardScope = 'global' | 'course';

export interface LeaderboardSummary {
  id: string;
  scope: LeaderboardScope;
  title: string;
  course_id: string | null;
  updated_at: string;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  score: number;
  solved_count: number;
  penalty_seconds: number;
  last_submission_at: string | null;
  is_me?: boolean;
}

export interface PaginatedLeaderboardEntries {
  items: LeaderboardEntry[];
  page: { cursor: string | null; limit: number; has_more: boolean };
}
