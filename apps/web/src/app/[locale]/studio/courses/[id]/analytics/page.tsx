'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/routing';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

type Analytics = Awaited<ReturnType<typeof api.teacher.analytics>>;

/**
 * Per-course analytics for the owning teacher. AdminLayout already
 * comes from studio/layout.tsx, so we just render the view here.
 */
export default function AnalyticsPage() {
  const { user, isLoading } = useSession();
  if (isLoading || !user) return null;
  return <AnalyticsView />;
}

function AnalyticsView() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('teacher.analytics');
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    api.teacher
      .analytics(token, id)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : (e as Error).message));
  }, [id]);

  if (error) {
    return (
      <main className="mx-auto max-w-[1200px] px-6 py-8">
        <div className="card text-center" style={{ color: '#ff6b6b' }}>
          {error}
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="mx-auto max-w-[1200px] px-6 py-8">
        <div className="card text-center text-text-muted">…</div>
      </main>
    );
  }

  const acRatePct = Math.round(data.acRate * 100);

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Link
            href={`/studio/courses/${id}` as never}
            className="text-sm text-text-muted hover:text-text"
          >
            ← {t('back_to_course')}
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-text">{t('title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
        </div>
      </header>

      {/* Summary strip */}
      <div className="grid gap-4 md:grid-cols-4">
        <Stat label={t('enrolments')} value={String(data.enrollmentCount)} />
        <Stat label={t('submitters')} value={String(data.uniqueSubmitters)} />
        <Stat label={t('submissions')} value={String(data.totalSubmissions)} />
        <Stat
          label={t('ac_rate')}
          value={`${acRatePct}%`}
          accent={data.totalSubmissions > 0}
        />
      </div>

      {/* Per-lesson table */}
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-text">{t('per_lesson_title')}</h2>
        {data.perLesson.length === 0 ? (
          <div className="card text-center text-text-muted">{t('per_lesson_empty')}</div>
        ) : (
          <div className="card overflow-hidden p-0">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-code text-left text-[11px] uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="px-4 py-2">{t('col_lesson')}</th>
                  <th className="px-4 py-2">{t('col_submissions')}</th>
                  <th className="px-4 py-2">{t('col_ac')}</th>
                  <th className="px-4 py-2">{t('col_ac_rate')}</th>
                  <th className="px-4 py-2">{t('col_concepts')}</th>
                </tr>
              </thead>
              <tbody>
                {data.perLesson.map((row) => (
                  <tr key={row.lessonId} className="border-t border-border">
                    <td className="px-4 py-3 text-text">{row.lessonTitle}</td>
                    <td className="px-4 py-3 font-mono tabular-nums text-text-muted">
                      {row.totalSubmissions}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-text-muted">
                      {row.acSubmissions}
                    </td>
                    <td className="px-4 py-3">
                      <AcRateBar rate={row.acRate} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {row.knowledgeNodes.map((slug) => (
                          <span
                            key={slug}
                            className="rounded-pill bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent"
                          >
                            {slug}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Weakest concepts */}
      {data.weakestConcepts.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold text-text">{t('weakest_title')}</h2>
          <div className="card">
            <ul className="flex flex-col gap-3">
              {data.weakestConcepts.map((c) => (
                <li key={c.slug}>
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold text-text">{c.title}</span>
                    <span className="font-mono text-xs text-text-muted">
                      {c.totalSubmissions} · {Math.round(c.acRate * 100)}%
                    </span>
                  </div>
                  <AcRateBar rate={c.acRate} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wider text-text-muted">{label}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${accent ? 'text-accent' : 'text-text'}`}>
        {value}
      </p>
    </div>
  );
}

function AcRateBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  const color = rate >= 0.7 ? 'var(--accent)' : rate >= 0.4 ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 min-w-[80px] overflow-hidden rounded-full bg-code">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="shrink-0 font-mono text-xs tabular-nums text-text-muted">{pct}%</span>
    </div>
  );
}
