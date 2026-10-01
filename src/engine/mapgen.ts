import { chebyshev, manhattan } from './grid';
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

  for (let i = 0; i < size; i++) if (rng() < o.mountainRate) terrain[i] = Terrain.Mountain;

  // Spread generals out; relax the spacing requirement the longer we fail.
  const minDist = Math.max(4, Math.floor(((w + h) / (o.players > 2 ? 2.6 : 1.8)) * (1 - attempt / 300)));
  const generals: number[] = [];
  for (let tries = 0; generals.length < o.players && tries < 500; tries++) {
    const c = randInt(rng, size);
    if (generals.every((g) => manhattan(w, g, c) >= minDist)) generals.push(c);
  }
  if (generals.length < o.players) return null;

  // Safe zone: the 3x3 around each general has no mountains and (later) no mines,
  // like minesweeper's guaranteed-safe first click.
  for (const g of generals) {
    for (let i = 0; i < size; i++) if (chebyshev(w, g, i) <= 1) terrain[i] = Terrain.Plain;
    terrain[g] = Terrain.General;
  }

  const reach = flood(w, h, terrain, generals[0]);
  if (generals.some((g) => !reach[g])) return null;
  let reachable = 0;
  for (let i = 0; i < size; i++) {
    if (!reach[i]) terrain[i] = Terrain.Mountain;
    else reachable++;
  }
  if (reachable < size * 0.6) return null;

  const nearGeneral = (i: number, d: number) => generals.some((g) => chebyshev(w, g, i) <= d);

  const cityCandidates: number[] = [];
  for (let i = 0; i < size; i++) if (terrain[i] === Terrain.Plain && !nearGeneral(i, 3)) cityCandidates.push(i);
  for (const c of shuffle(rng, cityCandidates).slice(0, o.cities)) {
    terrain[c] = Terrain.City;
    army[c] = 40 + randInt(rng, 11);
  }

  const mineCandidates: number[] = [];
  for (let i = 0; i < size; i++) if (terrain[i] === Terrain.Plain && !nearGeneral(i, 1)) mineCandidates.push(i);
  const mineTotal = Math.round(mineCandidates.length * o.mineRate);
  for (const m of shuffle(rng, mineCandidates).slice(0, mineTotal)) mine[m] = 1;

  return { terrain, army, mine, generals };
}

function flood(w: number, h: number, terrain: Uint8Array, start: number): Uint8Array {
  const seen = new Uint8Array(w * h);
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const j of next) {
      if (j < 0 || seen[j] || terrain[j] === Terrain.Mountain) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return seen;
}
