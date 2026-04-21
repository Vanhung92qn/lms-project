import type { LeaderboardEntry } from '@lms/shared-types';

export function LeaderboardTable({
  entries,
  emptyLabel,
}: {
  entries: LeaderboardEntry[];
  emptyLabel: string;
}) {
  const isEmpty = entries.length === 0;
  const avatarFromEmoji = (avatar: string | null) => (avatar?.startsWith('emoji:') ? avatar.replace('emoji:', '') : null);

  return (
    <div className="overflow-hidden rounded-box border border-yellow-500/30 bg-bg-panel shadow-[0_0_0_1px_rgba(234,179,8,0.05),0_12px_30px_rgba(234,179,8,0.08)]">
      <table className="w-full text-left">
        <thead className="border-b border-yellow-500/20 bg-gradient-to-r from-yellow-500/15 via-bg-soft/90 to-yellow-500/10 text-xs uppercase tracking-wide text-text-muted">
          <tr>
            <th className="px-4 py-3">#</th>
            <th className="px-4 py-3">Learner</th>
            <th className="px-4 py-3 text-right">Score</th>
            <th className="px-4 py-3 text-right">Solved</th>
            <th className="px-4 py-3 text-right">Penalty</th>
          </tr>
        </thead>
        <tbody>
          {isEmpty ? (
            <tr className="text-sm">
              <td className="px-4 py-6 text-text-muted" colSpan={5}>
                {emptyLabel}
              </td>
            </tr>
          ) : (
            entries.map((entry) => (
            <tr
              key={`${entry.user_id}-${entry.rank}`}
              className={`border-b border-border/60 text-sm last:border-0 ${entry.is_me ? 'bg-accent/10' : ''} ${entry.rank === 2 ? 'bg-slate-300/10' : ''} ${entry.rank === 3 ? 'bg-amber-700/10' : ''}`}
            >
              <td className="px-4 py-3 font-semibold text-text">{entry.rank}</td>
              <td className="px-4 py-3 text-text">
                <div className="flex items-center gap-3">
                  <div
                    className={`relative h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 ${
                      entry.rank === 1
                        ? 'border-yellow-400 shadow-[0_0_0_3px_rgba(250,204,21,0.22)]'
                        : entry.rank === 2
                          ? 'border-slate-300 bg-slate-300/25'
                          : entry.rank === 3
                            ? 'border-amber-700 bg-amber-700/25'
                            : 'border-border'
                    }`}
                  >
                    {/* Crown badge for top-1 to emphasize champion */}
                    {entry.rank === 1 ? (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-sm" aria-hidden>
                        👑
                      </span>
                    ) : null}
                    {avatarFromEmoji(entry.avatar_url) ? (
                      <span className="flex h-full w-full items-center justify-center text-lg">
                        {avatarFromEmoji(entry.avatar_url)}
                      </span>
                    ) : entry.avatar_url ? (
                      <img src={entry.avatar_url} alt={entry.display_name} className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-xs font-semibold text-text-muted">
                        {entry.display_name
                          .split(' ')
                          .slice(0, 2)
                          .map((part) => part[0]?.toUpperCase() ?? '')
                          .join('')}
                      </span>
                    )}
                  </div>
                  <span className="font-medium">{entry.display_name}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-right text-text">{entry.score}</td>
              <td className="px-4 py-3 text-right text-text">{entry.solved_count}</td>
              <td className="px-4 py-3 text-right text-text-muted">{entry.penalty_seconds}s</td>
            </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
