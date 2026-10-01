import type { Difficulty } from './ai/bot';
import type { InputEvent } from './engine/types';

export type DailyStatus = 'in-progress' | 'won' | 'lost' | 'forfeit';

/** One player's ranked attempt at one day's challenge. */
export interface DailyRecord {
  date: string;
  day: number;
  difficulty: Difficulty;
  status: DailyStatus;
  /** Turn the game ended on (win, loss or forfeit). */
  turn: number;
  minesLost: number;
  mineHits: number;
  strikes: number;
  /** Input log for replay / future server verification. Dropped for old days to save space. */
  log?: InputEvent[];
}

export type Records = Record<string, DailyRecord>;

const KEY = 'blockmarshal.daily.v1';
const KEEP_LOG_DAYS = 14;

export function loadRecords(): Records {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Records) : {};
  } catch {
    return {};
  }
}

export function saveRecords(records: Records): void {
  const dates = Object.keys(records).sort();
  for (const d of dates.slice(0, -KEEP_LOG_DAYS)) delete records[d].log;
  try {
    localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    /* storage full or unavailable: the attempt still plays, it just isn't remembered */
  }
}

/**
 * An attempt still marked in progress when the app starts means the page was
 * closed mid-game. Closing counts as quitting, and quitting is a forfeit.
 */
export function settleStale(records: Records): boolean {
  let changed = false;
  for (const r of Object.values(records)) {
    if (r.status === 'in-progress') {
      r.status = 'forfeit';
      changed = true;
    }
  }
  return changed;
}

export function prevDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** Consecutive days played (any finished attempt) ending today, or yesterday if today is still open. */
export function computeStreak(records: Records, today: string): number {
  const played = (d: string) => !!records[d] && records[d].status !== 'in-progress';
  let d = played(today) ? today : prevDate(today);
  let streak = 0;
  while (played(d)) {
    streak++;
    d = prevDate(d);
  }
  return streak;
}

export function msUntilReset(now: Date = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
}

export function formatCountdown(ms: number): string {
  const mins = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${mins % 60}m` : `${mins}m`;
}

export function resultLine(r: DailyRecord): string {
  if (r.status === 'won') return `Won on turn ${r.turn}`;
  if (r.status === 'lost') return `Fell on turn ${r.turn}`;
  if (r.status === 'forfeit') return `Forfeited on turn ${r.turn}`;
  return 'In progress';
}

const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

/** Wordle-style result text for pasting into chats. */
export function shareText(r: DailyRecord, streak: number, url: string): string {
  const icon = r.status === 'won' ? '🏆' : r.status === 'lost' ? '💀' : '🏳️';
  const mines =
    r.mineHits === 0
      ? '🧹 Never hit a mine'
      : `${'💥'.repeat(Math.min(r.mineHits, 8))} ${r.mineHits} mine${r.mineHits === 1 ? '' : 's'}, ${r.minesLost} troops lost`;
  const title = r.day >= 1 ? `Blockmarshal #${r.day}` : 'Blockmarshal preview';
  const lines = [`${title} · ${DIFFICULTY_LABEL[r.difficulty]}`, `${icon} ${resultLine(r)}`, mines];
  if (streak > 1) lines.push(`🔥 ${streak}-day streak`);
  lines.push(url);
  return lines.join('\n');
}
