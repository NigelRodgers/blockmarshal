import type { Board, Renderer } from './renderer';

export interface InputHandlers {
  getBoard(): Board | null;
  onTap(idx: number): void;
  onFlag(idx: number): void;
  /** Return true to start drawing a move path from this tile instead of panning. */
  onPathStart(idx: number): boolean;
  onPathStep(from: number, to: number): void;
}

type DragMode = 'none' | 'pending' | 'path' | 'pan' | 'pinch' | 'done';

const LONG_PRESS_MS = 420;
const DRAG_SLOP = 9;

/**
 * Touch-first gestures: tap, long-press (flag), drag from own tile (move path),
 * drag elsewhere (pan), pinch (zoom). Mouse: wheel zoom, right-click flag.
 */
export class Input {
  private pointers = new Map<number, { x: number; y: number }>();
  private mode: DragMode = 'none';
  private start = { x: 0, y: 0, idx: -1 };
  private last = { x: 0, y: 0 };
  private pathTile = -1;
  private longTimer = 0;
  private pinch = { dist: 0, mx: 0, my: 0 };

  constructor(
    private readonly el: HTMLElement,
    private readonly r: Renderer,
    private readonly h: InputHandlers,
  ) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private tileAt(x: number, y: number): number {
    const b = this.h.getBoard();
    return b ? this.r.screenToTile(b, x, y) : -1;
  }

  private down = (e: PointerEvent): void => {
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone (e.g. synthetic events) */
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (e.pointerType === 'mouse' && e.button === 2) {
      this.h.onFlag(this.tileAt(e.clientX, e.clientY));
      this.mode = 'done';
      return;
    }

    if (this.pointers.size === 1) {
      this.start = { x: e.clientX, y: e.clientY, idx: this.tileAt(e.clientX, e.clientY) };
      this.last = { x: e.clientX, y: e.clientY };
      this.mode = 'pending';
      clearTimeout(this.longTimer);
      this.longTimer = window.setTimeout(() => {
        if (this.mode !== 'pending') return;
        this.mode = 'done';
        this.h.onFlag(this.start.idx);
      }, LONG_PRESS_MS);
    } else if (this.pointers.size === 2) {
      clearTimeout(this.longTimer);
      this.mode = 'pinch';
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  };

  private move = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;

    if (this.mode === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (this.pinch.dist > 0) this.r.zoomAt(mx, my, dist / this.pinch.dist);
      this.r.pan(mx - this.pinch.mx, my - this.pinch.my);
      this.pinch = { dist, mx, my };
      this.clampCam();
      return;
    }

    if (this.mode === 'pending' && Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y) > DRAG_SLOP) {
      clearTimeout(this.longTimer);
      if (this.h.onPathStart(this.start.idx)) {
        this.mode = 'path';
        this.pathTile = this.start.idx;
      } else {
        this.mode = 'pan';
      }
    }

    if (this.mode === 'path') {
      this.extendPath(this.tileAt(e.clientX, e.clientY));
    } else if (this.mode === 'pan') {
      this.r.pan(e.clientX - this.last.x, e.clientY - this.last.y);
      this.clampCam();
    }
    this.last = { x: e.clientX, y: e.clientY };
  };

  /** Walk one orthogonal step at a time toward the finger, so fast swipes don't skip tiles. */
  private extendPath(target: number): void {
    const s = this.h.getBoard();
    if (!s || target < 0) return;
    for (let guard = 0; guard < 40 && this.pathTile !== target; guard++) {
      const cx = this.pathTile % s.w;
      const cy = Math.floor(this.pathTile / s.w);
      const dx = (target % s.w) - cx;
      const dy = Math.floor(target / s.w) - cy;
      const next = Math.abs(dx) >= Math.abs(dy) ? this.pathTile + Math.sign(dx) : this.pathTile + Math.sign(dy) * s.w;
      this.h.onPathStep(this.pathTile, next);
      this.pathTile = next;
    }
  }

  private up = (e: PointerEvent): void => {
    if (!this.pointers.delete(e.pointerId)) return;
    clearTimeout(this.longTimer);
    if (this.mode === 'pending') this.h.onTap(this.start.idx);
    if (this.pointers.size === 0) this.mode = 'none';
    else if (this.mode === 'pinch') this.mode = 'done';
  };

  private cancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    clearTimeout(this.longTimer);
    if (this.pointers.size === 0) this.mode = 'none';
  };

  private wheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.r.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    this.clampCam();
  };

  private clampCam(): void {
    const b = this.h.getBoard();
    if (b) this.r.clampTo(b);
  }
}
