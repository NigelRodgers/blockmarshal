import type { ClientMessage, ServerMessage } from './net/protocol';
import { cleanName, Match, type Conn } from '../server/match';

/**
 * A match against bots running entirely in this browser. It uses the same
 * Match class as the server and speaks the same messages, so the rest of the
 * client can't tell the difference. Costs the server nothing and works offline.
 */
export class LocalGame {
  private readonly conn: Conn;
  private readonly match: Match;

  constructor(name: string, onMessage: (msg: ServerMessage) => void) {
    this.conn = { id: 'local', name: cleanName(name), send: onMessage };
    // No countdown: with one human it starts at once, bots in the other five seats.
    this.match = new Match('local', () => {}, { lobbyMs: 0 });
    this.match.add(this.conn);
  }

  send(msg: ClientMessage): void {
    if (msg.t === 'leave') this.stop();
    else if (msg.t !== 'join') this.match.input(this.conn, msg);
  }

  /** Stops the tick loop; the match ends once nobody is watching. */
  stop(): void {
    this.match.remove(this.conn);
  }
}
