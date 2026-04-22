'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';
import { Avatar } from '@/components/Avatar';

type Row = Awaited<ReturnType<typeof api.leaderboard>>['top'][number];

const LIMIT = 20;

export default function LeaderboardPage() {
  const t = useTranslations('leaderboard');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'all' | 'season'>('all');

  useEffect(() => {
    (async () => {
      try {
        const res = await api.leaderboard(LIMIT);
        setRows(res.top);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'load failed');
      }
    })();
  }, []);

  return (
    <main className="mx-auto max-w-[1100px] px-6 py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-text md:text-4xl">🏆 {t('title')}</h1>
        <p className="mt-2 text-sm text-text-muted">{t('subtitle', { limit: LIMIT })}</p>
      </header>

      {/* Tab switch — season tab is a teaser for the future Arena phase. */}
      <div className="mb-6 flex gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setTab('all')}
          className="px-4 py-2 text-sm transition-colors"
          style={{
            borderBottom:
              tab === 'all' ? '2px solid var(--accent)' : '2px solid transparent',
            color: tab === 'all' ? 'var(--accent)' : 'var(--text-muted)',
            fontWeight: tab === 'all' ? 600 : 400,
          }}
        >
          {t('tab_all_time')}
        </button>
        <button
          type="button"
          onClick={() => setTab('season')}
          className="px-4 py-2 text-sm transition-colors"
          style={{
            borderBottom:
              tab === 'season' ? '2px solid var(--accent)' : '2px solid transparent',
            color: tab === 'season' ? 'var(--accent)' : 'var(--text-muted)',
            fontWeight: tab === 'season' ? 600 : 400,
          }}
        >
          {t('tab_season')} 🔒
        </button>
      </div>

      {tab === 'season' ? (
        <div className="card text-center text-text-muted">
          <p>{t('season_coming_soon')}</p>
        </div>
      ) : error ? (
        <div className="card text-center">
          <p style={{ color: '#ff6b6b' }}>{error}</p>
        </div>
      ) : !rows ? (
        <div className="card text-center text-text-muted">{t('loading')}</div>
      ) : rows.length === 0 ? (
        <div className="card text-center text-text-muted">{t('empty')}</div>
      ) : (
        <section className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-code">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  {t('rank')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  {t('name')}
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-text-muted">
                  {t('ac_count')}
                </th>
                <th className="hidden px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-text-muted md:table-cell">
                  {t('mastery')}
                </th>
                <th className="hidden px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-text-muted md:table-cell">
                  {t('mastered')}
                </th>
                <th className="hidden px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-text-muted sm:table-cell">
                  {t('submissions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const rank = idx + 1;
                const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
                return (
                  <tr
                    key={r.user_id}
                    className="border-b border-border transition-colors hover:bg-code"
                    style={rank <= 3 ? { background: 'rgba(247, 189, 77, 0.04)' } : undefined}
                  >
                    <td className="px-4 py-3 font-semibold text-text">
                      {medal ?? `#${rank}`}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar
                          user={{
                            id: r.user_id,
                            display_name: r.display_name,
                            avatar_url: r.avatar_url ?? undefined,
                          }}
                          size={32}
                        />
                        <span className="font-medium text-text">{r.display_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-text">
                      {r.ac_count.toLocaleString('vi-VN')}
                    </td>
                    <td className="hidden px-4 py-3 text-right font-mono text-sm md:table-cell">
                      {r.avg_mastery != null ? (
                        <span
                          style={{
                            color:
                              r.avg_mastery >= 0.8
                                ? '#28a745'
                                : r.avg_mastery >= 0.5
                                  ? 'var(--accent)'
                                  : 'var(--text-muted)',
                          }}
                        >
                          {(r.avg_mastery * 100).toFixed(0)}%
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-right font-mono text-sm text-text-muted md:table-cell">
                      {r.mastered_concepts}
                    </td>
                    <td className="hidden px-4 py-3 text-right font-mono text-sm text-text-muted sm:table-cell">
                      {r.total_submissions.toLocaleString('vi-VN')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
