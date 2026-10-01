export const Terrain = { Plain: 0, Mountain: 1, City: 2, General: 3 } as const;
export type TerrainType = (typeof Terrain)[keyof typeof Terrain];

/** What a player remembers about a tile they can no longer see. */
export const Memory = { None: 0, Mountain: 1, City: 2, Crater: 3, General: 4 } as const;

export interface Move {
  from: number;
  to: number;
  half: boolean;
}

export interface Player {
  id: number;
  name: string;
  color: string;
  isBot: boolean;
  alive: boolean;
  general: number;
  queue: Move[];
  /** Tiles whose adjacent-mine number this player knows (and therefore knows are safe). */
  revealed: Uint8Array;
  flags: Uint8Array;
  memory: Uint8Array;
  eliminatedAt: number;
  killedBy: number;
}

export type GameEvent =
  | { kind: 'explode'; idx: number; player: number; lost: number }
  | { kind: 'eliminated'; victim: number; by: number }
  | { kind: 'captureCity'; idx: number; player: number };

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
  /** Minesweeper number: mines among the 8 neighbours (fixed at map creation). */
  adj: Uint8Array;
  n4: number[][];
  n8: number[][];
  players: Player[];
  tick: number;
  winner: number;
  events: GameEvent[];
  mineCount: number;
  mineRate: number;
}
