'use client';

import { useTranslations } from 'next-intl';

/**
 * Renders Google + GitHub "Continue with..." buttons. Each links to the
 * backend `/api/v1/auth/oauth/<provider>/start` endpoint which 302s to the
 * provider's consent page.
 *
 * Backend env vars required for the buttons to actually work:
 *   GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
 *   GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET
 * See docs/runbook/oauth-setup.md.
 */
export function OAuthButtons({ intent }: { intent: 'login' | 'register' }) {
  const t = useTranslations(`auth.${intent}`);
  const apiBase =
    (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');

  return (
    <div className="flex flex-col gap-2">
      <a
        href={`${apiBase}/auth/oauth/google/start`}
        className="flex items-center justify-center gap-2 rounded-pill border border-border bg-panel px-4 py-3 text-sm font-medium text-text transition-all hover:border-accent hover:text-accent"
      >
        <GoogleGlyph className="h-5 w-5" />
        {t('continue_with_google')}
      </a>
      <a
        href={`${apiBase}/auth/oauth/github/start`}
        className="flex items-center justify-center gap-2 rounded-pill border border-border bg-panel px-4 py-3 text-sm font-medium text-text transition-all hover:border-accent hover:text-accent"
      >
        <GithubGlyph className="h-5 w-5" />
        {t('continue_with_github')}
      </a>
    </div>
  );
}

function GoogleGlyph({ className }: { className?: string }) {
  // Multi-colour Google "G" — kept inline so it survives any theme change.
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );
}

function GithubGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 .5C5.73.5.5 5.74.5 12.02c0 5.08 3.29 9.38 7.86 10.9.58.1.79-.25.79-.55v-1.92c-3.2.69-3.88-1.54-3.88-1.54-.52-1.32-1.28-1.67-1.28-1.67-1.04-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.69 1.26 3.35.96.1-.75.4-1.26.72-1.55-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.47.11-3.06 0 0 .96-.31 3.15 1.18a10.96 10.96 0 0 1 5.73 0c2.19-1.49 3.15-1.18 3.15-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.83 1.19 3.09 0 4.42-2.7 5.4-5.27 5.68.41.35.78 1.04.78 2.11v3.13c0 .31.21.66.8.55 4.57-1.53 7.85-5.83 7.85-10.9C23.5 5.74 18.27.5 12 .5z" />
    </svg>
  );
}
