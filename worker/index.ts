import { cleanFeedback, feedbackEmail, type FeedbackInput, type FeedbackRecord } from '../server/feedback';
import { isMode, type GameMode } from '../src/engine/constants';
import { MAX_REPLAY_BYTES, validateReplay } from '../src/replay';
import { MatchDO } from './matchDO';
import { MatchmakerDO } from './matchmakerDO';
import { pruneReplays, saveReplay } from './replays';
import { forbidden, readCapped, sameOrigin, tooMany, underLimit } from './security';

export { MatchDO, MatchmakerDO };

const MATCH_ID = /^\/ws\/([a-z0-9]{6,32})$/;
const MAX_FEEDBACK_BYTES = 8192;
const MAX_JOIN_BYTES = 256;

/**
 * Routes:
 *   POST /api/join      -> body { mode?: 'ffa' | 'duel' }; the matchmaker picks a lobby, returns { matchId }
 *   POST /api/feedback  -> anonymous feedback into the private D1 database (write-only)
 *   POST /api/replay    -> a finished browser-run game (vs bot / solo) for game analytics (write-only)
 *   GET  /ws/:matchId   -> WebSocket into that match's Durable Object
 *   everything else     -> static client (handled by the assets binding)
 *
 * Every API and socket request must come from this site (Origin check) and stays under a
 * per-IP rate limit; bodies are size-capped before parsing.
 */
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const ws = MATCH_ID.exec(url.pathname);
    const api = url.pathname.startsWith('/api/');
    if ((api || ws) && !sameOrigin(req, url)) return forbidden();

    if (url.pathname === '/api/join' && req.method === 'POST') {
      if (!(await underLimit(env.JOIN_LIMIT, req, 'join'))) return tooMany();
      const matchmaker = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global'));
      const matchId = await matchmaker.assign(await joinMode(req));
      return Response.json({ matchId }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (url.pathname === '/api/feedback' && req.method === 'POST') {
      if (!(await underLimit(env.FEEDBACK_LIMIT, req, 'feedback'))) return tooMany();
      return saveFeedback(req, env, ctx);
    }

    if (url.pathname === '/api/replay' && req.method === 'POST') {
      if (!(await underLimit(env.REPLAY_LIMIT, req, 'replay'))) return tooMany();
      return uploadReplay(req, env);
    }

    if (api) return new Response('Not found', { status: 404 });

    if (ws) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      if (!(await underLimit(env.SOCKET_LIMIT, req, 'socket'))) return tooMany();
      return env.MATCH.get(env.MATCH.idFromName(ws[1])).fetch(req);
    }

    return env.ASSETS.fetch(req);
  },

  async scheduled(_event, env, ctx): Promise<void> {
    ctx.waitUntil(pruneReplays(env));
  },
} satisfies ExportedHandler<Env>;

/** A replay from a browser-run game. Write-only, like feedback; bad input gets a quiet 204. */
async function uploadReplay(req: Request, env: Env): Promise<Response> {
  const raw = await readCapped(req, MAX_REPLAY_BYTES);
  if (raw === null) return new Response('Too large', { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  const replay = validateReplay(parsed);
  if (replay) await saveReplay(env, replay);
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

/** The game mode a join asks for; anything unreadable means free-for-all. */
async function joinMode(req: Request): Promise<GameMode> {
  try {
    const body = JSON.parse((await readCapped(req, MAX_JOIN_BYTES)) ?? '{}') as { mode?: unknown };
    return isMode(body?.mode) ? body.mode : 'ffa';
  } catch {
    return 'ffa';
  }
}

/**
 * Stores one feedback submission. Write-only on purpose: there is no route to
 * read feedback back; it is only visible in the Cloudflare dashboard or via
 * `npm run feedback`. No IP address or identity is recorded.
 */
async function saveFeedback(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const raw = await readCapped(req, MAX_FEEDBACK_BYTES);
  if (raw === null) return new Response('Too large', { status: 413 });
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
    ctx.waitUntil(emailFeedback(env, record));
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Copy of the feedback to FEEDBACK_EMAIL via Resend. Does nothing until the
 * RESEND_API_KEY secret is set; failures never affect the player.
 */
async function emailFeedback(env: Env, record: FeedbackRecord): Promise<void> {
  const key = (env as Env & { RESEND_API_KEY?: string }).RESEND_API_KEY;
  if (!key || !env.FEEDBACK_EMAIL) return;
  const { subject, text } = feedbackEmail(record);
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Blockmarshal <onboarding@resend.dev>', to: [env.FEEDBACK_EMAIL], subject, text }),
    });
  } catch {
    /* stored in D1 regardless */
  }
}
