'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/routing';
import { api } from '@/lib/api';

type Rec = Awaited<ReturnType<typeof api.knowledge.myRecommendations>>[number];

/**
 * "Bạn có thể thích" dashboard widget. Reads /knowledge/me/recommendations
 * (content-based: top-3 mastery nodes → courses tagged with those nodes,
 * cold-start falls back to most-enrolled published courses).
 *
 * Silent when the API returns an empty list (brand-new student with no
 * mastery AND no other courses exist).
 */
export function RecommendationsWidget() {
  const t = useTranslations('dashboard.recommendations');
  const [recs, setRecs] = useState<Rec[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const token = (() => {
      try {
        return sessionStorage.getItem('lms-access');
      } catch {
        return null;
      }
    })();
    if (!token) return;
    api.knowledge
      .myRecommendations(token)
      .then((data) => {
        if (!cancelled) setRecs(data);
      })
      .catch(() => {
        if (!cancelled) setRecs([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (recs === null || recs.length === 0) return null;

  return (
    <section className="card mt-8">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-text">{t('title')}</h2>
        <span className="text-xs text-text-muted">{t('subtitle')}</span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {recs.map((r) => (
          <Link key={r.id} href={`/courses/${r.slug}` as never}>
            <article className="card flex h-full flex-col gap-3 transition-all hover:-translate-y-[2px]">
              <div
                className="flex h-24 items-center justify-center rounded-box text-2xl font-bold text-text-muted"
                style={{ background: 'var(--bg-code)' }}
              >
                {r.title.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold leading-tight text-text">{r.title}</h3>
                {r.description ? (
                  <p className="mt-1 line-clamp-2 text-xs text-text-muted">{r.description}</p>
                ) : null}
              </div>
              {r.matchedNodes.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {r.matchedNodes.slice(0, 3).map((slug) => (
                    <span
                      key={slug}
                      className="rounded-pill bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent"
                    >
                      {slug}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-[10px] uppercase tracking-wider text-text-muted">
                  {t('popular_pick')}
                </span>
              )}
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">
                  {r.pricingModel === 'paid' && r.priceCents
                    ? `${new Intl.NumberFormat('vi-VN').format(Math.round(r.priceCents / 100))} đ`
                    : t('free')}
                </span>
                <span className="font-semibold text-accent">{t('view')} →</span>
              </div>
            </article>
          </Link>
        ))}
      </div>
    </section>
  );
}
