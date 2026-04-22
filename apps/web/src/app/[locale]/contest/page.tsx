'use client';

import { useTranslations } from 'next-intl';

// Contest page — UI shell only. The backend for contests (scheduled rounds,
// registration, per-contest leaderboards, voucher distribution) is queued
// for the Arena phase (P10 candidate, see memory project_arena_phase.md).
// Until then we render a set of realistic mock contests so the academic
// board can see the intended UX.

interface MockContest {
  id: string;
  title: string;
  subtitle: string;
  status: 'upcoming' | 'live' | 'past';
  starts_at: Date;
  ends_at: Date;
  participants: number;
  prize: string;
  language: 'cpp' | 'python' | 'mixed';
}

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

const MOCK_CONTESTS: MockContest[] = [
  {
    id: 'may-open',
    title: 'Mùa giải Tháng 5 · Open Round',
    subtitle: '10 bài C++/Python từ dễ tới khó. Top 3 nhận voucher 100% cho bất kỳ khoá nào.',
    status: 'upcoming',
    starts_at: new Date(NOW + 5 * DAY),
    ends_at: new Date(NOW + 5 * DAY + 3 * 60 * 60 * 1000),
    participants: 47,
    prize: 'Voucher 100% khoá học',
    language: 'mixed',
  },
  {
    id: 'weekly-cpp',
    title: 'Weekly C++ Sprint #12',
    subtitle: '5 bài C++ trong 90 phút. Thi cá nhân, không chia đội.',
    status: 'upcoming',
    starts_at: new Date(NOW + 2 * DAY),
    ends_at: new Date(NOW + 2 * DAY + 90 * 60 * 1000),
    participants: 18,
    prize: 'Voucher 50% khoá Nâng cao',
    language: 'cpp',
  },
  {
    id: 'python-data',
    title: 'Python Data Challenge',
    subtitle: 'Phân tích 1 dataset thật bằng pandas. Chấm tự động + giáo viên review.',
    status: 'past',
    starts_at: new Date(NOW - 8 * DAY),
    ends_at: new Date(NOW - 7 * DAY),
    participants: 73,
    prize: 'Vinh danh top 5 trên trang chủ',
    language: 'python',
  },
];

function fmt(d: Date): string {
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusPill({ status, t }: { status: MockContest['status']; t: ReturnType<typeof useTranslations> }) {
  const label =
    status === 'live'
      ? t('status_live')
      : status === 'upcoming'
        ? t('status_upcoming')
        : t('status_past');
  const color =
    status === 'live' ? '#28a745' : status === 'upcoming' ? 'var(--accent)' : 'var(--text-muted)';
  const bg =
    status === 'live'
      ? 'rgba(40, 167, 69, 0.12)'
      : status === 'upcoming'
        ? 'rgba(247, 189, 77, 0.12)'
        : 'var(--bg-code)';
  return (
    <span
      className="rounded-pill px-2.5 py-0.5 text-[11px] font-semibold uppercase"
      style={{ background: bg, color }}
    >
      {label}
    </span>
  );
}

function ContestCard({ c, t }: { c: MockContest; t: ReturnType<typeof useTranslations> }) {
  return (
    <article className="card">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusPill status={c.status} t={t} />
          <span className="text-[11px] text-text-muted">
            {c.language === 'mixed' ? 'C++ · Python' : c.language.toUpperCase()}
          </span>
        </div>
        <span className="text-[11px] text-text-muted">
          {t('participants', { n: c.participants })}
        </span>
      </header>
      <h3 className="text-base font-semibold text-text">{c.title}</h3>
      <p className="mt-1 text-sm text-text-muted">{c.subtitle}</p>

      <dl className="mt-4 grid grid-cols-1 gap-2 text-xs text-text-muted sm:grid-cols-2">
        <div>
          <dt className="text-[10px] uppercase tracking-wider">{t('starts_at', { when: '' }).replace(':', '')}</dt>
          <dd className="font-mono text-text">{fmt(c.starts_at)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider">{t('ends_at', { when: '' }).replace(':', '')}</dt>
          <dd className="font-mono text-text">{fmt(c.ends_at)}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs">
          <span className="font-semibold text-text">🎁 {t('prize')}:</span>{' '}
          <span className="text-text-muted">{c.prize}</span>
        </p>
        <button
          type="button"
          disabled
          className="rounded-pill bg-accent/60 px-4 py-1.5 text-xs font-semibold text-panel"
          title={t('register_disabled')}
        >
          {t('register_cta')}
        </button>
      </div>
    </article>
  );
}

export default function ContestPage() {
  const t = useTranslations('contest');

  const upcoming = MOCK_CONTESTS.filter((c) => c.status !== 'past');
  const past = MOCK_CONTESTS.filter((c) => c.status === 'past');

  return (
    <main className="mx-auto max-w-[1100px] px-6 py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-text md:text-4xl">🏁 {t('title')}</h1>
        <p className="mt-2 text-sm text-text-muted">{t('subtitle')}</p>
      </header>

      <div
        className="mb-6 rounded-box p-3 text-xs"
        style={{
          background: 'rgba(100, 100, 200, 0.08)',
          border: '1px solid rgba(100, 100, 200, 0.3)',
          color: '#6a7ad8',
        }}
      >
        🚧 {t('register_disabled')}
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-text">{t('upcoming_heading')}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {upcoming.map((c) => (
            <ContestCard key={c.id} c={c} t={t} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-text">{t('past_heading')}</h2>
        {past.length === 0 ? (
          <p className="text-sm text-text-muted">{t('empty_past')}</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {past.map((c) => (
              <ContestCard key={c.id} c={c} t={t} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
