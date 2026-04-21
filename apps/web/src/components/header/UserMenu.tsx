'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/lib/i18n/routing';
import { Avatar } from '@/components/Avatar';
import { useSession } from '@/lib/session';

/**
 * Avatar dropdown. Renders when a user is authenticated (driven by the
 * parent AuthActions). Click-outside-to-close + Escape-to-close.
 */
export function UserMenu() {
  const t = useTranslations('user_menu');
  const { user, logout } = useSession();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    if (open) {
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
    }
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const onLogout = async () => {
    setOpen(false);
    await logout();
    router.push('/');
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('trigger')}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-pill border border-border bg-panel px-2 py-1.5 transition-all hover:border-accent"
      >
        <Avatar user={user} size={28} />
        <span className="hidden pr-1 text-sm font-medium text-text md:inline">
          {user.display_name}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-50 w-64 origin-top-right rounded-card border border-border bg-panel p-2 shadow-soft"
        >
          <div className="flex items-center gap-3 rounded-box bg-code px-3 py-3">
            <Avatar user={user} size={40} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-text">{user.display_name}</div>
              <div className="truncate text-xs text-text-muted">{user.email}</div>
            </div>
          </div>

          <div className="my-2 border-t border-border" />

          <MenuLink href="/profile" label={t('profile')} onNavigate={() => setOpen(false)} />
          <MenuLink href="/dashboard" label={t('dashboard')} onNavigate={() => setOpen(false)} />
          <MenuLink href="/wallet" label={t('wallet')} onNavigate={() => setOpen(false)} />

          {user.roles.includes('teacher') || user.roles.includes('admin') ? (
            <MenuLink href="/studio" label={t('studio')} onNavigate={() => setOpen(false)} />
          ) : null}

          <div className="my-2 border-t border-border" />

          <button
            type="button"
            role="menuitem"
            onClick={onLogout}
            className="w-full rounded-box px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-code hover:text-text"
          >
            {t('logout')}
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  label,
  onNavigate,
}: {
  href: '/profile' | '/dashboard' | '/wallet' | '/studio';
  label: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href as never}
      role="menuitem"
      onClick={onNavigate}
      className="block rounded-box px-3 py-2 text-sm text-text transition-colors hover:bg-code"
    >
      {label}
    </Link>
  );
}
