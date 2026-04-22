'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/lib/i18n/routing';
import { useSession } from '@/lib/session';

/**
 * Top-header navigation. Matches the sitemap fixed in
 * docs/architecture/layout-patterns.md §A: Trang chủ · Duyệt lộ trình ·
 * Gia sư AI · Học tập · Thử thách · Cuộc thi · Xếp hạng · Thảo luận.
 *
 * Not all destinations exist yet (p2+); links that point to future routes
 * are rendered as `disabled` (muted, no href). The structure ships now so
 * the UX spec is visible to reviewers.
 *
 * "Duyệt lộ trình" → /courses (public catalog, visible to everyone).
 * "Học tập"        → /dashboard (enrolled courses + mastery + recs).
 *                     Hidden for anonymous visitors to avoid routing them
 *                     into a forced-login redirect.
 */
export function NavItems({ variant = 'solid' }: { variant?: 'solid' | 'glass' }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { user } = useSession();

  const allItems: Array<{ key: keyof IntlMessages; href: string | null; authOnly?: boolean }> = [
    { key: 'home',        href: '/' },
    { key: 'roadmap',     href: '/courses' },
    { key: 'ai_tutor',    href: null },
    { key: 'learn',       href: '/dashboard', authOnly: true },
    { key: 'challenge',   href: '/challenge' },
    { key: 'contest',     href: '/contest' },
    { key: 'leaderboard', href: '/leaderboard' },
    { key: 'forum',       href: '/forum' },
  ];
  const items = allItems.filter((item) => !item.authOnly || user);

  // Theme-aware across both variants — all colours read from tokens.
  // Keeping the `variant` parameter in case we need to fork behaviour
  // later (e.g. larger hit areas on a glass hero).
  void variant;
  const baseColor = 'text-text-muted hover:text-text';
  const activeColor = 'text-text';
  const disabledColor = 'text-text-muted/50';

  return (
    <nav className="hidden items-center gap-7 lg:flex">
      {items.map(({ key, href }) => {
        const active = href === pathname;
        if (!href) {
          return (
            <span
              key={key}
              className={`cursor-not-allowed text-sm font-medium transition-colors ${disabledColor}`}
              title="Sắp ra mắt"
            >
              {t(key)}
            </span>
          );
        }
        return (
          <Link
            key={key}
            href={href as never}
            className={`text-sm font-medium transition-colors ${active ? activeColor : baseColor}`}
          >
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}

// Keyof-safe — vi.json / en.json MUST expose these message keys (see messages/*).
type IntlMessages = {
  home: string;
  roadmap: string;
  ai_tutor: string;
  learn: string;
  challenge: string;
  contest: string;
  leaderboard: string;
  forum: string;
};
