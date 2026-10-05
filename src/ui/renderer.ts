import { TOWER_RADIUS } from '../engine/constants';
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
  /** Your flags. Never sent to the server, so opponents can't see them. */
  flags: Uint8Array;
  /** Moves sent but not yet echoed back by the server. */
  pending: Move[];
  fx: Effects;
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
  dotEdge: 'rgba(0,0,0,0.65)',
};

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

  fit(b: Board): void {
    const availW = this.vw - 8;
    const availH = this.vh - this.insetTop - this.insetBottom - 8;
    this.cam.scale = clamp(Math.min(availW / b.w, availH / b.h), 12, 72);
    const centerY = (this.insetTop + this.vh - this.insetBottom) / 2;
    this.cam.x = b.w / 2;
    this.cam.y = b.h / 2 - (centerY - this.vh / 2) / this.cam.scale;
  }

  centerOn(b: Board, idx: number): void {
    const centerY = (this.insetTop + this.vh - this.insetBottom) / 2;
    this.cam.x = (idx % b.w) + 0.5;
    this.cam.y = Math.floor(idx / b.w) + 0.5 - (centerY - this.vh / 2) / this.cam.scale;
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const wx = (sx - this.vw / 2) / this.cam.scale + this.cam.x;
    const wy = (sy - this.vh / 2) / this.cam.scale + this.cam.y;
    this.cam.scale = clamp(this.cam.scale * factor, 12, 110);
    this.cam.x = wx - (sx - this.vw / 2) / this.cam.scale;
    this.cam.y = wy - (sy - this.vh / 2) / this.cam.scale;
  }

  pan(dx: number, dy: number): void {
    this.cam.x -= dx / this.cam.scale;
    this.cam.y -= dy / this.cam.scale;
  }

  clampTo(b: Board): void {
    this.cam.x = clamp(this.cam.x, 0, b.w);
    this.cam.y = clamp(this.cam.y, 0, b.h);
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
    const [ox, oy] = o.fx.shakeOffset(this.cam.scale);
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
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const [sx, sy] = this.toScreen(x, y);
        this.drawTile(v, o, y * v.w + x, sx, sy, s, mines);
      }
    }

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

  private drawTile(v: PlayerView, o: DrawOptions, i: number, x: number, y: number, s: number, mines: Set<number> | null): void {
    const t = v.terrain[i];
    const own = v.owner[i];
    const seen = v.visible[i] === 1;
    const g = Math.max(1, s * 0.05);

    if (t === -1) {
      this.flat(x, y, s, g, C.fog);
    } else if (t === Terrain.Mountain) {
      this.mountain(x, y, s, g, !seen);
    } else if (own >= 0) {
      this.flat(x, y, s, g, v.players[own].color);
      this.icon(t, x, y, s, 0.5);
    } else if (!seen) {
      this.flat(x, y, s, g, C.fogKnown);
      this.icon(t, x, y, s, 0.25);
    } else {
      const color = t === Terrain.City ? C.neutralCity : t === Terrain.Tower ? C.neutralTower : C.plain;
      this.flat(x, y, s, g, color);
      this.icon(t, x, y, s, 0.35);
    }

    if (v.crater[i]) this.crater(x, y, s, seen ? 0.85 : 0.6);
    if (mines?.has(i)) this.mineIcon(x, y, s);
    if (seen && v.army[i] > 0) this.army(x, y, s, v.army[i]);
    if (v.dots[i]) this.dots(x, y, s, v.dots[i]);
    if (o.flags[i] && own !== v.you && !v.crater[i]) this.flag(x, y, s);
  }

  /** Red dots on the tile's edge, pointing at each neighbouring mine. */
  private dots(x: number, y: number, s: number, mask: number): void {
    const { ctx } = this;
    const r = Math.max(2.5, s * 0.09);
    const reach = s * 0.5 - r - Math.max(1, s * 0.05);
    ctx.fillStyle = C.dot;
    ctx.strokeStyle = C.dotEdge;
    ctx.lineWidth = Math.max(1, s * 0.025);
    for (let bit = 0; bit < 8; bit++) {
      if (!(mask & (1 << bit))) continue;
      const [dx, dy] = DOT_OFFSETS[bit];
      ctx.beginPath();
      ctx.arc(x + s / 2 + dx * reach, y + s / 2 + dy * reach, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private icon(t: number, x: number, y: number, s: number, alpha: number): void {
    if (t === Terrain.General) this.crown(x, y, s, alpha);
    else if (t === Terrain.City) this.castle(x, y, s, alpha);
    else if (t === Terrain.Tower) this.eye(x, y, s, alpha);
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

  private crown(x: number, y: number, s: number, alpha: number): void {
    const { ctx } = this;
    const cx = x + s / 2;
    const cy = y + s / 2;
    const r = s * 0.34;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy + r * 0.6);
    ctx.lineTo(cx - r, cy - r * 0.45);
    ctx.lineTo(cx - r * 0.5, cy);
    ctx.lineTo(cx, cy - r * 0.75);
    ctx.lineTo(cx + r * 0.5, cy);
    ctx.lineTo(cx + r, cy - r * 0.45);
    ctx.lineTo(cx + r, cy + r * 0.6);
    ctx.closePath();
    ctx.fill();
  }

  private castle(x: number, y: number, s: number, alpha: number): void {
    const { ctx } = this;
    const l = x + s * 0.2;
    const w = s * 0.6;
    const top = y + s * 0.28;
    const bottom = y + s * 0.8;
    const m = w / 5;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    ctx.moveTo(l, bottom);
    ctx.lineTo(l, top);
    for (let k = 0; k < 5; k++) {
      const dy = k % 2 === 0 ? 0 : m;
      ctx.lineTo(l + k * m, top + dy);
      ctx.lineTo(l + (k + 1) * m, top + dy);
    }
    ctx.lineTo(l + w, bottom);
    ctx.closePath();
    ctx.fill();
  }

  /** Watchtower: an almond eye with a dark pupil. */
  private eye(x: number, y: number, s: number, alpha: number): void {
    const { ctx } = this;
    const cx = x + s / 2;
    const cy = y + s / 2;
    const rx = s * 0.42;
    const ry = s * 0.3;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy);
    ctx.quadraticCurveTo(cx, cy - ry * 1.9, cx + rx, cy);
    ctx.quadraticCurveTo(cx, cy + ry * 1.9, cx - rx, cy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(0,0,0,${alpha * 0.6})`;
    ctx.beginPath();
    ctx.arc(cx, cy, ry * 0.62, 0, Math.PI * 2);
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

  private mineIcon(x: number, y: number, s: number): void {
    const { ctx } = this;
    const cx = x + s / 2;
    const cy = y + s / 2;
    const r = s * 0.2;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = Math.max(1, s * 0.06);
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI;
      ctx.moveTo(cx - Math.cos(a) * r * 1.5, cy - Math.sin(a) * r * 1.5);
      ctx.lineTo(cx + Math.cos(a) * r * 1.5, cy + Math.sin(a) * r * 1.5);
    }
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  private flag(x: number, y: number, s: number): void {
    const { ctx } = this;
    ctx.strokeStyle = '#222';
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.42, y + s * 0.2);
    ctx.lineTo(x + s * 0.42, y + s * 0.78);
    ctx.stroke();
    ctx.fillStyle = '#ffeb3b';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.44, y + s * 0.2);
    ctx.lineTo(x + s * 0.76, y + s * 0.35);
    ctx.lineTo(x + s * 0.44, y + s * 0.5);
    ctx.closePath();
    ctx.fill();
  }

  private army(x: number, y: number, s: number, n: number): void {
    const { ctx } = this;
    const label = formatArmy(n);
    const size = s * (label.length >= 4 ? 0.3 : label.length === 3 ? 0.36 : 0.42);
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, size * 0.18);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(label, x + s / 2, y + s / 2 + s * 0.03);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + s / 2, y + s / 2 + s * 0.03);
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
