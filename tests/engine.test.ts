import { describe, expect, it } from 'vitest';
import { Bot } from '../src/ai/bot';
import { MINE_DAMAGE } from '../src/engine/constants';
import { createGame, queueMove, step } from '../src/engine/game';
import { chebyshev } from '../src/engine/grid';
import { analyze } from '../src/engine/knowledge';
import { mulberry32 } from '../src/engine/rng';
import { Terrain } from '../src/engine/types';

const twoPlayers = [
  { name: 'A', isBot: false },
  { name: 'B', isBot: true },
];

describe('map generation', () => {
  it('keeps the 3x3 around each general free of mines and mountains', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = createGame({ w: 15, h: 21, seed, players: twoPlayers });
      for (const p of s.players) {
        for (let i = 0; i < s.size; i++) {
          if (chebyshev(s.w, p.general, i) > 1) continue;
          expect(s.mine[i]).toBe(0);
          expect(s.terrain[i]).not.toBe(Terrain.Mountain);
        }
      }
    }
  });

  it('is deterministic per seed', () => {
    const a = createGame({ w: 15, h: 21, seed: 7, players: twoPlayers });
    const b = createGame({ w: 15, h: 21, seed: 7, players: twoPlayers });
    expect([...a.mine]).toEqual([...b.mine]);
    expect([...a.terrain]).toEqual([...b.terrain]);
  });

  it('opens the starting area like a minesweeper first click', () => {
    const s = createGame({ w: 15, h: 21, seed: 3, players: twoPlayers });
    const rev = s.players[0].revealed;
    expect(rev[s.players[0].general]).toBe(1);
    for (const j of s.n8[s.players[0].general]) expect(rev[j]).toBe(1);
  });
});

describe('mines', () => {
  it('kills up to MINE_DAMAGE, halves neighbours and clears the queue', () => {
    const s = createGame({ w: 15, h: 21, seed: 11, players: twoPlayers });
    const me = s.players[0];
    // Find a mine with an orthogonal non-mountain neighbour to launch from.
    const target = s.mine.findIndex((m, i) => m === 1 && s.n4[i].some((j) => s.terrain[j] === Terrain.Plain && !s.mine[j]));
    const from = s.n4[target].find((j) => s.terrain[j] === Terrain.Plain && !s.mine[j])!;
    s.owner[from] = 0;
    s.army[from] = 41;
    queueMove(s, 0, from, target);
    queueMove(s, 0, target, target); // should be wiped by the blast
    s.tick = 0;
    step(s);
    expect(s.mine[target]).toBe(0);
    expect(s.crater[target]).toBe(1);
    expect(s.owner[target]).toBe(0);
    expect(s.army[target]).toBe(40 - MINE_DAMAGE);
    expect(s.army[from]).toBe(1);
    expect(me.queue.length).toBe(0);
    expect(s.events.some((e) => e.kind === 'explode')).toBe(true);
  });
});

describe('deduction', () => {
  it('never marks an actual mine as safe', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = createGame({ w: 15, h: 21, seed, players: twoPlayers });
      const k = analyze(s, 0);
      for (let i = 0; i < s.size; i++) if (k.safe[i]) expect(s.mine[i]).toBe(0);
    }
  });
});

describe('bots', () => {
  it('finish games against each other without crashing', () => {
    let finished = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const s = createGame({
        w: 15,
        h: 21,
        seed,
        players: [
          { name: 'A', isBot: true },
          { name: 'B', isBot: true },
          { name: 'C', isBot: true },
        ],
      });
      const rng = mulberry32(seed);
      const bots = s.players.map((p) => new Bot(p.id, 'hard', rng));
      while (s.winner < 0 && s.tick < 3000) {
        for (const b of bots) b.think(s);
        step(s);
      }
      if (s.winner >= 0) finished++;
      // Armies never go negative.
      expect(Math.min(...s.army)).toBeGreaterThanOrEqual(0);
    }
    expect(finished).toBeGreaterThan(0);
  });
});
