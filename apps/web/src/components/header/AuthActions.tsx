'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/routing';
import { useSession } from '@/lib/session';
import { UserMenu } from './UserMenu';

/**
 * Right-hand side of the top header.
 * - Anonymous (no session, OR session still loading): Login + Register pair.
 * - Authenticated: the UserMenu dropdown (avatar + display name).
 *
 * We keep `variant` as a prop so the parent can signal a glass-over-video
 * styling, but the internal colours all read from theme tokens.
 */
export function AuthActions({ variant: _variant = 'solid' }: { variant?: 'solid' | 'glass' }) {
  const t = useTranslations('nav');
  const { user, isLoading } = useSession();

  // Render a placeholder width while the first /me probe is in flight so the
  // header doesn't jump when the buttons swap for the avatar.
  if (isLoading) {
    return <div className="h-9 w-24 animate-pulse rounded-pill bg-code" aria-hidden="true" />;
  }

  if (user) return <UserMenu />;

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/login"
        className="rounded-pill px-4 py-2 text-sm font-medium text-text-muted transition-all hover:text-text"
      >
        {t('login')}
      </Link>
      <Link
        href="/register"
        className="rounded-pill bg-accent px-4 py-2 text-sm font-semibold text-panel transition-all hover:bg-accent-hover"
      >
        {t('register')}
      </Link>
    </div>
  );
}
