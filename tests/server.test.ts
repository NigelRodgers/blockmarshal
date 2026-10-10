import { describe, expect, it } from 'vitest';
import { MATCH_PLAYERS, MODES } from '../src/engine/constants';
import { mulberry32 } from '../src/engine/rng';
import { replay } from '../src/session';
import type { PlayerView, ServerMessage } from '../src/net/protocol';
import { LobbyIndex } from '../server/lobbyIndex';
import { LocalGame } from '../src/local';
import { cleanFeedback, feedbackEmail, MAX_TEXT } from '../server/feedback';
import { cleanName, Match, type Conn } from '../server/match';

/** Fake browser connection that records what the server sends it. */
function conn(id: string): Conn & { inbox: ServerMessage[]; lastView(): PlayerView | undefined } {
  const inbox: ServerMessage[] = [];
  return {
    id,
    name: id,
    inbox,
    send: (m) => inbox.push(m),
    lastView() {
      const v = [...inbox].reverse().find((m) => m.t === 'view');
      return v?.t === 'view' ? v.view : undefined;
    },
  };
}

/** A match with a controllable clock and no real timers. */
function newMatch(id = 'm1') {
  let now = 1_000_000;
  let done = false;
  const match = new Match(id, () => (done = true), { autoRun: false, lobbyMs: 60_000, now: () => now, seed: 42 });
  return { match, advance: (ms: number) => (now += ms), isDone: () => done };
}

describe('match lobby', () => {
  it('fills empty seats with bots when the one-minute countdown ends', () => {
    const { match, advance } = newMatch();
    const a = conn('Alice');
    match.add(a);
    expect(a.inbox.at(-1)).toMatchObject({ t: 'lobby', capacity: MATCH_PLAYERS, startsInMs: 60_000 });

    advance(59_000);
    match.lobbyTick();
    expect(match.phase).toBe('lobby');
    advance(1_000);
    match.lobbyTick();
    expect(match.phase).toBe('playing');
    const players = match.state!.players;
    expect(players.length).toBe(MATCH_PLAYERS);
    expect(players.filter((p) => !p.isBot).map((p) => p.name)).toEqual(['Alice']);
    expect(a.inbox.some((m) => m.t === 'start')).toBe(true);
    expect(a.lastView()?.you).toBe(0);
  });

  it('starts immediately with bots when the countdown is zero (local testing)', () => {
    const match = new Match('solo', () => {}, { autoRun: false, lobbyMs: 0, seed: 1 });
    const a = conn('solo');
    match.add(a);
    expect(match.phase).toBe('playing');
    expect(match.state!.players.filter((p) => p.isBot).length).toBe(MATCH_PLAYERS - 1);

    const idx = new LobbyIndex(MATCH_PLAYERS, 0);
    let n = 0;
    expect(idx.assign(0, () => `x${++n}`)).not.toBe(idx.assign(0, () => `x${++n}`)); // every solo player gets their own game
  });

  it('starts at once when six humans are in, and stops accepting players', () => {
    const { match } = newMatch();
    for (let i = 0; i < 6; i++) match.add(conn(`p${i}`));
    expect(match.phase).toBe('playing');
    expect(match.open).toBe(false);
    expect(match.state!.players.every((p) => !p.isBot)).toBe(true);
    expect(() => match.add(conn('late'))).toThrow();
  });

  it('closes when the last player leaves the lobby, or nobody is left watching a game', () => {
    const lobby = newMatch();
    const a = conn('a');
    lobby.match.add(a);
    lobby.match.remove(a);
    expect(lobby.isDone()).toBe(true);

    const game = newMatch('m2');
    const b = conn('b');
    game.match.add(b);
    game.advance(60_000);
    game.match.lobbyTick();
    game.match.remove(b);
    expect(game.match.phase).toBe('done');
    expect(game.isDone()).toBe(true);
  });

  it('runs matches independently side by side', () => {
    const one = newMatch('one');
    const two = newMatch('two');
    one.match.add(conn('a'));
    two.match.add(conn('b'));
    for (const m of [one, two]) {
      m.advance(60_000);
      m.match.lobbyTick();
    }
    one.match.tick();
    one.match.tick();
    two.match.tick();
    expect(one.match.state!.tick).toBe(2);
    expect(two.match.state!.tick).toBe(1);
  });

  it('cleans player names', () => {
    expect(cleanName('  Nigel  ')).toBe('Nigel');
    expect(cleanName('a\u0000b\nc')).toBe('abc');
    expect(cleanName('x'.repeat(40)).length).toBe(16);
    expect(cleanName('')).toBe('Player');
    expect(cleanName(42)).toBe('Player');
  });
});

describe('matchmaker lobby index', () => {
  let n = 0;
  const id = () => `L${++n}`;

  it('sends newcomers to the fullest open lobby so humans end up together', () => {
    const idx = new LobbyIndex();
    const a = idx.assign(0, id);
    const b = idx.assign(1_000, id);
    expect(b).toBe(a); // reservation counts before the match reports back
    idx.update(a, 2, true, 60_000, 2_000);
    expect(idx.assign(3_000, id)).toBe(a);
  });

  it('opens a new lobby when the open one is full or about to start', () => {
    const idx = new LobbyIndex();
    const a = idx.assign(0, id);
    idx.update(a, 6, true, 60_000, 1_000);
    const b = idx.assign(2_000, id);
    expect(b).not.toBe(a);

    const idx2 = new LobbyIndex();
    const c = idx2.assign(0, id);
    idx2.update(c, 1, true, 60_000, 0);
    expect(idx2.assign(59_000, id)).not.toBe(c); // 1 s left on c's countdown
  });

  it('forgets lobbies that started or closed, and seats nobody claimed', () => {
    const idx = new LobbyIndex();
    const a = idx.assign(0, id);
    idx.update(a, 1, false, 60_000, 1_000);
    expect(idx.size).toBe(0);

    const b = idx.assign(0, id); // reserved, but the player never connects
    expect(idx.size).toBe(1);
    expect(idx.assign(20_000, id)).not.toBe(b);
    expect(idx.size).toBe(1);
  });
});

describe('matchmaker recovery (the two-devices bug)', () => {
  it('sends a second player to the first lobby even after the matchmaker restarts', () => {
    const before = new LobbyIndex(6, 60_000);
    const lobby = before.assign(0, () => 'L1');
    before.update(lobby, 1, true, 60_000, 500); // the match confirms player one
    before.update(lobby, 1, true, 60_000, 20_500); // ...and keeps sending heartbeats
    // Cloudflare evicts the matchmaker; it comes back from storage.
    const after = new LobbyIndex(6, 60_000, JSON.parse(JSON.stringify(before.toJSON())));
    expect(after.assign(30_000, () => 'NEW')).toBe(lobby);
  });

  it('relearns an open lobby from its heartbeat if the state was lost entirely', () => {
    const fresh = new LobbyIndex(6, 60_000);
    fresh.update('L9', 1, true, 60_000, 30_000); // heartbeat from a lobby it had forgotten
    expect(fresh.assign(31_000, () => 'NEW')).toBe('L9');
  });

  it('forgets a lobby that stops sending heartbeats', () => {
    const idx = new LobbyIndex(6, 120_000);
    idx.update('L1', 1, true, 120_000, 0);
    expect(idx.assign(40_000, () => 'NEW')).toBe('NEW');
  });
});

describe('player views', () => {
  function started() {
    const { match, advance } = newMatch();
    const a = conn('a');
    match.add(a);
    advance(60_000);
    match.lobbyTick();
    return { match, a };
  }

  it('never leak mines, fogged armies or fogged owners while you are alive', () => {
    const { match, a } = started();
    for (let t = 0; t < 60; t++) match.tick();
    const s = match.state!;
    const v = a.lastView()!;
    expect(s.players[0].alive).toBe(true);
    expect(v.mines).toBeNull();
    for (let i = 0; i < s.size; i++) {
      if (!v.visible[i]) {
        expect(v.army[i]).toBe(0);
        expect(v.owner[i]).toBe(-1);
      }
      if (!s.players[0].revealed[i]) expect(v.dots[i]).toBe(0);
    }
    expect(JSON.stringify(v)).not.toContain('"mine"');
  });

  it('ignores malformed or out-of-range moves', () => {
    const { match, a } = started();
    const s = match.state!;
    const g = s.players[0].general;
    match.input(a, { t: 'move', from: -1, to: g, half: false });
    match.input(a, { t: 'move', from: g, to: s.size + 5, half: false });
    match.input(a, { t: 'move', from: 1.5, to: 2, half: false } as never);
    expect(s.players[0].queue.length).toBe(0);
    match.input(a, { t: 'move', from: g, to: s.n4[g][0], half: false });
    expect(s.players[0].queue.length).toBe(1);
  });
});

describe('feedback', () => {
  it('keeps short text, a 1-5 rating and only known context fields', () => {
    const r = cleanFeedback({
      rating: 4,
      confusing: '  red dots?  ',
      improve: 'x'.repeat(5000),
      context: { screen: 'end', turn: 88, name: 'Nigel', ip: '1.2.3.4', result: 'won' },
    })!;
    expect(r.rating).toBe(4);
    expect(r.confusing).toBe('red dots?');
    expect(r.improve!.length).toBe(MAX_TEXT);
    expect(JSON.parse(r.context)).toEqual({ screen: 'end', turn: 88, result: 'won' });
  });

  it('drops spam (honeypot) and empty submissions, and bad ratings', () => {
    expect(cleanFeedback({ rating: 5, website: 'http://spam' })).toBeNull();
    expect(cleanFeedback({ confusing: '   ' })).toBeNull();
    expect(cleanFeedback({ rating: 9, improve: 'ok' })!.rating).toBeNull();
  });
});

describe('solo handoff', () => {
  it('hands a lone human to their browser instead of running a server match', () => {
    let now = 0;
    let done = false;
    const match = new Match('h', () => (done = true), { autoRun: false, lobbyMs: 60_000, now: () => now, soloHandoff: true });
    const a = conn('a');
    match.add(a);
    now = 60_000;
    match.lobbyTick();
    expect(a.inbox.at(-1)).toEqual({ t: 'solo' });
    expect(match.state).toBeNull();
    expect(done).toBe(true);
  });

  it('still runs a server match when two humans are waiting', () => {
    let now = 0;
    const match = new Match('h2', () => {}, { autoRun: false, lobbyMs: 60_000, now: () => now, soloHandoff: true });
    match.add(conn('a'));
    match.add(conn('b'));
    now = 60_000;
    match.lobbyTick();
    expect(match.phase).toBe('playing');
    expect(match.state!.players.filter((p) => !p.isBot).length).toBe(2);
  });
});

describe('local game', () => {
  it('starts at once against five bots in the browser and accepts moves', () => {
    const inbox: ServerMessage[] = [];
    const game = new LocalGame('  Solo  ', (m) => inbox.push(m));
    try {
      expect(inbox[0]).toMatchObject({ t: 'start', you: 0 });
      const first = inbox.find((m) => m.t === 'view');
      expect(first?.t).toBe('view');
      const v = (first as Extract<ServerMessage, { t: 'view' }>).view;
      expect(v.players.map((p) => p.isBot)).toEqual([false, true, true, true, true, true]);
      expect(v.players[0].name).toBe('Solo');
      const g = v.owner.findIndex((o, i) => o === 0 && v.terrain[i] === 3);
      game.send({ t: 'move', from: g, to: g + 1, half: false });
    } finally {
      game.stop(); // stops the tick timer so the test exits cleanly
    }
  });
});

describe('feedback email', () => {
  it('formats a readable plain-text email with no personal data', () => {
    const r = cleanFeedback({ rating: 5, confusing: 'dots', context: { screen: 'end', turn: 40 } })!;
    const { subject, text } = feedbackEmail(r);
    expect(subject).toBe('Blockmarshal feedback: 5/5 🤩');
    expect(text).toContain('Anything confusing?\ndots');
    expect(text).toContain('(blank)');
    expect(text).toContain('Context: screen=end, turn=40');
  });
});

describe('replays', () => {
  it('rebuild a server game exactly from seed + log, including flags, pick-ups and building moves', () => {
    const match = new Match('r1', () => {}, { autoRun: false, lobbyMs: 0, seed: 99, mode: 'duel' });
    const a = conn('Ann');
    match.add(a);
    const s = match.state!;
    const rng = mulberry32(5);
    for (let t = 0; t < 600 && s.winner < 0; t++) {
      const mine = [...s.owner.keys()].filter((i) => s.owner[i] === 0);
      const pick = () => mine[Math.floor(rng() * mine.length)];
      const r = rng();
      if (r < 0.5) {
        const from = pick();
        match.input(a, { t: 'move', from, to: s.n4[from][Math.floor(rng() * s.n4[from].length)], half: rng() < 0.2 });
      } else if (r < 0.56) match.input(a, { t: 'flag', idx: Math.floor(rng() * s.size) });
      else if (r < 0.6) match.input(a, { t: 'pickup', idx: pick() });
      else if (r < 0.64) match.input(a, { t: 'relocate', from: s.players[0].general, to: pick() });
      else if (r < 0.66) match.input(a, { t: 'drop', idx: pick() });
      match.tick();
    }
    const ops = new Set(s.log.map((e) => e.op));
    expect(ops.has('flag')).toBe(true);
    expect(ops.has('relocate')).toBe(true);

    const { w, h, mineRate, mountainRate, spawnEdgeRows } = MODES.duel;
    const cfg = { w, h, seed: 99, mineRate, mountainRate, spawnEdgeRows, players: s.players.map((p) => ({ name: p.name, isBot: p.isBot })) };
    const again = replay(cfg, 'normal', s.log, s.tick);
    expect(again.tick).toBe(s.tick);
    expect([...again.owner]).toEqual([...s.owner]);
    expect([...again.army]).toEqual([...s.army]);
    expect([...again.terrain]).toEqual([...s.terrain]);
    expect([...again.mine]).toEqual([...s.mine]);
  });
});
