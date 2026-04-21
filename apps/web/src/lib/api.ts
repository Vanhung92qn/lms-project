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
  LeaderboardSummary,
  LessonDetail,
  PaginatedLeaderboardEntries,
  PaginatedCourses,
  Submission,
  SubmissionSummary,
} from '@lms/shared-types';

function authHeaders(token?: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
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

  // Leaderboards
  listLeaderboards: () => request<LeaderboardSummary[]>('/leaderboards'),
  leaderboardEntries: (leaderboardId: string, params?: { cursor?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.cursor) q.set('cursor', params.cursor);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return request<PaginatedLeaderboardEntries>(
      `/leaderboards/${leaderboardId}/entries${qs ? `?${qs}` : ''}`,
    );
  },
  leaderboardAroundMe: (leaderboardId: string, token: string) =>
    request<{ items: Array<PaginatedLeaderboardEntries['items'][number]> }>(
      `/leaderboards/${leaderboardId}/entries/around-me`,
      { headers: authHeaders(token) },
    ),

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
};
