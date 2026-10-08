import { mineDots, playerStats, stunTicksLeft, visionFor } from '../engine/game';
import { Memory, Terrain, type GameState } from '../engine/types';
import type { PlayerView } from './protocol';

/** Terrain the player remembers about a tile they can't currently see. */
const REMEMBERED: Record<number, number> = {
  [Memory.Mountain]: Terrain.Mountain,
  [Memory.City]: Terrain.City,
  [Memory.General]: Terrain.General,
  [Memory.Tower]: Terrain.Tower,
  [Memory.Crater]: Terrain.Plain,
};

/**
 * Fog-of-war filter: the slice of the game state one player may see.
 * Runs on the server, so hidden data never reaches the client.
 */
export function buildView(state: GameState, pid: number): PlayerView {
  const me = state.players[pid];
  const over = state.winner >= 0 || !me.alive;
  const vis = over ? new Uint8Array(state.size).fill(1) : visionFor(state, pid);
  const n = state.size;
  const terrain = new Array<number>(n);
  const owner = new Array<number>(n);
  const army = new Array<number>(n);
  const visible = new Array<number>(n);
  const dots = new Array<number>(n);
  const crater = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const seen = vis[i] === 1;
    visible[i] = seen ? 1 : 0;
    if (seen) {
      terrain[i] = state.terrain[i];
      owner[i] = state.owner[i];
      army[i] = state.army[i];
    } else {
      const m = me.memory[i];
      terrain[i] = m === Memory.None ? -1 : REMEMBERED[m];
      owner[i] = -1;
      army[i] = 0;
    }
    // Blasts are public: everyone sees the mark until it fades.
    crater[i] = state.crater[i] ? Math.max(0, state.crater[i] - state.tick) : 0;
    dots[i] = me.revealed[i] || over ? mineDots(state, i, over ? -2 : pid) : 0;
  }

  const myMines: number[] = [];
  for (let i = 0; i < n; i++) if (state.mine[i] && state.mineOwner[i] === pid) myMines.push(i);

  let mines: number[] | null = null;
  if (over) {
    mines = [];
    for (let i = 0; i < n; i++) if (state.mine[i]) mines.push(i);
  }

  const stats = playerStats(state);
  return {
    tick: state.tick,
    w: state.w,
    h: state.h,
    you: pid,
    terrain,
    owner,
    army,
    visible,
    dots,
    crater,
    flags: [...me.flags],
    minesInStock: me.minesInStock,
    myMines,
    mines,
    queue: me.queue.slice(),
    stunTicksLeft: stunTicksLeft(state, pid),
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      isBot: p.isBot,
      alive: p.alive,
      army: stats[p.id].army,
      land: stats[p.id].land,
    })),
    // Eliminations and explosions are public; captures and defusals only where you can see them.
    events: state.events.filter(
      (e) => e.kind === 'eliminated' || e.kind === 'explode' || e.player === pid || (e.kind !== 'defuse' && vis[e.idx] === 1),
    ),
    winner: state.winner,
  };
}
