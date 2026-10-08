import { describe, expect, it } from 'vitest';
import { CRATER_TICKS, MAX_FLAGS, MINE_DAMAGE } from '../src/engine/constants';
import { Bot } from '../src/ai/bot';
import { pickUpMine, plantMine, queueMove, step, toggleFlag } from '../src/engine/game';
import { mulberry32 } from '../src/engine/rng';
import { createFromLayout } from '../src/engine/layout';
import { buildView } from '../src/net/view';

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
    expect(s.players[A].minesInStock).toBe(1);
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
    expect(s.players[A].minesInStock).toBe(0);
  });
});

describe('planted mines', () => {
  function withPlanted() {
    const s = board();
    s.players[A].minesInStock = 1;
    expect(plantMine(s, A, 1)).toBe(true); // (1,0), A's own tile
    return s;
  }

  it('can only go on your own plain tiles, from stock', () => {
    const s = board();
    expect(plantMine(s, A, 1)).toBe(false); // no stock
    s.players[A].minesInStock = 2;
    expect(plantMine(s, A, 8)).toBe(false); // A's general
    expect(plantMine(s, A, 3 * 7 + 4)).toBe(false); // B's tile
    expect(plantMine(s, A, 1)).toBe(true);
    expect(plantMine(s, A, 1)).toBe(false); // already mined
    expect(s.players[A].minesInStock).toBe(1);
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
    expect(t.players[B].minesInStock).toBe(1);
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
    s.players[A].minesInStock = 1;
    plantMine(s, A, 1);
    toggleFlag(s, A, 1);
    expect(pickUpMine(s, A, 1)).toBe(true);
    expect(s.mine[1]).toBe(0);
    expect(s.players[A].minesInStock).toBe(1);
    expect(s.players[A].flags.has(1)).toBe(false);
    expect(plantMine(s, A, 0)).toBe(true);
  });

  it('cannot pick up natural or enemy mines', () => {
    const s = board();
    expect(pickUpMine(s, A, MINE)).toBe(false); // natural, not A's land
    s.players[B].minesInStock = 1;
    expect(plantMine(s, B, 3 * 7 + 4)).toBe(true);
    expect(pickUpMine(s, A, 3 * 7 + 4)).toBe(false);
  });
});

describe('flags and planting on your own land', () => {
  it('only lets you flag your own tiles where you planted a mine', () => {
    const s = board();
    expect(toggleFlag(s, A, 0)).toBe(false); // plain own tile
    expect(toggleFlag(s, A, 8)).toBe(false); // own general
    s.players[A].minesInStock = 1;
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
    s.players[A].minesInStock = 3;
    expect(plantMine(s, A, 0)).toBe(false); // general
    expect(plantMine(s, A, 1)).toBe(false); // city
    expect(plantMine(s, A, 2)).toBe(false); // tower
    expect(s.players[A].minesInStock).toBe(3);
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
