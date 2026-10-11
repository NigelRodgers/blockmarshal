import {
  DEFAULT_MINE_RATE,
  DEFAULT_MOUNTAIN_RATE,
  GENERAL_GROWTH_TICKS,
  LAND_GROWTH_TICKS,
  MINE_DAMAGE,
  MINE_STUN_TICKS,
  MAX_FLAGS,
  MAX_MINE_STOCK,
  START_MINE_STOCK,
  STOCK_REFILL_TICKS,
  CRATER_TICKS,
  PLAYER_COLORS,
  RELOCATE_COOLDOWN_TICKS,
  TOWER_RADIUS,
  TOWERS_PER_MATCH,
} from './constants';
import { buildNeighbors } from './grid';
import { generateMap, type GeneratedMap } from './mapgen';
import { Memory, Terrain, type GameState, type InputEvent, type Move, type PendingAction, type Player } from './types';

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
  /** See ModeConfig.spawnEdgeRows. */
  spawnEdgeRows?: number;
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
    towers: cfg.towers ?? TOWERS_PER_MATCH,
    spawnEdgeRows: cfg.spawnEdgeRows,
  });
  return buildState({ w, h, seed, players: cfg.players, mineRate }, map);
}

export interface StartOptions {
  /** Starting troops on each player's general (default 1). */
  generalArmy?: number[];
  /** Extra tiles player 0 starts with (1 troop each). */
  owned?: number[];
  /** Mines in each stock at the start (default START_MINE_STOCK). */
  stock?: number;
}

/** Turn a finished map (generated or hand-drawn) into a ready-to-play state. */
export function buildState(
  cfg: { w: number; h: number; seed: number; players: PlayerConfig[]; mineRate: number },
  map: GeneratedMap,
  opts: StartOptions = {},
): GameState {
  const { w, h, seed, mineRate } = cfg;
  const size = w * h;
  const { n4, n8 } = buildNeighbors(w, h);

  let mineCount = 0;
  for (let i = 0; i < size; i++) mineCount += map.mine[i];

  const players: Player[] = cfg.players.map((p, id) => ({
    id,
    name: p.name,
    isBot: p.isBot,
    color: PLAYER_COLORS[id % PLAYER_COLORS.length],
    alive: true,
    general: map.generals[id],
    queue: [],
    revealed: new Uint8Array(size),
    memory: new Uint8Array(size),
    eliminatedAt: -1,
    killedBy: -1,
    stunUntil: -1,
    minesLost: 0,
    flags: new Set<number>(),
    stock: Array.from({ length: opts.stock ?? START_MINE_STOCK }, () => ({ from: -1 })),
    refillAt: -1,
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
    crater: new Int32Array(size),
    moveReady: new Int32Array(size),
    mineOwner: new Int8Array(size).fill(-1),
    n4,
    n8,
    players,
    tick: 0,
    winner: -1,
    events: [],
    mineCount,
    mineRate,
    log: [],
    pending: [],
  };

  for (const p of players) {
    state.owner[p.general] = p.id;
    state.army[p.general] = opts.generalArmy?.[p.id] ?? 1;
    gainTile(state, p.id, p.general);
  }
  for (const i of opts.owned ?? []) {
    state.owner[i] = 0;
    state.army[i] = 1;
    gainTile(state, 0, i);
  }
  updateMemory(state);
  return state;
}

/** The player learns where the mines next to this tile are (shown as red dots). */
export function reveal(state: GameState, pid: number, idx: number): void {
  if (state.terrain[idx] === Terrain.Mountain || state.mine[idx]) return;
  state.players[pid].revealed[idx] = 1;
}

/**
 * A freshly planted mine (still on its RELOCATE_COOLDOWN_TICKS) is locked:
 * nobody can capture it, a flag doesn't help, it just goes off. Public: dots
 * toward a locked mine draw in a different colour for everyone.
 */
export function mineLocked(state: GameState, idx: number): boolean {
  return state.mine[idx] === 1 && state.mineOwner[idx] >= 0 && state.tick < state.moveReady[idx];
}

/** Like mineDots, but only the bits pointing at locked mines (see mineLocked). */
export function lockedDots(state: GameState, idx: number, exceptOwner = -2): number {
  return neighbourMask(state, idx, (j) => mineLocked(state, j) && state.mineOwner[j] !== exceptOwner);
}

/**
 * Directions of live mines around a tile, one bit per neighbour:
 * 0 top-left, 1 top, 2 top-right, 3 left, 4 right, 5 bottom-left, 6 bottom, 7 bottom-right.
 * Exploded mines are gone, so their dots disappear.
 */
export function mineDots(state: GameState, idx: number, exceptOwner = -2): number {
  return neighbourMask(state, idx, (j) => state.mine[j] === 1 && state.mineOwner[j] !== exceptOwner);
}

/** One bit per neighbour (mineDots order) for which `hit` is true. */
function neighbourMask(state: GameState, idx: number, hit: (j: number) => boolean): number {
  const x = idx % state.w;
  const y = Math.floor(idx / state.w);
  let mask = 0;
  let bit = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < state.w && ny < state.h && hit(ny * state.w + nx)) mask |= 1 << bit;
      bit++;
    }
  }
  return mask;
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

/** Flag or unflag a tile. Returns false if the player is already at MAX_FLAGS. */
export function toggleFlag(state: GameState, pid: number, idx: number): boolean {
  const p = state.players[pid];
  if (idx < 0 || idx >= state.size || state.terrain[idx] === Terrain.Mountain) return false;
  if (p.flags.delete(idx)) return true;
  // On your own land a flag only means something on your own planted mine (safe passage).
  if (state.owner[idx] === pid && !(state.mine[idx] && state.mineOwner[idx] === pid)) return false;
  if (p.flags.size >= MAX_FLAGS) return false;
  p.flags.add(idx);
  return true;
}

/**
 * Every tile of the player's land connected to idx through their own tiles
 * (sides only). Empty if idx isn't theirs. Generals, cities and mines can only
 * move within one of these stretches, never between separate islands.
 */
export function island(state: GameState, pid: number, idx: number): Uint8Array {
  const out = new Uint8Array(state.size);
  if (idx < 0 || idx >= state.size || state.owner[idx] !== pid) return out;
  const stack = [idx];
  out[idx] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    for (const j of state.n4[i]) {
      if (out[j] || state.owner[j] !== pid) continue;
      out[j] = 1;
      stack.push(j);
    }
  }
  return out;
}

/** Where a stocked mine may be planted: the land around the tile it came from, or the general's if that's lost. */
export function stockAnchor(state: GameState, pid: number, from: number): number {
  return from >= 0 && state.owner[from] === pid ? from : state.players[pid].general;
}

/** Index in the player's stock of a mine that may be planted at idx, or -1. */
export function plantableStock(state: GameState, pid: number, idx: number): number {
  const p = state.players[pid];
  if (!p.stock.length || idx < 0 || idx >= state.size) return -1;
  if (state.owner[idx] !== pid || state.terrain[idx] !== Terrain.Plain || state.mine[idx]) return -1;
  const land = island(state, pid, idx);
  return p.stock.findIndex((m) => land[stockAnchor(state, pid, m.from)] === 1);
}

/**
 * Plant a stocked mine on one of your own plain tiles, on the same stretch of
 * land it came from. Every planted mine is then held for RELOCATE_COOLDOWN_TICKS
 * before it can be picked up again.
 */
export function plantMine(state: GameState, pid: number, idx: number): boolean {
  const k = plantableStock(state, pid, idx);
  if (k < 0) return false;
  state.mine[idx] = 1;
  state.mineOwner[idx] = pid;
  state.mineCount++;
  state.players[pid].stock.splice(k, 1);
  state.moveReady[idx] = state.tick + RELOCATE_COOLDOWN_TICKS;
  return true;
}

/**
 * Move your general or one of your cities to another of your open tiles on the
 * same connected stretch of land. The new spot can't touch another general or
 * city, sides or corners. Troops stay where they are; only the building (and
 * its production) moves. It then can't move again for RELOCATE_COOLDOWN_TICKS.
 */
export function relocate(state: GameState, pid: number, from: number, to: number): boolean {
  if (!canRelocate(state, pid, from, to)) return false;
  state.terrain[to] = state.terrain[from];
  state.terrain[from] = Terrain.Plain;
  if (state.terrain[to] === Terrain.General) state.players[pid].general = to;
  state.moveReady[from] = 0;
  state.moveReady[to] = state.tick + RELOCATE_COOLDOWN_TICKS;
  return true;
}

export function canRelocate(state: GameState, pid: number, from: number, to: number, land?: Uint8Array): boolean {
  if (from === to || from < 0 || to < 0 || from >= state.size || to >= state.size) return false;
  const t = state.terrain[from];
  if (state.owner[from] !== pid || (t !== Terrain.General && t !== Terrain.City)) return false;
  if (state.tick < state.moveReady[from]) return false;
  if (state.owner[to] !== pid || state.terrain[to] !== Terrain.Plain || state.mine[to]) return false;
  if (state.n8[to].some((j) => j !== from && (state.terrain[j] === Terrain.General || state.terrain[j] === Terrain.City))) {
    return false;
  }
  return (land ?? island(state, pid, from))[to] === 1;
}

/** Take one of your planted mines back into stock, to plant again on the same stretch of land. */
export function pickUpMine(state: GameState, pid: number, idx: number): boolean {
  if (!canPickUpMine(state, pid, idx)) return false;
  state.mine[idx] = 0;
  state.mineOwner[idx] = -1;
  state.mineCount--;
  // Every flag on it comes back: the mine is gone from that tile.
  for (const pl of state.players) pl.flags.delete(idx);
  state.players[pid].stock.push({ from: idx });
  return true;
}

/**
 * Your own planted mine, on your land, while your stock has room. Any time otherwise:
 * the planting lock only stops enemies capturing it.
 */
export function canPickUpMine(state: GameState, pid: number, idx: number): boolean {
  if (idx < 0 || idx >= state.size || state.players[pid].stock.length >= MAX_MINE_STOCK) return false;
  return state.owner[idx] === pid && state.mine[idx] === 1 && state.mineOwner[idx] === pid;
}

/**
 * Schedule a general/city move or a mine planting to happen `delay` ticks from now
 * (bots use BOT_ACTION_DELAY_TICKS). Refused if it's illegal now or the same building
 * or tile already has an action waiting. The action is checked again when it's due.
 */
export function schedule(state: GameState, pid: number, kind: PendingAction['kind'], from: number, to: number, delay: number): boolean {
  if (state.pending.some((a) => a.pid === pid && (a.to === to || (kind === 'relocate' && a.from === from)))) return false;
  if (kind === 'relocate' ? !canRelocate(state, pid, from, to) : plantableStock(state, pid, to) < 0) return false;
  if (kind === 'plant' && pendingPlants(state, pid) >= state.players[pid].stock.length) return false;
  state.pending.push({ pid, kind, from: kind === 'plant' ? -1 : from, to, at: state.tick + delay });
  return true;
}

/** Plantings this player has waiting (each will use one stocked mine). */
export function pendingPlants(state: GameState, pid: number): number {
  return state.pending.filter((a) => a.pid === pid && a.kind === 'plant').length;
}

/** Carry out due actions that are still legal; drop the ones that were intercepted. */
function runPending(state: GameState): void {
  if (!state.pending.length) return;
  const later: PendingAction[] = [];
  for (const a of state.pending) {
    if (a.at > state.tick) later.push(a);
    else if (state.players[a.pid].alive) {
      if (a.kind === 'relocate') relocate(state, a.pid, a.from, a.to);
      else plantMine(state, a.pid, a.to);
    }
  }
  state.pending = later;
}

/** Apply a logged input during replay. Moves skip the log; other actions are re-logged and replay() resets the log. */
export function applyInput(state: GameState, ev: InputEvent): void {
  const p = state.players[ev.pid];
  if (ev.op === 'move') {
    if (state.n4[ev.from]?.includes(ev.to) && p.memory[ev.to] !== Memory.Mountain) {
      p.queue.push({ from: ev.from, to: ev.to, half: ev.half });
    }
  } else if (ev.op === 'undo') {
    p.queue.pop();
  } else if (ev.op === 'clear') {
    p.queue.length = 0;
  } else if (!p.alive) {
    // Actions from a player who is out do nothing (as live).
  } else if (ev.op === 'flag') {
    toggleFlag(state, ev.pid, ev.idx);
  } else if (ev.op === 'drop') {
    plantMine(state, ev.pid, ev.idx);
  } else if (ev.op === 'pickup') {
    pickUpMine(state, ev.pid, ev.idx);
  } else {
    relocate(state, ev.pid, ev.from, ev.to);
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
  // Delayed actions resolve after this tick's moves, so a capture or cut-off this tick stops them.
  runPending(state);

  if (state.tick % GENERAL_GROWTH_TICKS === 0) {
    for (let i = 0; i < state.size; i++) {
      const t = state.terrain[i];
      if (state.owner[i] >= 0 && (t === Terrain.General || t === Terrain.City)) state.army[i]++;
    }
  }
  if (state.tick % LAND_GROWTH_TICKS === 0) {
    for (let i = 0; i < state.size; i++) if (state.owner[i] >= 0) state.army[i]++;
  }

  refillStocks(state);
  expireCraters(state);
  updateMemory(state);
  // A one-player board (tutorial sandbox) never ends by elimination.
  const alive = state.players.filter((p) => p.alive);
  if (alive.length === 1 && state.players.length > 1) state.winner = alive[0].id;
}

/** A stock below full gains a mine every STOCK_REFILL_TICKS; the countdown pauses while it is full. */
function refillStocks(state: GameState): void {
  for (const p of state.players) {
    if (!p.alive || p.stock.length >= MAX_MINE_STOCK) {
      p.refillAt = -1;
      continue;
    }
    if (p.refillAt < 0) p.refillAt = state.tick + STOCK_REFILL_TICKS;
    else if (state.tick >= p.refillAt) {
      p.stock.push({ from: -1 });
      p.refillAt = p.stock.length < MAX_MINE_STOCK ? state.tick + STOCK_REFILL_TICKS : -1;
    }
  }
}

/** Blast marks fade back to ordinary tiles after CRATER_TICKS. */
function expireCraters(state: GameState): void {
  for (let i = 0; i < state.size; i++) {
    if (!state.crater[i] || state.tick < state.crater[i]) continue;
    state.crater[i] = 0;
    for (const p of state.players) if (p.memory[i] === Memory.Crater) p.memory[i] = Memory.None;
  }
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

/**
 * Stepping onto a mine:
 * - flagged by you and planted by you: pass over it, it stays armed;
 * - flagged by you otherwise: capture it into your stock, no blast, unless it's
 *   locked (freshly planted, see mineLocked): then it goes off anyway. With a full
 *   stock (MAX_MINE_STOCK) you cross it safely and it stays there, still flagged:
 *   step on it again once your stock has room to collect it;
 * - not flagged by you (including your own planted mines): it goes off.
 */
function arrive(state: GameState, p: Player, to: number, amount: number): void {
  const { owner, army } = state;
  if (state.mine[to]) {
    const flagged = p.flags.has(to);
    if (flagged && state.mineOwner[to] === p.id) {
      // Safe passage over your own flagged mine.
    } else if (flagged && !mineLocked(state, to)) {
      const kept = p.stock.length < MAX_MINE_STOCK;
      if (kept) {
        state.mine[to] = 0;
        state.mineOwner[to] = -1;
        state.mineCount--;
        for (const pl of state.players) pl.flags.delete(to);
        p.stock.push({ from: to });
      }
      state.events.push({ kind: 'defuse', idx: to, player: p.id, kept });
    } else {
      amount = detonate(state, to, p, amount);
      if (amount <= 0) return;
    }
  }
  if (owner[to] === p.id) {
    army[to] += amount;
    return;
  }
  if (amount > army[to]) {
    const prev = owner[to];
    army[to] = amount - army[to];
    owner[to] = p.id;
    gainTile(state, p.id, to);
    // You walked in safely, so there was no mine: your flag there is done. (A kept mine keeps it.)
    if (!state.mine[to]) p.flags.delete(to);
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
  state.mineOwner[idx] = -1;
  state.crater[idx] = state.tick + CRATER_TICKS;
  state.mineCount--;
  for (const pl of state.players) pl.flags.delete(idx);
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
    if (state.mineOwner[i] === victim) state.mineOwner[i] = by;
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
