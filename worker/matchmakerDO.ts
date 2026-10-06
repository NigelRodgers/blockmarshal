import { DurableObject } from 'cloudflare:workers';
import { MATCH_PLAYERS } from '../src/engine/constants';
import { LobbyIndex } from '../server/lobbyIndex';
import { lobbyMs } from './matchDO';

/**
 * One global instance. Hands out match IDs (fullest open lobby first) and
 * hears back from matches about their head counts. Holds no sockets, so it
 * costs almost nothing; if it is ever evicted it just opens fresh lobbies.
 */
export class MatchmakerDO extends DurableObject<Env> {
  private readonly index: LobbyIndex;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.index = new LobbyIndex(MATCH_PLAYERS, lobbyMs(env));
  }

  assign(): string {
    return this.index.assign(Date.now(), () => crypto.randomUUID().replace(/-/g, '').slice(0, 12));
  }

  update(matchId: string, humans: number, open: boolean): void {
    this.index.update(matchId, humans, open, Date.now());
  }
}
