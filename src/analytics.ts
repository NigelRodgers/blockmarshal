/**
 * Minimal anonymous analytics over PostHog's batch HTTP API.
 *
 * - No SDK, no cookies: a random ID in localStorage is the only identifier.
 * - No personal data is ever attached; properties are gameplay numbers.
 * - Disabled when no key is configured, when the browser sends Do Not Track,
 *   or when the player turns it off in the menu.
 *
 * Configure with VITE_POSTHOG_KEY (and optionally VITE_POSTHOG_HOST) at build time.
 */

const API_KEY = (import.meta.env.VITE_POSTHOG_KEY as string | undefined) || '';
const HOST = ((import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com').replace(/\/$/, '');
const ID_KEY = 'blockmarshal.aid';
const OPT_KEY = 'blockmarshal.analytics';
const APP_VERSION = '0.1.0';
const FLUSH_MS = 10_000;
const MAX_BATCH = 20;

export type AnalyticsEvent = 'app_open' | 'lobby_join' | 'quick_start' | 'game_start' | 'game_end' | 'install_prompt' | 'feedback_sent' | 'replay_shared' | 'replay_link_opened';

type Props = Record<string, string | number | boolean | null>;

interface Queued {
  event: AnalyticsEvent;
  properties: Props & { distinct_id: string };
  timestamp: string;
}

let queue: Queued[] = [];

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function anonymousId(): string {
  let id = storageGet(ID_KEY);
  if (!id) {
    id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    storageSet(ID_KEY, id);
  }
  return id;
}

export function analyticsConfigured(): boolean {
  return !!API_KEY;
}

export function analyticsOptedOut(): boolean {
  return storageGet(OPT_KEY) === 'off' || navigator.doNotTrack === '1';
}

export function setAnalyticsOptOut(off: boolean): void {
  storageSet(OPT_KEY, off ? 'off' : 'on');
  if (off) queue = [];
}

function enabled(): boolean {
  return analyticsConfigured() && !analyticsOptedOut();
}

function platform(): string {
  return window.matchMedia?.('(display-mode: standalone)').matches ? 'pwa' : 'web';
}

export function track(event: AnalyticsEvent, props: Props = {}): void {
  if (import.meta.env.DEV) console.debug('[analytics]', event, props, enabled() ? '' : '(not sent)');
  if (!enabled()) return;
  queue.push({
    event,
    properties: { distinct_id: anonymousId(), app_version: APP_VERSION, platform: platform(), ...props },
    timestamp: new Date().toISOString(),
  });
  if (queue.length >= MAX_BATCH) flush();
}

/**
 * Sent as text/plain so the browser skips the CORS preflight; PostHog parses the JSON body.
 * On page hide we use sendBeacon so the last events survive the tab closing.
 */
function flush(onExit = false): void {
  if (!queue.length || !enabled()) return;
  const body = JSON.stringify({ api_key: API_KEY, batch: queue });
  queue = [];
  const url = `${HOST}/batch/`;
  if (onExit && navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) return;
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: true }).catch(() => {
    /* offline or blocked: drop silently, analytics must never affect play */
  });
}

setInterval(flush, FLUSH_MS);
window.addEventListener('pagehide', () => flush(true));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flush(true);
});
