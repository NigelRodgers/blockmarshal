import { describe, expect, it } from 'vitest';
import {
  computeStreak,
  formatCountdown,
  loadRecords,
  msUntilReset,
  prevDate,
  saveRecords,
  settleStale,
  shareText,
  type DailyRecord,
  type Records,
} from '../src/dailyRecords';

function rec(date: string, over: Partial<DailyRecord> = {}): DailyRecord {
  return { date, day: 1, difficulty: 'normal', status: 'won', turn: 100, minesLost: 0, mineHits: 0, strikes: 0, ...over };
}

function byDate(...rs: DailyRecord[]): Records {
  return Object.fromEntries(rs.map((r) => [r.date, r]));
}

describe('dates', () => {
  it('steps back across month and year boundaries', () => {
    expect(prevDate('2026-10-01')).toBe('2026-09-30');
    expect(prevDate('2027-01-01')).toBe('2026-12-31');
    expect(prevDate('2028-03-01')).toBe('2028-02-29');
  });

  it('counts down to the next UTC midnight', () => {
    expect(msUntilReset(new Date('2026-10-01T23:00:00Z'))).toBe(3_600_000);
    expect(formatCountdown(3_600_000 + 5 * 60_000)).toBe('1h 5m');
    expect(formatCountdown(90_000)).toBe('2m');
  });
});

describe('streak', () => {
  it('counts consecutive played days, any result', () => {
    const r = byDate(rec('2026-10-03'), rec('2026-10-04', { status: 'lost' }), rec('2026-10-05', { status: 'forfeit' }));
    expect(computeStreak(r, '2026-10-05')).toBe(3);
  });

  it('stays alive until today is played, then breaks after a missed day', () => {
    const r = byDate(rec('2026-10-03'), rec('2026-10-04'));
    expect(computeStreak(r, '2026-10-05')).toBe(2);
    expect(computeStreak(r, '2026-10-06')).toBe(0);
  });

  it('does not count an unfinished attempt', () => {
    const r = byDate(rec('2026-10-04'), rec('2026-10-05', { status: 'in-progress' }));
    expect(computeStreak(r, '2026-10-05')).toBe(1);
  });
});

describe('stale attempts', () => {
  it('turns an attempt left in progress into a forfeit', () => {
    const r = byDate(rec('2026-10-05', { status: 'in-progress' }), rec('2026-10-04'));
    expect(settleStale(r)).toBe(true);
    expect(r['2026-10-05'].status).toBe('forfeit');
    expect(r['2026-10-04'].status).toBe('won');
    expect(settleStale(r)).toBe(false);
  });
});

describe('share text', () => {
  it('summarises a win', () => {
    const text = shareText(rec('2026-10-05', { day: 5, difficulty: 'hard', turn: 187, mineHits: 2, minesLost: 18 }), 4, 'https://x.dev/');
    expect(text).toBe(
      ['Blockmarshal #5 · Hard', '🏆 Won on turn 187', '💥💥 2 mines, 18 troops lost', '🔥 4-day streak', 'https://x.dev/'].join('\n'),
    );
  });

  it('calls pre-launch results a preview', () => {
    const firstLine = shareText(rec('2026-10-05', { day: -4 }), 1, 'u').split('\n')[0];
    expect(firstLine).toBe('Blockmarshal preview · Normal');
  });

  it('handles a clean loss with no streak line', () => {
    const text = shareText(rec('2026-10-05', { status: 'lost', turn: 90 }), 1, 'u');
    expect(text).toBe(['Blockmarshal #1 · Normal', '💀 Fell on turn 90', '🧹 Never hit a mine', 'u'].join('\n'));
  });
});

describe('storage', () => {
  it('keeps logs only for the most recent 14 days', () => {
    const mem = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => mem.set(k, v),
    };
    const r: Records = {};
    for (let d = 1; d <= 20; d++) {
      const date = `2026-10-${String(d).padStart(2, '0')}`;
      r[date] = rec(date, { log: [{ tick: 1, pid: 0, op: 'clear' }] });
    }
    saveRecords(r);
    const back = loadRecords();
    expect(Object.keys(back).length).toBe(20);
    expect(back['2026-10-06'].log).toBeUndefined();
    expect(back['2026-10-07'].log?.length).toBe(1);
  });
});
