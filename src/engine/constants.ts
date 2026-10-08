/** Troops destroyed when an army walks onto a live mine. */
export const MINE_DAMAGE = 15;

/** Ticks the triggering player cannot move after setting off a mine. */
export const MINE_STUN_TICKS = 6;

/** Flags a player may have placed at once. */
export const MAX_FLAGS = 5;

/** A blast mark stays visible to everyone for this long (10 turns), then the tile is ordinary again. */
export const CRATER_TICKS = 20;

/** Watchtowers per match. Off for now (0); the feature stays in the engine for later. */
export const TOWERS_PER_MATCH = 0;

/** Neutral watchtower garrison. Towers produce no troops. */
export const TOWER_GARRISON = 25;

/** Watchtower vision and number-reveal radius (Chebyshev, so 3 = 7x7). */
export const TOWER_RADIUS = 3;

/** After a general or city moves, it can't move again for this many ticks (100 turns). Mines have no cooldown. */
export const RELOCATE_COOLDOWN_TICKS = 200;

/** Generals and owned cities produce +1 every N ticks (2 ticks = 1 turn). */
export const GENERAL_GROWTH_TICKS = 2;

/** Every owned tile produces +1 every N ticks. */
export const LAND_GROWTH_TICKS = 50;

/** Share of eligible plains that hide a mine (was 0.18; cut by a quarter). */
export const DEFAULT_MINE_RATE = 0.135;

export const DEFAULT_MOUNTAIN_RATE = 0.14;

/** Six slots per match. Avoid reds: mine dots are red. */
export const PLAYER_COLORS = ['#f57c00', '#1e88e5', '#43a047', '#8e24aa', '#00acc1', '#8d6e63'];
export const BOT_NAMES = ['Ada', 'Bishop', 'Cato', 'Dara', 'Ezra', 'Fen', 'Gale', 'Hux', 'Ivo', 'Juno'];

/** One fixed board that fits portrait phones (~26px tiles on a 390px-wide screen). */
export const MAP_W = 15;
export const MAP_H = 25;
export const MATCH_PLAYERS = 6;
export const LOBBY_SECONDS = 60;
export const TICK_MS = 500;
