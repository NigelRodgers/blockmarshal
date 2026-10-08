import type { Board, Renderer } from './renderer';

export interface InputHandlers {
  getBoard(): Board | null;
  onTap(idx: number): void;
  onFlag(idx: number): void;
  /** Return true to start drawing a move path from this tile instead of panning. */
  onPathStart(idx: number): boolean;
  onPathStep(from: number, to: number): void;
}

type DragMode = 'none' | 'pending' | 'path' | 'done';

const LONG_PRESS_MS = 420;
const DRAG_SLOP = 9;

/**
 * Touch-first gestures on a fixed board: tap, long-press (flag), drag from
 * your own tile (move path). Dragging elsewhere or pinching does nothing, so
 * the board never moves under your finger. Mouse: right-click to flag.
 */
export class Input {
  private pointers = new Set<number>();
  private mode: DragMode = 'none';
  private start = { x: 0, y: 0, idx: -1 };
  private pathTile = -1;
  private longTimer = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly r: Renderer,
    private readonly h: InputHandlers,
  ) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    // Swallow wheel and context menu so the page never scrolls or zooms instead.
    el.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
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
    this.pointers.add(e.pointerId);

    if (e.pointerType === 'mouse' && e.button === 2) {
      this.h.onFlag(this.tileAt(e.clientX, e.clientY));
      this.mode = 'done';
      return;
    }

    if (this.pointers.size === 1) {
      this.start = { x: e.clientX, y: e.clientY, idx: this.tileAt(e.clientX, e.clientY) };
      this.mode = 'pending';
      clearTimeout(this.longTimer);
      this.longTimer = window.setTimeout(() => {
        if (this.mode !== 'pending') return;
        this.mode = 'done';
        this.h.onFlag(this.start.idx);
      }, LONG_PRESS_MS);
    } else {
      // A second finger cancels whatever the first was doing.
      clearTimeout(this.longTimer);
      this.mode = 'done';
    }
  };

  private move = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    if (this.mode === 'pending' && Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y) > DRAG_SLOP) {
      clearTimeout(this.longTimer);
      if (this.h.onPathStart(this.start.idx)) {
        this.mode = 'path';
        this.pathTile = this.start.idx;
      } else {
        this.mode = 'done';
      }
    }
    if (this.mode === 'path') this.extendPath(this.tileAt(e.clientX, e.clientY));
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
  };

  private cancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    clearTimeout(this.longTimer);
    if (this.pointers.size === 0) this.mode = 'none';
  };
}
