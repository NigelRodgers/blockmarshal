import { BOT_ACTION_DELAY_TICKS, MAX_FLAGS, MINE_DAMAGE } from '../engine/constants';
import {
  canPickUpMine,
  canRelocate,
  island,
  mineLocked,
  pendingPlants,
  pickUpMine,
  plantableStock,
  queueMove,
  schedule,
  toggleFlag,
  visionFor,
} from '../engine/game';
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
  /** Moves its general and cities away once an enemy has seen them. */
  hides: boolean;
  /** Flags and captures mines, then plants them as traps. */
  usesMines: boolean;
}

/** Furthest target a bot plans toward, in tiles. */
const MAX_PATH_STEPS = 30;

/** Extra path cost for walking through a known mine (on top of the risk weight). */
const MINE_PATH_COST = 25;

/** A bot that gains no land for this many ticks (with troops to spare) stops avoiding mines. */
const STALL_TICKS = 40;
const STALL_MIN_ARMY = 20;

/** Planted mines a bot keeps around its general for defence. */
const DEFENCE_MINES = 3;

/** A planted mine with no visible enemy within this many steps is idle and may be moved to a front. */
const IDLE_MINE_DISTANCE = 6;

/** Worth of capturing a mine the bot has flagged. */
const FLAGGED_MINE_VALUE = 15;

const PROFILES: Record<Difficulty, Profile> = {
  easy: { thinkEvery: 3, readsDots: false, riskWeight: 3, aggression: 0.6, defend: false, noise: 0.6, expandRisk: 0.5, towerValue: 0, hides: false, usesMines: false },
  normal: { thinkEvery: 1, readsDots: true, riskWeight: 10, aggression: 1.4, defend: true, noise: 0.25, expandRisk: 0.3, towerValue: 70, hides: true, usesMines: true },
  hard: { thinkEvery: 1, readsDots: true, riskWeight: 16, aggression: 2, defend: true, noise: 0.08, expandRisk: 0.2, towerValue: 70, hides: true, usesMines: true },
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
  private land = 0;
  private lastGain = 0;
  /** Set when the bot has been stuck: plans ignore mine costs until it gains ground again. */
  private reckless = false;
  /** Our general/cities an enemy has had in view since they last moved. */
  private readonly exposed = new Set<number>();

  constructor(
    readonly pid: number,
    difficulty: Difficulty,
    private readonly rng: Rng,
  ) {
    this.p = PROFILES[difficulty];
  }

  think(s: GameState): void {
    const me = s.players[this.pid];
    if (!me.alive || s.tick % this.p.thinkEvery) return;
    const busy = me.queue.length > 0;
    // Hiding and mine work don't use the move queue, so they run even mid-plan.
    if (busy && !this.p.hides && !this.p.usesMines) return;
    const ctx: Ctx = { s, me, vis: visionFor(s, this.pid), k: analyze(s, this.pid, this.p.readsDots) };
    if (this.p.hides) this.hide(ctx);
    if (this.p.usesMines) this.handleMines(ctx, busy);
    if (busy) return;
    this.trackProgress(s);

    if (this.p.defend && this.defend(ctx)) return;

    const src = this.biggestStack(ctx, -1);
    if (src < 0) return;
    const plan = this.bestTarget(ctx, src);
    if (plan && (plan.value >= 35 || s.army[src] >= 10)) return this.queuePath(ctx, plan.path);
    if (this.expand(ctx)) return;
    if (plan) this.queuePath(ctx, plan.path);
  }

  /** Notice when the bot stops gaining ground despite having troops: it's boxed in or blocked. */
  private trackProgress(s: GameState): void {
    let land = 0;
    let army = 0;
    for (let i = 0; i < s.size; i++) {
      if (s.owner[i] !== this.pid) continue;
      land++;
      army = Math.max(army, s.army[i]);
    }
    if (land > this.land) {
      this.lastGain = s.tick;
      this.reckless = false;
    } else if (s.tick - this.lastGain > STALL_TICKS && army >= STALL_MIN_ARMY) {
      this.reckless = true;
    }
    this.land = land;
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

  /** Only mountains are walls. Known mines are passable at a price (see paths). */
  private blocked({ me }: Ctx, i: number): boolean {
    return me.memory[i] === Memory.Mountain;
  }

  private knownMine({ s, me, k }: Ctx, i: number): boolean {
    return k.mine[i] === 1 && me.memory[i] !== Memory.Crater && s.owner[i] !== this.pid;
  }

  /** A mine we planted (we always know where those are). */
  private ownMine({ s }: Ctx, i: number): boolean {
    return s.mine[i] === 1 && s.mineOwner[i] === this.pid;
  }

  /** Stepping here sets off a mine we know about (a flagged mine is captured or crossed safely instead). */
  private trap(ctx: Ctx, i: number): boolean {
    if (this.ownMine(ctx, i)) return !ctx.me.flags.has(i);
    // A locked mine (freshly planted, shown by its dot colour) goes off even when flagged.
    return this.knownMine(ctx, i) && (!ctx.me.flags.has(i) || mineLocked(ctx.s, i));
  }

  /** A known enemy or natural mine we've flagged: walking onto it banks it. */
  private prize(ctx: Ctx, i: number): boolean {
    return ctx.me.flags.has(i) && this.knownMine(ctx, i) && !this.ownMine(ctx, i) && !mineLocked(ctx.s, i);
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
          if (!this.prize(ctx, v)) cost += k.prob[v] * this.p.riskWeight;
          if (vis[v]) cost += s.army[v] * 0.05;
        }
        // Blasting through costs troops and a stun: only worth it when there's no way around,
        // e.g. boxed in by mines or a general walled off behind them. Our own traps count too.
        if (this.trap(ctx, v)) cost += this.reckless && !this.ownMine(ctx, v) ? 2 : MINE_PATH_COST;
        if (dist[u] + cost < dist[v]) {
          dist[v] = dist[u] + cost;
          prev[v] = u;
        }
      }
    }
    return { dist, prev };
  }

  /** Troops left on arrival if we push the whole stack along this path. */
  private simulate(ctx: Ctx, path: number[]): number {
    const { s, me, vis, k } = ctx;
    let carry = s.army[path[0]] - 1;
    for (let n = 1; n < path.length; n++) {
      const j = path[n];
      const blast = this.trap(ctx, j) ? MINE_DAMAGE : this.prize(ctx, j) ? 0 : k.prob[j] * MINE_DAMAGE;
      if (s.owner[j] === this.pid) {
        carry += s.army[j] - blast;
      } else {
        const m = me.memory[j];
        const remembered = m === Memory.City || m === Memory.General ? 45 : m === Memory.Tower ? 25 : 0;
        const defenders = vis[j] ? s.army[j] : remembered;
        carry -= defenders + blast;
        if (carry <= 0) return carry;
      }
      if (n < path.length - 1) carry -= 1;
    }
    return carry;
  }

  private value(ctx: Ctx, t: number): number {
    const { s, me, vis, k } = ctx;
    const o = s.owner[t];
    if (o === this.pid) return 0;
    const bonus = this.prize(ctx, t) ? FLAGGED_MINE_VALUE : 0;
    if (vis[t]) {
      if (o >= 0 && s.terrain[t] === Terrain.General) return 1000;
      if (o >= 0 && s.terrain[t] === Terrain.City) return 160 + bonus;
      if (o >= 0) return 40 + bonus;
      if (s.terrain[t] === Terrain.City) return 70;
      if (s.terrain[t] === Terrain.Tower) return this.p.towerValue;
    } else if (me.memory[t] === Memory.General) {
      return 500;
    }
    if (bonus) return bonus;
    return (k.safe[t] ? 12 : 8) * (1 - k.prob[t]);
  }

  private bestTarget(ctx: Ctx, src: number): { path: number[]; value: number } | null {
    const { s } = ctx;
    const { dist, prev } = this.paths(ctx, src);
    let best: { path: number[]; value: number } | null = null;
    let bestScore = 0;
    for (let t = 0; t < s.size; t++) {
      if (t === src || !isFinite(dist[t])) continue;
      const value = this.value(ctx, t) * this.p.aggression;
      if (value <= 0) continue;
      const path = trace(prev, src, t);
      // Limit by distance walked, not path cost, so a route through a mine still counts.
      if (path.length > MAX_PATH_STEPS) continue;
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

  /** Visible tiles held by other players. */
  private enemyTiles({ s, vis }: Ctx): number[] {
    const out: number[] = [];
    for (let i = 0; i < s.size; i++) if (vis[i] && s.owner[i] >= 0 && s.owner[i] !== this.pid) out.push(i);
    return out;
  }

  /** An enemy can see tile t right now (they hold one of its 8 neighbours). */
  private seenByEnemy({ s, vis }: Ctx, t: number): boolean {
    return s.n8[t].some((j) => vis[j] && s.owner[j] >= 0 && s.owner[j] !== this.pid);
  }

  /**
   * Once an enemy has had our general or a city in view, move it somewhere they
   * haven't seen, away from their land, on the same stretch of our land.
   * The enemy keeps hunting the old spot; the troops left there still guard it.
   */
  private hide(ctx: Ctx): void {
    const { s, me } = ctx;
    const isBuilding = (b: number) =>
      s.owner[b] === this.pid && (s.terrain[b] === Terrain.General || s.terrain[b] === Terrain.City);
    for (const b of [...this.exposed]) if (!isBuilding(b)) this.exposed.delete(b);
    for (let b = 0; b < s.size; b++) if (isBuilding(b) && this.seenByEnemy(ctx, b)) this.exposed.add(b);
    if (!this.exposed.size) return;
    const enemies = this.enemyTiles(ctx);
    if (!enemies.length) return;

    // The general first; a city only when an enemy army nearby could take it.
    const order = [...this.exposed].sort((a, b) => Number(b === me.general) - Number(a === me.general));
    for (const b of order) {
      if (s.tick < s.moveReady[b]) continue; // moved recently: the 100-turn cooldown holds it
      if (s.pending.some((a) => a.pid === this.pid && a.from === b)) continue; // already on its way
      if (b !== me.general && !enemies.some((e) => manhattan(s.w, e, b) <= 4 && s.army[e] >= s.army[b])) continue;
      const land = island(s, this.pid, b);
      let best = -1;
      let bestScore = -Infinity;
      for (let t = 0; t < s.size; t++) {
        if (!land[t] || manhattan(s.w, b, t) < 3 || this.ownMine(ctx, t) || this.seenByEnemy(ctx, t)) continue;
        if (!canRelocate(s, this.pid, b, t, land)) continue;
        let near = Infinity;
        for (const e of enemies) near = Math.min(near, manhattan(s.w, e, t));
        if (near < 3) continue;
        const score = Math.min(near, 12) * 3 + manhattan(s.w, b, t) * 0.5 + Math.min(s.army[t], 40) * 0.1;
        if (score > bestScore) {
          bestScore = score;
          best = t;
        }
      }
      // Like a human picking a spot, the move lands 3 turns later, and only if still legal then.
      if (best < 0 || !schedule(s, this.pid, 'relocate', b, best, BOT_ACTION_DELAY_TICKS)) continue;
      // One move per tick; the engine's cooldown then pins that building for 100 turns.
      this.exposed.delete(b);
      return;
    }
  }

  /** Flag mines on our border to capture them; plant what we've captured as traps. */
  private handleMines(ctx: Ctx, busy: boolean): void {
    const { s, me, k } = ctx;
    // Drop flags on mines that are gone (someone else took or tripped them).
    for (const f of [...me.flags]) if (!k.mine[f] || me.memory[f] === Memory.Crater) toggleFlag(s, this.pid, f);
    // Flag known mines next to our land: paths then walk onto them to bank them. Like a human,
    // only between plans: an army already marching doesn't react to a mine it just uncovered.
    for (let i = 0; i < s.size && !busy && me.flags.size < MAX_FLAGS; i++) {
      if (me.flags.has(i) || !this.knownMine(ctx, i) || this.ownMine(ctx, i) || mineLocked(s, i)) continue;
      if (s.n4[i].some((j) => s.owner[j] === this.pid)) toggleFlag(s, this.pid, i);
    }

    if (me.stock.length > pendingPlants(s, this.pid)) {
      // Planting lands 3 turns later (like a human's long-press), if the tile is still ours then.
      const t = this.trapSpot(ctx);
      if (t >= 0) schedule(s, this.pid, 'plant', -1, t, BOT_ACTION_DELAY_TICKS);
      return;
    }
    if (me.stock.length) return; // everything in stock is already being planted
    // Nothing in stock: every so often, bring an idle mine from a quiet corner to a front with an enemy.
    if (s.tick % 10 || this.trapSpot(ctx, true) < 0) return;
    const g = me.general;
    const enemies = this.enemyTiles(ctx);
    for (let i = 0; i < s.size; i++) {
      if (!this.ownMine(ctx, i) || !canPickUpMine(s, this.pid, i) || manhattan(s.w, i, g) <= 3) continue;
      if (enemies.some((e) => manhattan(s.w, e, i) <= IDLE_MINE_DISTANCE)) continue;
      if (pickUpMine(s, this.pid, i)) return;
    }
  }

  /**
   * Best own tile for a trap. Ambush traps go one row behind our border with an
   * enemy: out of reach of their dots (they only see dots on tiles they've held),
   * but on the tiles they take next. Defence traps ring the general two or three
   * steps out, on the side enemies come from. Never beside our own general or
   * cities, so our troops can still get in. `frontOnly` asks whether any ambush
   * spot exists at all.
   */
  private trapSpot(ctx: Ctx, frontOnly = false): number {
    const { s, me, vis } = ctx;
    const g = me.general;
    let defending = 0;
    let nearestEnemy = -1;
    let nearestD = Infinity;
    for (let i = 0; i < s.size; i++) {
      if (this.ownMine(ctx, i) && manhattan(s.w, i, g) <= 3) defending++;
      if (vis[i] && s.owner[i] >= 0 && s.owner[i] !== this.pid) {
        const d = manhattan(s.w, i, g);
        if (d < nearestD) {
          nearestD = d;
          nearestEnemy = i;
        }
      }
    }
    // Our queued moves would walk into a trap planted on their path.
    const route = new Set(me.queue.map((m) => m.to));
    for (const a of s.pending) if (a.pid === this.pid) route.add(a.to); // tiles already spoken for
    let best = -1;
    let bestScore = 0;
    for (let t = 0; t < s.size; t++) {
      if (s.owner[t] !== this.pid || s.terrain[t] !== Terrain.Plain || s.mine[t] || s.army[t] > 3 || route.has(t)) continue;
      if (s.n4[t].some((j) => s.owner[j] === this.pid && (s.terrain[j] === Terrain.General || s.terrain[j] === Terrain.City))) {
        continue;
      }
      if (!frontOnly && plantableStock(s, this.pid, t) < 0) continue;
      let score = 0;
      if (!this.seenByEnemy(ctx, t) && s.n8[t].some((j) => s.owner[j] === this.pid && this.seenByEnemy(ctx, j))) score += 10;
      if (!frontOnly) {
        const d = manhattan(s.w, t, g);
        if (d >= 2 && d <= 3 && defending < DEFENCE_MINES) {
          score += 6;
          if (nearestEnemy >= 0 && manhattan(s.w, t, nearestEnemy) < nearestD) score += 4;
        }
      }
      // Don't wall ourselves in.
      for (const j of s.n4[t]) if (this.ownMine(ctx, j)) score -= 5;
      if (score <= 0) continue;
      score += this.rng() * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return frontOnly && bestScore < 10 ? -1 : best;
  }

  private queuePath(ctx: Ctx, path: number[]): void {
    const { s, me } = ctx;
    for (let n = 0; n < Math.min(path.length - 1, 15); n++) {
      const to = path[n + 1];
      // Our own mine in the way: lift it (back to stock to plant again), or flag it for safe
      // passage while it's on its move cooldown. If neither works, stop short of it.
      if (this.ownMine(ctx, to) && !me.flags.has(to) && !pickUpMine(s, this.pid, to) && !toggleFlag(s, this.pid, to)) return;
      queueMove(s, this.pid, path[n], to);
    }
  }
}

function trace(prev: Int32Array, src: number, t: number): number[] {
  const path = [t];
  while (path[path.length - 1] !== src) path.push(prev[path[path.length - 1]]);
  return path.reverse();
}
