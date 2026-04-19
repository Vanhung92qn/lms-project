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
  return (
    <div className="flex items-center gap-2">
      <Link
        href="/login"
        className={`rounded-pill px-4 py-2 text-sm font-medium transition-all ${
          glass
            ? 'text-white/80 hover:text-white'
            : 'text-text-muted hover:text-text'
        }`}
      >
        {t('login')}
      </Link>
      <Link
        href="/register"
        className={`rounded-pill px-4 py-2 text-sm font-semibold transition-all ${
          glass
            ? 'liquid-glass text-white hover:scale-[1.03]'
            : 'bg-accent text-panel hover:bg-accent-hover'
        }`}
      >
        {t('register')}
      </Link>
    </div>
  );
}
