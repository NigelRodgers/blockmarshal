export const Terrain = { Plain: 0, Mountain: 1, City: 2, General: 3, Tower: 4 } as const;
export type TerrainType = (typeof Terrain)[keyof typeof Terrain];

/** What a player remembers about a tile they can no longer see. */
export const Memory = { None: 0, Mountain: 1, City: 2, Crater: 3, General: 4, Tower: 5 } as const;

export interface Move {
  from: number;
  to: number;
  half: boolean;
}

/** A human input, stamped with the tick it was made before. Seed + log replays a game exactly. */
export type InputEvent =
  | { tick: number; pid: number; op: 'move'; from: number; to: number; half: boolean }
  | { tick: number; pid: number; op: 'undo' }
  | { tick: number; pid: number; op: 'clear' }
  | { tick: number; pid: number; op: 'flag'; idx: number }
  | { tick: number; pid: number; op: 'drop'; idx: number }
  | { tick: number; pid: number; op: 'pickup'; idx: number }
  | { tick: number; pid: number; op: 'relocate'; from: number; to: number };

/** A delayed action (bots): carried out at tick `at` if still legal then, else dropped. */
export interface PendingAction {
  pid: number;
  kind: 'relocate' | 'plant';
  /** Building tile for 'relocate'; unused (-1) for 'plant'. */
  from: number;
  to: number;
  at: number;
}

/** A mine in a player's stock. */
export interface StockedMine {
  /** The tile it came from: it can only be planted on land connected to this tile. -1: a refill, planted on the general's land. */
  from: number;
}

export interface Player {
  id: number;
  name: string;
  color: string;
  isBot: boolean;
  alive: boolean;
  general: number;
  queue: Move[];
  /** Tiles this player has held (or seen from a watchtower): they show mine dots for this player. */
  revealed: Uint8Array;
  memory: Uint8Array;
  eliminatedAt: number;
  killedBy: number;
  /** Moves are skipped on any tick before this one. */
  stunUntil: number;
  /** Troops lost to mines. */
  minesLost: number;
  /** Tiles this player has flagged (at most MAX_FLAGS). Private to the player. */
  flags: Set<number>;
  /**
   * Captured or picked-up mines ready to plant. A mine can only be planted on
   * land connected to the tile it came from (see plantMine); if that tile has
   * been lost, it goes with the general's land.
   */
  stock: StockedMine[];
  /** Tick the next refill mine arrives (see STOCK_REFILL_TICKS); -1 while the stock is full. */
  refillAt: number;
}

export type GameEvent =
  | { kind: 'explode'; idx: number; player: number; lost: number }
  /** A flagged mine taken safely; `kept: false` when the player's stock was full (crossed safely, left in place, still flagged). */
  | { kind: 'defuse'; idx: number; player: number; kept: boolean }
  | { kind: 'eliminated'; victim: number; by: number }
  | { kind: 'captureCity'; idx: number; player: number }
  | { kind: 'captureTower'; idx: number; player: number };

export interface GameState {
  w: number;
  h: number;
  size: number;
  seed: number;
  terrain: Uint8Array;
  owner: Int8Array;
  army: Int32Array;
  mine: Uint8Array;
  /** Tick at which a blast mark disappears; 0 = no mark. Blasts are public. */
  crater: Int32Array;
  /** Tick from which the general, city or planted mine on this tile may move again (0 = any time). */
  moveReady: Int32Array;
  /** Who planted each mine: -1 for the map's own mines. */
  mineOwner: Int8Array;
  n4: number[][];
  n8: number[][];
  players: Player[];
  tick: number;
  winner: number;
  events: GameEvent[];
  mineCount: number;
  mineRate: number;
  /** Inputs from human players, for replays and score verification. */
  log: InputEvent[];
  /** Delayed actions waiting for their tick (see BOT_ACTION_DELAY_TICKS). */
  pending: PendingAction[];
}
