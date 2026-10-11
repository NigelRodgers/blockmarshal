import type { ReplayRecord } from './replay';
import { ReplayPlayer } from './replayPlayer';

/**
 * - `yes`: rebuilding the game from its seed and inputs ends exactly as recorded.
 * - `no`: it doesn't, though it was played on this same build: forged, or a determinism bug.
 * - `stale-build`: it doesn't, but it was played on another build (or before builds were
 *   stamped), whose bots or rules may differ: can't tell.
 * - `error`: the rebuild threw.
 */
export type Verdict = 'yes' | 'no' | 'stale-build' | 'error';

/** Replays a record to the end and checks it against what was recorded (used by `npm run replays`). */
export function verifyReplay(r: ReplayRecord, currentBuild: string): Verdict {
  try {
    const p = new ReplayPlayer(r);
    while (!p.done) p.step();
    if (!p.diverged) return 'yes';
    return r.build === currentBuild ? 'no' : 'stale-build';
  } catch {
    return 'error';
  }
}
