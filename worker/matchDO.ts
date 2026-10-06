import { DurableObject } from 'cloudflare:workers';
import type { ClientMessage } from '../src/net/protocol';
import { cleanName, Match, type Conn } from '../server/match';

const MAX_MESSAGE = 4096;

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

  async fetch(req: Request): Promise<Response> {
    this.matchId ||= new URL(req.url).pathname.split('/').pop() ?? '';
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

    server.addEventListener('message', (ev) => {
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
    const gone = () => this.onLeave(conn);
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);

    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(conn: Conn, msg: ClientMessage, socket: WebSocket): void {
    if (msg.t === 'join') {
      if (conn.match) return;
      const match = this.ensureMatch();
      if (!match.open) {
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

  private ensureMatch(): Match {
    if (this.match && this.match.phase !== 'done') return this.match;
    this.match = new Match(this.matchId, () => this.report(), { lobbyMs: lobbyMs(this.env) });
    // The lobby countdown. The game loop itself runs on Match's own interval.
    this.lobbyTimer = setInterval(() => {
      this.match?.lobbyTick();
      if (this.match?.phase !== 'lobby') {
        if (this.lobbyTimer) clearInterval(this.lobbyTimer);
        this.lobbyTimer = null;
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
    this.ctx.waitUntil(matchmaker.update(this.matchId, m?.humans.length ?? 0, open).catch(() => {}));
  }
}
