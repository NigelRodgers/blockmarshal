import { DurableObject } from 'cloudflare:workers';
import { isMode, type GameMode } from '../src/engine/constants';
import type { ClientMessage } from '../src/net/protocol';
import { cleanName, Match, type Conn } from '../server/match';
import { saveReplay } from './replays';
import { MessageBudget } from './security';

const MAX_MESSAGE = 4096;
/** How often an open lobby re-reports itself to the matchmaker. */
const HEARTBEAT_SECONDS = 10;
/** Sockets one match accepts (players plus reconnect churn); more is an attack, not a game. */
const MAX_SOCKETS = 24;
/** A socket that has had this many messages dropped for flooding is closed. */
const MAX_DROPPED = 200;

/** Lobby countdown from the LOBBY_SECONDS var (60 in production, often 0 locally). */
export function lobbyMs(env: Env): number {
  const secs = Number(env.LOBBY_SECONDS);
  return (Number.isFinite(secs) && secs >= 0 ? secs : 60) * 1000;
}

/**
 * One match: its players' WebSockets, the lobby countdown and the game loop.
 * All game rules live in the shared Match class; this only adapts sockets.
 */
export class MatchDO extends DurableObject<Env> {
  private match: Match | null = null;
  private matchId = '';
  private lobbyTimer: ReturnType<typeof setInterval> | null = null;
  private sockets = 0;

  async fetch(req: Request): Promise<Response> {
    this.matchId ||= new URL(req.url).pathname.split('/').pop() ?? '';
    if (this.sockets >= MAX_SOCKETS) return new Response('Match is busy', { status: 503 });
    this.sockets++;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const conn: Conn = {
      id: crypto.randomUUID(),
      name: 'Player',
      send(msg) {
        try {
          server.send(JSON.stringify(msg));
        } catch {
          /* socket already closed */
        }
      },
    };

    const budget = new MessageBudget();
    server.addEventListener('message', (ev) => {
      if (!budget.take()) {
        if (budget.dropped > MAX_DROPPED) server.close(1008, 'flood');
        return;
      }
      const data = typeof ev.data === 'string' ? ev.data : '';
      if (!data || data.length > MAX_MESSAGE) return;
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      this.onMessage(conn, msg, server);
    });
    let closed = false;
    const gone = () => {
      if (!closed) this.sockets--;
      closed = true;
      this.onLeave(conn);
    };
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);

    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(conn: Conn, msg: ClientMessage, socket: WebSocket): void {
    if (msg.t === 'join') {
      if (conn.match) return;
      const mode = isMode(msg.mode) ? msg.mode : 'ffa';
      const match = this.ensureMatch(mode);
      // A lobby only takes players looking for its own mode.
      if (!match.open || match.mode !== mode) {
        conn.send({ t: 'error', code: 'full', message: 'That game just filled up. Finding another…' });
        socket.close(1000, 'full');
        return;
      }
      conn.name = cleanName(msg.name);
      match.add(conn);
      this.report();
    } else if (msg.t === 'leave') {
      this.onLeave(conn);
      socket.close(1000, 'left');
    } else {
      conn.match?.input(conn, msg);
    }
  }

  private onLeave(conn: Conn): void {
    if (!conn.match) return;
    conn.match.remove(conn);
    this.report();
  }

  private ensureMatch(mode: GameMode): Match {
    if (this.match && this.match.phase !== 'done') return this.match;
    this.match = new Match(this.matchId, () => this.report(), {
      lobbyMs: lobbyMs(this.env),
      soloHandoff: true,
      mode,
      onReplay: (r) => this.ctx.waitUntil(saveReplay(this.env, r).catch(() => {})),
    });
    // The lobby countdown. The game loop itself runs on Match's own interval.
    let seconds = 0;
    this.lobbyTimer = setInterval(() => {
      this.match?.lobbyTick();
      if (this.match?.phase !== 'lobby') {
        if (this.lobbyTimer) clearInterval(this.lobbyTimer);
        this.lobbyTimer = null;
        this.report();
      } else if (++seconds % HEARTBEAT_SECONDS === 0) {
        // Keeps the matchmaker's list right even if it lost its state.
        this.report();
      }
    }, 1000);
    return this.match;
  }

  /** Tell the matchmaker how full this lobby is (or that it closed). */
  private report(): void {
    const m = this.match;
    const open = !!m && m.open;
    const matchmaker = this.env.MATCHMAKER.get(this.env.MATCHMAKER.idFromName('global'));
    this.ctx.waitUntil(
      matchmaker.update(this.matchId, m?.humans.length ?? 0, open, m?.startsAt ?? 0, m?.mode ?? 'ffa').catch(() => {}),
    );
  }
}
