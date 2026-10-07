import type { GameEvent, Move } from '../engine/types';

/** Messages from a browser to the game server. */
export type ClientMessage =
  | { t: 'join'; name: string }
  | { t: 'leave' }
  | { t: 'move'; from: number; to: number; half: boolean }
  | { t: 'undo' }
  | { t: 'clear' };

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
  /** Mine-direction dot mask (see mineDots) on tiles this player has revealed, else 0. */
  dots: number[];
  /** Known craters (seen now or remembered). */
  crater: number[];
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
  | { t: 'error'; code?: 'full'; message: string };
