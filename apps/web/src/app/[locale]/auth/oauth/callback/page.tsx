'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/lib/i18n/routing';

/**
 * OAuth callback landing. Reads the `#access_token=...&refresh_token=...`
 * URL fragment the backend set after exchanging the provider's code, then
 * persists tokens to session storage and forwards the user to /dashboard.
 *
 * Fragments are never sent to the server, so these tokens don't appear in
 * server logs.
 */
export default function OAuthCallbackPage() {
  const t = useTranslations('auth.errors');
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const frag = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(frag);

    const err = params.get('error');
    if (err) {
      setMessage(t('oauth_failed'));
      return;
    }

    const access = params.get('access_token');
    const refresh = params.get('refresh_token');
    if (!access || !refresh) {
      setMessage(t('oauth_failed'));
      return;
    }

    try {
      sessionStorage.setItem('lms-access', access);
      sessionStorage.setItem('lms-refresh', refresh);
    } catch {
      /* private browsing — tokens still work for this tab via memory handoff later */
    }

    // Clear the fragment so the tokens don't sit in the URL bar.
    window.history.replaceState(null, '', window.location.pathname);
    router.replace('/dashboard');
  }, [router, t]);

  return (
    <main className="grid min-h-[60vh] place-items-center px-6">
      <div className="card text-center">
        {message ? (
          <p className="text-sm" style={{ color: '#ff6b6b' }}>
            {message}
          </p>
        ) : (
          <p className="text-text-muted">…</p>
        )}
      </div>
    </main>
  );
}
