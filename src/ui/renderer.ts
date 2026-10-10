import { CRATER_TICKS, TOWER_RADIUS } from '../engine/constants';
import { Terrain, type Move } from '../engine/types';
import type { PlayerView } from '../net/protocol';
import type { Effects } from './effects';

export interface Board {
  w: number;
  h: number;
}

/** Client-only state layered on the server's view. */
export interface DrawOptions {
  selected: number;
  half: boolean;
  /** Moves sent but not yet echoed back by the server. */
  pending: Move[];
  fx: Effects;
  /** Tiles to highlight as valid destinations (moving a general or city). */
  targets?: number[];
  /** No shaking or pulsing (prefers-reduced-motion). */
  calm?: boolean;
}

const C = {
  bg: '#12151b',
  frame: '#0b0d11',
  plain: '#c9d0d9',
  fog: '#3a4049',
  fogKnown: '#4a515b',
  mountain: '#2f343c',
  mountainPeak: '#8d96a3',
  neutralCity: '#7c818a',
  neutralTower: '#4f7a82',
  dot: '#ff2d2d',
  /** Dots toward a locked mine (freshly planted, can't be captured): white, so they differ in lightness too. */
  dotLocked: '#ffffff',
  dotEdge: '#0b0d11',
  darkText: '#111418',
};

/** Relative luminance (WCAG) of a #rrggbb colour. */
const lumCache = new Map<string, number>();
function luminance(hex: string): number {
  let l = lumCache.get(hex);
  if (l === undefined) {
    const ch = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);
    const [r, g, b] = ch.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lumCache.set(hex, l);
  }
  return l;
}

/** Above this tile luminance, dark text contrasts better than white (the two ratios cross at ~0.19). */
const DARK_TEXT_ABOVE = 0.19;

/** Dot positions in tile units, matching the mineDots bit order. */
const DOT_OFFSETS: [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

export function formatArmy(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  cam = { x: 0, y: 0, scale: 32 };
  vw = 0;
  vh = 0;
  insetTop = 0;
  insetBottom = 0;
  private dpr = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.vw = window.innerWidth;
    this.vh = window.innerHeight;
    this.canvas.width = Math.round(this.vw * this.dpr);
    this.canvas.height = Math.round(this.vh * this.dpr);
    this.canvas.style.width = `${this.vw}px`;
    this.canvas.style.height = `${this.vh}px`;
  }

  /** Scale the whole board to the largest square tiles that fit between the HUD bars. */
  fit(b: Board): void {
    // A page opened in the background can report a 0x0 window until it's shown: measure again.
    if (!this.vw || !this.vh) this.resize();
    const availW = this.vw - 6;
    const availH = this.vh - this.insetTop - this.insetBottom - 6;
    this.cam.scale = Math.max(4, Math.min(availW / b.w, availH / b.h, 96));
    const centerY = (this.insetTop + this.vh - this.insetBottom) / 2;
    this.cam.x = b.w / 2;
    this.cam.y = b.h / 2 - (centerY - this.vh / 2) / this.cam.scale;
  }

  screenToTile(b: Board, sx: number, sy: number): number {
    const wx = Math.floor((sx - this.vw / 2) / this.cam.scale + this.cam.x);
    const wy = Math.floor((sy - this.vh / 2) / this.cam.scale + this.cam.y);
    if (wx < 0 || wy < 0 || wx >= b.w || wy >= b.h) return -1;
    return wy * b.w + wx;
  }

  toScreen = (wx: number, wy: number): [number, number] => [
    (wx - this.cam.x) * this.cam.scale + this.vw / 2,
    (wy - this.cam.y) * this.cam.scale + this.vh / 2,
  ];

  draw(v: PlayerView, o: DrawOptions): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, this.vw, this.vh);
    const [ox, oy] = o.calm ? [0, 0] : o.fx.shakeOffset(this.cam.scale);
    ctx.translate(ox, oy);

    const s = this.cam.scale;
    const x0 = Math.max(0, Math.floor(this.cam.x - this.vw / 2 / s) - 1);
    const x1 = Math.min(v.w - 1, Math.ceil(this.cam.x + this.vw / 2 / s));
    const y0 = Math.max(0, Math.floor(this.cam.y - this.vh / 2 / s) - 1);
    const y1 = Math.min(v.h - 1, Math.ceil(this.cam.y + this.vh / 2 / s));

    const [bx, by] = this.toScreen(0, 0);
    ctx.fillStyle = C.frame;
    ctx.fillRect(bx - 3, by - 3, v.w * s + 6, v.h * s + 6);

    const mines = v.mines ? new Set(v.mines) : null;
    const flags = new Set(v.flags);
    const myMines = new Set(v.myMines);
    const kept = new Set(v.keptMines);
    const cooling = new Set(v.moveCooldowns.map((c) => c.idx));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const [sx, sy] = this.toScreen(x, y);
        this.drawTile(v, y * v.w + x, sx, sy, s, mines, flags, myMines, cooling, kept);
      }
    }

    if (o.targets?.length) this.drawTargets(v, o.targets, s, !!o.calm);
    this.drawQueue(v, [...v.queue, ...o.pending], s);

    if (o.selected >= 0 && v.owner[o.selected] === v.you) {
      const [sx, sy] = this.toScreen(o.selected % v.w, Math.floor(o.selected / v.w));
      if (v.terrain[o.selected] === Terrain.Tower) this.towerArea(v, o.selected);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, s * 0.09);
      ctx.strokeRect(sx + ctx.lineWidth / 2, sy + ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth);
      if (o.half) {
        ctx.fillStyle = '#fff';
        ctx.font = `700 ${Math.max(8, s * 0.22)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('50%', sx + s / 2, sy + s * 0.08);
      }
    }

    o.fx.draw(ctx, this.toScreen, s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawTile(
    v: PlayerView,
    i: number,
    x: number,
    y: number,
    s: number,
    mines: Set<number> | null,
    flags: Set<number>,
    myMines: Set<number>,
    cooling: Set<number>,
    kept: Set<number>,
  ): void {
    const t = v.terrain[i];
    const own = v.owner[i];
    const seen = v.visible[i] === 1;
    const g = Math.max(1, s * 0.05);

    let tile = C.fog;
    if (t === -1) {
      this.flat(x, y, s, g, C.fog);
    } else if (t === Terrain.Mountain) {
      this.mountain(x, y, s, g, !seen);
    } else if (own >= 0) {
      tile = v.players[own].color;
      this.flat(x, y, s, g, tile);
      this.icon(t, x, y, s, 1);
    } else if (!seen) {
      tile = C.fogKnown;
      this.flat(x, y, s, g, tile);
      this.icon(t, x, y, s, 0.45);
    } else {
      tile = t === Terrain.City ? C.neutralCity : t === Terrain.Tower ? C.neutralTower : C.plain;
      this.flat(x, y, s, g, tile);
      this.icon(t, x, y, s, 0.9);
    }

    // Blast marks are public and fade out over CRATER_TICKS.
    if (v.crater[i]) this.crater(x, y, s, 0.2 + 0.7 * Math.min(1, v.crater[i] / CRATER_TICKS));
    // Your own mine turns grey once you've flagged it (safe for you to cross),
    // and wears a white ring while it's locked (on its cooldown: can't be captured or picked up).
    // A mine you crossed with a full stock: grey (safe for you), with your flag since it isn't yours.
    if (mines?.has(i) || myMines.has(i) || kept.has(i)) {
      this.mineIcon(x, y, s, kept.has(i) || (myMines.has(i) && flags.has(i)), myMines.has(i) && cooling.has(i));
    }
    const structure = t === Terrain.General || t === Terrain.City || t === Terrain.Tower;
    if (seen && v.army[i] > 0) this.army(x, y, s, v.army[i], structure, tile);
    if (v.dots[i]) this.dots(x, y, s, v.dots[i], v.lockedDots[i]);
    if (flags.has(i) && !v.crater[i] && !myMines.has(i)) this.flag(x, y, s, own >= 0);
  }

  /**
   * Dots on the tile's edge, pointing at each neighbouring mine: red, or white for a
   * locked mine (freshly planted, can't be captured). A solid dark rim keeps them
   * readable on every tile colour, whatever the viewer's colour vision.
   */
  private dots(x: number, y: number, s: number, mask: number, locked: number): void {
    const { ctx } = this;
    const r = Math.max(2.5, s * 0.09);
    const reach = s * 0.5 - r - Math.max(1, s * 0.05);
    ctx.strokeStyle = C.dotEdge;
    ctx.lineWidth = Math.max(1.2, s * 0.035);
    for (let bit = 0; bit < 8; bit++) {
      if (!(mask & (1 << bit))) continue;
      const [dx, dy] = DOT_OFFSETS[bit];
      ctx.fillStyle = locked & (1 << bit) ? C.dotLocked : C.dot;
      ctx.beginPath();
      ctx.arc(x + s / 2 + dx * reach, y + s / 2 + dy * reach, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /**
   * Structure icons sit in a band at the top of the tile, troops below.
   * General: gold crown + gold border. City: white buildings. Tower: eye.
   */
  private icon(t: number, x: number, y: number, s: number, alpha: number): void {
    const cx = x + s / 2;
    const top = y + s * 0.08;
    const h = s * 0.34;
    if (t === Terrain.General) {
      this.generalBorder(x, y, s, alpha);
      this.crown(cx, top, h, alpha);
    } else if (t === Terrain.City) {
      this.buildings(cx, top, h, alpha);
    } else if (t === Terrain.Tower) {
      this.eye(cx, top + h / 2, h, alpha);
    }
  }

  private flat(x: number, y: number, s: number, g: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x + g / 2, y + g / 2, s - g, s - g);
  }

  private mountain(x: number, y: number, s: number, g: number, fog: boolean): void {
    const { ctx } = this;
    this.flat(x, y, s, g, fog ? '#22262c' : C.mountain);
    ctx.fillStyle = fog ? '#4a515b' : C.mountainPeak;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.12, y + s * 0.82);
    ctx.lineTo(x + s * 0.42, y + s * 0.28);
    ctx.lineTo(x + s * 0.58, y + s * 0.52);
    ctx.lineTo(x + s * 0.68, y + s * 0.38);
    ctx.lineTo(x + s * 0.9, y + s * 0.82);
    ctx.closePath();
    ctx.fill();
  }

  private generalBorder(x: number, y: number, s: number, alpha: number): void {
    const { ctx } = this;
    const lw = Math.max(1.5, s * 0.07);
    ctx.strokeStyle = `rgba(255,213,79,${alpha})`;
    ctx.lineWidth = lw;
    ctx.strokeRect(x + lw, y + lw, s - lw * 2, s - lw * 2);
  }

  /** Gold three-point crown, h tall, top edge at `top`. */
  private crown(cx: number, top: number, h: number, alpha: number): void {
    const { ctx } = this;
    const w = h * 1.5;
    const l = cx - w / 2;
    const b = top + h;
    ctx.beginPath();
    ctx.moveTo(l, b);
    ctx.lineTo(l, top + h * 0.25);
    ctx.lineTo(l + w * 0.25, top + h * 0.6);
    ctx.lineTo(cx, top);
    ctx.lineTo(l + w * 0.75, top + h * 0.6);
    ctx.lineTo(l + w, top + h * 0.25);
    ctx.lineTo(l + w, b);
    ctx.closePath();
    ctx.fillStyle = `rgba(255,213,79,${alpha})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(60,40,0,${alpha * 0.7})`;
    ctx.lineWidth = Math.max(1, h * 0.08);
    ctx.stroke();
  }

  /** City: a tall block and a short block with dark windows. */
  private buildings(cx: number, top: number, h: number, alpha: number): void {
    const { ctx } = this;
    const w = h * 1.4;
    const l = cx - w / 2;
    const tallW = w * 0.45;
    const shortW = w * 0.5;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillRect(l, top, tallW, h);
    ctx.fillRect(l + w - shortW, top + h * 0.35, shortW, h * 0.65);
    ctx.fillStyle = `rgba(30,34,40,${alpha * 0.8})`;
    const win = Math.max(1, h * 0.14);
    for (const [wx, wy] of [
      [l + tallW * 0.22, top + h * 0.2],
      [l + tallW * 0.6, top + h * 0.2],
      [l + tallW * 0.22, top + h * 0.55],
      [l + tallW * 0.6, top + h * 0.55],
      [l + w - shortW + shortW * 0.25, top + h * 0.55],
      [l + w - shortW + shortW * 0.6, top + h * 0.55],
    ]) {
      ctx.fillRect(wx, wy, win, win);
    }
  }

  /** Watchtower: an almond eye with a dark pupil, h tall, centred on (cx, cy). */
  private eye(cx: number, cy: number, h: number, alpha: number): void {
    const { ctx } = this;
    const rx = h * 0.85;
    const ry = h * 0.5;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy);
    ctx.quadraticCurveTo(cx, cy - ry * 2, cx + rx, cy);
    ctx.quadraticCurveTo(cx, cy + ry * 2, cx - rx, cy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(0,0,0,${alpha * 0.7})`;
    ctx.beginPath();
    ctx.arc(cx, cy, ry * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  private crater(x: number, y: number, s: number, alpha: number): void {
    const { ctx } = this;
    const cx = x + s / 2;
    const cy = y + s / 2;
    const grad = ctx.createRadialGradient(cx, cy, s * 0.05, cx, cy, s * 0.42);
    grad.addColorStop(0, `rgba(20,14,10,${alpha})`);
    grad.addColorStop(0.6, `rgba(60,40,28,${alpha * 0.8})`);
    grad.addColorStop(1, 'rgba(60,40,28,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, s, s);
  }

  /**
   * Classic mine: dark round body with eight bumps, large and centred. Grey when flagged
   * (safe for you); a white ring while locked, matching the white dots enemies see.
   */
  private mineIcon(x: number, y: number, s: number, flagged = false, locked = false): void {
    const { ctx } = this;
    const cx = x + s / 2;
    const cy = y + s / 2;
    const r = s * 0.24;
    if (locked) {
      ctx.strokeStyle = C.dotLocked;
      ctx.lineWidth = Math.max(1.5, s * 0.06);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.75, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = flagged ? '#9aa0a8' : '#16181c';
    // Eight bumps around the body.
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r * 1.22, cy + Math.sin(a) * r * 1.22, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // A small shine so it reads as round.
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(cx - r * 0.38, cy - r * 0.38, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Yellow flag; small and tucked into the top-right corner on tiles that show troops. */
  private flag(x: number, y: number, s: number, corner = false): void {
    const { ctx } = this;
    const k = corner ? 0.5 : 1;
    const ox = corner ? x + s * 0.5 : x;
    const oy = corner ? y + s * 0.02 : y;
    ctx.strokeStyle = '#222';
    ctx.lineWidth = Math.max(1, s * 0.05 * k);
    ctx.beginPath();
    ctx.moveTo(ox + s * 0.42 * k, oy + s * 0.2 * k);
    ctx.lineTo(ox + s * 0.42 * k, oy + s * 0.78 * k);
    ctx.stroke();
    ctx.fillStyle = '#ffeb3b';
    ctx.beginPath();
    ctx.moveTo(ox + s * 0.44 * k, oy + s * 0.2 * k);
    ctx.lineTo(ox + s * 0.76 * k, oy + s * 0.35 * k);
    ctx.lineTo(ox + s * 0.44 * k, oy + s * 0.5 * k);
    ctx.closePath();
    ctx.fill();
  }

  /** Troop count, dark or white, whichever contrasts more with the tile underneath. */
  private army(x: number, y: number, s: number, n: number, belowIcon: boolean, tile: string): void {
    const { ctx } = this;
    const label = formatArmy(n);
    let size = s * (label.length >= 4 ? 0.3 : label.length === 3 ? 0.36 : 0.42);
    if (belowIcon) size *= 0.9;
    const cy = belowIcon ? y + s * 0.68 : y + s / 2 + s * 0.03;
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const dark = luminance(tile) > DARK_TEXT_ABOVE;
    ctx.lineWidth = Math.max(2, size * 0.18);
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.55)';
    ctx.strokeText(label, x + s / 2, cy);
    ctx.fillStyle = dark ? C.darkText : '#fff';
    ctx.fillText(label, x + s / 2, cy);
  }

  /** Pulsing outline on each tile a general or city may move to. */
  private drawTargets(b: Board, tiles: number[], s: number, calm: boolean): void {
    const { ctx } = this;
    const pulse = calm ? 1 : (Math.sin(performance.now() / 220) + 1) / 2;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 213, 79, ${0.5 + pulse * 0.5})`;
    ctx.lineWidth = Math.max(2, s * 0.08);
    for (const i of tiles) {
      const [x, y] = this.toScreen(i % b.w, Math.floor(i / b.w));
      ctx.strokeRect(x + s * 0.12, y + s * 0.12, s * 0.76, s * 0.76);
    }
    ctx.restore();
  }

  /** Dashed outline of a selected watchtower's 7x7 area. */
  private towerArea(b: Board, idx: number): void {
    const { ctx } = this;
    const cx = idx % b.w;
    const cy = Math.floor(idx / b.w);
    const [ax, ay] = this.toScreen(Math.max(0, cx - TOWER_RADIUS), Math.max(0, cy - TOWER_RADIUS));
    const [bx, by] = this.toScreen(Math.min(b.w, cx + TOWER_RADIUS + 1), Math.min(b.h, cy + TOWER_RADIUS + 1));
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ax + 1, ay + 1, bx - ax - 2, by - ay - 2);
    ctx.restore();
  }

  private drawQueue(b: Board, moves: Move[], s: number): void {
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(1.5, s * 0.06);
    for (const m of moves) {
      const fx = (m.from % b.w) + 0.5;
      const fy = Math.floor(m.from / b.w) + 0.5;
      const dx = (m.to % b.w) + 0.5 - fx;
      const dy = Math.floor(m.to / b.w) + 0.5 - fy;
      const [ax, ay] = this.toScreen(fx + dx * 0.3, fy + dy * 0.3);
      const [bx, by] = this.toScreen(fx + dx * 0.7, fy + dy * 0.7);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      const hs = s * 0.14;
      ctx.beginPath();
      ctx.moveTo(bx + dx * hs, by + dy * hs);
      ctx.lineTo(bx - dy * hs, by + dx * hs);
      ctx.lineTo(bx + dy * hs, by - dx * hs);
      ctx.closePath();
      ctx.fill();
    }
  }
}
