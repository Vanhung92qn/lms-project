'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/routing';
import { api, ApiError } from '@/lib/api';

// P9.1 Teacher Insight Layer — one page per course bundling three qualitative
// views the academic-board demo leans on:
//   1. Classroom Heatmap     (students × concepts, BKT gradient)
//   2. AI Tutor Insights     (top questions mined from ai_chats)
//   3. Concept Coverage Gap  (what the course teaches vs the KG vocabulary)

type HeatmapData = Awaited<ReturnType<typeof api.teacher.heatmap>>;
type TutorData = Awaited<ReturnType<typeof api.teacher.tutorInsights>>;
type CoverageData = Awaited<ReturnType<typeof api.teacher.coverageGap>>;

export default function CourseInsightsPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('studio.insights');

  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null);
  const [tutor, setTutor] = useState<TutorData | null>(null);
  const [coverage, setCoverage] = useState<CoverageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    (async () => {
      try {
        const [h, c, ti] = await Promise.all([
          api.teacher.heatmap(token, id),
          api.teacher.coverageGap(token, id),
          api.teacher.tutorInsights(token, id),
        ]);
        setHeatmap(h);
        setCoverage(c);
        setTutor(ti);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : t('load_failed'));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, t]);

  if (loading) {
    return <div className="px-8 py-8 text-text-muted">…</div>;
  }
  if (error) {
    return (
      <div className="px-8 py-8">
        <p className="text-sm" style={{ color: '#ff6b6b' }}>
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="px-8 py-8">
      <header className="mb-6">
        <Link
          href={`/studio/courses/${id}` as never}
          className="text-xs text-text-muted hover:text-text"
        >
          {t('back_to_edit')}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-text">{t('title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
      </header>

      <div className="flex flex-col gap-6">
        {heatmap ? <HeatmapSection data={heatmap} /> : null}
        {tutor ? <TutorSection data={tutor} /> : null}
        {coverage ? <CoverageSection data={coverage} /> : null}
      </div>
    </div>
  );
}

// ---------- Heatmap ---------------------------------------------------------

function cellColor(score: number | null): string {
  if (score == null) return 'transparent';
  // red → yellow → green, mapped 0.0 → 0.5 → 1.0
  if (score < 0.4) return 'rgba(220, 53, 69, 0.25)';
  if (score < 0.55) return 'rgba(220, 140, 60, 0.28)';
  if (score < 0.7) return 'rgba(247, 189, 77, 0.32)';
  if (score < 0.85) return 'rgba(160, 200, 80, 0.32)';
  return 'rgba(40, 167, 69, 0.32)';
}

const HEATMAP_ROW_CAP = 40; // render the 40 weakest students so the table stays readable

function HeatmapSection({ data }: { data: HeatmapData }) {
  const t = useTranslations('studio.insights.heatmap');

  // Compute per-student average mastery so weakest appear at the top.
  const rows = useMemo(() => {
    const byUser = new Map<string, Map<string, number>>();
    for (const cell of data.cells) {
      const m = byUser.get(cell.user_id) ?? new Map<string, number>();
      m.set(cell.node_slug, cell.score);
      byUser.set(cell.user_id, m);
    }
    const scored = data.students.map((s) => {
      const cells = byUser.get(s.id) ?? new Map<string, number>();
      const values = Array.from(cells.values());
      const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      return { student: s, cells, avg, touchedCount: values.length };
    });
    // Students with zero mastery data sink to the bottom (can't demo weakness
    // for them); among those with data, weakest first.
    scored.sort((a, b) => {
      if (a.touchedCount === 0 && b.touchedCount > 0) return 1;
      if (b.touchedCount === 0 && a.touchedCount > 0) return -1;
      return a.avg - b.avg;
    });
    return scored.slice(0, HEATMAP_ROW_CAP);
  }, [data]);

  if (data.students.length === 0 || data.concepts.length === 0) {
    return (
      <section className="card">
        <h2 className="text-lg font-semibold text-text">{t('title')}</h2>
        <p className="mt-1 text-sm text-text-muted">{t('empty')}</p>
      </section>
    );
  }

  return (
    <section className="card overflow-x-auto">
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-text">{t('title')}</h2>
        <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
        <p className="mt-1 text-xs text-text-muted">
          {t('showing', { count: rows.length, total: data.students.length })}
        </p>
      </header>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 bg-panel p-2 text-left font-semibold text-text-muted">
              {t('students_col')}
            </th>
            {data.concepts.map((c) => (
              <th
                key={c.id}
                className="p-2 text-left font-semibold text-text-muted"
                title={c.title}
                style={{ minWidth: 80 }}
              >
                {c.slug}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.student.id} className="border-t border-border">
              <td className="sticky left-0 bg-panel p-2 font-medium text-text">
                <div className="truncate" style={{ maxWidth: 200 }}>
                  {r.student.display_name}
                </div>
                <div className="text-[10px] text-text-muted">
                  avg {(r.avg * 100).toFixed(0)}% · {r.touchedCount} concepts
                </div>
              </td>
              {data.concepts.map((c) => {
                const score = r.cells.get(c.slug);
                return (
                  <td
                    key={c.id}
                    className="p-1"
                    style={{ background: cellColor(score ?? null) }}
                    title={score != null ? `${c.slug}: ${(score * 100).toFixed(0)}%` : t('no_data')}
                  >
                    <div
                      className="text-center text-[10px]"
                      style={{ color: score != null ? 'var(--text-main)' : 'var(--text-muted)' }}
                    >
                      {score != null ? `${Math.round(score * 100)}` : t('no_data')}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------- Tutor Insights --------------------------------------------------

function TutorSection({ data }: { data: TutorData }) {
  const t = useTranslations('studio.insights.tutor');

  if (data.questions.length === 0) {
    return (
      <section className="card">
        <h2 className="text-lg font-semibold text-text">{t('title')}</h2>
        <p className="mt-1 text-sm text-text-muted">
          {t('empty', { days: data.window_days })}
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-text">{t('title')}</h2>
        <p className="mt-1 text-sm text-text-muted">
          {t('subtitle', { limit: data.questions.length, days: data.window_days })}
        </p>
      </header>
      <ul className="flex flex-col gap-3">
        {data.questions.map((q, idx) => (
          <li
            key={idx}
            className="rounded-box border border-border bg-panel p-3"
          >
            <p className="text-sm text-text">{q.question}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-text-muted">
              {q.lesson_title ? (
                <span>
                  <span className="font-semibold">{t('lesson_label')}:</span> {q.lesson_title}
                </span>
              ) : null}
              <span
                className="rounded-pill px-2 py-0.5 text-[10px]"
                style={{
                  background:
                    q.provider === 'deepseek'
                      ? 'rgba(247, 189, 77, 0.15)'
                      : 'rgba(100, 100, 200, 0.15)',
                  color: q.provider === 'deepseek' ? 'var(--accent)' : '#6a7ad8',
                }}
              >
                {q.provider === 'deepseek' ? t('provider_deepseek') : t('provider_llama')}
              </span>
              <span>{new Date(q.at).toLocaleString('vi-VN')}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- Coverage Gap ----------------------------------------------------

function CoverageSection({ data }: { data: CoverageData }) {
  const t = useTranslations('studio.insights.coverage');

  return (
    <section className="card">
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-text">{t('title')}</h2>
        <p className="mt-1 text-sm text-text-muted">
          {t('subtitle', { taught: data.taught_count, total: data.total_kg_size })}
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <CoverageList
          heading={t('taught_heading', { n: data.taught.length })}
          items={data.taught}
          accent="#28a745"
        />
        <CoverageList
          heading={t('missing_heading', { n: data.missing.length })}
          items={data.missing}
          accent="#dc3545"
        />
      </div>
      {data.missing_prereqs.length > 0 ? (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-text">
            {t('missing_prereqs_heading', { n: data.missing_prereqs.length })}
          </h3>
          <ul className="flex flex-col gap-2">
            {data.missing_prereqs.map((mp) => (
              <li
                key={mp.node.slug}
                className="rounded-box border px-3 py-2 text-sm"
                style={{ borderColor: 'rgba(247, 189, 77, 0.4)' }}
              >
                <span className="font-semibold" style={{ color: 'var(--accent)' }}>
                  {mp.node.title}
                </span>{' '}
                <span className="text-xs text-text-muted">
                  ({mp.node.slug}) — {t('required_by')} {mp.required_by.join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function CoverageList({
  heading,
  items,
  accent,
}: {
  heading: string;
  items: Array<{ slug: string; title: string; domain: string }>;
  accent: string;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-text">{heading}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-text-muted">—</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((n) => (
            <li
              key={n.slug}
              className="rounded-box border border-border bg-panel px-3 py-1.5 text-xs"
            >
              <span className="font-medium" style={{ color: accent }}>
                {n.title}
              </span>{' '}
              <span className="text-text-muted">· {n.domain} · {n.slug}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
