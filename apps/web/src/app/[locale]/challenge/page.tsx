'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/routing';
import { api, ApiError } from '@/lib/api';

// Challenge arena — public listing of every `isChallenge` exercise across
// all published courses. Real data (38 rows seeded from demo-cpp-advanced,
// demo-dsa-foundation, demo-interview-prep). Submissions still flow
// through the normal /submissions endpoint after the student opens the
// lesson, so no new gating code is needed here.

type Challenge = Awaited<ReturnType<typeof api.challenges>>[number];

function langBadge(lang: string): { label: string; color: string; bg: string } {
  switch (lang) {
    case 'cpp':
      return { label: 'C++', color: '#005baf', bg: 'rgba(0, 91, 175, 0.15)' };
    case 'c':
      return { label: 'C', color: '#283593', bg: 'rgba(40, 53, 147, 0.15)' };
    case 'python':
      return { label: 'Python', color: '#2d7d46', bg: 'rgba(45, 125, 70, 0.15)' };
    case 'js':
      return { label: 'JavaScript', color: '#a67f00', bg: 'rgba(166, 127, 0, 0.15)' };
    default:
      return { label: lang, color: 'var(--text-muted)', bg: 'var(--bg-code)' };
  }
}

function difficultyLabel(acRate: number | null): { label: string; color: string } {
  if (acRate == null) return { label: '—', color: 'var(--text-muted)' };
  if (acRate >= 0.7) return { label: 'Dễ', color: '#28a745' };
  if (acRate >= 0.4) return { label: 'TB', color: 'var(--accent)' };
  return { label: 'Khó', color: '#dc3545' };
}

export default function ChallengePage() {
  const t = useTranslations('challenge');
  const [rows, setRows] = useState<Challenge[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setRows(await api.challenges());
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'load failed');
      }
    })();
  }, []);

  const grouped = useMemo(() => {
    if (!rows) return null;
    const byCourse = new Map<string, { course: Challenge['course']; items: Challenge[] }>();
    for (const r of rows) {
      const k = r.course.slug;
      const g = byCourse.get(k) ?? { course: r.course, items: [] };
      g.items.push(r);
      byCourse.set(k, g);
    }
    return Array.from(byCourse.values());
  }, [rows]);

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-text md:text-4xl">⚔️ {t('title')}</h1>
        <p className="mt-2 text-sm text-text-muted">
          {t('subtitle', { count: rows?.length ?? 0 })}
        </p>
      </header>

      <div
        className="mb-6 rounded-box p-4 text-sm"
        style={{
          background: 'rgba(247, 189, 77, 0.08)',
          border: '1px solid rgba(247, 189, 77, 0.35)',
          color: 'var(--accent)',
        }}
      >
        ✨ {t('coming_soon_banner')}
      </div>

      {error ? (
        <div className="card text-center">
          <p style={{ color: '#ff6b6b' }}>{error}</p>
        </div>
      ) : !rows ? (
        <div className="card text-center text-text-muted">{t('loading')}</div>
      ) : rows.length === 0 ? (
        <div className="card text-center text-text-muted">{t('empty')}</div>
      ) : (
        <div className="flex flex-col gap-6">
          {grouped?.map(({ course, items }) => (
            <section key={course.slug} className="card">
              <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-text">{course.title}</h2>
                <span className="text-xs text-text-muted">
                  {items.length} challenges · {course.pricing_model === 'paid' ? '💎 Paid' : 'Free'}
                </span>
              </header>
              <ul className="flex flex-col gap-2">
                {items.map((ex) => {
                  const badge = langBadge(ex.language);
                  const diff = difficultyLabel(ex.ac_rate);
                  return (
                    <li
                      key={ex.exercise_id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-box border border-border bg-panel px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-text">
                          {ex.lesson_title}
                        </p>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {t('module')}: {ex.module_title}
                        </p>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        <span
                          className="rounded-pill px-2 py-0.5 text-[11px] font-semibold"
                          style={{ background: badge.bg, color: badge.color }}
                        >
                          {badge.label}
                        </span>
                        <span
                          className="rounded-pill border px-2 py-0.5 text-[11px] font-semibold"
                          style={{ borderColor: diff.color, color: diff.color }}
                        >
                          {diff.label}
                        </span>
                        <span className="text-[11px] text-text-muted" title={t('attempts', { n: ex.total_attempts })}>
                          {ex.ac_rate == null
                            ? t('no_attempts')
                            : t('ac_rate', { rate: Math.round(ex.ac_rate * 100) })}
                        </span>
                        <Link
                          href={`/courses/${course.slug}/learn/${ex.lesson_id}` as never}
                          className="rounded-pill bg-accent px-4 py-1.5 text-xs font-semibold text-panel transition-colors hover:bg-accent-hover"
                        >
                          {t('start_cta')}
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
