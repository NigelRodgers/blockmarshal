import { LOBBY_SECONDS, MATCH_PLAYERS } from '../src/engine/constants';

interface LobbyEntry {
  /** Humans the match itself last reported. */
  humans: number;
  /** Players sent here who haven't shown up in a report yet. */
  reserved: number;
  createdAt: number;
  updatedAt: number;
}

/** A player handed a seat but never connecting frees it after this long. */
const RESERVATION_MS = 15_000;

/**
 * Which lobbies are open and how full they are. Lives in the matchmaker; each
 * match reports its own head count, so this is a routing hint, not the truth.
 * The match still refuses a join if it filled up in the meantime.
 */
export class LobbyIndex {
  private readonly lobbies = new Map<string, LobbyEntry>();

  constructor(private readonly capacity = MATCH_PLAYERS, private readonly lobbyMs = LOBBY_SECONDS * 1000) {}

  /** Send a player to the fullest open lobby, or open a new one. Humans end up together. */
  assign(now: number, newId: () => string): string {
    this.prune(now);
    let best: string | null = null;
    let bestCount = -1;
    for (const [id, e] of this.lobbies) {
      const count = e.humans + e.reserved;
      // Skip lobbies about to start: the seat would likely be gone on arrival.
      if (count >= this.capacity || now - e.createdAt > this.lobbyMs - 2_000) continue;
      if (count > bestCount) {
        best = id;
        bestCount = count;
      }
    }
    const id = best ?? newId();
    const entry = this.lobbies.get(id) ?? { humans: 0, reserved: 0, createdAt: now, updatedAt: now };
    entry.reserved++;
    entry.updatedAt = now;
    this.lobbies.set(id, entry);
    return id;
  }

  /** A match reporting its lobby head count; closed lobbies (started, empty, done) drop out. */
  update(id: string, humans: number, open: boolean, now: number): void {
    if (!open) {
      this.lobbies.delete(id);
      return;
    }
    const e = this.lobbies.get(id);
    if (!e) return; // already started or forgotten; nothing to route there
    e.humans = humans;
    e.reserved = 0;
    e.updatedAt = now;
  }

  get size(): number {
    return this.lobbies.size;
  }

  private prune(now: number): void {
    for (const [id, e] of this.lobbies) {
      if (now - e.updatedAt > RESERVATION_MS) e.reserved = 0;
      if (e.humans + e.reserved === 0 && now - e.updatedAt > RESERVATION_MS) this.lobbies.delete(id);
      else if (now - e.createdAt > this.lobbyMs + RESERVATION_MS) this.lobbies.delete(id);
    }
  }
}
