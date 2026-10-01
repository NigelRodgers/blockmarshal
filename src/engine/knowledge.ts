import { Memory, Terrain, type GameState } from './types';

export interface Knowledge {
  /** Certainly no live mine. */
  safe: Uint8Array;
  /** Certainly a mine (live, or already a crater). */
  mine: Uint8Array;
  /** Estimated chance of a live mine. */
  prob: Float32Array;
}

/**
 * What a player can logically conclude about mines from the numbers they know.
 * Uses the two classic single-cell rules, iterated to a fixed point.
 */
export function analyze(state: GameState, pid: number, deduce = true): Knowledge {
  const { size, n8, adj } = state;
  const p = state.players[pid];
  const safe = new Uint8Array(size);
  const mine = new Uint8Array(size);
  const prob = new Float32Array(size);

  for (let i = 0; i < size; i++) {
    const m = p.memory[i];
    if (m === Memory.Crater) mine[i] = 1;
    else if (p.revealed[i] || (m !== Memory.None && m !== Memory.Crater)) safe[i] = 1;
    else if (state.owner[i] === pid) safe[i] = 1;
  }

  const clues: number[] = [];
  for (let i = 0; i < size; i++) if (p.revealed[i] && adj[i] > 0 && state.terrain[i] !== Terrain.Mountain) clues.push(i);

  if (deduce) {
    for (let pass = 0; pass < 20; pass++) {
      let changed = false;
      for (const c of clues) {
        let known = 0;
        const unknown: number[] = [];
        for (const j of n8[c]) {
          if (mine[j]) known++;
          else if (!safe[j]) unknown.push(j);
        }
        if (!unknown.length) continue;
        if (known === adj[c]) {
          for (const j of unknown) safe[j] = 1;
          changed = true;
        } else if (adj[c] - known === unknown.length) {
          for (const j of unknown) mine[j] = 1;
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  prob.fill(state.mineRate);
  for (let i = 0; i < size; i++) {
    if (safe[i]) prob[i] = 0;
    else if (mine[i]) prob[i] = p.memory[i] === Memory.Crater ? 0 : 1;
  }
  for (const c of clues) {
    let known = 0;
    const unknown: number[] = [];
    for (const j of n8[c]) {
      if (mine[j]) known++;
      else if (!safe[j]) unknown.push(j);
    }
    if (!unknown.length) continue;
    const local = (adj[c] - known) / unknown.length;
    for (const j of unknown) prob[j] = Math.max(prob[j] === state.mineRate ? 0 : prob[j], local);
  }
  return { safe, mine, prob };
}
