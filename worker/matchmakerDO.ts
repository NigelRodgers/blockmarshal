import { DurableObject } from 'cloudflare:workers';
import { isMode, MODES, type GameMode } from '../src/engine/constants';
import { LobbyIndex, type LobbyEntry } from '../server/lobbyIndex';
import { lobbyMs } from './matchDO';

/** Free-for-all keeps the original key, so a deploy doesn't forget open lobbies. */
const storageKey = (mode: GameMode) => (mode === 'ffa' ? 'lobbies' : `lobbies:${mode}`);

/**
 * One global instance. Hands out match IDs (fullest open lobby first, one list
 * per game mode) and hears back from matches about their head counts. The index is persisted,
 * because Cloudflare evicts idle objects from memory: without it, a second
 * player arriving after an eviction would be sent to a brand-new lobby.
 */
export class MatchmakerDO extends DurableObject<Env> {
  private readonly indexes = {} as Record<GameMode, LobbyIndex>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      for (const mode of Object.keys(MODES) as GameMode[]) {
        const saved = (await ctx.storage.get<Record<string, LobbyEntry>>(storageKey(mode))) ?? {};
        this.indexes[mode] = new LobbyIndex(MODES[mode].players, lobbyMs(env), saved);
      }
    });
  }

  async assign(mode: GameMode = 'ffa'): Promise<string> {
    const m = isMode(mode) ? mode : 'ffa';
    const id = this.indexes[m].assign(Date.now(), () => crypto.randomUUID().replace(/-/g, '').slice(0, 12));
    await this.save(m);
    return id;
  }

  async update(matchId: string, humans: number, open: boolean, startsAt: number, mode: GameMode = 'ffa'): Promise<void> {
    const m = isMode(mode) ? mode : 'ffa';
    this.indexes[m].update(matchId, humans, open, startsAt, Date.now());
    await this.save(m);
  }

  private save(mode: GameMode): Promise<void> {
    return this.ctx.storage.put(storageKey(mode), this.indexes[mode].toJSON());
  }
}
