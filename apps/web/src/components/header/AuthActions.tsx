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
            ? 'text-slate-700/80 hover:text-slate-900'
            : 'text-text-muted hover:text-text'
        }`}
      >
        {t('login')}
      </Link>
      <Link
        href="/register"
        className={`rounded-pill px-4 py-2 text-sm font-semibold transition-all ${
          glass
            ? 'border border-slate-900/10 bg-gradient-to-b from-[#2e2e2e] to-[#121212] text-white shadow-[inset_-4px_-6px_25px_0px_rgba(201,201,201,0.08),inset_4px_4px_10px_0px_rgba(29,29,29,0.24)] hover:scale-[1.02]'
            : 'bg-accent text-panel hover:bg-accent-hover'
        }`}
      >
        {t('register')}
      </Link>
    </div>
  );
}
