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
  | { tick: number; pid: number; op: 'clear' };

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
  /** Troops lost to mines (daily-challenge tiebreak). */
  minesLost: number;
}

export type GameEvent =
  | { kind: 'explode'; idx: number; player: number; lost: number }
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
  crater: Uint8Array;
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
}
