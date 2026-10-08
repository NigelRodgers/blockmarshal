import { describe, expect, it } from 'vitest';
import { MINE_DAMAGE, MINE_STUN_TICKS, TOWER_GARRISON, TOWER_RADIUS } from '../src/engine/constants';
import { clearQueue, createGame, queueMove, step, stunTicksLeft, undoMove, visionFor } from '../src/engine/game';
import { chebyshev, manhattan } from '../src/engine/grid';
import { mulberry32 } from '../src/engine/rng';
import { Terrain, type GameState } from '../src/engine/types';
import { createBots, replay, runTick } from '../src/session';

const twoPlayers = [
  { name: 'A', isBot: false },
  { name: 'B', isBot: true },
];

/** Put player 0 next to a live mine with a big stack. */
function nextToMine(s: GameState): { from: number; mine: number } {
  const mine = s.mine.findIndex((m, i) => m === 1 && s.n4[i].some((j) => s.terrain[j] === Terrain.Plain && !s.mine[j]));
  const from = s.n4[mine].find((j) => s.terrain[j] === Terrain.Plain && !s.mine[j])!;
  s.owner[from] = 0;
  s.army[from] = 50;
  return { from, mine };
}

describe('mine stun', () => {
  it('skips exactly MINE_STUN_TICKS moves, then runs moves queued during the stun', () => {
    const s = createGame({ w: 15, h: 21, seed: 11, players: twoPlayers });
    const me = s.players[0];
    const { from, mine } = nextToMine(s);
    queueMove(s, 0, from, mine);
    step(s);
    expect(s.crater[mine]).toBeGreaterThan(0);
    expect(me.minesLost).toBe(MINE_DAMAGE);
    expect(stunTicksLeft(s, 0)).toBe(MINE_STUN_TICKS);

    // Queue a move back from the crater during the stun.
    queueMove(s, 0, mine, from);
    const before = s.army[mine];
    for (let t = 0; t < MINE_STUN_TICKS; t++) {
      step(s);
      expect(me.queue.length).toBe(1);
    }
    expect(stunTicksLeft(s, 0)).toBe(0);
    step(s);
    expect(me.queue.length).toBe(0);
    expect(s.army[mine]).toBe(1);
    expect(s.army[from]).toBeGreaterThanOrEqual(before);
  });
});

describe('watchtowers (off by default, kept for later)', () => {
  it('places contested, mine-free towers (one per two players) away from generals', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const n of [2, 3, 4]) {
        const s = createGame({ w: 15, h: 21, seed, towers: Math.ceil(n / 2), players: Array.from({ length: n }, (_, i) => ({ name: `${i}`, isBot: i > 0 })) });
        const towers = [...s.terrain.keys()].filter((i) => s.terrain[i] === Terrain.Tower);
        expect(towers.length).toBe(Math.ceil(n / 2));
        for (const t of towers) {
          expect(s.army[t]).toBe(TOWER_GARRISON);
          expect(s.mine[t]).toBe(0);
          for (const p of s.players) expect(manhattan(s.w, p.general, t)).toBeGreaterThanOrEqual(5);
        }
      }
    }
  });

  it('on capture reveals mine dots across its 7x7 and grants vision there', () => {
    const s = createGame({ w: 15, h: 21, seed: 5, towers: 1, players: twoPlayers });
    const tower = s.terrain.findIndex((t) => t === Terrain.Tower);
    const from = s.n4[tower].find((j) => s.terrain[j] !== Terrain.Mountain && !s.mine[j])!;
    s.owner[from] = 0;
    s.army[from] = 100;
    queueMove(s, 0, from, tower);
    step(s);
    expect(s.owner[tower]).toBe(0);
    expect(s.events.some((e) => e.kind === 'captureTower')).toBe(true);
    const me = s.players[0];
    const vis = visionFor(s, 0);
    for (let i = 0; i < s.size; i++) {
      if (chebyshev(s.w, tower, i) > TOWER_RADIUS) continue;
      expect(vis[i]).toBe(1);
      const expectKnown = !s.mine[i] && s.terrain[i] !== Terrain.Mountain;
      expect(me.revealed[i]).toBe(expectKnown ? 1 : 0);
    }
  });

  it('produces no troops', () => {
    const s = createGame({ w: 15, h: 21, seed: 5, towers: 1, players: twoPlayers });
    const tower = s.terrain.findIndex((t) => t === Terrain.Tower);
    s.owner[tower] = 0;
    s.army[tower] = 10;
    for (let t = 0; t < 10; t++) step(s);
    expect(s.army[tower]).toBe(10);
  });
});

describe('input log and replay', () => {
  it('logs human inputs only', () => {
    const s = createGame({ w: 15, h: 21, seed: 2, players: twoPlayers });
    const g = s.players[0].general;
    queueMove(s, 0, g, s.n4[g][0]);
    queueMove(s, 1, s.players[1].general, s.n4[s.players[1].general][0]);
    undoMove(s, 0);
    queueMove(s, 0, g, s.n4[g][0]);
    clearQueue(s, 0);
    expect(s.log.map((e) => e.op)).toEqual(['move', 'undo', 'move', 'clear']);
  });

  it('replays a human-vs-bots game to the identical state', () => {
    for (const seed of [3, 17, 42]) {
      const cfg = {
        w: 15,
        h: 21,
        seed,
        players: [0, 1, 2].map((i) => ({ name: `${i}`, isBot: i > 0 })),
      };
      const live = createGame(cfg);
      const bots = createBots(live, 'hard');
      const human = mulberry32(seed * 7);
      while (live.winner < 0 && live.tick < 1500) {
        // A jittery fake human: random moves from owned tiles, occasional undo/clear.
        const r = human();
        const owned = [...live.owner.keys()].filter((i) => live.owner[i] === 0 && live.army[i] > 1);
        if (owned.length && r < 0.4) {
          const from = owned[Math.floor(human() * owned.length)];
          const to = live.n4[from][Math.floor(human() * live.n4[from].length)];
          queueMove(live, 0, from, to, human() < 0.2);
        } else if (r < 0.43) {
          undoMove(live, 0);
        } else if (r < 0.45) {
          clearQueue(live, 0);
        }
        runTick(live, bots);
      }
      const again = replay(cfg, 'hard', live.log, live.tick);
      expect(again.tick).toBe(live.tick);
      expect(again.winner).toBe(live.winner);
      expect([...again.owner]).toEqual([...live.owner]);
      expect([...again.army]).toEqual([...live.army]);
      expect(again.players.map((p) => p.minesLost)).toEqual(live.players.map((p) => p.minesLost));
    }
  });
});
