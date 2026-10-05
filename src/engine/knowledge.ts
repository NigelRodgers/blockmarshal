import { Memory, type GameState } from './types';

export interface Knowledge {
  /** Certainly no live mine. */
  safe: Uint8Array;
  /** Certainly a mine (live, or already a crater). */
  mine: Uint8Array;
  /** Estimated chance of a live mine. */
  prob: Float32Array;
}

/**
 * What a player knows about mines. Every revealed tile shows dots toward its
 * mined neighbours, so all 8 neighbours of a revealed tile are known exactly.
 * Anything further out is a guess at the map's mine density.
 * `readDots: false` models a careless player who ignores the dots.
 */
export function analyze(state: GameState, pid: number, readDots = true): Knowledge {
  const { size, n8 } = state;
  const p = state.players[pid];
  const safe = new Uint8Array(size);
  const mine = new Uint8Array(size);
  const prob = new Float32Array(size).fill(state.mineRate);

  for (let i = 0; i < size; i++) {
    const m = p.memory[i];
    if (m === Memory.Crater) mine[i] = 1;
    else if (p.revealed[i] || state.owner[i] === pid || (m !== Memory.None && m !== Memory.Crater)) safe[i] = 1;
  }
  for (let i = 0; i < size; i++) {
    if (!readDots || !p.revealed[i]) continue;
    for (const j of n8[i]) {
      if (state.mine[j]) mine[j] = 1;
      else safe[j] = 1;
    }
  }
  for (let i = 0; i < size; i++) {
    if (safe[i]) prob[i] = 0;
    else if (mine[i]) prob[i] = p.memory[i] === Memory.Crater ? 0 : 1;
  }
  return { safe, mine, prob };
}
