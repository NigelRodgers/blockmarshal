/** Troops destroyed when an army walks onto a live mine. */
export const MINE_DAMAGE = 15;

/** Ticks the triggering player cannot move after setting off a mine. */
export const MINE_STUN_TICKS = 6;

/** Neutral watchtower garrison. Towers produce no troops. */
export const TOWER_GARRISON = 25;

/** Watchtower vision and number-reveal radius (Chebyshev, so 3 = 7x7). */
export const TOWER_RADIUS = 3;

/** Generals and owned cities produce +1 every N ticks (2 ticks = 1 turn). */
export const GENERAL_GROWTH_TICKS = 2;

/** Every owned tile produces +1 every N ticks. */
export const LAND_GROWTH_TICKS = 50;

export const DEFAULT_MINE_RATE = 0.18;

/** How many steps a zero-cascade may spread from the captured tile. Keeps the opening local. */
export const REVEAL_CASCADE = 3;

export const DEFAULT_MOUNTAIN_RATE = 0.14;

export const PLAYER_COLORS = ['#f57c00', '#1e88e5', '#43a047', '#8e24aa'];
export const PLAYER_NAMES = ['You', 'Blue', 'Green', 'Violet'];
