import { MINE_DAMAGE } from '../engine/constants';
import { queueMove, visionFor } from '../engine/game';
import { manhattan } from '../engine/grid';
import { analyze, type Knowledge } from '../engine/knowledge';
import type { Rng } from '../engine/rng';
import { Memory, Terrain, type GameState, type Player } from '../engine/types';

export type Difficulty = 'easy' | 'normal' | 'hard';

interface Profile {
  thinkEvery: number;
  /** Uses the mine dots on its own tiles. */
  readsDots: boolean;
  riskWeight: number;
  aggression: number;
  defend: boolean;
  noise: number;
  expandRisk: number;
  /** Worth of a neutral watchtower; 0 means the bot ignores towers. */
  towerValue: number;
}

const PROFILES: Record<Difficulty, Profile> = {
  easy: { thinkEvery: 3, readsDots: false, riskWeight: 3, aggression: 0.6, defend: false, noise: 0.6, expandRisk: 0.5, towerValue: 0 },
  normal: { thinkEvery: 1, readsDots: true, riskWeight: 10, aggression: 1, defend: true, noise: 0.25, expandRisk: 0.3, towerValue: 70 },
  hard: { thinkEvery: 1, readsDots: true, riskWeight: 16, aggression: 1.5, defend: true, noise: 0.08, expandRisk: 0.2, towerValue: 70 },
};

interface Ctx {
  s: GameState;
  me: Player;
  vis: Uint8Array;
  k: Knowledge;
}

/** Plays with the same information a human has: its own vision, memory and known numbers. */
export class Bot {
  private readonly p: Profile;

  constructor(
    readonly pid: number,
    difficulty: Difficulty,
    private readonly rng: Rng,
  ) {
    this.p = PROFILES[difficulty];
  }

  think(s: GameState): void {
    const me = s.players[this.pid];
    if (!me.alive || me.queue.length || s.tick % this.p.thinkEvery) return;
    const ctx: Ctx = { s, me, vis: visionFor(s, this.pid), k: analyze(s, this.pid, this.p.readsDots) };

    if (this.p.defend && this.defend(ctx)) return;

    const src = this.biggestStack(ctx, -1);
    if (src < 0) return;
    const plan = this.bestTarget(ctx, src);
    if (plan && (plan.value >= 50 || s.army[src] >= 12)) return this.queuePath(ctx, plan.path);
    if (this.expand(ctx)) return;
    if (plan) this.queuePath(ctx, plan.path);
  }

  private biggestStack({ s }: Ctx, exclude: number): number {
    let src = -1;
    let best = 1;
    for (let i = 0; i < s.size; i++) {
      if (s.owner[i] === this.pid && i !== exclude && s.army[i] > best) {
        best = s.army[i];
        src = i;
      }
    }
    return src;
  }

  private blocked({ s, me, k }: Ctx, i: number): boolean {
    if (me.memory[i] === Memory.Mountain) return true;
    return k.mine[i] === 1 && me.memory[i] !== Memory.Crater && s.owner[i] !== this.pid;
  }

  /** Dijkstra over the grid; unknown tiles cost extra in proportion to mine risk. */
  private paths(ctx: Ctx, src: number): { dist: Float32Array; prev: Int32Array } {
    const { s, vis, k } = ctx;
    const dist = new Float32Array(s.size).fill(Infinity);
    const prev = new Int32Array(s.size).fill(-1);
    const done = new Uint8Array(s.size);
    dist[src] = 0;
    for (;;) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < s.size; i++) {
        if (!done[i] && dist[i] < best) {
          best = dist[i];
          u = i;
        }
      }
      if (u < 0) break;
      done[u] = 1;
      for (const v of s.n4[u]) {
        if (done[v] || this.blocked(ctx, v)) continue;
        let cost = 1;
        if (s.owner[v] !== this.pid) {
          cost += k.prob[v] * this.p.riskWeight;
          if (vis[v]) cost += s.army[v] * 0.05;
        }
        if (dist[u] + cost < dist[v]) {
          dist[v] = dist[u] + cost;
          prev[v] = u;
        }
      }
    }
    return { dist, prev };
  }

  /** Troops left on arrival if we push the whole stack along this path. */
  private simulate({ s, me, vis, k }: Ctx, path: number[]): number {
    let carry = s.army[path[0]] - 1;
    for (let n = 1; n < path.length; n++) {
      const j = path[n];
      if (s.owner[j] === this.pid) {
        carry += s.army[j];
      } else {
        const m = me.memory[j];
        const remembered = m === Memory.City || m === Memory.General ? 45 : m === Memory.Tower ? 25 : 0;
        const defenders = vis[j] ? s.army[j] : remembered;
        carry -= defenders + k.prob[j] * MINE_DAMAGE;
        if (carry <= 0) return carry;
      }
      if (n < path.length - 1) carry -= 1;
    }
    return carry;
  }

  private value({ s, me, vis, k }: Ctx, t: number): number {
    const o = s.owner[t];
    if (o === this.pid) return 0;
    if (vis[t]) {
      if (o >= 0 && s.terrain[t] === Terrain.General) return 1000;
      if (o >= 0 && s.terrain[t] === Terrain.City) return 120;
      if (o >= 0) return 25;
      if (s.terrain[t] === Terrain.City) return 70;
      if (s.terrain[t] === Terrain.Tower) return this.p.towerValue;
    } else if (me.memory[t] === Memory.General) {
      return 300;
    }
    return (k.safe[t] ? 12 : 8) * (1 - k.prob[t]);
  }

  private bestTarget(ctx: Ctx, src: number): { path: number[]; value: number } | null {
    const { s } = ctx;
    const { dist, prev } = this.paths(ctx, src);
    let best: { path: number[]; value: number } | null = null;
    let bestScore = 0;
    for (let t = 0; t < s.size; t++) {
      if (t === src || !isFinite(dist[t]) || dist[t] > 30) continue;
      const value = this.value(ctx, t) * this.p.aggression;
      if (value <= 0) continue;
      const path = trace(prev, src, t);
      if (this.simulate(ctx, path) <= 0) continue;
      const score = (value / (dist[t] + 3)) * (1 + this.p.noise * this.rng());
      if (score > bestScore) {
        bestScore = score;
        best = { path, value };
      }
    }
    return best;
  }

  /** Cheap land grab: push a small stack onto a neighbouring empty tile we believe is safe. */
  private expand(ctx: Ctx): boolean {
    const { s, me, vis, k } = ctx;
    let best = -1;
    let bestFrom = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < s.size; i++) {
      if (s.owner[i] !== this.pid || s.army[i] < 2) continue;
      for (const v of s.n4[i]) {
        if (s.owner[v] >= 0 || !vis[v] || s.terrain[v] !== Terrain.Plain || s.army[v] > 0) continue;
        if (this.blocked(ctx, v) || k.prob[v] > this.p.expandRisk) continue;
        const score =
          (k.safe[v] ? 10 : 0) - k.prob[v] * 25 - (i === me.general ? 1 : 0) + this.p.noise * 4 * this.rng();
        if (score > bestScore) {
          bestScore = score;
          best = v;
          bestFrom = i;
        }
      }
    }
    if (best < 0) return false;
    queueMove(s, this.pid, bestFrom, best);
    return true;
  }

  /** Pull the biggest outside stack home if a visible enemy army threatens the general. */
  private defend(ctx: Ctx): boolean {
    const { s, me, vis } = ctx;
    const g = me.general;
    let threat = 0;
    for (let i = 0; i < s.size; i++) {
      if (vis[i] && s.owner[i] >= 0 && s.owner[i] !== this.pid && manhattan(s.w, i, g) <= 5) {
        threat = Math.max(threat, s.army[i]);
      }
    }
    if (threat < 6 || threat < s.army[g] - 1) return false;
    const src = this.biggestStack(ctx, g);
    if (src < 0 || s.army[src] < 3) return false;
    const { prev } = this.paths(ctx, src);
    if (prev[g] < 0) return false;
    this.queuePath(ctx, trace(prev, src, g));
    return true;
  }

  private queuePath({ s }: Ctx, path: number[]): void {
    for (let n = 0; n < Math.min(path.length - 1, 15); n++) queueMove(s, this.pid, path[n], path[n + 1]);
  }
}

function trace(prev: Int32Array, src: number, t: number): number[] {
  const path = [t];
  while (path[path.length - 1] !== src) path.push(prev[path[path.length - 1]]);
  return path.reverse();
}
