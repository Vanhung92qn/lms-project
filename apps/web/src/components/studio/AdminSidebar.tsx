'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/lib/i18n/routing';
import { useSession } from '@/lib/session';
import { Avatar } from '@/components/Avatar';

/**
 * Fixed left sidebar for the studio workspace. Items filter by role:
 * teachers see course authoring; admins see everything.
 *
 * Per docs/architecture/layout-patterns.md §B — admin shell is minimal,
 * data-heavy, no TopHeader; the sidebar *is* the nav.
 */
export function AdminSidebar() {
  const t = useTranslations('studio.sidebar');
  const pathname = usePathname();
  const { user, logout } = useSession();

  const isAdmin = user?.roles.includes('admin') ?? false;

  const items: Array<{ key: string; href: string; label: string; roles: Array<'teacher' | 'admin'> }> = [
    { key: 'overview', href: '/studio', label: t('overview'), roles: ['teacher', 'admin'] },
    { key: 'courses', href: '/studio', label: t('courses'), roles: ['teacher', 'admin'] },
  ];
  if (isAdmin) {
    items.push(
      { key: 'payments', href: '/studio/payments', label: t('payments'), roles: ['admin'] },
      { key: 'users', href: '/studio', label: t('users'), roles: ['admin'] },
      { key: 'metrics', href: '/studio', label: t('metrics'), roles: ['admin'] },
    );
  }

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-border bg-panel">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <Link href="/" className="text-xl font-semibold tracking-tight text-text" style={{ fontFamily: "'Instrument Serif', serif" }}>
          khohoc<sup className="text-[10px]">®</sup>
        </Link>
        <span className="rounded-pill border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Studio
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-1">
          {items.map((it) => {
            const active = pathname === it.href || pathname.startsWith(it.href + '/');
            return (
              <li key={it.key + it.href}>
                <Link
                  href={it.href as never}
                  className={`block rounded-box px-3 py-2 text-sm transition-colors ${
                    active
                      ? 'bg-accent/10 font-semibold text-accent'
                      : 'text-text-muted hover:bg-code hover:text-text'
                  }`}
                >
                  {it.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {user ? (
        <div className="flex items-center gap-3 border-t border-border px-4 py-3">
          <Avatar user={user} size={32} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-text">{user.display_name}</div>
            <div className="truncate text-xs text-text-muted">{user.email}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              void logout();
            }}
            className="rounded-box p-1 text-xs text-text-muted transition-colors hover:text-text"
            aria-label={t('logout')}
            title={t('logout')}
          >
            ⎋
          </button>
        </div>
      ) : null}
    </aside>
  );
}
