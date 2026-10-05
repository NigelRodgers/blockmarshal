import { MatchDO } from './matchDO';
import { MatchmakerDO } from './matchmakerDO';

export { MatchDO, MatchmakerDO };

const MATCH_ID = /^\/ws\/([a-z0-9]{6,32})$/;

/**
 * Routes:
 *   POST /api/join      -> the matchmaker picks a lobby, returns { matchId }
 *   GET  /ws/:matchId   -> WebSocket into that match's Durable Object
 *   everything else     -> static client (handled by the assets binding)
 */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/api/join' && req.method === 'POST') {
      const matchmaker = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global'));
      const matchId = await matchmaker.assign();
      return Response.json({ matchId }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const ws = MATCH_ID.exec(url.pathname);
    if (ws) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      return env.MATCH.get(env.MATCH.idFromName(ws[1])).fetch(req);
    }

    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
