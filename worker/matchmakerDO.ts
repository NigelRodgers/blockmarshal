import { DurableObject } from 'cloudflare:workers';
import { MATCH_PLAYERS } from '../src/engine/constants';
import { LobbyIndex, type LobbyEntry } from '../server/lobbyIndex';
import { lobbyMs } from './matchDO';

const STORAGE_KEY = 'lobbies';

/**
 * One global instance. Hands out match IDs (fullest open lobby first) and
 * hears back from matches about their head counts. The index is persisted,
 * because Cloudflare evicts idle objects from memory: without it, a second
 * player arriving after an eviction would be sent to a brand-new lobby.
 */
export class MatchmakerDO extends DurableObject<Env> {
  private index!: LobbyIndex;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const saved = (await ctx.storage.get<Record<string, LobbyEntry>>(STORAGE_KEY)) ?? {};
      this.index = new LobbyIndex(MATCH_PLAYERS, lobbyMs(env), saved);
    });
  }

  async assign(): Promise<string> {
    const id = this.index.assign(Date.now(), () => crypto.randomUUID().replace(/-/g, '').slice(0, 12));
    await this.save();
    return id;
  }

  async update(matchId: string, humans: number, open: boolean, startsAt: number): Promise<void> {
    this.index.update(matchId, humans, open, startsAt, Date.now());
    await this.save();
  }

  private save(): Promise<void> {
    return this.ctx.storage.put(STORAGE_KEY, this.index.toJSON());
  }
}
