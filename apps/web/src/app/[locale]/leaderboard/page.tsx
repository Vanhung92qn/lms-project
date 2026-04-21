import { getTranslations, setRequestLocale } from 'next-intl/server';
import { api } from '@/lib/api';
import { LeaderboardFilters } from '@/components/leaderboard/LeaderboardFilters';
import { LeaderboardTable } from '@/components/leaderboard/LeaderboardTable';
import type { LeaderboardSummary, LeaderboardEntry } from '@lms/shared-types';

export default async function LeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ scope?: 'global' | 'course' }>;
}) {
  const { locale } = await params;
  const { scope = 'global' } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('leaderboard');

  let leaderboards: LeaderboardSummary[] = [];
  let entries: LeaderboardEntry[] = [];
  let error: string | null = null;

  try {
    leaderboards = await api.listLeaderboards();
    const selected =
      leaderboards.find((lb) => lb.scope === scope) ??
      leaderboards.find((lb) => lb.scope === 'global') ??
      null;
    if (selected) {
      const res = await api.leaderboardEntries(selected.id, { limit: 50 });
      entries = res.items;
    }
  } catch (err) {
    error = (err as Error).message;
  }

  const mockEntries = buildMockEntries(scope, 50);
  const rows = mergeWithBaseline(mockEntries, entries, 50);

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-10">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-text md:text-4xl">{t('title')}</h1>
          <p className="mt-2 max-w-2xl text-text-muted">{t('subtitle')}</p>
        </div>
        <LeaderboardFilters hasCourseScope={leaderboards.some((x) => x.scope === 'course')} />
      </header>

      {error ? <div className="mb-4 text-sm text-red-400">{t('load_failed')}</div> : null}
      {entries.length === 0 ? (
        <div className="mb-4 inline-flex rounded-pill border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-300">
          {t('mock_notice')}
        </div>
      ) : null}
      <LeaderboardTable entries={rows} emptyLabel={t('empty')} />
    </main>
  );
}

function buildMockEntries(scope: 'global' | 'course', count: number): LeaderboardEntry[] {
  const botNames = [
    'Nguyễn Minh Anh',
    'Trần Quốc Bảo',
    'Lê Hoàng Nam',
    'Phạm Gia Hân',
    'Võ Quang Huy',
    'Bùi Khánh Linh',
    'Đỗ Tuấn Kiệt',
    'Đặng Ngọc Mai',
    'Phan Nhật Quang',
    'Hoàng Gia Bảo',
    'Ngô Thanh Tùng',
    'Dương Quỳnh Anh',
  ];
  const funnyAvatars = ['emoji:🤡', 'emoji:😜', 'emoji:🤪', 'emoji:😹', 'emoji:🐵', 'emoji:🦄', 'emoji:🐸', 'emoji:🐼', 'emoji:🦊', 'emoji:🐤'];

  return Array.from({ length: count }, (_, idx) => {
    const rank = idx + 1;
    const baseName = botNames[idx % botNames.length] ?? 'Nguyễn Văn A';
    const displayName = baseName;
    return {
      rank,
      user_id: `mock-user-${scope}-${rank}`,
      display_name: displayName,
      avatar_url: funnyAvatars[idx % funnyAvatars.length] ?? 'emoji:🤡',
      score: 5200 - idx * 77,
      solved_count: Math.max(2, 60 - idx),
      penalty_seconds: 140 + idx * 17,
      last_submission_at: new Date(Date.now() - idx * 2_100_000).toISOString(),
      is_me: rank === 12,
    };
  });
}

function mergeWithBaseline(
  baseline: LeaderboardEntry[],
  liveEntries: LeaderboardEntry[],
  limit: number,
): LeaderboardEntry[] {
  const seen = new Map<string, LeaderboardEntry>();
  for (const item of baseline) seen.set(item.user_id, item);
  for (const item of liveEntries) seen.set(item.user_id, item);

  const merged = Array.from(seen.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.solved_count !== a.solved_count) return b.solved_count - a.solved_count;
    if (a.penalty_seconds !== b.penalty_seconds) return a.penalty_seconds - b.penalty_seconds;
    const ta = a.last_submission_at ? Date.parse(a.last_submission_at) : Number.MAX_SAFE_INTEGER;
    const tb = b.last_submission_at ? Date.parse(b.last_submission_at) : Number.MAX_SAFE_INTEGER;
    return ta - tb;
  });

  return merged.slice(0, limit).map((entry, idx) => ({
    ...entry,
    rank: idx + 1,
  }));
}
