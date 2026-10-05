import { describe, expect, it } from 'vitest';
import { MATCH_PLAYERS } from '../src/engine/constants';
import type { PlayerView, ServerMessage } from '../src/net/protocol';
import type { Conn } from '../server/match';
import { cleanName, Matchmaker } from '../server/matchmaker';

/** Fake browser connection that records what the server sends it. */
function conn(id: string): Conn & { inbox: ServerMessage[]; lastView(): PlayerView | undefined } {
  const inbox: ServerMessage[] = [];
  return {
    id,
    name: '',
    inbox,
    send: (m) => inbox.push(m),
    lastView() {
      const v = [...inbox].reverse().find((m) => m.t === 'view');
      return v?.t === 'view' ? v.view : undefined;
    },
  };
}

function setup() {
  let now = 1_000_000;
  const mm = new Matchmaker({ autoRun: false, lobbyMs: 60_000, now: () => now, seed: 42 });
  return { mm, advance: (ms: number) => (now += ms) };
}

describe('matchmaking', () => {
  it('fills empty seats with bots when the one-minute countdown ends', () => {
    const { mm, advance } = setup();
    const a = conn('a');
    const match = mm.join(a, 'Alice');
    expect(match.phase).toBe('lobby');
    expect(a.inbox.at(-1)).toMatchObject({ t: 'lobby', capacity: MATCH_PLAYERS, startsInMs: 60_000 });

    advance(59_000);
    mm.lobbyTick();
    expect(match.phase).toBe('lobby');
    advance(1_000);
    mm.lobbyTick();
    expect(match.phase).toBe('playing');
    const players = match.state!.players;
    expect(players.length).toBe(MATCH_PLAYERS);
    expect(players.filter((p) => !p.isBot).map((p) => p.name)).toEqual(['Alice']);
    expect(a.inbox.some((m) => m.t === 'start')).toBe(true);
    expect(a.lastView()?.you).toBe(0);
  });

  it('starts at once when six humans are in, and opens a new lobby for the seventh', () => {
    const { mm } = setup();
    const six = Array.from({ length: 6 }, (_, i) => conn(`c${i}`));
    const first = mm.join(six[0], 'P0');
    for (const c of six.slice(1)) mm.join(c, c.id);
    expect(first.phase).toBe('playing');
    expect(first.state!.players.every((p) => !p.isBot)).toBe(true);

    const seventh = mm.join(conn('c7'), 'late');
    expect(seventh).not.toBe(first);
    expect(seventh.phase).toBe('lobby');
    expect(mm.matches.size).toBe(2);
  });

  it('sends newcomers to the fullest open lobby', () => {
    const { mm } = setup();
    const a = mm.join(conn('a'), 'a');
    // Force a second lobby by filling the first's slot count artificially: join, then leave the first.
    const b = conn('b');
    mm.join(b, 'b');
    expect(b.match).toBe(a);
    expect(a.humans.length).toBe(2);
  });

  it('runs several matches side by side', () => {
    const { mm, advance } = setup();
    const a = mm.join(conn('a'), 'a');
    advance(60_000);
    mm.lobbyTick();
    const b = mm.join(conn('b'), 'b');
    advance(60_000);
    mm.lobbyTick();
    expect(a.phase).toBe('playing');
    expect(b.phase).toBe('playing');
    expect(a).not.toBe(b);
    a.tick();
    b.tick();
    expect(a.state!.tick).toBe(1);
    expect(b.state!.tick).toBe(1);
  });

  it('closes an empty lobby and stops a match nobody is watching', () => {
    const { mm, advance } = setup();
    const a = conn('a');
    const lobby = mm.join(a, 'a');
    mm.leave(a);
    expect(lobby.phase).toBe('done');
    expect(mm.matches.size).toBe(0);

    const b = conn('b');
    const game = mm.join(b, 'b');
    advance(60_000);
    mm.lobbyTick();
    mm.leave(b);
    expect(game.phase).toBe('done');
    expect(mm.matches.size).toBe(0);
  });

  it('cleans player names', () => {
    expect(cleanName('  Nigel  ')).toBe('Nigel');
    expect(cleanName('a\u0000b\nc')).toBe('abc');
    expect(cleanName('x'.repeat(40)).length).toBe(16);
    expect(cleanName('')).toBe('Player');
    expect(cleanName(42)).toBe('Player');
  });
});

describe('player views', () => {
  function started() {
    const { mm, advance } = setup();
    const a = conn('a');
    const match = mm.join(a, 'a');
    advance(60_000);
    mm.lobbyTick();
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
    // The JSON on the wire carries no per-tile mine field at all.
    expect(JSON.stringify(v)).not.toContain('"mine"');
  });

  it('shows dots on tiles you have held', () => {
    const { match, a } = started();
    const s = match.state!;
    const g = s.players[0].general;
    expect(a.lastView()!.dots[g]).toBe(0); // generals start in a mine-free 3x3
    expect(a.lastView()!.owner[g]).toBe(0);
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
