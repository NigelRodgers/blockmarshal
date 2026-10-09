/** Troops destroyed when an army walks onto a live mine. */
export const MINE_DAMAGE = 15;

/** Ticks the triggering player cannot move after setting off a mine. */
export const MINE_STUN_TICKS = 6;

/** Flags a player may have placed at once. */
export const MAX_FLAGS = 5;

/** Unplanted mines a player can hold. With a full stock a flagged mine is disarmed but not kept. */
export const MAX_MINE_STOCK = 5;

/** A blast mark stays visible to everyone for this long (10 turns), then the tile is ordinary again. */
export const CRATER_TICKS = 20;

/** Watchtowers per match. Off for now (0); the feature stays in the engine for later. */
export const TOWERS_PER_MATCH = 0;

/** Neutral watchtower garrison. Towers produce no troops. */
export const TOWER_GARRISON = 25;

/** Watchtower vision and number-reveal radius (Chebyshev, so 3 = 7x7). */
export const TOWER_RADIUS = 3;

/**
 * After a general or city moves it can't move again for this many ticks (100 turns). A planted mine
 * is locked against enemies for the same time (no capturing it); its owner may pick it up any time.
 */
export const RELOCATE_COOLDOWN_TICKS = 200;

/**
 * Bots plant mines and move their general or cities with this delay (3 turns), like the time
 * a human spends long-pressing and choosing. The action happens on the third turn and fails
 * if, by then, it has become illegal (the tile was taken, the land was cut in two...).
 */
export const BOT_ACTION_DELAY_TICKS = 6;

/** Generals and owned cities produce +1 every N ticks (2 ticks = 1 turn). */
export const GENERAL_GROWTH_TICKS = 2;

/** Every owned tile produces +1 every N ticks. */
export const LAND_GROWTH_TICKS = 50;

/** Share of eligible plains that hide a mine (was 0.18; cut by a quarter). */
export const DEFAULT_MINE_RATE = 0.135;

export const DEFAULT_MOUNTAIN_RATE = 0.14;

/**
 * Six slots per match: orange, sky, teal, indigo, pink, brown. Picked to stay apart for
 * red-green and blue-yellow colour blindness (spread in lightness as well as hue) and to
 * avoid reds, which are the mine dots. Troop numbers switch between dark and white per tile.
 */
export const PLAYER_COLORS = ['#f5a623', '#7ec8f0', '#00806a', '#2e3a9e', '#d16ab8', '#5a3a22'];
export const BOT_NAMES = ['Ada', 'Bishop', 'Cato', 'Dara', 'Ezra', 'Fen', 'Gale', 'Hux', 'Ivo', 'Juno'];

/** One fixed board that fits portrait phones (~26px tiles on a 390px-wide screen). */
export const MAP_W = 15;
export const MAP_H = 25;
export const MATCH_PLAYERS = 6;

/**
 * Free-for-all (six generals) or a 1 vs 1 duel on a smaller board (bigger tiles, shorter games).
 * Duels have twice the mines and 10% more mountains.
 */
export type GameMode = 'ffa' | 'duel';
export interface ModeConfig {
  players: number;
  w: number;
  h: number;
  mineRate: number;
  mountainRate: number;
}
export const MODES: Record<GameMode, ModeConfig> = {
  ffa: { players: MATCH_PLAYERS, w: MAP_W, h: MAP_H, mineRate: DEFAULT_MINE_RATE, mountainRate: DEFAULT_MOUNTAIN_RATE },
  duel: { players: 2, w: 11, h: 17, mineRate: DEFAULT_MINE_RATE * 2, mountainRate: DEFAULT_MOUNTAIN_RATE * 1.1 },
};

export function isMode(x: unknown): x is GameMode {
  return x === 'ffa' || x === 'duel';
}
export const LOBBY_SECONDS = 60;
export const TICK_MS = 500;
