import { chebyshev, manhattan } from './grid';
import { TOWER_GARRISON } from './constants';
import { mulberry32, randInt, shuffle, type Rng } from './rng';
import { Terrain } from './types';

export interface MapOptions {
  w: number;
  h: number;
  seed: number;
  players: number;
  mineRate: number;
  mountainRate: number;
  cities: number;
  towers: number;
}

export interface GeneratedMap {
  terrain: Uint8Array;
  army: Int32Array;
  mine: Uint8Array;
  generals: number[];
}

export function generateMap(o: MapOptions): GeneratedMap {
  const rng = mulberry32(o.seed);
  for (let attempt = 0; attempt < 200; attempt++) {
    const map = tryGenerate(o, rng, attempt);
    if (map) return map;
  }
  throw new Error('Map generation failed');
}

function tryGenerate(o: MapOptions, rng: Rng, attempt: number): GeneratedMap | null {
  const { w, h } = o;
  const size = w * h;
  const terrain = new Uint8Array(size);
  const army = new Int32Array(size);
  const mine = new Uint8Array(size);
  /** Mountains and mines: tiles an army can't (or shouldn't have to) walk through. */
  const blocked = new Uint8Array(size);

  // Spread generals out by area per player; relax the requirement the longer we fail.
  const minDist = Math.max(4, Math.floor(Math.sqrt((w * h) / o.players) * 1.3 * (1 - attempt / 300)));
  const generals: number[] = [];
  for (let tries = 0; generals.length < o.players && tries < 500; tries++) {
    const c = randInt(rng, size);
    if (generals.every((g) => manhattan(w, g, c) >= minDist)) generals.push(c);
  }
  if (generals.length < o.players) return null;
  for (const g of generals) terrain[g] = Terrain.General;

  // Safe zone: the 3x3 around each general never holds a mountain or a mine.
  const nearGeneral = (i: number, d: number) => generals.some((g) => chebyshev(w, g, i) <= d);

  const fits = (i: number) => !blocksSquare(w, h, blocked, i) && allConnected(w, h, blocked, generals[0]);

  // Mountains, one at a time, keeping every open tile reachable.
  const mountainCandidates: number[] = [];
  for (let i = 0; i < size; i++) if (terrain[i] === Terrain.Plain && !nearGeneral(i, 1)) mountainCandidates.push(i);
  let mountains = Math.round(size * o.mountainRate);
  for (const i of shuffle(rng, mountainCandidates)) {
    if (mountains <= 0) break;
    blocked[i] = 1;
    if (fits(i)) {
      terrain[i] = Terrain.Mountain;
      mountains--;
    } else {
      blocked[i] = 0;
    }
  }

  // Watchtowers go where generals are about equally far away, so each one is contested.
  const towerCandidates: { i: number; score: number }[] = [];
  for (let i = 0; i < size; i++) {
    if (terrain[i] !== Terrain.Plain) continue;
    const d = generals.map((g) => manhattan(w, g, i));
    if (Math.min(...d) < 5) continue;
    towerCandidates.push({ i, score: Math.max(...d) - Math.min(...d) + rng() });
  }
  towerCandidates.sort((a, b) => a.score - b.score);
  const towers: number[] = [];
  for (const { i } of towerCandidates) {
    if (towers.length >= o.towers) break;
    if (towers.some((t) => manhattan(w, t, i) < 5)) continue;
    towers.push(i);
    terrain[i] = Terrain.Tower;
    army[i] = TOWER_GARRISON;
  }
  if (towers.length < o.towers) return null;

  const cityCandidates: number[] = [];
  for (let i = 0; i < size; i++) if (terrain[i] === Terrain.Plain && !nearGeneral(i, 3)) cityCandidates.push(i);
  for (const c of shuffle(rng, cityCandidates).slice(0, o.cities)) {
    terrain[c] = Terrain.City;
    army[c] = 40 + randInt(rng, 11);
  }

  // Mines under the same rules: never a sealed-off pocket, never a solid 2x2 of mines and mountains.
  const mineCandidates: number[] = [];
  for (let i = 0; i < size; i++) if (terrain[i] === Terrain.Plain && !nearGeneral(i, 1)) mineCandidates.push(i);
  let mines = Math.round(mineCandidates.length * o.mineRate);
  for (const i of shuffle(rng, mineCandidates)) {
    if (mines <= 0) break;
    blocked[i] = 1;
    if (fits(i)) {
      mine[i] = 1;
      mines--;
    } else {
      blocked[i] = 0;
    }
  }

  return { terrain, army, mine, generals };
}

/** True if tile i completes a 2x2 square in which every tile is blocked. */
export function blocksSquare(w: number, h: number, blocked: Uint8Array, i: number): boolean {
  const x = i % w;
  const y = Math.floor(i / w);
  for (const [ox, oy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
    const x0 = x + ox;
    const y0 = y + oy;
    if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) continue;
    const a = y0 * w + x0;
    if (blocked[a] && blocked[a + 1] && blocked[a + w] && blocked[a + w + 1]) return true;
  }
  return false;
}

/** Every unblocked tile is reachable from `start` without stepping on a blocked one. */
export function allConnected(w: number, h: number, blocked: Uint8Array, start: number): boolean {
  const size = w * h;
  let open = 0;
  for (let i = 0; i < size; i++) if (!blocked[i]) open++;
  const seen = new Uint8Array(size);
  const stack = [start];
  seen[start] = 1;
  let reached = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const j of next) {
      if (j < 0 || seen[j] || blocked[j]) continue;
      seen[j] = 1;
      reached++;
      stack.push(j);
    }
  }
  return reached === open;
}
