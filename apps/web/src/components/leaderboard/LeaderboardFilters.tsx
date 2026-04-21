'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, usePathname } from '@/lib/i18n/routing';

type Scope = 'global' | 'course';

export function LeaderboardFilters({ hasCourseScope }: { hasCourseScope: boolean }) {
  const t = useTranslations('leaderboard');
  const pathname = usePathname();
  const search = useSearchParams();
  const active = (search.get('scope') as Scope | null) ?? 'global';

  const items: Array<{ scope: Scope; label: string; disabled?: boolean }> = [
    { scope: 'global', label: t('filters.global') },
    { scope: 'course', label: t('filters.course'), disabled: !hasCourseScope },
  ];

  return (
    <div className="inline-flex items-center gap-2 rounded-pill border border-border bg-bg-panel p-1">
      {items.map((item) => {
        if (item.disabled) {
          return (
            <span
              key={item.scope}
              className="rounded-pill px-3 py-1.5 text-sm text-text-muted/60"
              title={t('filters.coming_soon')}
            >
              {item.label}
            </span>
          );
        }
        const q = new URLSearchParams(search.toString());
        q.set('scope', item.scope);
        return (
          <Link
            key={item.scope}
            href={`${pathname}?${q.toString()}` as never}
            className={`rounded-pill px-3 py-1.5 text-sm transition-colors ${
              active === item.scope
                ? 'bg-accent text-white'
                : 'text-text-muted hover:bg-bg-soft hover:text-text'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
