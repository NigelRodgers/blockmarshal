import type { GameMode } from '../engine/constants';
import type { ReplayRecord } from '../replay';
import type { ClientMessage, ServerMessage } from './protocol';

/** Base URL of the game backend: same origin by default (Vite proxies /api and /ws in dev). */
function backend(): URL {
  const override = import.meta.env.VITE_SERVER_URL as string | undefined;
  return new URL(override || location.origin);
}

/** Ask the matchmaker which match to join, for a free-for-all or a duel. */
export async function findMatch(mode: GameMode): Promise<string> {
  const res = await fetch(new URL('/api/join', backend()), { method: 'POST', body: JSON.stringify({ mode }) });
  if (!res.ok) throw new Error(`matchmaker ${res.status}`);
  const { matchId } = (await res.json()) as { matchId: string };
  return matchId;
}

/** Send a finished browser-run game to the server for game analytics. Best effort. */
export function uploadReplay(replay: ReplayRecord): void {
  fetch(new URL('/api/replay', backend()), { method: 'POST', body: JSON.stringify(replay), keepalive: true }).catch(() => {});
}

/**
 * Make sure a replay is on the server (for a link or feedback): uploads it if it was played
 * in this browser. Server games are stored by the server already. True once it is there.
 */
export async function storeReplay(replay: ReplayRecord): Promise<boolean> {
  if (replay.source !== 'browser') return true;
  try {
    const res = await fetch(new URL('/api/replay', backend()), { method: 'POST', body: JSON.stringify(replay) });
    return res.ok;
  } catch {
    return false;
  }
}

/** A replay from its link (`/?replay=<id>`), or null if unknown or pruned (kept 60 days). */
export async function fetchReplay(id: string): Promise<unknown> {
  try {
    const res = await fetch(new URL(`/api/replay/${encodeURIComponent(id)}`, backend()));
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** The link that opens a replay for anyone. */
export function replayLink(id: string): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('replay', id);
  return url.toString();
}

function socketUrl(matchId: string): string {
  const url = new URL(`/ws/${matchId}`, backend());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/** One WebSocket per match: JSON in, JSON out. */
export class Net {
  private ws: WebSocket | null = null;

  constructor(
    private readonly onMessage: (msg: ServerMessage) => void,
    private readonly onDown: () => void,
  ) {}

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Opens a socket to the match, closing any previous one. Rejects if unreachable. */
  connect(matchId: string): Promise<void> {
    this.close();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(socketUrl(matchId));
      let opened = false;
      ws.onopen = () => {
        opened = true;
        this.ws = ws;
        resolve();
      };
      ws.onmessage = (e) => {
        try {
          this.onMessage(JSON.parse(String(e.data)) as ServerMessage);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        const current = this.ws === ws;
        if (current) this.ws = null;
        if (!opened) reject(new Error('unreachable'));
        else if (current) this.onDown();
      };
    });
  }

  send(msg: ClientMessage): void {
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }

  /** Close without reporting it as a dropped connection. */
  close(): void {
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
  }
}
