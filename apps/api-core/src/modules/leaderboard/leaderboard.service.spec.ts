import { LeaderboardService } from './leaderboard.service';

describe('LeaderboardService', () => {
  it('parses valid cursor values', () => {
    const svc = new LeaderboardService({} as never);
    expect((svc as any).safeCursor('12')).toBe(12);
    expect((svc as any).safeCursor('12.9')).toBe(12);
  });

  it('rejects invalid cursor values', () => {
    const svc = new LeaderboardService({} as never);
    expect((svc as any).safeCursor(undefined)).toBeUndefined();
    expect((svc as any).safeCursor('0')).toBeUndefined();
    expect((svc as any).safeCursor('-3')).toBeUndefined();
    expect((svc as any).safeCursor('abc')).toBeUndefined();
  });
});
