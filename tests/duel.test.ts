import { describe, expect, it } from 'vitest';
import { Bot } from '../src/ai/bot';
import { MODES } from '../src/engine/constants';
import { createGame, step } from '../src/engine/game';
import { manhattan } from '../src/engine/grid';
import { mulberry32 } from '../src/engine/rng';
import type { ServerMessage } from '../src/net/protocol';
import { LobbyIndex } from '../server/lobbyIndex';
import { LocalGame } from '../src/local';
import { Match, type Conn } from '../server/match';

function conn(id: string): Conn & { inbox: ServerMessage[] } {
  const inbox: ServerMessage[] = [];
  return { id, name: id, inbox, send: (m) => inbox.push(m) };
}

describe('1 vs 1', () => {
  const { w, h, mineRate, mountainRate, spawnEdgeRows } = MODES.duel;

  it('starts as soon as a second human joins, on the duel board, with no bots', () => {
    let now = 0;
    const match = new Match('d1', () => {}, { autoRun: false, lobbyMs: 60_000, now: () => now, seed: 7, mode: 'duel' });
    const a = conn('Ann');
    match.add(a);
    expect(a.inbox.at(-1)).toMatchObject({ t: 'lobby', capacity: 2 });
    expect(match.phase).toBe('lobby');
    match.add(conn('Bo'));
    expect(match.phase).toBe('playing');
    expect(match.open).toBe(false);
    const s = match.state!;
    expect([s.w, s.h]).toEqual([w, h]);
    expect(s.players.map((p) => p.isBot)).toEqual([false, false]);
  });

  it('gives a lone human one bot when the countdown ends', () => {
    let now = 0;
    const match = new Match('d2', () => {}, { autoRun: false, lobbyMs: 60_000, now: () => now, seed: 7, mode: 'duel' });
    match.add(conn('Ann'));
    now += 60_000;
    match.lobbyTick();
    expect(match.state!.players.map((p) => p.isBot)).toEqual([false, true]);
  });

  it('plays a bot in the browser straight away', () => {
    const inbox: ServerMessage[] = [];
    const game = new LocalGame('Solo', (m) => inbox.push(m), 'duel');
    try {
      const v = inbox.find((m) => m.t === 'view');
      expect(v?.t === 'view' && v.view.players.length).toBe(2);
      expect(v?.t === 'view' && [v.view.w, v.view.h]).toEqual([w, h]);
    } finally {
      game.stop();
    }
  });

  it('keeps duel lobbies separate from free-for-all ones in the matchmaker', () => {
    const duel = new LobbyIndex(2, 60_000);
    let n = 0;
    const id = () => `m${n++}`;
    expect(duel.assign(0, id)).toBe('m0');
    expect(duel.assign(0, id)).toBe('m0'); // the second player joins the first
    expect(duel.assign(0, id)).toBe('m1'); // a third opens a new duel
  });

  it('places the two generals far apart', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = createGame({ w, h, seed, mineRate, mountainRate, spawnEdgeRows, players: [{ name: 'a', isBot: true }, { name: 'b', isBot: true }] });
      expect(manhattan(w, s.players[0].general, s.players[1].general)).toBeGreaterThanOrEqual(10);
      // One within 4 rows of the top edge, the other within 4 rows of the bottom.
      const rows = s.players.map((p) => Math.floor(p.general / w)).sort((a, b) => a - b);
      expect(rows[0]).toBeLessThan(4);
      expect(rows[1]).toBeGreaterThanOrEqual(h - 4);
    }
  });

  it('bot duels finish', () => {
    let finished = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const s = createGame({ w, h, seed, mineRate, mountainRate, spawnEdgeRows, players: [{ name: 'a', isBot: true }, { name: 'b', isBot: true }] });
      const rng = mulberry32(seed);
      const bots = s.players.map((p) => new Bot(p.id, 'normal', rng));
      while (s.winner < 0 && s.tick < 4000) {
        for (const b of bots) b.think(s);
        step(s);
      }
      if (s.winner >= 0) finished++;
    }
    expect(finished).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('the bot finishes off a human who never moves', () => {
    // Seeds where it used to hold the whole board for 3000+ turns: its troops sat spread out
    // (no single stack beat the growing general), or its own mine blocked the last step.
    for (const seed of [4, 6, 7, 9]) {
      const match = new Match('m', () => {}, { autoRun: false, lobbyMs: 0, seed, mode: 'duel' });
      match.add(conn('Idle'));
      for (let t = 0; t < 1400 && match.phase === 'playing'; t++) match.tick();
      expect(match.state!.winner, `seed ${seed}`).toBe(1);
    }
  }, 60_000);
});
