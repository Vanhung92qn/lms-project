import { useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/routing';

/**
 * Anonymous-only. Login + Register buttons, right-side of the top header.
 * When user-session wiring lands (p1.1), swap this for an avatar dropdown
 * that also shows Đăng xuất.
 */
export function AuthActions({ variant = 'solid' }: { variant?: 'solid' | 'glass' }) {
  const t = useTranslations('nav');
  const glass = variant === 'glass';
  // Both variants now use theme tokens. `glass` can be used later to swap
  // register for a brand-locked dark gloss if we want the hero CTA echo.
  void glass;
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
