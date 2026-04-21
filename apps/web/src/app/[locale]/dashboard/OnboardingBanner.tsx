'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/routing';
import { api, ApiError } from '@/lib/api';

// Shows on the student dashboard until the onboarding profile exists.
// Dismiss persists in sessionStorage so students aren't nagged forever
// within a single session; a fresh login re-shows it (safe — it's a
// 30-second task). Hides itself entirely once the student has filled
// the questionnaire or manually skipped this session.

const DISMISS_KEY = 'lms-onboarding-dismissed';

export function OnboardingBanner() {
  const t = useTranslations('onboarding.banner');
  const [show, setShow] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      /* ignore private-browsing / no-storage envs */
    }
    if (dismissed) return;

    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    (async () => {
      try {
        const { profile } = await api.onboarding.get(token);
        if (!profile) setShow(true);
      } catch (err) {
        // Only suppress on auth — network blips we quietly ignore so the
        // banner doesn't flash on every page load.
        if (err instanceof ApiError && err.status === 401) return;
      }
    })();
  }, []);

  if (!show) return null;

  const onDismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  return (
    <div
      className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-box p-4"
      style={{
        background: 'rgba(247, 189, 77, 0.08)',
        border: '1px solid rgba(247, 189, 77, 0.35)',
      }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>
          ✨ {t('title')}
        </p>
        <p className="mt-1 text-xs text-text-muted">{t('subtitle')}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-pill border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text"
        >
          {t('dismiss')}
        </button>
        <Link
          href={'/onboarding' as never}
          className="rounded-pill bg-accent px-4 py-1.5 text-xs font-semibold text-panel transition-colors hover:bg-accent-hover"
        >
          {t('cta')}
        </Link>
      </div>
    </div>
  );
}
