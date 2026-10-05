import { Match, type Conn, type MatchOptions } from './match';

const MAX_NAME = 16;

/** Trim, drop control characters, cap length; fall back to a generic name. */
export function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME) : '';
  return s || 'Player';
}

/**
 * Puts players into lobbies and keeps every match running side by side.
 * New players join the fullest open lobby, so humans end up together rather
 * than each facing five bots alone.
 */
export class Matchmaker {
  readonly matches = new Map<string, Match>();
  private nextId = 1;
  private readonly timer: ReturnType<typeof setInterval> | null;

  constructor(private readonly opts: MatchOptions = {}) {
    this.timer = opts.autoRun === false ? null : setInterval(() => this.lobbyTick(), 1000);
  }

  join(conn: Conn, name: unknown): Match {
    this.leave(conn);
    conn.name = cleanName(name);
    const open = [...this.matches.values()].filter((m) => m.open).sort((a, b) => b.humans.length - a.humans.length);
    let match = open[0];
    if (!match) {
      const id = `m${this.nextId++}`;
      match = new Match(id, (m) => this.matches.delete(m.id), this.opts);
      this.matches.set(id, match);
    }
    match.add(conn);
    return match;
  }

  leave(conn: Conn): void {
    conn.match?.remove(conn);
    conn.pid = undefined;
  }

  lobbyTick(): void {
    for (const m of this.matches.values()) m.lobbyTick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
