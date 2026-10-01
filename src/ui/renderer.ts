import { TOWER_RADIUS } from '../engine/constants';
import { visionFor } from '../engine/game';
import { Memory, Terrain, type GameState } from '../engine/types';
import type { Effects } from './effects';

export interface ViewState {
  pid: number;
  selected: number;
  half: boolean;
  revealAll: boolean;
  fx: Effects;
}

const NUMBER_COLORS = ['', '#1565c0', '#2e7d32', '#c62828', '#4a148c', '#bf360c', '#00838f', '#212121', '#616161'];

const C = {
  bg: '#12151b',
  open: '#dfe4ea',
  openFog: '#59616d',
  raised: '#a3adba',
  raisedLight: '#cdd4dd',
  raisedDark: '#6e7784',
  fogRaised: '#3b424c',
  fogLight: '#4b535f',
  fogDark: '#2b3038',
  mountain: '#2f343c',
  mountainPeak: '#8d96a3',
  neutralCity: '#7c818a',
  neutralTower: '#4f7a82',
};

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
  private vision = new Uint8Array(0);

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

  fit(w: number, h: number): void {
    const availW = this.vw - 16;
    const availH = this.vh - this.insetTop - this.insetBottom - 16;
    this.cam.scale = clamp(Math.min(availW / w, availH / h), 14, 72);
    const centerY = (this.insetTop + this.vh - this.insetBottom) / 2;
    this.cam.x = w / 2;
    this.cam.y = h / 2 - (centerY - this.vh / 2) / this.cam.scale;
  }

  centerOn(state: GameState, idx: number): void {
    const centerY = (this.insetTop + this.vh - this.insetBottom) / 2;
    this.cam.x = (idx % state.w) + 0.5;
    this.cam.y = Math.floor(idx / state.w) + 0.5 - (centerY - this.vh / 2) / this.cam.scale;
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

  clampTo(w: number, h: number): void {
    this.cam.x = clamp(this.cam.x, 0, w);
    this.cam.y = clamp(this.cam.y, 0, h);
  }

  screenToTile(state: GameState, sx: number, sy: number): number {
    const wx = Math.floor((sx - this.vw / 2) / this.cam.scale + this.cam.x);
    const wy = Math.floor((sy - this.vh / 2) / this.cam.scale + this.cam.y);
    if (wx < 0 || wy < 0 || wx >= state.w || wy >= state.h) return -1;
    return wy * state.w + wx;
  }

  toScreen = (wx: number, wy: number): [number, number] => [
    (wx - this.cam.x) * this.cam.scale + this.vw / 2,
    (wy - this.cam.y) * this.cam.scale + this.vh / 2,
  ];

  draw(state: GameState, view: ViewState): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, this.vw, this.vh);

    const [ox, oy] = view.fx.shakeOffset(this.cam.scale);
    ctx.translate(ox, oy);

    if (this.vision.length !== state.size) this.vision = new Uint8Array(state.size);
    if (view.revealAll) this.vision.fill(1);
    else visionFor(state, view.pid, this.vision);

    const s = this.cam.scale;
    const x0 = Math.max(0, Math.floor(this.cam.x - this.vw / 2 / s) - 1);
    const x1 = Math.min(state.w - 1, Math.ceil(this.cam.x + this.vw / 2 / s));
    const y0 = Math.max(0, Math.floor(this.cam.y - this.vh / 2 / s) - 1);
    const y1 = Math.min(state.h - 1, Math.ceil(this.cam.y + this.vh / 2 / s));

    // Board frame
    const [bx, by] = this.toScreen(0, 0);
    ctx.fillStyle = '#0b0d11';
    ctx.fillRect(bx - 4, by - 4, state.w * s + 8, state.h * s + 8);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const [sx, sy] = this.toScreen(x, y);
        this.drawTile(state, view, y * state.w + x, sx, sy, s);
      }
    }

    this.drawQueue(state, view, s);

    if (view.selected >= 0 && state.owner[view.selected] === view.pid) {
      const [sx, sy] = this.toScreen(view.selected % state.w, Math.floor(view.selected / state.w));
      if (state.terrain[view.selected] === Terrain.Tower) this.towerArea(state, view.selected);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, s * 0.09);
      ctx.strokeRect(sx + ctx.lineWidth / 2, sy + ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth);
      if (view.half) {
        ctx.fillStyle = '#fff';
        ctx.font = `700 ${Math.max(8, s * 0.22)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('50%', sx + s / 2, sy + s * 0.08);
      }
    }

    view.fx.draw(ctx, this.toScreen, s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Dashed outline of a selected watchtower's 7x7 area. */
  private towerArea(state: GameState, idx: number): void {
    const { ctx } = this;
    const cx = idx % state.w;
    const cy = Math.floor(idx / state.w);
    const [ax, ay] = this.toScreen(Math.max(0, cx - TOWER_RADIUS), Math.max(0, cy - TOWER_RADIUS));
    const [bx, by] = this.toScreen(Math.min(state.w, cx + TOWER_RADIUS + 1), Math.min(state.h, cy + TOWER_RADIUS + 1));
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ax + 1, ay + 1, bx - ax - 2, by - ay - 2);
    ctx.restore();
  }

  private drawTile(state: GameState, view: ViewState, i: number, x: number, y: number, s: number): void {
    const me = state.players[view.pid];
    const visible = this.vision[i] === 1;
    const t = state.terrain[i];
    const o = state.owner[i];
    const g = Math.max(1, s * 0.05);
    const known = me.revealed[i] === 1 || (view.revealAll && !state.mine[i] && t !== Terrain.Mountain);

    if (visible) {
      if (t === Terrain.Mountain) {
        this.mountain(x, y, s, g, false);
      } else if (o >= 0) {
        this.flat(x, y, s, g, state.players[o].color);
        if (t === Terrain.General) this.crown(x, y, s);
        else if (t === Terrain.City) this.castle(x, y, s, 'rgba(255,255,255,0.28)');
        else if (t === Terrain.Tower) this.eye(x, y, s, 0.6);
        else if (state.crater[i]) this.crater(x, y, s, 0.5);
        const badge = known && state.adj[i] > 0 && s >= 18 && this.isFrontier(state, view.pid, i);
        this.army(x, y, s, state.army[i], badge);
        if (badge) this.badge(x, y, s, state.adj[i]);
      } else if (t === Terrain.City) {
        this.flat(x, y, s, g, C.neutralCity);
        this.castle(x, y, s, 'rgba(255,255,255,0.25)');
        this.army(x, y, s, state.army[i]);
      } else if (t === Terrain.Tower) {
        this.flat(x, y, s, g, C.neutralTower);
        this.eye(x, y, s, 0.4);
        this.army(x, y, s, state.army[i]);
      } else if (state.crater[i]) {
        this.flat(x, y, s, g, C.open);
        this.crater(x, y, s, 1);
      } else if (known) {
        this.flat(x, y, s, g, C.open);
        if (state.adj[i] > 0) this.number(x, y, s, state.adj[i], 1);
      } else {
        this.bevel(x, y, s, g, C.raised, C.raisedLight, C.raisedDark);
        if (view.revealAll && state.mine[i]) this.mineIcon(x, y, s);
      }
    } else {
      const m = me.memory[i];
      if (m === Memory.Mountain) {
        this.mountain(x, y, s, g, true);
      } else if (m === Memory.City || m === Memory.General) {
        this.flat(x, y, s, g, C.openFog);
        if (m === Memory.General) this.crown(x, y, s);
        else this.castle(x, y, s, 'rgba(255,255,255,0.18)');
      } else if (m === Memory.Tower) {
        this.flat(x, y, s, g, C.openFog);
        this.eye(x, y, s, 0.25);
      } else if (m === Memory.Crater) {
        this.flat(x, y, s, g, C.openFog);
        this.crater(x, y, s, 0.7);
      } else if (known) {
        this.flat(x, y, s, g, C.openFog);
        if (state.adj[i] > 0) this.number(x, y, s, state.adj[i], 0.75);
      } else {
        this.bevel(x, y, s, g, C.fogRaised, C.fogLight, C.fogDark);
      }
    }

    if (me.flags[i] && !(visible && o >= 0)) this.flag(x, y, s);
  }

  private flat(x: number, y: number, s: number, g: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x + g / 2, y + g / 2, s - g, s - g);
  }

  private bevel(x: number, y: number, s: number, g: number, base: string, light: string, dark: string): void {
    const { ctx } = this;
    const b = Math.max(1.5, s * 0.1);
    const l = x + g / 2;
    const tp = y + g / 2;
    const sz = s - g;
    ctx.fillStyle = dark;
    ctx.fillRect(l, tp, sz, sz);
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.moveTo(l, tp);
    ctx.lineTo(l + sz, tp);
    ctx.lineTo(l + sz - b, tp + b);
    ctx.lineTo(l + b, tp + sz - b);
    ctx.lineTo(l, tp + sz);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = base;
    ctx.fillRect(l + b, tp + b, sz - 2 * b, sz - 2 * b);
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

  private crown(x: number, y: number, s: number): void {
    const { ctx } = this;
    const cx = x + s / 2;
    const cy = y + s / 2;
    const r = s * 0.34;
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
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

  private castle(x: number, y: number, s: number, color: string): void {
    const { ctx } = this;
    const l = x + s * 0.2;
    const w = s * 0.6;
    const top = y + s * 0.28;
    const bottom = y + s * 0.8;
    const m = w / 5;
    ctx.fillStyle = color;
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
    ctx.strokeStyle = `rgba(20,14,10,${alpha * 0.7})`;
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.4;
      ctx.moveTo(cx + Math.cos(a) * s * 0.18, cy + Math.sin(a) * s * 0.18);
      ctx.lineTo(cx + Math.cos(a) * s * 0.42, cy + Math.sin(a) * s * 0.42);
    }
    ctx.stroke();
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
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx - r * 0.35, cy - r * 0.35, r * 0.25, 0, Math.PI * 2);
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
    ctx.fillStyle = '#e53935';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.44, y + s * 0.2);
    ctx.lineTo(x + s * 0.76, y + s * 0.35);
    ctx.lineTo(x + s * 0.44, y + s * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.fillRect(x + s * 0.28, y + s * 0.76, s * 0.3, s * 0.07);
  }

  private number(x: number, y: number, s: number, n: number, alpha: number): void {
    const { ctx } = this;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = NUMBER_COLORS[n];
    ctx.font = `800 ${s * 0.56}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), x + s / 2, y + s / 2 + s * 0.03);
    ctx.globalAlpha = 1;
  }

  /** True when an owned tile's number still says something: it touches a tile the viewer can't classify yet. */
  private isFrontier(state: GameState, pid: number, i: number): boolean {
    const me = state.players[pid];
    return state.n8[i].some((j) => state.owner[j] !== pid && !me.revealed[j] && me.memory[j] === Memory.None);
  }

  /** Mine number on an owned tile: a pill in the top-left corner. */
  private badge(x: number, y: number, s: number, n: number): void {
    const { ctx } = this;
    const h = s * 0.4;
    const w = h * 0.86;
    const l = x + s * 0.07;
    const t = y + s * 0.07;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.roundRect(l, t, w, h, h * 0.3);
    ctx.fill();
    ctx.fillStyle = NUMBER_COLORS[n];
    ctx.font = `800 ${h * 0.82}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), l + w / 2, t + h / 2 + h * 0.05);
  }

  /** Troop count; nudged toward the bottom-right when a number badge takes the corner. */
  private army(x: number, y: number, s: number, n: number, besideBadge = false): void {
    if (n <= 0) return;
    const { ctx } = this;
    const label = formatArmy(n);
    let size = s * (label.length >= 4 ? 0.3 : label.length === 3 ? 0.36 : 0.42);
    let cx = x + s / 2;
    let cy = y + s / 2 + s * 0.03;
    if (besideBadge) {
      size *= label.length >= 3 ? 0.85 : 0.95;
      cx = x + s * 0.6;
      cy = y + s * 0.66;
    }
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, size * 0.18);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(label, cx, cy);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, cx, cy);
  }

  private drawQueue(state: GameState, view: ViewState, s: number): void {
    const { ctx } = this;
    const q = state.players[view.pid].queue;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(1.5, s * 0.06);
    for (const m of q) {
      const fx = (m.from % state.w) + 0.5;
      const fy = Math.floor(m.from / state.w) + 0.5;
      const dx = (m.to % state.w) + 0.5 - fx;
      const dy = Math.floor(m.to / state.w) + 0.5 - fy;
      const [ax, ay] = this.toScreen(fx + dx * 0.3, fy + dy * 0.3);
      const [bx, by] = this.toScreen(fx + dx * 0.7, fy + dy * 0.7);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      const hs = s * 0.14;
      const px = -dy;
      const py = dx;
      ctx.beginPath();
      ctx.moveTo(bx + dx * hs, by + dy * hs);
      ctx.lineTo(bx + px * hs, by + py * hs);
      ctx.lineTo(bx - px * hs, by - py * hs);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
