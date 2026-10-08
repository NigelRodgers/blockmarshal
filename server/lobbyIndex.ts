import { LOBBY_SECONDS, MATCH_PLAYERS } from '../src/engine/constants';

export interface LobbyEntry {
  /** Humans the match itself last reported. */
  humans: number;
  /** Players sent here who haven't shown up in a report yet. */
  reserved: number;
  /** When the countdown ends (reported by the match; estimated until then). */
  startsAt: number;
  updatedAt: number;
}

/** A player handed a seat but never connecting frees it after this long. */
const RESERVATION_MS = 15_000;
/** Don't route players to a lobby whose countdown ends sooner than this. */
const MIN_TIME_LEFT_MS = 2_000;
/** A lobby that stops reporting (its heartbeat is every 10 s) is forgotten after this. */
const SILENT_MS = 25_000;

/**
 * Which lobbies are open and how full they are. Lives in the matchmaker; each
 * match reports its own head count, so this is a routing hint, not the truth.
 * The match still refuses a join if it filled up in the meantime.
 * Serialisable, so the matchmaker can persist it across evictions.
 */
export class LobbyIndex {
  private readonly lobbies: Map<string, LobbyEntry>;

  constructor(
    private readonly capacity = MATCH_PLAYERS,
    private readonly lobbyMs = LOBBY_SECONDS * 1000,
    saved: Record<string, LobbyEntry> = {},
  ) {
    this.lobbies = new Map(Object.entries(saved));
  }

  /** Send a player to the fullest open lobby, or open a new one. Humans end up together. */
  assign(now: number, newId: () => string): string {
    this.prune(now);
    let best: string | null = null;
    let bestCount = -1;
    for (const [id, e] of this.lobbies) {
      const count = e.humans + e.reserved;
      if (count >= this.capacity || e.startsAt - now < MIN_TIME_LEFT_MS) continue;
      if (count > bestCount) {
        best = id;
        bestCount = count;
      }
    }
    const id = best ?? newId();
    const entry = this.lobbies.get(id) ?? { humans: 0, reserved: 0, startsAt: now + this.lobbyMs, updatedAt: now };
    entry.reserved++;
    entry.updatedAt = now;
    this.lobbies.set(id, entry);
    return id;
  }

  /**
   * A match reporting its lobby head count and countdown end. Unknown open
   * lobbies are (re)added, so the index heals if the matchmaker lost its state.
   * Closed lobbies (started, empty, done) drop out.
   */
  update(id: string, humans: number, open: boolean, startsAt: number, now: number): void {
    if (!open) {
      this.lobbies.delete(id);
      return;
    }
    this.lobbies.set(id, { humans, reserved: 0, startsAt, updatedAt: now });
  }

  get size(): number {
    return this.lobbies.size;
  }

  toJSON(): Record<string, LobbyEntry> {
    return Object.fromEntries(this.lobbies);
  }

  private prune(now: number): void {
    for (const [id, e] of this.lobbies) {
      if (now - e.updatedAt > RESERVATION_MS) e.reserved = 0;
      const empty = e.humans + e.reserved === 0 && now - e.updatedAt > RESERVATION_MS;
      if (empty || now - e.updatedAt > SILENT_MS || now > e.startsAt + RESERVATION_MS) this.lobbies.delete(id);
    }
  }
}
