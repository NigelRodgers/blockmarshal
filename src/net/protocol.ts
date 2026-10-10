import type { GameMode } from '../engine/constants';
import type { GameEvent, Move } from '../engine/types';
import type { ReplayRecord } from '../replay';

/** Messages from a browser to the game server. */
export type ClientMessage =
  /** `mode` must match the lobby the matchmaker picked (missing = free-for-all). */
  | { t: 'join'; name: string; mode?: GameMode }
  | { t: 'leave' }
  | { t: 'move'; from: number; to: number; half: boolean }
  | { t: 'undo' }
  | { t: 'clear' }
  /** Flag or unflag a tile (max 5). Flags are private to you. */
  | { t: 'flag'; idx: number }
  /** Plant a captured mine on one of your own tiles. */
  | { t: 'drop'; idx: number }
  /** Take one of your planted mines back into stock (replant on the same stretch of land). */
  | { t: 'pickup'; idx: number }
  /** Move your general or a city you hold to another of your open tiles on the same stretch of land. */
  | { t: 'relocate'; from: number; to: number };

export interface LobbySlot {
  name: string;
  you: boolean;
}

export interface PublicPlayer {
  id: number;
  name: string;
  color: string;
  isBot: boolean;
  alive: boolean;
  army: number;
  land: number;
}

/**
 * Everything one player is allowed to know, rebuilt every tick. Arrays have one
 * entry per tile. Hidden information (mines, fogged armies) is never included
 * while the player is still in the game.
 */
export interface PlayerView {
  tick: number;
  w: number;
  h: number;
  you: number;
  /** Terrain if seen now or remembered, else -1 (never seen). */
  terrain: number[];
  /** Owner if visible right now, else -1. */
  owner: number[];
  /** Troops if visible right now, else 0. */
  army: number[];
  visible: number[];
  /** Mine-direction dot mask (see mineDots) on tiles this player has revealed, else 0. Excludes your own planted mines. */
  dots: number[];
  /** Subset of `dots`: bits pointing at locked mines (freshly planted, can't be captured). */
  lockedDots: number[];
  /** Blast marks, visible to everyone: ticks until the mark fades (0 = none). */
  crater: number[];
  /** Your flags. */
  flags: number[];
  /** Mines you can plant: the starting stock, refills, captures and pick-ups. */
  minesInStock: number;
  /** Turns until the next refill mine (0 while the stock is full). */
  refillTurns: number;
  /** One of your tiles per stocked mine: that mine can only be planted on land connected to it. */
  stockAnchors: number[];
  /** Your general, cities and mines that were moved or planted recently: turns until each may move again. */
  moveCooldowns: { idx: number; turns: number }[];
  /** Mines you planted that are still armed (shown to you as mine icons). */
  myMines: number[];
  /** Mines you crossed with a full stock: on your land, flagged by you, not yours (step on one with room in stock to collect it). */
  keptMines: number[];
  /** Every live mine, only once the player is out of the game or it has ended. */
  mines: number[] | null;
  queue: Move[];
  stunTicksLeft: number;
  players: PublicPlayer[];
  /** Events this player is allowed to see. */
  events: GameEvent[];
  winner: number;
}

/** Messages from the game server to a browser. */
export type ServerMessage =
  | { t: 'lobby'; matchId: string; slots: LobbySlot[]; capacity: number; startsInMs: number }
  | { t: 'start'; matchId: string; you: number }
  | { t: 'view'; view: PlayerView }
  /** You're the only human: play this one against bots in your browser instead. */
  | { t: 'solo' }
  /** The finished game, to keep in the browser (sent when a game ends). */
  | { t: 'replay'; replay: ReplayRecord }
  | { t: 'error'; code?: 'full'; message: string };
