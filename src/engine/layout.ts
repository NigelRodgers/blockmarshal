import { buildState, type PlayerConfig } from './game';
import { Terrain, type GameState } from './types';

/**
 * Hand-drawn boards (tutorial levels, puzzles). One character per tile:
 *   .  plain        #  mountain     *  hidden mine
 *   G  your general E  enemy general
 *   C  city         T  watchtower   o  plain you already own
 *   @  plain marked as a goal
 */
export interface LayoutOptions {
  players: PlayerConfig[];
  generalArmy?: number[];
  cityGarrison?: number;
  towerGarrison?: number;
  /** Mines in each stock at the start. Default 0: hand-drawn boards test one rule at a time. */
  stock?: number;
}

export interface LayoutGame {
  state: GameState;
  /** Tiles drawn as '@', in reading order. */
  goals: number[];
  /** Tiles drawn as '*', in reading order. */
  mines: number[];
}

export function createFromLayout(rows: string[], opts: LayoutOptions): LayoutGame {
  const h = rows.length;
  const w = rows[0].length;
  if (rows.some((r) => r.length !== w)) throw new Error('Layout rows must be the same width');
  const size = w * h;
  const terrain = new Uint8Array(size);
  const army = new Int32Array(size);
  const mine = new Uint8Array(size);
  const generals: number[] = [];
  const owned: number[] = [];
  const goals: number[] = [];
  const mines: number[] = [];
  let plains = 0;

  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const i = y * w + x;
      switch (ch) {
        case '#':
          terrain[i] = Terrain.Mountain;
          return;
        case '*':
          mine[i] = 1;
          mines.push(i);
          break;
        case 'G':
          terrain[i] = Terrain.General;
          generals[0] = i;
          return;
        case 'E':
          terrain[i] = Terrain.General;
          generals[1] = i;
          return;
        case 'C':
          terrain[i] = Terrain.City;
          army[i] = opts.cityGarrison ?? 40;
          return;
        case 'T':
          terrain[i] = Terrain.Tower;
          army[i] = opts.towerGarrison ?? 25;
          return;
        case 'o':
          owned.push(i);
          break;
        case '@':
          goals.push(i);
          break;
        case '.':
          break;
        default:
          throw new Error(`Unknown layout character '${ch}'`);
      }
      plains++;
    });
  });

  if (generals.length !== opts.players.length || generals.some((g) => g === undefined)) {
    throw new Error('Layout needs one general per player');
  }
  const state = buildState(
    { w, h, seed: 0, players: opts.players, mineRate: plains ? mines.length / plains : 0 },
    { terrain, army, mine, generals },
    { generalArmy: opts.generalArmy, owned, stock: opts.stock ?? 0 },
  );
  return { state, goals, mines };
}
