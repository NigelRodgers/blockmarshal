import type { Bot } from './ai/bot';
import { applyInput, createGame } from './engine/game';
import type { GameState } from './engine/types';
import { buildView } from './net/view';
import type { PlayerView } from './net/protocol';
import { replayConfig, type ReplayRecord } from './replay';
import { createBots, runTick } from './session';

/**
 * Plays a replay back tick by tick: rebuilds the game from its seed, lets the (seeded)
 * bots play themselves and feeds the humans' logged inputs at the ticks they were made.
 * Views show the whole board, nothing fogged.
 */
export class ReplayPlayer {
  private state!: GameState;
  private bots!: Bot[];
  private next = 0;

  constructor(readonly record: ReplayRecord) {
    this.restart();
  }

  restart(): void {
    this.state = createGame(replayConfig(this.record));
    this.bots = createBots(this.state, 'normal');
    this.next = 0;
  }

  get tick(): number {
    return this.state.tick;
  }

  get done(): boolean {
    return this.state.winner >= 0 || this.state.tick >= this.record.ticks;
  }

  /**
   * At the end: the rebuilt game didn't finish the way the recorded one did. Happens
   * when the replay was made by a build whose bots or rules differ from this one.
   */
  get diverged(): boolean {
    return this.done && (this.state.winner !== this.record.winner || this.state.tick !== this.record.ticks);
  }

  /** Advance one tick. */
  step(): void {
    if (this.done) return;
    const log = this.record.log;
    while (this.next < log.length && log[this.next].tick === this.state.tick) applyInput(this.state, log[this.next++]);
    runTick(this.state, this.bots);
  }

  /** Jump to a tick (replaying from the start if it's behind us). */
  seek(tick: number): void {
    if (tick < this.state.tick) this.restart();
    while (!this.done && this.state.tick < tick) this.step();
  }

  /** The whole board, from `pid`'s seat (their name, their colour highlighted in standings). */
  view(pid: number): PlayerView {
    return buildView(this.state, pid, true);
  }
}
