import type { Difficulty } from './ai/bot';
import { PLAYER_NAMES } from './engine/constants';
import type { GameConfig } from './engine/game';

/**
 * Day 1 of the daily challenge (UTC), as YYYY-MM-DD. Set VITE_DAILY_EPOCH at build
 * time to the public launch date so the first public puzzle is #1. Changing it after
 * launch renumbers every puzzle, so set it once.
 */
const EPOCH_DATE = (import.meta.env?.VITE_DAILY_EPOCH as string | undefined) || '2026-10-10';
const EPOCH = Date.parse(`${EPOCH_DATE}T00:00:00Z`);

/** "Daily #12", or "Daily preview" for days before launch (number zero or below). */
export function dailyLabel(day: number): string {
  return day >= 1 ? `Daily #${day}` : 'Daily preview';
}

export interface DailyConfig {
  /** Puzzle number shown on share cards, starting at 1. */
  day: number;
  /** UTC date, YYYY-MM-DD. */
  date: string;
  difficulty: Difficulty;
  tickMs: number;
  game: GameConfig;
}

/** cyrb53-style string hash folded to 32 bits; stable across platforms. */
export function hashString(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/** Everyone in the world gets the same challenge for a given UTC day. */
export function dailyConfig(now: Date = new Date()): DailyConfig {
  const date = now.toISOString().slice(0, 10);
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const weekday = now.getUTCDay(); // 0 = Sunday
  const difficulty: Difficulty = weekday === 0 || weekday >= 5 ? 'hard' : 'normal';
  return {
    day: Math.floor((midnight - EPOCH) / 86_400_000) + 1,
    date,
    difficulty,
    tickMs: 500,
    game: {
      w: 15,
      h: 21,
      seed: hashString(`blockmarshal:${date}`),
      players: [0, 1, 2].map((i) => ({ name: PLAYER_NAMES[i], isBot: i !== 0 })),
    },
  };
}
