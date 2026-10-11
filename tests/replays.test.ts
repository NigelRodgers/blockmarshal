import { describe, expect, it } from 'vitest';
import { BUILD_HASH } from '../src/buildId';
import { LocalGame } from '../src/local';
import type { ServerMessage } from '../src/net/protocol';
import { summarize, validateReplay, type ReplayRecord } from '../src/replay';
import { ReplayPlayer } from '../src/replayPlayer';
import { Match, type Conn } from '../server/match';
import { MessageBudget } from '../worker/security';

function conn(id: string): Conn & { inbox: ServerMessage[] } {
  const inbox: ServerMessage[] = [];
  return { id, name: id, inbox, send: (m) => inbox.push(m) };
}

/** Plays a duel with one idle human until it ends, returning the replay the match produced. */
function finishedDuel(build?: string): { replay: ReplayRecord; match: Match } {
  let replay: ReplayRecord | null = null;
  const match = new Match('m', () => {}, { autoRun: false, lobbyMs: 0, seed: 3, mode: 'duel', build, onReplay: (r) => (replay = r) });
  match.add(conn('Ann'));
  for (let t = 0; t < 5000 && match.phase === 'playing'; t++) match.tick();
  return { replay: replay!, match };
}

describe('replay records', () => {
  it('are produced when a game ends, sent to the players, and replay to the same result', () => {
    const { replay, match } = finishedDuel();
    expect(replay).toBeTruthy();
    expect(replay.ticks).toBe(match.state!.tick);
    expect(replay.winner).toBe(match.state!.winner);
    const p = new ReplayPlayer(replay);
    while (!p.done) p.step();
    expect(p.tick).toBe(replay.ticks);
    expect(p.view(0).winner).toBe(replay.winner);
    expect(p.diverged).toBe(false);
  }, 30_000);

  it('carry the build that made them, and notice when they no longer rebuild the game', () => {
    const { replay } = finishedDuel('abc1234');
    expect(replay.build).toBe('abc1234');
    // Stand-in for a build whose bots play differently: same log, different game.
    const p = new ReplayPlayer({ ...replay, seed: replay.seed + 1 });
    while (!p.done) p.step();
    expect(p.diverged).toBe(true);
  }, 30_000);

  it('summarise to what the list needs, judged from the first human seat', () => {
    const { replay } = finishedDuel();
    const s = summarize({ ...replay, players: [{ name: 'Bot', isBot: true }, { name: 'Ann', isBot: false }] });
    expect(s).toEqual({ id: replay.id, mode: 'duel', ticks: replay.ticks, winner: replay.winner, endedAt: replay.endedAt, seat: 1 });
  }, 30_000);

  it('can seek backwards and forwards', () => {
    const { replay } = finishedDuel();
    const p = new ReplayPlayer(replay);
    p.seek(40);
    const at40 = JSON.stringify(p.view(0).owner);
    p.seek(80);
    p.seek(40);
    expect(JSON.stringify(p.view(0).owner)).toBe(at40);
  }, 30_000);

  it('records a browser game left early', () => {
    const inbox: ServerMessage[] = [];
    const game = new LocalGame('Solo', (m) => inbox.push(m), 'duel');
    game.stop();
    const r = inbox.find((m) => m.t === 'replay');
    expect(r?.t === 'replay' && r.replay.source).toBe('browser');
    expect(r?.t === 'replay' && r.replay.winner).toBe(-1);
    expect(r?.t === 'replay' && r.replay.build).toBe(BUILD_HASH);
    expect(BUILD_HASH).toMatch(/^[a-z0-9]{1,12}$/); // the short hash, not the date shown on the start screen
  });

  it('uploads are checked: shape, sizes, ranges, and only browser games', () => {
    const { replay } = finishedDuel();
    const browser = { ...replay, source: 'browser' as const };
    expect(validateReplay(browser)).toBeTruthy();
    expect(validateReplay(replay)).toBeNull(); // a 'server' record can't be uploaded
    expect(validateReplay(replay, ['server', 'browser'])).toBeTruthy(); // but can be opened from a file
    expect(validateReplay({ ...browser, mode: 'chess' })).toBeNull();
    expect(validateReplay({ ...browser, players: browser.players.slice(0, 1) })).toBeNull();
    expect(validateReplay({ ...browser, ticks: 1e9 })).toBeNull();
    expect(validateReplay({ ...browser, id: '<script>' })).toBeNull();
    expect(validateReplay({ ...browser, log: [{ tick: 1, pid: 0, op: 'move', from: 99999, to: 1, half: false }] })).toBeNull();
    expect(validateReplay({ ...browser, log: [{ tick: 1, pid: 7, op: 'undo' }] })).toBeNull();
    expect(validateReplay({ ...browser, log: [{ tick: 1, pid: 0, op: 'nuke' }] })).toBeNull();
    expect(validateReplay({ ...browser, build: 'abc1234' })).toBeTruthy();
    expect(validateReplay({ ...browser, build: undefined })).toBeTruthy(); // replays from before builds were stamped
    expect(validateReplay({ ...browser, build: '<b>' })).toBeNull();
    expect(validateReplay({ ...browser, build: 7 })).toBeNull();
  }, 30_000);
});

describe('socket message budget', () => {
  it('lets a normal player through and drops a flood', () => {
    let now = 0;
    const b = new MessageBudget(25, 60, () => now);
    let ok = 0;
    for (let i = 0; i < 1000; i++) if (b.take()) ok++;
    expect(ok).toBe(60); // the burst, then nothing until it refills
    now += 1000;
    expect(b.take()).toBe(true); // refilled about 25 a second
    for (let s = 0; s < 10; s++) {
      now += 100;
      expect(b.take()).toBe(true); // 10 a second is always fine
    }
  });
});

describe('origin check', () => {
  it('only lets this site call the API in production; anything goes on a dev machine', async () => {
    const { sameOrigin } = await import('../worker/security');
    const site = new URL('https://blockmarshal.example.dev/api/join');
    const req = (origin?: string) => new Request(site, { method: 'POST', headers: origin ? { Origin: origin } : {} });
    expect(sameOrigin(req('https://blockmarshal.example.dev'), site)).toBe(true);
    expect(sameOrigin(req('https://evil.example'), site)).toBe(false);
    expect(sameOrigin(req(), site)).toBe(false); // bare scripts send no Origin
    const dev = new URL('http://localhost:8787/api/join');
    expect(sameOrigin(req('http://192.168.1.5:5199'), dev)).toBe(true);
  });
});
