'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/routing';

// Forum page — placeholder UI. A real discussion system lives later in the
// roadmap; for now we show the intended layout with mock threads so the
// academic board understands the plan, plus CTA buttons for existing
// community channels (Discord / Zalo / AI Tutor fallback).

const MOCK_THREADS: Array<{
  id: string;
  title: string;
  tag: string;
  tagColor: string;
  replies: number;
  views: number;
  lastActivityHours: number;
}> = [
  {
    id: '1',
    title: 'Cách tối ưu đệ quy Fibonacci bằng memoization?',
    tag: 'C++',
    tagColor: '#005baf',
    replies: 14,
    views: 231,
    lastActivityHours: 2,
  },
  {
    id: '2',
    title: 'Tại sao std::map chậm hơn unordered_map nhiều thế?',
    tag: 'C++',
    tagColor: '#005baf',
    replies: 8,
    views: 142,
    lastActivityHours: 5,
  },
  {
    id: '3',
    title: 'Chia sẻ: setup VSCode + clang-format cho team',
    tag: 'Setup',
    tagColor: 'var(--text-muted)',
    replies: 22,
    views: 412,
    lastActivityHours: 18,
  },
  {
    id: '4',
    title: 'pandas groupby vs SQL GROUP BY — khi nào dùng cái nào?',
    tag: 'Python',
    tagColor: '#2d7d46',
    replies: 6,
    views: 89,
    lastActivityHours: 36,
  },
  {
    id: '5',
    title: 'Review code: bài tập Linked List reverse của tôi',
    tag: 'Review',
    tagColor: 'var(--accent)',
    replies: 3,
    views: 54,
    lastActivityHours: 48,
  },
];

function fmtHours(h: number): string {
  if (h < 1) return 'vài phút trước';
  if (h < 24) return `${h} giờ trước`;
  return `${Math.floor(h / 24)} ngày trước`;
}

export default function ForumPage() {
  const t = useTranslations('forum');

  return (
    <main className="mx-auto max-w-[1000px] px-6 py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-text md:text-4xl">💬 {t('title')}</h1>
        <p className="mt-2 text-sm text-text-muted">{t('subtitle')}</p>
      </header>

      {/* Coming-soon hero with 3 CTAs */}
      <section
        className="card mb-8 text-center"
        style={{
          background:
            'linear-gradient(135deg, rgba(247, 189, 77, 0.08) 0%, rgba(100, 100, 200, 0.08) 100%)',
        }}
      >
        <div className="mx-auto max-w-[560px] py-6">
          <div className="text-5xl">🚧</div>
          <h2 className="mt-3 text-xl font-semibold text-text">{t('coming_soon_title')}</h2>
          <p className="mt-2 text-sm text-text-muted">{t('coming_soon_body')}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <a
              href="https://discord.gg/"
              target="_blank"
              rel="noreferrer"
              className="rounded-pill px-4 py-2 text-xs font-semibold text-white"
              style={{ background: '#5865f2' }}
            >
              {t('discord_cta')}
            </a>
            <a
              href="https://zalo.me/"
              target="_blank"
              rel="noreferrer"
              className="rounded-pill px-4 py-2 text-xs font-semibold text-white"
              style={{ background: '#0068ff' }}
            >
              {t('zalo_cta')}
            </a>
            <Link
              href="/dashboard"
              className="rounded-pill border border-border bg-panel px-4 py-2 text-xs font-semibold text-text transition-colors hover:border-text"
            >
              {t('tutor_cta')}
            </Link>
          </div>
        </div>
      </section>

      {/* Mock thread list — labelled so reviewers don't think it's live. */}
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
          {t('sample_threads_heading')}
        </h3>
        <ul className="card divide-y divide-border overflow-hidden p-0">
          {MOCK_THREADS.map((thread) => (
            <li
              key={thread.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4 opacity-80"
              style={{ pointerEvents: 'none' }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className="rounded-pill px-2 py-0.5 text-[10px] font-semibold"
                    style={{
                      background: `${thread.tagColor}22`,
                      color: thread.tagColor,
                    }}
                  >
                    {thread.tag}
                  </span>
                  <p className="truncate text-sm font-medium text-text">{thread.title}</p>
                </div>
                <p className="mt-1 text-[11px] text-text-muted">
                  {fmtHours(thread.lastActivityHours)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-4 text-[11px] text-text-muted">
                <span>{t('sample_replies', { n: thread.replies })}</span>
                <span>{t('sample_views', { n: thread.views })}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
