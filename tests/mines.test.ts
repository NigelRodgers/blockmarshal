import { describe, expect, it } from 'vitest';
import { CRATER_TICKS, MAX_FLAGS, MINE_DAMAGE, RELOCATE_COOLDOWN_TICKS } from '../src/engine/constants';
import { Bot } from '../src/ai/bot';
import { pickUpMine, plantMine, queueMove, relocate, step, toggleFlag } from '../src/engine/game';
import { mulberry32 } from '../src/engine/rng';
import { createFromLayout } from '../src/engine/layout';
import { buildView } from '../src/net/view';
import type { GameState } from '../src/engine/types';
import { manhattan } from '../src/engine/grid';

const A = 0;
const B = 1;

/**
 * 7x4 board. A (player 0) holds the top-left corner, B (player 1) the bottom-right.
 * A natural mine sits at (3,0), right next to A's tile (2,0).
 */
function board() {
  const lv = createFromLayout(['ooo*...', 'oGo....', '.......', '....ooE'], {
    players: [
      { name: 'A', isBot: false },
      { name: 'B', isBot: false },
    ],
  });
  const s = lv.state;
  // The 'o' tiles in the bottom row belong to B, not A.
  for (const i of [3 * 7 + 4, 3 * 7 + 5]) {
    s.owner[i] = B;
    s.army[i] = 1;
  }
  return s;
}

/** Stock n mines that came from the player's general's land. */
function give(s: GameState, pid: number, n: number): void {
  s.players[pid].stock = Array.from({ length: n }, () => ({ from: s.players[pid].general, moved: false }));
}

const MINE = 3; // (3,0)
const NEXT_TO_MINE = 2; // (2,0), owned by A

describe('flags', () => {
  it('allows at most MAX_FLAGS at once', () => {
    const s = board();
    for (let i = 0; i < MAX_FLAGS; i++) expect(toggleFlag(s, A, 14 + i)).toBe(true);
    expect(toggleFlag(s, A, 20)).toBe(false);
    expect(toggleFlag(s, A, 14)).toBe(true); // unflag frees a slot
    expect(toggleFlag(s, A, 20)).toBe(true);
  });

  it('are private: your view lists only your flags', () => {
    const s = board();
    toggleFlag(s, A, MINE);
    toggleFlag(s, B, 10);
    expect(buildView(s, A).flags).toEqual([MINE]);
    expect(buildView(s, B).flags).toEqual([10]);
  });
});

describe('capturing a flagged mine', () => {
  it('moves onto the mine without a blast and banks it', () => {
    const s = board();
    s.army[NEXT_TO_MINE] = 20;
    toggleFlag(s, A, MINE);
    queueMove(s, A, NEXT_TO_MINE, MINE);
    step(s);
    expect(s.mine[MINE]).toBe(0);
    expect(s.crater[MINE]).toBe(0);
    expect(s.owner[MINE]).toBe(A);
    expect(s.army[MINE]).toBe(19);
    expect(s.players[A].stock.length).toBe(1);
    expect(s.players[A].flags.has(MINE)).toBe(false);
    expect(s.events.some((e) => e.kind === 'defuse')).toBe(true);
  });

  it('an unflagged mine still goes off', () => {
    const s = board();
    s.army[NEXT_TO_MINE] = 20;
    queueMove(s, A, NEXT_TO_MINE, MINE);
    step(s);
    expect(s.crater[MINE]).toBeGreaterThan(0);
    expect(s.army[MINE]).toBe(19 - MINE_DAMAGE);
    expect(s.players[A].stock.length).toBe(0);
  });
});

describe('planted mines', () => {
  function withPlanted() {
    const s = board();
    give(s, A, 1);
    expect(plantMine(s, A, 1)).toBe(true); // (1,0), A's own tile
    return s;
  }

  it('can only go on your own plain tiles, from stock', () => {
    const s = board();
    expect(plantMine(s, A, 1)).toBe(false); // no stock
    give(s, A, 2);
    expect(plantMine(s, A, 8)).toBe(false); // A's general
    expect(plantMine(s, A, 3 * 7 + 4)).toBe(false); // B's tile
    expect(plantMine(s, A, 1)).toBe(true);
    expect(plantMine(s, A, 1)).toBe(false); // already mined
    expect(s.players[A].stock.length).toBe(1);
  });

  it('show to you as a mine (no dots), and to enemies only as dots', () => {
    const s = withPlanted();
    const mine = buildView(s, A);
    expect(mine.myMines).toEqual([1]);
    expect(mine.dots[0]).toBe(0); // A's own tile next to it: no dot for its own mine

    // B once held (0,1)... simulate B having revealed a tile next to A's mine.
    s.players[B].revealed[2] = 1;
    const theirs = buildView(s, B);
    expect(theirs.myMines).toEqual([]);
    expect(theirs.dots[2]).not.toBe(0);
    expect(JSON.stringify(theirs)).not.toContain('"myMines":[1]');
  });

  it('trip their owner unless the owner flagged them', () => {
    const s = withPlanted();
    s.army[0] = 10;
    queueMove(s, A, 0, 1);
    step(s);
    expect(s.crater[1]).toBeGreaterThan(0); // tripped its own mine

    const t = withPlanted();
    t.army[0] = 10;
    toggleFlag(t, A, 1);
    queueMove(t, A, 0, 1);
    step(t);
    expect(t.crater[1]).toBe(0);
    expect(t.mine[1]).toBe(1); // still armed for enemies
    expect(t.army[1]).toBe(1 + 9);
  });

  it('blow up on enemies, unless the enemy flagged them (then they capture it)', () => {
    const s = withPlanted();
    // Give B a stack next to A's mine.
    s.owner[2] = B;
    s.army[2] = 30;
    queueMove(s, B, 2, 1);
    step(s);
    expect(s.crater[1]).toBeGreaterThan(0);
    expect(s.players[B].stunUntil).toBeGreaterThan(s.tick);

    const t = withPlanted();
    t.owner[2] = B;
    t.army[2] = 30;
    toggleFlag(t, B, 1);
    queueMove(t, B, 2, 1);
    step(t);
    expect(t.crater[1]).toBe(0);
    expect(t.players[B].stock.length).toBe(1);
  });
});

describe('blasts', () => {
  it('are seen by everyone, even in fog, and fade after 10 turns', () => {
    const s = board();
    s.army[NEXT_TO_MINE] = 20;
    queueMove(s, A, NEXT_TO_MINE, MINE);
    step(s);
    const bView = buildView(s, B);
    expect(bView.visible[MINE]).toBe(0); // B can't see that corner...
    expect(bView.crater[MINE]).toBeGreaterThan(0); // ...but sees the blast mark
    expect(bView.events.some((e) => e.kind === 'explode')).toBe(true);

    for (let t = 0; t < CRATER_TICKS; t++) step(s);
    expect(s.crater[MINE]).toBe(0);
    expect(buildView(s, A).crater[MINE]).toBe(0);
    expect(buildView(s, B).crater[MINE]).toBe(0);
  });
});

describe('moving your own mines', () => {
  it('picks a planted mine back into stock so it can be planted elsewhere', () => {
    const s = board();
    give(s, A, 1);
    plantMine(s, A, 1);
    toggleFlag(s, A, 1);
    expect(pickUpMine(s, A, 1)).toBe(true);
    expect(s.mine[1]).toBe(0);
    expect(s.players[A].stock.length).toBe(1);
    expect(s.players[A].flags.has(1)).toBe(false);
    expect(plantMine(s, A, 0)).toBe(true);
  });

  it('cannot pick up natural or enemy mines', () => {
    const s = board();
    expect(pickUpMine(s, A, MINE)).toBe(false); // natural, not A's land
    give(s, B, 1);
    expect(plantMine(s, B, 3 * 7 + 4)).toBe(true);
    expect(pickUpMine(s, A, 3 * 7 + 4)).toBe(false);
  });
});

describe('flags and planting on your own land', () => {
  it('only lets you flag your own tiles where you planted a mine', () => {
    const s = board();
    expect(toggleFlag(s, A, 0)).toBe(false); // plain own tile
    expect(toggleFlag(s, A, 8)).toBe(false); // own general
    give(s, A, 1);
    plantMine(s, A, 0);
    expect(toggleFlag(s, A, 0)).toBe(true);
    expect(toggleFlag(s, A, 0)).toBe(true); // and unflag it again, mine untouched
    expect(s.mine[0]).toBe(1);
  });

  it('never plants on generals, cities or towers', () => {
    const lv = createFromLayout(['GCT.', '....', '...E'], {
      players: [
        { name: 'A', isBot: false },
        { name: 'B', isBot: false },
      ],
    });
    const s = lv.state;
    for (const i of [1, 2]) s.owner[i] = A;
    give(s, A, 3);
    expect(plantMine(s, A, 0)).toBe(false); // general
    expect(plantMine(s, A, 1)).toBe(false); // city
    expect(plantMine(s, A, 2)).toBe(false); // tower
    expect(s.players[A].stock.length).toBe(3);
  });
});

describe('bots and mines', () => {
  it('blast their way out when boxed in by mines', () => {
    // B's general sits in a pocket sealed by mines; open ground lies beyond.
    const lv = createFromLayout(['G........', '.........', '...***...', '...*E*...', '...***...', '.........'], {
      players: [
        { name: 'A', isBot: true },
        { name: 'B', isBot: true },
      ],
      generalArmy: [1, 1],
    });
    const s = lv.state;
    const botB = new Bot(B, 'normal', mulberry32(1));
    for (let t = 0; t < 200; t++) {
      botB.think(s);
      step(s);
    }
    const land = s.owner.reduce((n, o) => n + (o === B ? 1 : 0), 0);
    expect(s.crater.some((c) => c > 0) || land > 1).toBe(true);
    expect(land).toBeGreaterThan(1);
  });
});

describe('relocating generals and cities', () => {
  function land() {
    const lv = createFromLayout(['ooooooo', 'oGooooC', 'ooooooo', '......E'], {
      players: [
        { name: 'A', isBot: false },
        { name: 'B', isBot: false },
      ],
    });
    const s = lv.state;
    s.owner[13] = A; // the city at (6,1) is A's
    return s;
  }

  it('moves your general to another of your open tiles; troops stay put', () => {
    const s = land();
    s.army[8] = 30;
    expect(relocate(s, A, 8, 3)).toBe(true); // (1,1) -> (3,0)
    expect(s.terrain[3]).toBe(3);
    expect(s.terrain[8]).toBe(0);
    expect(s.players[A].general).toBe(3);
    expect(s.army[8]).toBe(30);
  });

  it("refuses spots touching another general or city, sides or corners", () => {
    const s = land();
    expect(relocate(s, A, 8, 5)).toBe(false); // (5,0) touches the city at (6,1) diagonally
    expect(relocate(s, A, 8, 12)).toBe(false); // (5,1) touches the city side-on
    expect(relocate(s, A, 13, 9)).toBe(false); // city to (2,1): touches the general
    expect(relocate(s, A, 13, 18)).toBe(true); // city to (4,2): clear of the general
  });

  it('then holds the building for 100 turns', () => {
    const s = land();
    expect(relocate(s, A, 8, 3)).toBe(true);
    expect(relocate(s, A, 3, 15)).toBe(false); // general on cooldown
    expect(buildView(s, A).moveCooldowns).toEqual([{ idx: 3, turns: 100 }]);
    expect(relocate(s, A, 13, 18)).toBe(true); // the city has its own cooldown
    for (let t = 0; t < RELOCATE_COOLDOWN_TICKS - 1; t++) step(s);
    expect(relocate(s, A, 3, 15)).toBe(false);
    step(s);
    expect(relocate(s, A, 3, 15)).toBe(true);
  });

  it('holds a moved mine for 100 turns too; a captured mine planted the first time is free', () => {
    const s = land();
    give(s, A, 1); // captured: no cooldown
    expect(plantMine(s, A, 0)).toBe(true);
    expect(buildView(s, A).moveCooldowns).toEqual([]);
    expect(pickUpMine(s, A, 0)).toBe(true);
    expect(plantMine(s, A, 1)).toBe(true); // moved: now held
    expect(buildView(s, A).moveCooldowns).toEqual([{ idx: 1, turns: 100 }]);
    expect(pickUpMine(s, A, 1)).toBe(false);
    for (let t = 0; t < RELOCATE_COOLDOWN_TICKS; t++) step(s);
    expect(pickUpMine(s, A, 1)).toBe(true);
  });

  it("refuses moving onto mines, enemy land, or someone else's buildings", () => {
    const s = land();
    give(s, A, 1);
    plantMine(s, A, 4);
    expect(relocate(s, A, 8, 4)).toBe(false); // own mine
    expect(relocate(s, A, 8, 3 * 7 + 3)).toBe(false); // neutral tile
    expect(relocate(s, B, 8, 3)).toBe(false); // not B's general
  });
});

describe('islands: buildings and mines stay on one connected stretch of land', () => {
  /** A holds two separate patches: (0..2, 0) with its general, and (4..5, 0) + (5,1). */
  function islands() {
    const lv = createFromLayout(['oGo.oo.', '.....o.', '......E'], {
      players: [
        { name: 'A', isBot: false },
        { name: 'B', isBot: false },
      ],
    });
    return lv.state;
  }

  it('a general or city cannot jump to a separate island', () => {
    const s = islands();
    expect(relocate(s, A, 1, 5)).toBe(false);
    s.owner[3] = A; // bridge the gap: now one stretch
    s.army[3] = 1;
    expect(relocate(s, A, 1, 5)).toBe(true);
  });

  it('a stocked mine plants only on land connected to where it came from', () => {
    const s = islands();
    s.players[A].stock = [{ from: 4, moved: false }];
    expect(plantMine(s, A, 0)).toBe(false); // other island
    expect(plantMine(s, A, 12)).toBe(true); // (5,1), same island as (4,0)
    expect(pickUpMine(s, A, 12)).toBe(true);
    expect(plantMine(s, A, 2)).toBe(false); // can't carry it across
    expect(plantMine(s, A, 5)).toBe(true);
  });

  it("a mine whose home tile was lost goes with the general's land", () => {
    const s = islands();
    s.players[A].stock = [{ from: 4, moved: false }];
    s.owner[4] = B;
    expect(buildView(s, A).stockAnchors).toEqual([1]);
    expect(plantMine(s, A, 12)).toBe(false);
    expect(plantMine(s, A, 0)).toBe(true);
  });
});

describe('bot tactics', () => {
  /** B (a bot) holds rows 1-4 of a 9x5 board around its general at (4,2); A's general sits at (0,0). */
  function bLand() {
    const lv = createFromLayout(['G........', '.........', '....E....', '.........', '.........'], {
      players: [
        { name: 'A', isBot: false },
        { name: 'B', isBot: true },
      ],
    });
    const s = lv.state;
    for (let i = 9; i < 45; i++) {
      if (s.owner[i] >= 0) continue;
      s.owner[i] = B;
      s.army[i] = 1;
    }
    return s;
  }

  it('moves its general out of sight once an enemy has seen it', () => {
    const s = bLand();
    const spotted = 2 * 9 + 4;
    s.owner[9 + 4] = A; // A takes (4,1), right next to B's general
    s.army[9 + 4] = 5;
    new Bot(B, 'normal', mulberry32(1)).think(s);
    const g = s.players[B].general;
    expect(g).not.toBe(spotted);
    expect(s.terrain[g]).toBe(3);
    expect(s.n8[g].some((j) => s.owner[j] === A)).toBe(false);
  });

  it('plants a stocked mine near its general, leaving the general reachable', () => {
    const s = bLand();
    const g = s.players[B].general;
    s.players[B].stock = [{ from: g, moved: false }];
    new Bot(B, 'normal', mulberry32(1)).think(s);
    expect(s.players[B].stock.length).toBe(0);
    const planted = [...s.mineOwner.keys()].filter((i) => s.mineOwner[i] === B && s.mine[i]);
    expect(planted.length).toBe(1);
    const d = manhattan(s.w, planted[0], g);
    expect(d).toBeGreaterThanOrEqual(2);
    expect(d).toBeLessThanOrEqual(3);
  });

  it('flags a mine next to its land and captures it instead of tripping it', () => {
    const lv = createFromLayout(['G......', '.......', '...E*..', '.......'], {
      players: [
        { name: 'A', isBot: false },
        { name: 'B', isBot: true },
      ],
      generalArmy: [1, 20],
    });
    const s = lv.state;
    const bot = new Bot(B, 'normal', mulberry32(1));
    for (let t = 0; t < 30; t++) {
      bot.think(s);
      step(s);
    }
    const mine = 2 * 7 + 4;
    expect(s.crater[mine]).toBe(0);
    expect(s.mine[mine] === 0 || s.mineOwner[mine] === B).toBe(true);
    const banked = s.players[B].stock.length + s.mineOwner.filter((o) => o === B).length;
    expect(banked).toBe(1);
  });
});
