'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';

interface MasteryRow {
  node: { id: string; slug: string; title: string; domain: string };
  score: number;
  confidence: number;
  attempts: number;
  lastUpdatedAt: string;
}

/**
 * "Bạn đang mạnh ở X, yếu ở Y" widget on the student dashboard. Reads
 * the Knowledge Graph mastery endpoint (populated by the data-science
 * service after each AC submission) and renders the top-3 strongest
 * and the bottom-3 weakest nodes.
 *
 * Gracefully renders nothing when the student has no mastery rows yet
 * — new students shouldn't see an empty state, they see the normal
 * "enrolled courses" view above. Once they submit their first AC
 * answer the widget lights up.
 */
export function MasteryWidget() {
  const t = useTranslations('dashboard.mastery');
  const [rows, setRows] = useState<MasteryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    (async () => {
      try {
        const data = await api.knowledge.myMastery(token);
        if (!cancelled) setRows(data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Silent null while loading — we don't show a skeleton for a
  // supplementary widget.
  if (rows === null && !error) return null;

  if (error) {
    return (
      <section className="card mt-8">
        <p className="text-xs text-text-muted">{t('load_failed')}</p>
      </section>
    );
  }

  const nonEmpty = (rows ?? []).filter((r) => r.attempts > 0);
  if (nonEmpty.length === 0) return null;

  const sorted = [...nonEmpty].sort((a, b) => b.score - a.score);
  const strengths = sorted.slice(0, 3);
  const weaknesses = sorted.length > 3 ? sorted.slice(-3).reverse() : [];

  return (
    <section className="card mt-8">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-text">{t('title')}</h2>
        <span className="text-xs text-text-muted">{t('subtitle')}</span>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            {t('strengths')}
          </h3>
          <ul className="space-y-2">
            {strengths.map((r) => (
              <MasteryRowItem key={r.node.id} row={r} tone="strong" />
            ))}
          </ul>
        </div>
        {weaknesses.length > 0 ? (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              {t('weaknesses')}
            </h3>
            <ul className="space-y-2">
              {weaknesses.map((r) => (
                <MasteryRowItem key={r.node.id} row={r} tone="weak" />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function MasteryRowItem({ row, tone }: { row: MasteryRow; tone: 'strong' | 'weak' }) {
  const pct = Math.round(row.score * 100);
  const barColor = tone === 'strong' ? 'var(--accent)' : '#f59e0b';
  return (
    <li className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text">{row.node.title}</p>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-code">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${pct}%`, background: barColor }}
          />
        </div>
      </div>
      <span className="shrink-0 font-mono text-xs tabular-nums text-text-muted">{pct}%</span>
    </li>
  );
}
