/**
 * Request guards shared by the Worker routes: same-origin checks and per-IP rate limits.
 * Limits use Cloudflare's rate-limiting bindings (see wrangler.jsonc `ratelimits`): counts
 * are per Cloudflare location and approximate, which is fine for stopping floods.
 */

/** Running under `wrangler dev`: the Vite dev server (another port, or a phone on the LAN) calls in. */
function isLocal(url: URL): boolean {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

/**
 * Browsers always send Origin on POST and WebSocket requests. In production it must be
 * this site, so other sites can't drive the API from their visitors' browsers, and bare
 * scripts (no Origin) are turned away.
 */
export function sameOrigin(req: Request, url: URL): boolean {
  if (isLocal(url)) return true;
  return req.headers.get('Origin') === url.origin;
}

export function clientIp(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? 'unknown';
}

/** The part of Cloudflare's rate-limit binding we use (kept local so tests can import this file). */
interface Limiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** True if this IP is still under `limiter`'s limit. A missing binding (tests) never limits. */
export async function underLimit(limiter: Limiter | undefined, req: Request, route: string): Promise<boolean> {
  if (!limiter) return true;
  const { success } = await limiter.limit({ key: `${route}:${clientIp(req)}` });
  return success;
}

export function tooMany(): Response {
  return new Response('Too many requests. Wait a minute and try again.', {
    status: 429,
    headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' },
  });
}

export function forbidden(): Response {
  return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
}

/** Read a request body as text, refusing anything over `max` bytes (null). */
export async function readCapped(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get('Content-Length') ?? 0);
  if (declared > max) return null;
  const text = await req.text();
  return text.length > max ? null : text;
}

/**
 * Per-socket message budget: a token bucket refilled at `rate` per second up to `burst`.
 * A browser sends a few messages a second at most (fast drags, ~10/s); floods get dropped.
 */
export class MessageBudget {
  private tokens: number;
  private last: number;
  /** Messages dropped so far; the caller closes the socket past a threshold. */
  dropped = 0;

  constructor(
    private readonly rate = 25,
    private readonly burst = 60,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = burst;
    this.last = now();
  }

  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.rate);
    this.last = t;
    if (this.tokens >= 1) {
      this.tokens--;
      return true;
    }
    this.dropped++;
    return false;
  }
}
