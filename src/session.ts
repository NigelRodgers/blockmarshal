import { Bot, type Difficulty } from './ai/bot';
import { applyInput, createGame, step, type GameConfig } from './engine/game';
import { mulberry32 } from './engine/rng';
import type { GameState, InputEvent } from './engine/types';

/**
 * Bots for a game. Their RNG comes from the game seed, so the same seed and
 * the same human inputs always produce the same bot behaviour.
 */
export function createBots(state: GameState, difficulty: Difficulty): Bot[] {
  const rng = mulberry32(state.seed ^ 0x9e3779b9);
  return state.players.filter((p) => p.isBot).map((p) => new Bot(p.id, difficulty, rng));
}

/** One tick in the canonical order: bots decide, then the world steps. */
export function runTick(state: GameState, bots: Bot[]): void {
  for (const b of bots) b.think(state);
  step(state);
}

/**
 * Rebuild a game from its config and input log. Runs until someone wins or
 * `untilTick` is reached, whichever comes first.
 */
export function replay(cfg: GameConfig, difficulty: Difficulty, log: InputEvent[], untilTick = 20000): GameState {
  const state = createGame(cfg);
  const bots = createBots(state, difficulty);
  let next = 0;
  while (state.winner < 0 && state.tick < untilTick) {
    while (next < log.length && log[next].tick === state.tick) applyInput(state, log[next++]);
    runTick(state, bots);
  }
  state.log = log.slice();
  return state;
}
