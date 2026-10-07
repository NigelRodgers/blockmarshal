import './style.css';
import { analyticsConfigured, analyticsOptedOut, setAnalyticsOptOut, track } from './analytics';
import { MINE_STUN_TICKS } from './engine/constants';
import { Terrain, type Move } from './engine/types';
import { findMatch, Net } from './net/client';
import type { PlayerView, ServerMessage } from './net/protocol';
import { Effects } from './ui/effects';
import { Input } from './ui/input';
import { formatArmy, Renderer } from './ui/renderer';

const NAME_KEY = 'blockmarshal.name';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const renderer = new Renderer($<HTMLCanvasElement>('board'));
const fx = new Effects();
const net = new Net(onServer, onDisconnect);

type Screen = 'start' | 'lobby' | 'game';
let screen: Screen = 'start';
let view: PlayerView | null = null;
/** Your flags live only in this browser; they are never sent to the server. */
let flags = new Uint8Array(0);
/** Moves sent since the last server view, drawn until the server echoes them back. */
let pending: Move[] = [];
let selected = -1;
let half = false;
let mode: 'move' | 'flag' = 'move';
let fitted = false;
let endShown = false;
let lobbyEndsAt = 0;

// ---------- Screens ----------

function show(id: string, on: boolean): void {
  $(id).classList.toggle('hidden', !on);
}

function setScreen(next: Screen): void {
  screen = next;
  show('start', next === 'start');
  show('lobby', next === 'lobby');
  show('hud-top', next === 'game');
  show('hud-bottom', next === 'game');
  if (next !== 'game') show('gameover', false);
}

function playerName(): string {
  return $<HTMLInputElement>('name').value.trim();
}

async function play(attempt = 0): Promise<void> {
  try {
    localStorage.setItem(NAME_KEY, playerName());
  } catch {
    /* name just won't be remembered */
  }
  show('offline', false);
  view = null;
  setScreen('lobby');
  $('lobby-time').textContent = '…';
  $('lobby-slots').innerHTML = '';
  try {
    await net.connect(await findMatch());
  } catch {
    setScreen('start');
    $('offline-sub').textContent = 'Check your connection and try again.';
    show('offline', true);
    return;
  }
  joinAttempt = attempt;
  net.send({ t: 'join', name: playerName() });
  if (attempt === 0) track('lobby_join');
}

/** A lobby can fill between the matchmaker's answer and our arrival; try another a few times. */
let joinAttempt = 0;

function toStart(): void {
  net.send({ t: 'leave' });
  net.close();
  view = null;
  setScreen('start');
}

// ---------- Server messages ----------

function onServer(msg: ServerMessage): void {
  if (msg.t === 'lobby') {
    if (screen !== 'lobby') setScreen('lobby');
    lobbyEndsAt = Date.now() + msg.startsInMs;
    renderLobby(msg.slots, msg.capacity);
  } else if (msg.t === 'start') {
    view = null;
    pending = [];
    selected = -1;
    half = false;
    mode = 'move';
    fitted = false;
    endShown = false;
    setScreen('game');
  } else if (msg.t === 'view') {
    onView(msg.view);
  } else if (msg.t === 'error') {
    if (msg.code === 'full' && joinAttempt < 3) play(joinAttempt + 1);
    else toast(msg.message);
  }
}

function onDisconnect(): void {
  if (screen === 'start') return;
  $('offline-sub').textContent =
    screen === 'game' ? 'Connection lost. Your general stays on the board until the game ends.' : 'Connection lost.';
  show('offline', true);
  setScreen('start');
}

function onView(v: PlayerView): void {
  const first = !view;
  view = v;
  pending = [];
  if (flags.length !== v.w * v.h) flags = new Uint8Array(v.w * v.h);

  if (first) {
    const humans = v.players.filter((p) => !p.isBot).length;
    track('game_start', { humans, bots: v.players.length - humans });
    selected = v.owner.findIndex((o, i) => o === v.you && v.terrain[i] === Terrain.General);
  }
  if (!fitted) {
    measureInsets();
    renderer.fit(v);
    fitted = true;
  }

  for (const ev of v.events) {
    if (ev.kind === 'explode') {
      fx.explode((ev.idx % v.w) + 0.5, Math.floor(ev.idx / v.w) + 0.5);
      if (ev.player === v.you) {
        buzz([30, 40, 90]);
        toast(`Boom! Lost ${ev.lost} troops, stunned 3 turns`);
      }
    } else if (ev.kind === 'eliminated') {
      const by = v.players[ev.by].name;
      const victim = v.players[ev.victim].name;
      if (ev.victim !== v.you) toast(ev.by === v.you ? `You captured ${victim}'s crown!` : `${by} captured ${victim}`);
    } else if (ev.kind === 'captureCity' && ev.player === v.you) {
      toast('City captured');
    } else if (ev.kind === 'captureTower' && ev.player === v.you) {
      toast('Watchtower captured');
    }
  }

  const me = v.players[v.you];
  if (!endShown && (v.winner >= 0 || !me.alive)) showEnd(v);
  updateHud();
}

function showEnd(v: PlayerView): void {
  endShown = true;
  selected = -1;
  const won = v.winner === v.you;
  const turn = Math.floor(v.tick / 2);
  if (won) {
    $('go-title').textContent = 'Victory';
    $('go-sub').textContent = `Last crown standing on turn ${turn}.`;
    buzz([20, 60, 20, 60, 120]);
  } else {
    $('go-title').textContent = 'Defeated';
    $('go-sub').textContent =
      v.winner >= 0 ? `${v.players[v.winner].name} won on turn ${turn}.` : `Your crown fell on turn ${turn}.`;
  }
  show('btn-watch', v.winner < 0);
  show('gameover', true);
  track('game_end', { won, turn, alive: v.players.filter((p) => p.alive).length });
}

// ---------- Lobby ----------

function renderLobby(slots: { name: string; you: boolean }[], capacity: number): void {
  const rows = slots.map((s) => `<li class="${s.you ? 'you' : ''}">${escapeHtml(s.name)}${s.you ? ' (you)' : ''}</li>`);
  for (let i = slots.length; i < capacity; i++) rows.push('<li class="empty">Waiting… a bot takes this seat at 0:00</li>');
  $('lobby-slots').innerHTML = rows.join('');
  renderLobbyTime();
}

function renderLobbyTime(): void {
  const secs = Math.max(0, Math.ceil((lobbyEndsAt - Date.now()) / 1000));
  $('lobby-time').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

setInterval(() => {
  if (screen === 'lobby') renderLobbyTime();
}, 250);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// ---------- Player actions ----------

function canAct(): boolean {
  return !!view && screen === 'game' && view.players[view.you].alive && view.winner < 0;
}

function ownsTile(idx: number): boolean {
  return !!view && idx >= 0 && view.owner[idx] === view.you;
}

function adjacent(a: number, b: number): boolean {
  if (!view) return false;
  const dx = Math.abs((a % view.w) - (b % view.w));
  const dy = Math.abs(Math.floor(a / view.w) - Math.floor(b / view.w));
  return dx + dy === 1;
}

function tryMove(from: number, to: number): boolean {
  if (!canAct() || !adjacent(from, to) || view!.terrain[to] === Terrain.Mountain) return false;
  net.send({ t: 'move', from, to, half });
  pending.push({ from, to, half });
  selected = to;
  half = false;
  return true;
}

function toggleFlag(idx: number): void {
  if (!view || idx < 0 || view.owner[idx] === view.you || view.terrain[idx] === Terrain.Mountain) return;
  flags[idx] ^= 1;
  buzz(12);
}

function undo(): void {
  if (!canAct()) return;
  const m = pending.pop() ?? view!.queue.pop();
  if (!m) return;
  net.send({ t: 'undo' });
  selected = m.from;
}

function clearQueue(): void {
  if (!canAct()) return;
  net.send({ t: 'clear' });
  pending = [];
  view!.queue = [];
}

new Input($('board'), renderer, {
  getBoard: () => view,
  onTap(idx) {
    if (!view) return;
    if (idx < 0) {
      selected = -1;
    } else if (mode === 'flag') {
      toggleFlag(idx);
    } else if (selected >= 0 && adjacent(selected, idx) && tryMove(selected, idx)) {
      // queued
    } else if (idx === selected && ownsTile(idx)) {
      half = !half;
    } else if (ownsTile(idx)) {
      selected = idx;
      half = false;
    } else {
      selected = -1;
    }
    updateControls();
  },
  onFlag: toggleFlag,
  onPathStart(idx) {
    if (mode !== 'move' || !ownsTile(idx) || !canAct()) return false;
    selected = idx;
    return true;
  },
  onPathStep(from, to) {
    tryMove(from, to);
  },
});

const DIRS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1],
  ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0],
};

window.addEventListener('keydown', (e) => {
  if (!view || screen !== 'game' || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const dir = DIRS[e.key];
  if (dir && selected >= 0) {
    e.preventDefault();
    const x = (selected % view.w) + dir[0];
    const y = Math.floor(selected / view.w) + dir[1];
    if (x >= 0 && y >= 0 && x < view.w && y < view.h) tryMove(selected, y * view.w + x);
  } else if (e.key === ' ') {
    half = !half;
  } else if (e.key === 'q') {
    clearQueue();
  } else if (e.key === 'e') {
    undo();
  } else if (e.key === 'f') {
    mode = mode === 'move' ? 'flag' : 'move';
  }
  updateControls();
});

$('btn-play').addEventListener('click', () => play());
$('name').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') play();
});
$('btn-lobby-leave').addEventListener('click', toStart);
$('btn-leave').addEventListener('click', () => {
  if (!canAct() || window.confirm('Leave this game? Your general stays on the board, undefended.')) toStart();
});
$('btn-again').addEventListener('click', () => play());
$('btn-menu').addEventListener('click', toStart);
$('btn-watch').addEventListener('click', () => show('gameover', false));
$('btn-retry').addEventListener('click', () => play());
$('btn-mode').addEventListener('click', () => {
  mode = mode === 'move' ? 'flag' : 'move';
  updateControls();
});
$('btn-half').addEventListener('click', () => {
  half = !half;
  updateControls();
});
$('btn-undo').addEventListener('click', undo);
$('btn-clear').addEventListener('click', clearQueue);
$('btn-home').addEventListener('click', () => {
  if (!view) return;
  const v = view;
  const g = v.owner.findIndex((o, i) => o === v.you && v.terrain[i] === Terrain.General);
  if (g < 0) return;
  renderer.centerOn(v, g);
  selected = g;
});

// ---------- Feedback ----------

let fbRating = 0;

function openFeedback(): void {
  fbRating = 0;
  $<HTMLFormElement>('feedback-form').reset();
  document.querySelectorAll('#fb-rating button').forEach((b) => b.classList.remove('on'));
  show('feedback', true);
}

/** Where the player was when they wrote it. Nothing that identifies them. */
function feedbackContext(): Record<string, string | number | boolean> {
  const ctx: Record<string, string | number | boolean> = {
    screen: screen === 'game' && endShown ? 'end' : screen,
    device: window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse',
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    version: '0.1.0',
  };
  if (view) {
    ctx.turn = Math.floor(view.tick / 2);
    ctx.humans = view.players.filter((p) => !p.isBot).length;
    ctx.result = view.winner === view.you ? 'won' : !view.players[view.you].alive ? 'lost' : 'playing';
  }
  return ctx;
}

$('fb-rating').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b?.dataset.v) return;
  fbRating = Number(b.dataset.v);
  document.querySelectorAll('#fb-rating button').forEach((x) => x.classList.toggle('on', x === b));
});

$('feedback-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const confusing = $<HTMLTextAreaElement>('fb-confusing').value.trim();
  const improve = $<HTMLTextAreaElement>('fb-improve').value.trim();
  if (!fbRating && !confusing && !improve) {
    toast('Pick a face or write a few words first');
    return;
  }
  const send = $<HTMLButtonElement>('fb-send');
  send.disabled = true;
  try {
    const res = await fetch('./api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: fbRating || null,
        confusing,
        improve,
        context: feedbackContext(),
        website: $<HTMLInputElement>('fb-website').value,
      }),
    });
    if (!res.ok) throw new Error(String(res.status));
    show('feedback', false);
    toast('Thanks! Your feedback was sent.');
    track('feedback_sent', { rating: fbRating || null });
  } catch {
    toast("Couldn't send. Check your connection and try again.");
  } finally {
    send.disabled = false;
  }
});

$('fb-cancel').addEventListener('click', () => show('feedback', false));
for (const id of ['btn-feedback-start', 'btn-feedback-hud', 'btn-feedback-end']) $(id).addEventListener('click', openFeedback);

// Install as app, when the browser offers it.
let installEvent: (Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e as typeof installEvent;
  show('btn-install', true);
});
$('btn-install').addEventListener('click', async () => {
  if (!installEvent) return;
  await installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  track('install_prompt', { outcome });
  installEvent = null;
  show('btn-install', false);
});

function renderPrivacy(): void {
  const off = analyticsOptedOut();
  show('privacy', analyticsConfigured());
  $('privacy-text').textContent = off
    ? 'Anonymous gameplay stats are off.'
    : 'Anonymous gameplay stats (no account, no personal data) help improve the game.';
  $('btn-privacy').textContent = off ? 'Turn on' : 'Turn off';
}
$('btn-privacy').addEventListener('click', () => {
  setAnalyticsOptOut(!analyticsOptedOut());
  renderPrivacy();
});

// ---------- HUD ----------

function updateControls(): void {
  $('btn-mode').classList.toggle('on', mode === 'flag');
  $('mode-label').textContent = mode === 'flag' ? 'Flag' : 'Move';
  $('mode-ico').textContent = mode === 'flag' ? '⚑' : '➔';
  $('btn-half').classList.toggle('on', half);
}

function updateHud(): void {
  if (!view) return;
  const v = view;
  $('turn').textContent = `Turn ${Math.floor(v.tick / 2)}`;
  const stun = v.stunTicksLeft;
  show('stun', stun > 0);
  if (stun > 0) {
    $('stun').style.setProperty('--p', String(stun / MINE_STUN_TICKS));
    $('stun-n').textContent = String(Math.ceil(stun / 2));
  }
  $('board-ranks').innerHTML = [...v.players]
    .sort((a, b) => Number(b.alive) - Number(a.alive) || b.army - a.army)
    .map(
      (p) =>
        `<li style="--c:${p.color}" class="${p.alive ? '' : 'dead'} ${p.id === v.you ? 'you' : ''}">` +
        `<b>${p.isBot ? '🤖 ' : ''}${escapeHtml(p.name)}</b><span>${formatArmy(p.army)} · ${p.land}</span></li>`,
    )
    .join('');
  updateControls();
}

function measureInsets(): void {
  renderer.insetTop = $('hud-top').getBoundingClientRect().height;
  renderer.insetBottom = $('hud-bottom').getBoundingClientRect().height;
}

let toastTimer = 0;
function toast(msg: string): void {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 1800);
}

function buzz(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

window.addEventListener('resize', () => {
  renderer.resize();
  measureInsets();
  if (view) renderer.fit(view);
});

// ---------- Render loop ----------

let lastFrame = performance.now();
function frame(now: number): void {
  const dt = Math.min(now - lastFrame, 250);
  lastFrame = now;
  fx.update(dt);
  if (view && screen === 'game') renderer.draw(view, { selected, half, flags, pending, fx });
  requestAnimationFrame(frame);
}

// Offline shell: production builds ship a service worker (see vite.config.ts).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline shell is a bonus */
    });
  });
}

try {
  $<HTMLInputElement>('name').value = localStorage.getItem(NAME_KEY) ?? '';
} catch {
  /* no stored name */
}
renderPrivacy();
setScreen('start');
track('app_open');
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  Object.assign(window, { __bm: { renderer, net, getView: () => view, flags: () => flags } });
}
