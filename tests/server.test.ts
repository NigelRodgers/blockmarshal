import { describe, expect, it } from 'vitest';
import { MATCH_PLAYERS } from '../src/engine/constants';
import type { PlayerView, ServerMessage } from '../src/net/protocol';
import { LobbyIndex } from '../server/lobbyIndex';
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
    idx.update(a, 2, true, 2_000);
    expect(idx.assign(3_000, id)).toBe(a);
  });

  it('opens a new lobby when the open one is full or about to start', () => {
    const idx = new LobbyIndex();
    const a = idx.assign(0, id);
    idx.update(a, 6, true, 1_000);
    const b = idx.assign(2_000, id);
    expect(b).not.toBe(a);

    const idx2 = new LobbyIndex();
    const c = idx2.assign(0, id);
    idx2.update(c, 1, true, 0);
    expect(idx2.assign(59_000, id)).not.toBe(c); // 1 s left on c's countdown
  });

  it('forgets lobbies that started or closed, and seats nobody claimed', () => {
    const idx = new LobbyIndex();
    const a = idx.assign(0, id);
    idx.update(a, 1, false, 1_000);
    expect(idx.size).toBe(0);

    const b = idx.assign(0, id); // reserved, but the player never connects
    expect(idx.size).toBe(1);
    expect(idx.assign(20_000, id)).not.toBe(b);
    expect(idx.size).toBe(1);
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
