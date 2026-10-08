import { describe, expect, it } from 'vitest';
import { MAP_H, MAP_W, MATCH_PLAYERS } from '../src/engine/constants';
import { createGame } from '../src/engine/game';
import { allConnected } from '../src/engine/mapgen';
import { Terrain } from '../src/engine/types';

const players = Array.from({ length: MATCH_PLAYERS }, (_, i) => ({ name: `${i}`, isBot: i > 0 }));

describe('map fairness', () => {
  const games = Array.from({ length: 60 }, (_, seed) => createGame({ w: MAP_W, h: MAP_H, seed: seed + 1, players }));

  it('never has a 2x2 square made only of mines and mountains', () => {
    for (const s of games) {
      const blocked = (i: number) => s.terrain[i] === Terrain.Mountain || s.mine[i] === 1;
      for (let y = 0; y + 1 < s.h; y++) {
        for (let x = 0; x + 1 < s.w; x++) {
          const a = y * s.w + x;
          expect(blocked(a) && blocked(a + 1) && blocked(a + s.w) && blocked(a + s.w + 1)).toBe(false);
        }
      }
    }
  });

  it('never seals anything off: every open tile connects to every general without crossing mines or mountains', () => {
    for (const s of games) {
      const blocked = new Uint8Array(s.size);
      for (let i = 0; i < s.size; i++) blocked[i] = s.terrain[i] === Terrain.Mountain || s.mine[i] ? 1 : 0;
      for (const p of s.players) expect(allConnected(s.w, s.h, blocked, p.general)).toBe(true);
    }
  });

  it('places about a quarter fewer mines than before (~13.5% of eligible plains)', () => {
    let mines = 0;
    let plains = 0;
    for (const s of games) {
      for (let i = 0; i < s.size; i++) {
        mines += s.mine[i];
        if (s.terrain[i] === Terrain.Plain) plains++;
      }
    }
    const rate = mines / plains;
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.15);
  });
});
