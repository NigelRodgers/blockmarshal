import type { ReplayRecord } from '../src/replay';

/** Replays not pulled to the PC are deleted after this long, so the database stays small. */
export const REPLAY_RETENTION_DAYS = 60;

/** One row per finished game. `data` is the whole ReplayRecord as JSON (see migrations/0002). */
export async function saveReplay(env: Env, r: ReplayRecord): Promise<void> {
  const humans = r.players.filter((p) => !p.isBot).length;
  await env.FEEDBACK_DB.prepare(
    'INSERT OR IGNORE INTO replays (id, created_at, mode, source, humans, ticks, winner, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(r.id, r.endedAt, r.mode, r.source, humans, r.ticks, r.winner, JSON.stringify(r))
    .run();
}

/** Daily cron: forget replays older than the retention window (the PC keeps its copies). */
export async function pruneReplays(env: Env, now = Date.now()): Promise<void> {
  const cutoff = now - REPLAY_RETENTION_DAYS * 24 * 3600 * 1000;
  await env.FEEDBACK_DB.prepare('DELETE FROM replays WHERE created_at < ?').bind(cutoff).run();
}
