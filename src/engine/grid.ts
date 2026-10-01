export function buildNeighbors(w: number, h: number): { n4: number[][]; n8: number[][] } {
  const n4: number[][] = [];
  const n8: number[][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a4: number[] = [];
      const a8: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          a8.push(j);
          if (!dx || !dy) a4.push(j);
        }
      }
      n4.push(a4);
      n8.push(a8);
    }
  }
  return { n4, n8 };
}

export function manhattan(w: number, a: number, b: number): number {
  return Math.abs((a % w) - (b % w)) + Math.abs(Math.floor(a / w) - Math.floor(b / w));
}

export function chebyshev(w: number, a: number, b: number): number {
  return Math.max(Math.abs((a % w) - (b % w)), Math.abs(Math.floor(a / w) - Math.floor(b / w)));
}
