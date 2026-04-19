'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { UpdateProfileRequest, UserSummary } from '@lms/shared-types';

// Client-only session state. The actual tokens stay in sessionStorage; this
// provider keeps the parsed user record in React state so every component
// that calls useSession() re-renders the instant login / logout happens.
//
// SECURITY NOTE — sessionStorage is readable by any JS running on the page.
// Moving to an HttpOnly cookie is a P8 hardening task; for now the browser
// is trusted.

const API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');
const KEY_ACCESS = 'lms-access';
const KEY_REFRESH = 'lms-refresh';

interface SessionState {
  user: UserSummary | null;
  isLoading: boolean;
  login: (access: string, refresh: string, user: UserSummary) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateProfile: (patch: UpdateProfileRequest) => Promise<UserSummary>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const readToken = useCallback((): string | null => {
    try {
      return sessionStorage.getItem(KEY_ACCESS);
    } catch {
      return null;
    }
  }, []);

  const fetchMe = useCallback(async (): Promise<void> => {
    const token = readToken();
    if (!token) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API}/me`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!res.ok) {
        // Stale token — clear and drop to anonymous.
        try {
          sessionStorage.removeItem(KEY_ACCESS);
          sessionStorage.removeItem(KEY_REFRESH);
        } catch {
          /* ignore */
        }
        setUser(null);
      } else {
        setUser((await res.json()) as UserSummary);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, [readToken]);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  const login = useCallback<SessionState['login']>((access, refresh, u) => {
    try {
      sessionStorage.setItem(KEY_ACCESS, access);
      sessionStorage.setItem(KEY_REFRESH, refresh);
    } catch {
      /* private browsing — ignore */
    }
    setUser(u);
    setIsLoading(false);
  }, []);

  const logout = useCallback<SessionState['logout']>(async () => {
    let access: string | null = null;
    let refresh: string | null = null;
    try {
      access = sessionStorage.getItem(KEY_ACCESS);
      refresh = sessionStorage.getItem(KEY_REFRESH);
    } catch {
      /* ignore */
    }
    // Revoke refresh-token family on the server — fire and forget.
    if (access && refresh) {
      try {
        await fetch(`${API}/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${access}`,
          },
          body: JSON.stringify({ refresh_token: refresh }),
        });
      } catch {
        /* network failure is non-fatal for logout */
      }
    }
    try {
      sessionStorage.removeItem(KEY_ACCESS);
      sessionStorage.removeItem(KEY_REFRESH);
    } catch {
      /* ignore */
    }
    setUser(null);
  }, []);

  const updateProfile = useCallback<SessionState['updateProfile']>(async (patch) => {
    const token = readToken();
    if (!token) throw new Error('Not signed in');
    const res = await fetch(`${API}/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message =
        (body as { error?: { message?: string } })?.error?.message ?? 'Update failed';
      throw new Error(message);
    }
    const next = (await res.json()) as UserSummary;
    setUser(next);
    return next;
  }, [readToken]);

  const value = useMemo<SessionState>(
    () => ({ user, isLoading, login, logout, refresh: fetchMe, updateProfile }),
    [user, isLoading, login, logout, fetchMe, updateProfile],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used inside <SessionProvider>');
  }
  return ctx;
}
