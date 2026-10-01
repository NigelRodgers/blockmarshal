interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

interface Ring {
  x: number;
  y: number;
  age: number;
}

/** Explosion particles and screen shake, in world (tile) coordinates. */
export class Effects {
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private shake = 0;

  explode(x: number, y: number): void {
    const colors = ['#ffd54f', '#ff8f00', '#e53935', '#5d4037', '#212121'];
    for (let n = 0; n < 34; n++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 3.2;
      const max = 400 + Math.random() * 500;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: max,
        max,
        color: colors[n % colors.length],
        size: 0.05 + Math.random() * 0.12,
      });
    }
    this.rings.push({ x, y, age: 0 });
    this.shake = Math.max(this.shake, 350);
  }

  get active(): boolean {
    return this.particles.length > 0 || this.rings.length > 0 || this.shake > 0;
  }

  update(dt: number): void {
    const s = dt / 1000;
    for (const p of this.particles) {
      p.x += p.vx * s;
      p.y += p.vy * s;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < 500);
    this.shake = Math.max(0, this.shake - dt);
  }

  shakeOffset(scale: number): [number, number] {
    if (!this.shake) return [0, 0];
    const m = (this.shake / 350) * Math.min(10, scale * 0.25);
    return [(Math.random() - 0.5) * m, (Math.random() - 0.5) * m];
  }

  draw(ctx: CanvasRenderingContext2D, toScreen: (x: number, y: number) => [number, number], scale: number): void {
    for (const r of this.rings) {
      const [sx, sy] = toScreen(r.x, r.y);
      const t = r.age / 500;
      ctx.beginPath();
      ctx.arc(sx, sy, scale * (0.3 + t * 1.8), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,214,79,${1 - t})`;
      ctx.lineWidth = Math.max(2, scale * 0.15 * (1 - t));
      ctx.stroke();
    }
    for (const p of this.particles) {
      const [sx, sy] = toScreen(p.x, p.y);
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(sx, sy, p.size * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
