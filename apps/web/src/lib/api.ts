import type {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  ApiErrorShape,
} from '@lms/shared-types';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
    public correlationId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    let body: ApiErrorShape | null = null;
    try {
      body = (await res.json()) as ApiErrorShape;
    } catch {
      /* non-JSON error; leave body null */
    }
    throw new ApiError(
      res.status,
      body?.error.code ?? `http_${res.status}`,
      body?.error.message ?? res.statusText,
      body?.error.details,
      body?.error.correlation_id,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

import type {
  CourseDetail,
  CourseSummary,
  EnrollResponse,
  LessonDetail,
  PaginatedCourses,
  Submission,
  SubmissionSummary,
} from '@lms/shared-types';

function authHeaders(token?: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---- Billing v1 — wallet manual topup (P6) ---------------------------
// Kept local rather than in @lms/shared-types since only the student
// wallet page + admin console consume it today.

export type TopupMethod = 'momo' | 'bank';
export type TopupStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface WalletBalanceDto {
  balanceCents: number;
  currency: 'VND';
}

export interface WalletTopupDto {
  id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  amountCents: number;
  currency: string;
  method: TopupMethod;
  status: TopupStatus;
  referenceCode: string;
  userNote: string | null;
  adminNote: string | null;
  qrImageUrl: string | null;
  createdAt: string;
  approvedAt: string | null;
}

export interface WalletInstructionsDto {
  momo: { phone: string; holder: string; qrUrl: string };
  bank: { bin: string; name: string; account: string; holder: string };
  currency: 'VND';
}

export const api = {
  register: (dto: RegisterRequest) =>
    request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  login: (dto: LoginRequest) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),

  // Catalog
  listCourses: (params?: { limit?: number; cursor?: string; locale?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.cursor) q.set('cursor', params.cursor);
    if (params?.locale) q.set('locale', params.locale);
    const qs = q.toString();
    return request<PaginatedCourses>(`/courses${qs ? `?${qs}` : ''}`);
  },
  getCourse: (slug: string, token?: string | null) =>
    request<CourseDetail>(`/courses/${slug}`, { headers: authHeaders(token) }),

  // Enrollment
  enroll: (slug: string, token: string) =>
    request<EnrollResponse>('/enrollments', {
      method: 'POST',
      body: JSON.stringify({ course_slug: slug }),
      headers: authHeaders(token),
    }),
  myEnrollments: (token: string) =>
    request<CourseSummary[]>('/me/enrollments', { headers: authHeaders(token) }),

  // Lesson player
  getLesson: (id: string, token: string) =>
    request<LessonDetail>(`/lessons/${id}`, { headers: authHeaders(token) }),

  // Submissions
  submit: (token: string, dto: { exercise_id: string; source_code: string }) =>
    request<Submission>('/submissions', {
      method: 'POST',
      body: JSON.stringify(dto),
      headers: authHeaders(token),
    }),
  getSubmission: (token: string, id: string) =>
    request<Submission>(`/submissions/${id}`, { headers: authHeaders(token) }),
  mySubmissionsForExercise: (token: string, exerciseId: string) =>
    request<SubmissionSummary[]>(`/me/submissions?exercise_id=${exerciseId}`, {
      headers: authHeaders(token),
    }),

  // Wallet v1 (P6 manual top-up) -----------------------------------------
  wallet: {
    instructions: () => request<WalletInstructionsDto>('/wallet/instructions'),
    balance: (token: string) =>
      request<WalletBalanceDto>('/wallet/me', { headers: authHeaders(token) }),
    createTopup: (
      token: string,
      dto: { amount_cents: number; method: TopupMethod; user_note?: string },
    ) =>
      request<WalletTopupDto>('/wallet/me/topups', {
        method: 'POST',
        body: JSON.stringify(dto),
        headers: authHeaders(token),
      }),
    myTopups: (token: string) =>
      request<WalletTopupDto[]>('/wallet/me/topups', { headers: authHeaders(token) }),
    cancelTopup: (token: string, id: string) =>
      request<{ ok: true }>(`/wallet/me/topups/${id}/cancel`, {
        method: 'PATCH',
        headers: authHeaders(token),
      }),
    purchase: (token: string, courseSlug: string) =>
      request<{ entitlementId: string; remainingBalanceCents: number }>(
        '/wallet/me/purchase',
        {
          method: 'POST',
          body: JSON.stringify({ course_slug: courseSlug }),
          headers: authHeaders(token),
        },
      ),
    admin: {
      listTopups: (token: string, status?: TopupStatus) =>
        request<WalletTopupDto[]>(
          `/wallet/admin/topups${status ? `?status=${status}` : ''}`,
          { headers: authHeaders(token) },
        ),
      approve: (token: string, id: string, adminNote?: string) =>
        request<WalletTopupDto>(`/wallet/admin/topups/${id}/approve`, {
          method: 'PATCH',
          body: JSON.stringify({ admin_note: adminNote }),
          headers: authHeaders(token),
        }),
      reject: (token: string, id: string, adminNote?: string) =>
        request<WalletTopupDto>(`/wallet/admin/topups/${id}/reject`, {
          method: 'PATCH',
          body: JSON.stringify({ admin_note: adminNote }),
          headers: authHeaders(token),
        }),
    },
  },

  // Admin (P7) — role-gated server-side.
  admin: {
    metrics: (token: string) =>
      request<{
        users: { total: number; active: number; locked: number; byRole: Record<string, number> };
        courses: { total: number; published: number; draft: number; freeCount: number; paidCount: number };
        submissions: { total: number; ac: number; last7d: number };
        revenue: {
          approvedTopupCents: number;
          approvedTopupCount: number;
          pendingTopupCents: number;
          pendingTopupCount: number;
          walletLiabilityCents: number;
        };
      }>('/admin/metrics', { headers: authHeaders(token) }),
    listUsers: (
      token: string,
      params?: { q?: string; role?: string; status?: 'active' | 'locked' | 'pending' },
    ) => {
      const qs = new URLSearchParams();
      if (params?.q) qs.set('q', params.q);
      if (params?.role) qs.set('role', params.role);
      if (params?.status) qs.set('status', params.status);
      const s = qs.toString();
      return request<
        Array<{
          id: string;
          email: string;
          displayName: string;
          avatarUrl: string | null;
          locale: string;
          status: 'active' | 'locked' | 'pending';
          roles: string[];
          walletBalanceCents: number;
          createdAt: string;
        }>
      >(`/admin/users${s ? `?${s}` : ''}`, { headers: authHeaders(token) });
    },
    setUserStatus: (token: string, id: string, status: 'active' | 'locked') =>
      request<unknown>(`/admin/users/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
        headers: authHeaders(token),
      }),
  },

  // Knowledge Graph (P5b/c) ---------------------------------------------
  knowledge: {
    listNodes: (domain?: string) =>
      request<Array<{ id: string; slug: string; title: string; domain: string }>>(
        `/knowledge/nodes${domain ? `?domain=${encodeURIComponent(domain)}` : ''}`,
      ),
    myRecommendations: (token: string) =>
      request<
        Array<{
          id: string;
          slug: string;
          title: string;
          description: string | null;
          pricingModel: 'free' | 'paid';
          priceCents: number | null;
          matchedNodes: string[];
        }>
      >('/knowledge/me/recommendations', { headers: authHeaders(token) }),
    myMastery: (token: string) =>
      request<
        Array<{
          node: { id: string; slug: string; title: string; domain: string };
          score: number;
          confidence: number;
          attempts: number;
          lastUpdatedAt: string;
        }>
      >('/knowledge/me/mastery', { headers: authHeaders(token) }),
    nextSuggestion: (token: string, lessonId: string) =>
      request<{
        lessonId: string;
        title: string;
        courseSlug: string;
        gatedByPrereq: boolean;
      } | null>(`/knowledge/lessons/${lessonId}/next-suggestion`, {
        headers: authHeaders(token),
      }),
    lessonTags: (lessonId: string) =>
      request<{ tags: string[] }>(`/knowledge/lessons/${lessonId}/tags`),
    tagLesson: (token: string, lessonId: string, nodeSlugs: string[]) =>
      request<{ tagged: string[] }>(`/knowledge/lessons/${lessonId}/tags`, {
        method: 'PUT',
        body: JSON.stringify({ node_slugs: nodeSlugs }),
        headers: authHeaders(token),
      }),
  },

  // Teacher / Studio — all require Bearer; backend enforces teacher|admin role.
  teacher: {
    listMine: (token: string) =>
      request<CourseSummary[]>('/teacher/courses', { headers: authHeaders(token) }),
    detail: (token: string, id: string) =>
      request<CourseDetail>(`/teacher/courses/${id}`, { headers: authHeaders(token) }),
    create: (
      token: string,
      dto: {
        slug: string;
        title: string;
        description?: string;
        locale?: 'vi' | 'en';
        pricing_model?: 'free' | 'paid';
        price_cents?: number;
        currency?: string;
        cover_url?: string;
      },
    ) =>
      // Returns the raw Course row — we only need .id + .slug to navigate.
      request<{ id: string; slug: string }>('/teacher/courses', {
        method: 'POST',
        body: JSON.stringify(dto),
        headers: authHeaders(token),
      }),
    update: (
      token: string,
      id: string,
      dto: Partial<{
        title: string;
        description: string;
        locale: 'vi' | 'en';
        pricing_model: 'free' | 'paid';
        price_cents: number;
        currency: string;
        cover_url: string;
      }>,
    ) =>
      request<{ id: string }>(`/teacher/courses/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
        headers: authHeaders(token),
      }),
    remove: (token: string, id: string) =>
      request<void>(`/teacher/courses/${id}`, { method: 'DELETE', headers: authHeaders(token) }),
    publish: (token: string, id: string) =>
      request<{ id: string; status: string }>(`/teacher/courses/${id}/publish`, {
        method: 'POST',
        headers: authHeaders(token),
      }),
    unpublish: (token: string, id: string) =>
      request<{ id: string; status: string }>(`/teacher/courses/${id}/unpublish`, {
        method: 'POST',
        headers: authHeaders(token),
      }),
    analytics: (token: string, id: string) =>
      request<{
        enrollmentCount: number;
        uniqueSubmitters: number;
        totalSubmissions: number;
        acSubmissions: number;
        acRate: number;
        perLesson: Array<{
          lessonId: string;
          lessonTitle: string;
          totalSubmissions: number;
          acSubmissions: number;
          acRate: number;
          knowledgeNodes: string[];
        }>;
        weakestConcepts: Array<{
          slug: string;
          title: string;
          totalSubmissions: number;
          acRate: number;
        }>;
      }>(`/teacher/courses/${id}/analytics`, { headers: authHeaders(token) }),
    addModule: (token: string, courseId: string, dto: { title: string; sort_order: number }) =>
      request<{ id: string }>(`/teacher/courses/${courseId}/modules`, {
        method: 'POST',
        body: JSON.stringify(dto),
        headers: authHeaders(token),
      }),
    addLesson: (
      token: string,
      courseId: string,
      moduleId: string,
      dto: {
        title: string;
        sort_order: number;
        type: 'markdown' | 'exercise' | 'quiz';
        content_markdown?: string;
        est_minutes?: number;
      },
    ) =>
      request<{ id: string }>(`/teacher/courses/${courseId}/modules/${moduleId}/lessons`, {
        method: 'POST',
        body: JSON.stringify(dto),
        headers: authHeaders(token),
      }),
  },

  // Lesson micro-check quiz + completion tracking (P9.0, refined).
  // `get` lazily generates a 1–2 question "Câu hỏi ôn tập nhanh" on first
  // open and caches it server-side. Any attempt marks the lesson complete;
  // `markComplete` is the no-quiz alternative for a relaxed theory flow.
  quiz: {
    get: (token: string, lessonId: string) =>
      request<{
        lesson_id: string;
        generated_at: string;
        model: string;
        pass_threshold: number;
        questions: Array<{ id: string; question: string; options: string[] }>;
        attempts: Array<{ id: string; score: number; passed: boolean; attempted_at: string }>;
        best_score: number | null;
        completed: boolean;
      }>(`/lessons/${lessonId}/quiz`, { headers: authHeaders(token) }),
    attempt: (
      token: string,
      lessonId: string,
      answers: Array<{ question_id: string; selected_index: number }>,
    ) =>
      request<{
        attempt_id: string;
        score: number;
        passed: boolean;
        pass_threshold: number;
        details: Array<{
          question_id: string;
          selected_index: number;
          correct_index: number;
          correct: boolean;
          explanation: string;
        }>;
        fired_mastery_rebuild: boolean;
        completed: boolean;
      }>(`/lessons/${lessonId}/quiz/attempts`, {
        method: 'POST',
        body: JSON.stringify({ answers }),
        headers: authHeaders(token),
      }),
    markComplete: (token: string, lessonId: string) =>
      request<{
        completed: boolean;
        method: 'mark' | 'quiz';
        completed_at: string;
      }>(`/lessons/${lessonId}/complete`, {
        method: 'POST',
        headers: authHeaders(token),
      }),
  },
};
