'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/lib/i18n/routing';
import { api, ApiError } from '@/lib/api';

/**
 * Enroll CTA. Props:
 *   enrolled        — parent-owned state so the lesson list can flip to
 *                     clickable links the moment this button succeeds
 *                     (we don't redirect the user away any more).
 *   firstLessonId   — destination for the "Start learning" shortcut.
 *   onEnrolled      — callback the parent uses to flip its `enrolled`
 *                     state without a server round-trip.
 */
export function EnrollButton({
  slug,
  enrolled,
  firstLessonId,
  onEnrolled,
}: {
  slug: string;
  enrolled: boolean;
  firstLessonId: string | null;
  onEnrolled: () => void;
}) {
  const t = useTranslations('catalog');
  const router = useRouter();
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

  const startLearning = () => {
    if (firstLessonId) {
      router.push(`/courses/${slug}/learn/${firstLessonId}` as never);
    } else {
      router.push('/dashboard');
    }
  };

  const onClick = async () => {
    setError(null);
    let token: string | null = null;
    try {
      token = sessionStorage.getItem('lms-access');
    } catch {
      token = null;
    }
    if (!token) {
      router.push('/login');
      return;
    }
    setLoading(true);
    try {
      await api.enroll(slug, token);
      // Keep the student on this page — the parent updates its enrollment
      // state via this callback so the curriculum becomes clickable.
      onEnrolled();
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
          onClick={startLearning}
          className="btn w-full justify-center"
        >
          {firstLessonId ? t('start_learning') : t('go_dashboard')}
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
