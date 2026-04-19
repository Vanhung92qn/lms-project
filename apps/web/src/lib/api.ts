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
  PaginatedCourses,
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
};
