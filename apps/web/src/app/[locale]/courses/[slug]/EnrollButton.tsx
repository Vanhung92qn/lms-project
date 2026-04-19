'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/lib/i18n/routing';
import { api, ApiError } from '@/lib/api';

/**
 * Client-only enroll button.
 *
 * - Reads the access token from sessionStorage (set by login/register/oauth).
 * - If no token, redirects to /login (preserving intent via `next=` query).
 * - On success, flips the local state to "already enrolled" and nudges the
 *   user to /dashboard.
 */
export function EnrollButton({
  slug,
  initialEnrolled,
}: {
  slug: string;
  initialEnrolled: boolean;
}) {
  const t = useTranslations('catalog');
  const router = useRouter();
  const [enrolled, setEnrolled] = useState<boolean>(initialEnrolled);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    try {
      setHasToken(Boolean(sessionStorage.getItem('lms-access')));
    } catch {
      setHasToken(false);
    }
  }, []);

  const onClick = async () => {
    setError(null);
    let token: string | null = null;
    try {
      token = sessionStorage.getItem('lms-access');
    } catch {
      token = null;
    }
    if (!token) {
      router.push(`/login`);
      return;
    }
    setLoading(true);
    try {
      await api.enroll(slug, token);
      setEnrolled(true);
      router.push('/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t('enroll_failed'));
      }
    } finally {
      setLoading(false);
    }
  };

  if (enrolled) {
    return (
      <div className="flex flex-col gap-2">
        <div className="rounded-pill border border-accent bg-accent/10 px-5 py-3 text-center text-sm font-semibold text-accent">
          {t('enrolled')}
        </div>
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="btn btn-secondary w-full justify-center"
        >
          {t('go_dashboard')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="btn w-full justify-center"
      >
        {loading ? '…' : hasToken ? t('enroll_now') : t('login_to_enroll')}
      </button>
      {error ? (
        <p className="text-sm" style={{ color: '#ff6b6b' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
