import { isMode, MODES, type GameMode } from './engine/constants';
import type { GameConfig } from './engine/game';
import type { InputEvent } from './engine/types';

/**
 * Everything needed to watch a finished game again: the seed and settings rebuild the
 * map, bots replay themselves (they're seeded from the game), and the log replays the
 * humans. Stored on the server for every game and in each player's browser.
 */
export interface ReplayRecord {
  v: 1;
  id: string;
  mode: GameMode;
  /** Where the game ran: on the server, or in a player's browser (vs bot, solo handoff). */
  source: 'server' | 'browser';
  seed: number;
  players: { name: string; isBot: boolean }[];
  log: InputEvent[];
  /** Ticks played (2 per turn). */
  ticks: number;
  /** Winning player id, or -1 if the game was abandoned before anyone won. */
  winner: number;
  startedAt: number;
  endedAt: number;
  /**
   * Short git hash of the code that played the game (missing on replays from before
   * 2026-10-10). Bots are re-simulated, so a replay only rebuilds exactly on its own build.
   */
  build?: string;
}

/** Biggest replay accepted from a browser (a long human game is ~100 KB). */
export const MAX_REPLAY_BYTES = 512 * 1024;
const MAX_TICKS = 40_000;
const OPS = new Set(['move', 'undo', 'clear', 'flag', 'drop', 'pickup', 'relocate']);

export function replayConfig(r: ReplayRecord): GameConfig {
  const { w, h, mineRate, mountainRate, spawnEdgeRows } = MODES[r.mode];
  return { w, h, seed: r.seed, players: r.players, mineRate, mountainRate, spawnEdgeRows };
}

/** Turns per human-readable game length. */
export function replayTurns(r: ReplayRecord): number {
  return Math.floor(r.ticks / 2);
}

/**
 * Checks a replay sent by a browser: shape, sizes and ranges only. A forged replay can't
 * hurt anyone (replays are analytics), so it isn't re-simulated on the server.
 */
export function validateReplay(x: unknown, sources: ReplayRecord['source'][] = ['browser']): ReplayRecord | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Partial<ReplayRecord>;
  if (r.v !== 1 || !isMode(r.mode) || !sources.includes(r.source!)) return null;
  if (typeof r.id !== 'string' || !/^[a-z0-9-]{8,40}$/.test(r.id)) return null;
  if (!Number.isInteger(r.seed) || r.seed! < 0 || r.seed! >= 2 ** 32) return null;
  const n = MODES[r.mode].players;
  if (!Array.isArray(r.players) || r.players.length !== n) return null;
  if (!r.players.every((p) => p && typeof p.name === 'string' && p.name.length <= 16 && typeof p.isBot === 'boolean')) return null;
  if (!Number.isInteger(r.ticks) || r.ticks! < 0 || r.ticks! > MAX_TICKS) return null;
  if (!Number.isInteger(r.winner) || r.winner! < -1 || r.winner! >= n) return null;
  if (!Number.isFinite(r.startedAt) || !Number.isFinite(r.endedAt)) return null;
  if (r.build !== undefined && (typeof r.build !== 'string' || !/^[a-z0-9]{1,12}$/.test(r.build))) return null;
  if (!Array.isArray(r.log)) return null;
  const size = MODES[r.mode].w * MODES[r.mode].h;
  const tile = (v: unknown) => Number.isInteger(v) && (v as number) >= -1 && (v as number) < size;
  for (const e of r.log) {
    if (!e || typeof e !== 'object' || !OPS.has(e.op) || !Number.isInteger(e.tick) || !Number.isInteger(e.pid)) return null;
    if (e.pid < 0 || e.pid >= n || e.tick < 0 || e.tick > MAX_TICKS) return null;
    if ('idx' in e && !tile(e.idx)) return null;
    if ('from' in e && (!tile(e.from) || !tile(e.to))) return null;
  }
  return r as ReplayRecord;
}
