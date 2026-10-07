import { cleanFeedback, type FeedbackInput } from '../server/feedback';
import { MatchDO } from './matchDO';
import { MatchmakerDO } from './matchmakerDO';

export { MatchDO, MatchmakerDO };

const MATCH_ID = /^\/ws\/([a-z0-9]{6,32})$/;
const MAX_FEEDBACK_BYTES = 8192;

/**
 * Routes:
 *   POST /api/join      -> the matchmaker picks a lobby, returns { matchId }
 *   POST /api/feedback  -> anonymous feedback into the private D1 database (write-only)
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

    if (url.pathname === '/api/feedback' && req.method === 'POST') return saveFeedback(req, env);

    const ws = MATCH_ID.exec(url.pathname);
    if (ws) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      return env.MATCH.get(env.MATCH.idFromName(ws[1])).fetch(req);
    }

    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

/**
 * Stores one feedback submission. Write-only on purpose: there is no route to
 * read feedback back; it is only visible in the Cloudflare dashboard or via
 * `npm run feedback`. No IP address or identity is recorded.
 */
async function saveFeedback(req: Request, env: Env): Promise<Response> {
  const raw = await req.text();
  if (raw.length > MAX_FEEDBACK_BYTES) return new Response('Too large', { status: 413 });
  let input: FeedbackInput;
  try {
    input = JSON.parse(raw);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  const record = cleanFeedback(input ?? {});
  // Spam and empty submissions get the same quiet success, so bots learn nothing.
  if (record) {
    await env.FEEDBACK_DB.prepare('INSERT INTO feedback (rating, confusing, improve, context) VALUES (?, ?, ?, ?)')
      .bind(record.rating, record.confusing, record.improve, record.context)
      .run();
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
