import type { Bot } from '../src/ai/bot';
import { BOT_NAMES, LOBBY_SECONDS, MODES, TICK_MS, type GameMode } from '../src/engine/constants';
import { clearQueue, createGame, pickUpMine, plantMine, queueMove, relocate, toggleFlag, undoMove } from '../src/engine/game';
import { mulberry32, shuffle } from '../src/engine/rng';
import type { GameState } from '../src/engine/types';
import type { ClientMessage, ServerMessage } from '../src/net/protocol';
import { buildView } from '../src/net/view';
import type { ReplayRecord } from '../src/replay';
import { createBots, runTick } from '../src/session';

/** A connected browser, as the match sees it. */
export interface Conn {
  readonly id: string;
  name: string;
  send(msg: ServerMessage): void;
  match?: Match;
  pid?: number;
}

export interface MatchOptions {
  lobbyMs?: number;
  tickMs?: number;
  now?: () => number;
  /** Run the tick timer. Tests turn this off and call tick() themselves. */
  autoRun?: boolean;
  seed?: number;
  /**
   * If the countdown ends with a single human, hand them off to play locally
   * (in their browser) instead of running a server match for one person.
   */
  soloHandoff?: boolean;
  /** Free-for-all (default) or a 1 vs 1 duel: sets the seat count and the board size. */
  mode?: GameMode;
  /** Where this match runs, for its replay record. */
  source?: ReplayRecord['source'];
  /** Called once with the replay when a game that started ends (won or abandoned). */
  onReplay?: (r: ReplayRecord) => void;
}

const MAX_QUEUE = 200;
const MAX_NAME = 16;

/** Trim, drop control characters, cap length; fall back to a generic name. */
export function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME) : '';
  return s || 'Player';
}

/**
 * One game: a lobby that fills for up to LOBBY_SECONDS (or until every seat
 * has a human: six in free-for-all, two in a duel), then a match where empty
 * slots are bots. The server is authoritative;
 * each player only ever receives their own fog-filtered view.
 */
export class Match {
  phase: 'lobby' | 'playing' | 'done' = 'lobby';
  readonly humans: Conn[] = [];
  readonly startsAt: number;
  state: GameState | null = null;
  private bots: Bot[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly connected = new Set<Conn>();
  readonly mode: GameMode;
  private seed = 0;
  private startedAt = 0;
  /** Seats in this match (humans + bots). */
  readonly capacity: number;

  constructor(
    readonly id: string,
    private readonly onDone: (m: Match) => void,
    private readonly opts: MatchOptions = {},
  ) {
    this.startsAt = this.now() + (opts.lobbyMs ?? LOBBY_SECONDS * 1000);
    this.mode = opts.mode ?? 'ffa';
    this.capacity = MODES[this.mode].players;
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  get open(): boolean {
    return this.phase === 'lobby' && this.humans.length < this.capacity;
  }

  add(conn: Conn): void {
    if (!this.open) throw new Error('Match is not accepting players');
    this.humans.push(conn);
    this.connected.add(conn);
    conn.match = this;
    // Full, or the countdown is zero (local testing): start right away.
    if (this.humans.length >= this.capacity || this.now() >= this.startsAt) this.start();
    else this.broadcastLobby();
  }

  remove(conn: Conn): void {
    conn.match = undefined;
    this.connected.delete(conn);
    if (this.phase === 'lobby') {
      this.humans.splice(this.humans.indexOf(conn), 1);
      if (!this.humans.length) this.finish();
      else this.broadcastLobby();
      return;
    }
    // In play, a leaver's general stays on the board, idle. With nobody left to watch, stop.
    if (this.phase === 'playing' && this.connected.size === 0) this.finish();
  }

  /** Called about once a second by the matchmaker while in the lobby. */
  lobbyTick(): void {
    if (this.phase !== 'lobby') return;
    if (this.now() >= this.startsAt) this.start();
    else this.broadcastLobby();
  }

  private broadcastLobby(): void {
    const startsInMs = Math.max(0, this.startsAt - this.now());
    for (const c of this.humans) {
      c.send({
        t: 'lobby',
        matchId: this.id,
        slots: this.humans.map((h) => ({ name: h.name, you: h === c })),
        capacity: this.capacity,
        startsInMs,
      });
    }
  }

  start(): void {
    if (this.phase !== 'lobby') return;
    if (this.opts.soloHandoff && this.humans.length === 1) {
      this.humans[0].send({ t: 'solo' });
      this.finish();
      return;
    }
    this.phase = 'playing';
    const seed = this.opts.seed ?? (Math.random() * 2 ** 32) >>> 0;
    this.seed = seed;
    this.startedAt = this.now();
    const botNames = shuffle(mulberry32(seed), [...BOT_NAMES]);
    const { w, h, mineRate, mountainRate } = MODES[this.mode];
    const players = Array.from({ length: this.capacity }, (_, i) =>
      i < this.humans.length ? { name: this.humans[i].name, isBot: false } : { name: botNames[i % botNames.length], isBot: true },
    );
    this.state = createGame({ w, h, seed, players, mineRate, mountainRate });
    this.bots = createBots(this.state, 'normal');
    this.humans.forEach((c, pid) => {
      c.pid = pid;
      c.send({ t: 'start', matchId: this.id, you: pid });
    });
    this.sendViews();
    if (this.opts.autoRun !== false) this.timer = setInterval(() => this.tick(), this.opts.tickMs ?? TICK_MS);
  }

  /** Stop / restart the clock (browser-run games only: nobody else is waiting). */
  pause(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  resume(): void {
    if (this.phase !== 'playing' || this.timer || this.opts.autoRun === false) return;
    this.timer = setInterval(() => this.tick(), this.opts.tickMs ?? TICK_MS);
  }

  tick(): void {
    if (this.phase !== 'playing' || !this.state) return;
    runTick(this.state, this.bots);
    this.sendViews();
    if (this.state.winner >= 0) this.finish();
  }

  input(conn: Conn, msg: ClientMessage): void {
    const s = this.state;
    if (this.phase !== 'playing' || !s || conn.pid === undefined || !s.players[conn.pid].alive) return;
    const pid = conn.pid;
    if (msg.t === 'move') {
      const ok = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < s.size;
      if (!ok(msg.from) || !ok(msg.to) || s.players[pid].queue.length >= MAX_QUEUE) return;
      queueMove(s, pid, msg.from, msg.to, msg.half === true);
    } else if (msg.t === 'undo') {
      undoMove(s, pid);
    } else if (msg.t === 'clear') {
      clearQueue(s, pid);
    } else if (msg.t === 'flag' && Number.isInteger(msg.idx)) {
      if (toggleFlag(s, pid, msg.idx)) s.log.push({ tick: s.tick, pid, op: 'flag', idx: msg.idx });
    } else if (msg.t === 'drop' && Number.isInteger(msg.idx)) {
      if (plantMine(s, pid, msg.idx)) s.log.push({ tick: s.tick, pid, op: 'drop', idx: msg.idx });
    } else if (msg.t === 'pickup' && Number.isInteger(msg.idx)) {
      if (pickUpMine(s, pid, msg.idx)) s.log.push({ tick: s.tick, pid, op: 'pickup', idx: msg.idx });
    } else if (msg.t === 'relocate' && Number.isInteger(msg.from) && Number.isInteger(msg.to)) {
      if (relocate(s, pid, msg.from, msg.to)) s.log.push({ tick: s.tick, pid, op: 'relocate', from: msg.from, to: msg.to });
    }
  }

  private sendViews(): void {
    if (!this.state) return;
    for (const c of this.connected) if (c.pid !== undefined) c.send({ t: 'view', view: buildView(this.state, c.pid) });
  }

  private finish(): void {
    if (this.phase === 'done') return;
    const played = this.phase === 'playing';
    this.phase = 'done';
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (played && this.state) {
      const replay = this.replay(this.state);
      for (const c of this.connected) c.send({ t: 'replay', replay });
      try {
        this.opts.onReplay?.(replay);
      } catch {
        /* storing a replay must never break a match */
      }
    }
    for (const c of this.humans) if (c.match === this) c.match = undefined;
    this.onDone(this);
  }

  /** Seed + settings + human inputs: enough to rebuild the whole game (see ReplayPlayer). */
  private replay(s: GameState): ReplayRecord {
    return {
      v: 1,
      id: crypto.randomUUID(),
      mode: this.mode,
      source: this.opts.source ?? 'server',
      seed: this.seed,
      players: s.players.map((p) => ({ name: p.name, isBot: p.isBot })),
      log: s.log.slice(),
      ticks: s.tick,
      winner: s.winner,
      startedAt: this.startedAt,
      endedAt: this.now(),
    };
  }
}
