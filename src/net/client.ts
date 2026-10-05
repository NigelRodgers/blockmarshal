import type { ClientMessage, ServerMessage } from './protocol';

/** Where the game server lives: same host by default (Vite proxies /ws in dev). */
export function serverUrl(): string {
  const override = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (override) return override;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

/** Thin WebSocket wrapper: JSON in, JSON out, one handler per event. */
export class Net {
  private ws: WebSocket | null = null;

  constructor(
    private readonly onMessage: (msg: ServerMessage) => void,
    private readonly onDown: () => void,
  ) {}

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Resolves once connected; rejects if the server can't be reached. */
  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(serverUrl());
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
        if (this.ws === ws) this.ws = null;
        if (opened) this.onDown();
        else reject(new Error('unreachable'));
      };
    });
  }

  send(msg: ClientMessage): void {
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }
}
