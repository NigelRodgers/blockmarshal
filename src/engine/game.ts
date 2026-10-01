import {
  DEFAULT_MINE_RATE,
  DEFAULT_MOUNTAIN_RATE,
  GENERAL_GROWTH_TICKS,
  LAND_GROWTH_TICKS,
  MINE_DAMAGE,
  MINE_STUN_TICKS,
  PLAYER_COLORS,
  REVEAL_CASCADE,
  TOWER_RADIUS,
} from './constants';
import { buildNeighbors } from './grid';
import { generateMap } from './mapgen';
import { Memory, Terrain, type GameState, type InputEvent, type Move, type Player } from './types';

export interface PlayerConfig {
  name: string;
  isBot: boolean;
}

export interface GameConfig {
  w: number;
  h: number;
  seed: number;
  players: PlayerConfig[];
  mineRate?: number;
  mountainRate?: number;
  cities?: number;
  towers?: number;
}

export function createGame(cfg: GameConfig): GameState {
  const { w, h, seed } = cfg;
  const size = w * h;
  const mineRate = cfg.mineRate ?? DEFAULT_MINE_RATE;
  const map = generateMap({
    w,
    h,
    seed,
    players: cfg.players.length,
    mineRate,
    mountainRate: cfg.mountainRate ?? DEFAULT_MOUNTAIN_RATE,
    cities: cfg.cities ?? Math.round(size / 50),
    towers: cfg.towers ?? cfg.players.length,
  });
  const { n4, n8 } = buildNeighbors(w, h);

  const adj = new Uint8Array(size);
  let mineCount = 0;
  for (let i = 0; i < size; i++) {
    mineCount += map.mine[i];
    let c = 0;
    for (const j of n8[i]) c += map.mine[j];
    adj[i] = c;
  }

  const players: Player[] = cfg.players.map((p, id) => ({
    id,
    name: p.name,
    isBot: p.isBot,
    color: PLAYER_COLORS[id % PLAYER_COLORS.length],
    alive: true,
    general: map.generals[id],
    queue: [],
    revealed: new Uint8Array(size),
    flags: new Uint8Array(size),
    memory: new Uint8Array(size),
    eliminatedAt: -1,
    killedBy: -1,
    stunUntil: -1,
    minesLost: 0,
  }));

  const state: GameState = {
    w,
    h,
    size,
    seed,
    terrain: map.terrain,
    owner: new Int8Array(size).fill(-1),
    army: map.army,
    mine: map.mine,
    crater: new Uint8Array(size),
    adj,
    n4,
    n8,
    players,
    tick: 0,
    winner: -1,
    events: [],
    mineCount,
    mineRate,
    log: [],
  };

  for (const p of players) {
    state.owner[p.general] = p.id;
    state.army[p.general] = 1;
    gainTile(state, p.id, p.general);
  }
  updateMemory(state);
  return state;
}

/** Minesweeper-style reveal: learn this tile's number, cascading through zeros. */
export function reveal(state: GameState, pid: number, start: number): void {
  const p = state.players[pid];
  const queue: [number, number][] = [[start, 0]];
  for (let q = 0; q < queue.length; q++) {
    const [i, depth] = queue[q];
    if (p.revealed[i] || state.terrain[i] === Terrain.Mountain || state.mine[i]) continue;
    p.revealed[i] = 1;
    p.flags[i] = 0;
    if (state.adj[i] === 0 && depth < REVEAL_CASCADE) {
      for (const j of state.n8[i]) if (!p.revealed[j]) queue.push([j, depth + 1]);
    }
  }
}

/** Every tile within Chebyshev radius r of idx. */
function area(state: GameState, idx: number, r: number): number[] {
  const out: number[] = [];
  const cx = idx % state.w;
  const cy = Math.floor(idx / state.w);
  for (let y = Math.max(0, cy - r); y <= Math.min(state.h - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(state.w - 1, cx + r); x++) out.push(y * state.w + x);
  }
  return out;
}

/** A player takes a tile: learn its number, and a watchtower's whole area of numbers. */
function gainTile(state: GameState, pid: number, idx: number): void {
  reveal(state, pid, idx);
  if (state.terrain[idx] !== Terrain.Tower) return;
  const p = state.players[pid];
  for (const j of area(state, idx, TOWER_RADIUS)) {
    if (state.terrain[j] === Terrain.Mountain || state.mine[j]) continue;
    p.revealed[j] = 1;
    p.flags[j] = 0;
  }
}

export function visionFor(state: GameState, pid: number, out?: Uint8Array): Uint8Array {
  const v = out ?? new Uint8Array(state.size);
  v.fill(0);
  for (let i = 0; i < state.size; i++) {
    if (state.owner[i] !== pid) continue;
    v[i] = 1;
    for (const j of state.n8[i]) v[j] = 1;
    if (state.terrain[i] === Terrain.Tower) for (const j of area(state, i, TOWER_RADIUS)) v[j] = 1;
  }
  return v;
}

/** Upcoming ticks on which this player's moves will be skipped. */
export function stunTicksLeft(state: GameState, pid: number): number {
  return Math.max(0, state.players[pid].stunUntil - state.tick - 1);
}

function memoryOf(state: GameState, i: number): number {
  switch (state.terrain[i]) {
    case Terrain.Mountain:
      return Memory.Mountain;
    case Terrain.City:
      return Memory.City;
    case Terrain.General:
      return Memory.General;
    case Terrain.Tower:
      return Memory.Tower;
  }
  return state.crater[i] ? Memory.Crater : Memory.None;
}

function updateMemory(state: GameState): void {
  const v = new Uint8Array(state.size);
  for (const p of state.players) {
    if (!p.alive) continue;
    visionFor(state, p.id, v);
    for (let i = 0; i < state.size; i++) if (v[i]) p.memory[i] = memoryOf(state, i);
  }
}

export function queueMove(state: GameState, pid: number, from: number, to: number, half = false): boolean {
  const p = state.players[pid];
  if (!state.n4[from]?.includes(to)) return false;
  if (p.memory[to] === Memory.Mountain) return false;
  p.queue.push({ from, to, half });
  if (!p.isBot) state.log.push({ tick: state.tick, pid, op: 'move', from, to, half });
  return true;
}

export function undoMove(state: GameState, pid: number): Move | undefined {
  const p = state.players[pid];
  const m = p.queue.pop();
  if (m && !p.isBot) state.log.push({ tick: state.tick, pid, op: 'undo' });
  return m;
}

export function clearQueue(state: GameState, pid: number): void {
  const p = state.players[pid];
  if (!p.queue.length) return;
  p.queue.length = 0;
  if (!p.isBot) state.log.push({ tick: state.tick, pid, op: 'clear' });
}

/** Apply a logged input during replay, without re-logging it. */
export function applyInput(state: GameState, ev: InputEvent): void {
  const p = state.players[ev.pid];
  if (ev.op === 'move') {
    if (state.n4[ev.from]?.includes(ev.to) && p.memory[ev.to] !== Memory.Mountain) {
      p.queue.push({ from: ev.from, to: ev.to, half: ev.half });
    }
  } else if (ev.op === 'undo') {
    p.queue.pop();
  } else {
    p.queue.length = 0;
  }
}

export function step(state: GameState): void {
  if (state.winner >= 0) return;
  state.events = [];
  state.tick++;

  // Rotate who moves first each tick so no player gets a permanent tiebreak.
  const n = state.players.length;
  for (let k = 0; k < n; k++) {
    const p = state.players[(state.tick + k) % n];
    if (p.alive) executeNext(state, p);
  }

  if (state.tick % GENERAL_GROWTH_TICKS === 0) {
    for (let i = 0; i < state.size; i++) {
      const t = state.terrain[i];
      if (state.owner[i] >= 0 && (t === Terrain.General || t === Terrain.City)) state.army[i]++;
    }
  }
  if (state.tick % LAND_GROWTH_TICKS === 0) {
    for (let i = 0; i < state.size; i++) if (state.owner[i] >= 0) state.army[i]++;
  }

  updateMemory(state);
  const alive = state.players.filter((p) => p.alive);
  if (alive.length === 1) state.winner = alive[0].id;
}

function executeNext(state: GameState, p: Player): void {
  if (state.tick < p.stunUntil) return;
  while (p.queue.length) {
    const m = p.queue.shift()!;
    if (state.owner[m.from] !== p.id || state.army[m.from] <= 1) continue;
    if (state.terrain[m.to] === Terrain.Mountain || !state.n4[m.from].includes(m.to)) continue;
    const amount = m.half ? Math.floor(state.army[m.from] / 2) : state.army[m.from] - 1;
    if (amount <= 0) continue;
    state.army[m.from] -= amount;
    arrive(state, p, m.to, amount);
    return;
  }
}

function arrive(state: GameState, p: Player, to: number, amount: number): void {
  const { owner, army } = state;
  if (owner[to] === p.id) {
    army[to] += amount;
    return;
  }
  if (state.mine[to]) {
    amount = detonate(state, to, p, amount);
    if (amount <= 0) return;
  }
  if (amount > army[to]) {
    const prev = owner[to];
    army[to] = amount - army[to];
    owner[to] = p.id;
    gainTile(state, p.id, to);
    if (state.terrain[to] === Terrain.City) state.events.push({ kind: 'captureCity', idx: to, player: p.id });
    if (state.terrain[to] === Terrain.Tower) state.events.push({ kind: 'captureTower', idx: to, player: p.id });
    if (prev >= 0 && state.terrain[to] === Terrain.General) eliminate(state, prev, p.id, to);
  } else {
    army[to] -= amount;
  }
}

/**
 * Mine goes off: hits the arriving army, halves everything around it,
 * wipes the mover's queue and stuns them for MINE_STUN_TICKS.
 */
function detonate(state: GameState, idx: number, p: Player, amount: number): number {
  state.mine[idx] = 0;
  state.crater[idx] = 1;
  state.mineCount--;
  for (const pl of state.players) pl.flags[idx] = 0;
  for (const j of state.n8[idx]) {
    if (state.army[j] <= 0) continue;
    const halved = Math.floor(state.army[j] / 2);
    state.army[j] = state.owner[j] >= 0 ? Math.max(1, halved) : halved;
  }
  p.queue.length = 0;
  // Moves resume on tick (now + MINE_STUN_TICKS + 1), i.e. MINE_STUN_TICKS full ticks lost.
  p.stunUntil = state.tick + MINE_STUN_TICKS + 1;
  const lost = Math.min(amount, MINE_DAMAGE);
  p.minesLost += lost;
  state.events.push({ kind: 'explode', idx, player: p.id, lost });
  return amount - MINE_DAMAGE;
}

function eliminate(state: GameState, victim: number, by: number, generalIdx: number): void {
  const v = state.players[victim];
  v.alive = false;
  v.eliminatedAt = state.tick;
  v.killedBy = by;
  v.queue.length = 0;
  state.terrain[generalIdx] = Terrain.City;
  for (let i = 0; i < state.size; i++) {
    if (state.owner[i] !== victim) continue;
    state.owner[i] = by;
    state.army[i] = Math.ceil(state.army[i] / 2);
    gainTile(state, by, i);
  }
  state.events.push({ kind: 'eliminated', victim, by });
}

export function playerStats(state: GameState): { army: number; land: number }[] {
  const out = state.players.map(() => ({ army: 0, land: 0 }));
  for (let i = 0; i < state.size; i++) {
    const o = state.owner[i];
    if (o < 0) continue;
    out[o].army += state.army[i];
    out[o].land++;
  }
  return out;
}
