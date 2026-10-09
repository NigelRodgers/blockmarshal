import type { GameMode } from './engine/constants';
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

  constructor(name: string, onMessage: (msg: ServerMessage) => void, mode: GameMode = 'ffa') {
    this.conn = { id: 'local', name: cleanName(name), send: onMessage };
    // No countdown: with one human it starts at once, bots in every other seat.
    // Also hand over the replay of a game left early (the match no longer has us to send it to).
    this.match = new Match('local', () => {}, {
      lobbyMs: 0,
      mode,
      source: 'browser',
      onReplay: (replay) => onMessage({ t: 'replay', replay }),
    });
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
