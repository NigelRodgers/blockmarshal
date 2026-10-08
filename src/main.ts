import './style.css';
import { analyticsConfigured, analyticsOptedOut, setAnalyticsOptOut, track } from './analytics';
import { MAX_FLAGS, MINE_STUN_TICKS } from './engine/constants';
import { Terrain, type Move } from './engine/types';
import { LocalGame } from './local';
import { findMatch, Net } from './net/client';
import type { ClientMessage, PlayerView, ServerMessage } from './net/protocol';
import { Effects } from './ui/effects';
import { Input } from './ui/input';
import { formatArmy, Renderer } from './ui/renderer';
import { Sounds } from './ui/sound';

const NAME_KEY = 'blockmarshal.name';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const renderer = new Renderer($<HTMLCanvasElement>('board'));
const fx = new Effects();
const net = new Net(onServer, onDisconnect);
const sounds = new Sounds();

type Screen = 'start' | 'lobby' | 'game';
let screen: Screen = 'start';
let view: PlayerView | null = null;
/** Moves sent since the last server view, drawn until the server echoes them back. */
let pending: Move[] = [];
let selected = -1;
let half = false;
/** What a tap on the board does: move troops, or flag (which also plants stocked mines). */
let mode: 'move' | 'flag' = 'move';
let fitted = false;
let endShown = false;
let lobbyEndsAt = 0;
/** Set while playing a browser-only match against bots. */
let local: LocalGame | null = null;

// ---------- Screens ----------

function show(id: string, on: boolean): void {
  $(id).classList.toggle('hidden', !on);
}

function setScreen(next: Screen): void {
  screen = next;
  show('start', next === 'start');
  show('lobby', next === 'lobby');
  show('hud', next === 'game');
  if (next !== 'game') closeGameMenu();
  if (next !== 'game') show('gameover', false);
}

function playerName(): string {
  return $<HTMLInputElement>('name').value.trim();
}

/** Player input goes to the local match if there is one, otherwise to the server. */
function send(msg: ClientMessage): void {
  if (local) local.send(msg);
  else net.send(msg);
}

function stopLocal(): void {
  local?.stop();
  local = null;
}

/** Play against bots in this browser: used for solo handoffs and when offline. */
function startLocal(): void {
  sounds.unlock();
  stopLocal();
  net.close();
  show('offline', false);
  view = null;
  local = new LocalGame(playerName(), onServer);
}

async function play(attempt = 0): Promise<void> {
  sounds.unlock(); // inside the Play tap, so the start horn can play later
  stopLocal();
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
  if (local) stopLocal();
  else net.send({ t: 'leave' });
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
    void sounds.play('start');
  } else if (msg.t === 'view') {
    onView(msg.view);
  } else if (msg.t === 'solo') {
    // Nobody else joined: the server hands this game to the browser.
    startLocal();
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

  if (first) {
    const humans = v.players.filter((p) => !p.isBot).length;
    track('game_start', { humans, bots: v.players.length - humans, mode: local ? 'local' : 'online' });
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
      // A crown falls: yours, or one you just took.
      if (ev.victim === v.you || ev.by === v.you) void sounds.play('fall');
      if (ev.victim !== v.you) toast(ev.by === v.you ? `You captured ${victim}'s crown!` : `${by} captured ${victim}`);
    } else if (ev.kind === 'defuse' && ev.player === v.you) {
      buzz(30);
      toast(`Mine captured! Long-press one of your tiles connected to it to plant it (${v.minesInStock} in stock)`);
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
  closeMineMenu();
  closeBuildMenu();
  closeGameMenu();
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
  send({ t: 'move', from, to, half });
  pending.push({ from, to, half });
  selected = to;
  half = false;
  return true;
}

/**
 * The flag gesture (long-press, right-click, or a tap in Flag mode).
 * On one of your own open tiles while you hold captured mines, it plants one;
 * everywhere else it toggles a flag. Flags live on the server (they matter for
 * capturing mines) but only you ever see yours.
 */
function flagGesture(idx: number): void {
  if (!canAct() || idx < 0 || view!.terrain[idx] === Terrain.Mountain) return;
  const v = view!;
  if (v.owner[idx] === v.you) {
    // Your own land: your mines and buildings get a menu, open tiles get a mine if you have one.
    if (v.myMines.includes(idx)) return openMineMenu(idx);
    if (v.terrain[idx] === Terrain.General || v.terrain[idx] === Terrain.City) return openBuildMenu(idx);
    if (v.terrain[idx] === Terrain.Plain && v.minesInStock > 0) {
      if (plantableAnchor(v, idx) >= 0) return plantMine(idx);
      toast("Mines only move within one connected stretch of your land: plant it where it came from");
      return;
    }
    toast(
      v.terrain[idx] !== Terrain.Plain
        ? "Mines can't go on generals, cities or towers"
        : 'No mines to plant yet: flag a mine, then move onto it to capture it',
    );
    return;
  }
  toggleFlag(idx);
}

function toggleFlag(idx: number): void {
  const v = view!;
  const has = v.flags.includes(idx);
  if (!has && v.flags.length >= MAX_FLAGS) {
    toast(`All ${MAX_FLAGS} flags are out. Remove one first.`);
    return;
  }
  send({ t: 'flag', idx });
  v.flags = has ? v.flags.filter((f) => f !== idx) : [...v.flags, idx]; // shown now, confirmed next tick
  buzz(12);
  updateControls();
}

// ---------- Moving your general or a city ----------

let buildTile = -1;
/** True while choosing where to move buildTile. */
let relocating = false;

function openBuildMenu(idx: number): void {
  const v = view!;
  buildTile = idx;
  relocating = false;
  const what = v.terrain[idx] === Terrain.General ? 'general' : 'city';
  const wait = v.moveCooldowns.find((c) => c.idx === idx)?.turns ?? 0;
  const btn = $('bm-move') as HTMLButtonElement;
  btn.textContent = wait ? `Move ${what} (in ${wait} turns)` : `Move ${what}`;
  btn.disabled = wait > 0;
  placeMenu($('build-menu'), idx);
  buzz(12);
}

function closeBuildMenu(): void {
  buildTile = -1;
  relocating = false;
  show('build-menu', false);
  updateControls();
}

/** Your tiles connected to idx through your own land (sides only): the engine's `island`, on the view. */
function landOf(v: PlayerView, idx: number): Uint8Array {
  const out = new Uint8Array(v.owner.length);
  if (v.owner[idx] !== v.you) return out;
  const stack = [idx];
  out[idx] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % v.w;
    const y = Math.floor(i / v.w);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= v.w || ny >= v.h) continue;
      const j = ny * v.w + nx;
      if (out[j] || v.owner[j] !== v.you) continue;
      out[j] = 1;
      stack.push(j);
    }
  }
  return out;
}

/** Index into stockAnchors of a mine that may be planted at idx (same connected land), or -1. */
function plantableAnchor(v: PlayerView, idx: number): number {
  const land = landOf(v, idx);
  return v.stockAnchors.findIndex((a) => land[a] === 1);
}

/** Same rule the server enforces: your own open tile on the same stretch of land, no mine, not touching another general or city. */
function canMoveBuildingTo(v: PlayerView, from: number, to: number, land = landOf(v, from)): boolean {
  if (to === from || !land[to] || v.terrain[to] !== Terrain.Plain || v.myMines.includes(to)) return false;
  const x = to % v.w;
  const y = Math.floor(to / v.w);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= v.w || ny >= v.h) continue;
      const j = ny * v.w + nx;
      if (j !== from && (v.terrain[j] === Terrain.General || v.terrain[j] === Terrain.City)) return false;
    }
  }
  return true;
}

function relocationTargets(): number[] {
  const v = view;
  if (!v || !relocating || buildTile < 0) return [];
  const out: number[] = [];
  const land = landOf(v, buildTile);
  for (let i = 0; i < v.owner.length; i++) if (canMoveBuildingTo(v, buildTile, i, land)) out.push(i);
  return out;
}

$('bm-move').addEventListener('click', () => {
  if (buildTile < 0 || !view) return;
  show('build-menu', false);
  relocating = true;
  if (!relocationTargets().length) {
    toast('No room: it needs an open tile on this stretch of your land, not touching another general or city');
    closeBuildMenu();
    return;
  }
  toast('Tap a highlighted tile to move it there');
  updateControls();
});
$('bm-cancel').addEventListener('click', closeBuildMenu);

function finishRelocate(idx: number): void {
  const v = view;
  const from = buildTile;
  if (!v || from < 0) return closeBuildMenu();
  if (idx === from) return closeBuildMenu();
  if (!canMoveBuildingTo(v, from, idx)) {
    toast("Can't go there: pick a highlighted tile (or tap the building to cancel)");
    return;
  }
  send({ t: 'relocate', from, to: idx });
  // Shown now, confirmed next tick.
  v.terrain[idx] = v.terrain[from];
  v.terrain[from] = Terrain.Plain;
  if (selected === from) selected = idx;
  buzz(20);
  closeBuildMenu();
}

/** Position a small floating menu just below a tile, kept on screen. */
function placeMenu(menu: HTMLElement, idx: number): void {
  const v = view!;
  const [x, y] = renderer.toScreen((idx % v.w) + 0.5, Math.floor(idx / v.w) + 0.5);
  menu.classList.remove('hidden');
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, x - r.width / 2))}px`;
  menu.style.top = `${Math.max(8, Math.min(window.innerHeight - r.height - 8, y + renderer.cam.scale * 0.6))}px`;
}

// ---------- Menu for your own planted mines ----------

let menuTile = -1;

function openMineMenu(idx: number): void {
  const v = view!;
  menuTile = idx;
  $('mm-flag').textContent = v.flags.includes(idx) ? 'Remove flag' : 'Flag it (walk over safely)';
  const wait = v.moveCooldowns.find((c) => c.idx === idx)?.turns ?? 0;
  const pick = $('mm-pickup') as HTMLButtonElement;
  pick.textContent = wait ? `Pick up (in ${wait} turns)` : 'Pick up (move it)';
  pick.disabled = wait > 0;
  placeMenu($('mine-menu'), idx);
  buzz(12);
}

function closeMineMenu(): void {
  menuTile = -1;
  show('mine-menu', false);
}

$('mm-flag').addEventListener('click', () => {
  if (menuTile >= 0 && canAct()) toggleFlag(menuTile);
  closeMineMenu();
});
$('mm-pickup').addEventListener('click', () => {
  const v = view;
  if (menuTile >= 0 && v && canAct()) {
    send({ t: 'pickup', idx: menuTile });
    v.myMines = v.myMines.filter((m) => m !== menuTile);
    v.flags = v.flags.filter((f) => f !== menuTile);
    v.minesInStock++;
    v.stockAnchors = [...v.stockAnchors, menuTile];
    toast('Mine picked up. Long-press an open tile on this same stretch of land to plant it again.');
    updateControls();
  }
  closeMineMenu();
});
$('mm-cancel').addEventListener('click', closeMineMenu);

function plantMine(idx: number): void {
  const v = view!;
  send({ t: 'drop', idx });
  const used = plantableAnchor(v, idx);
  v.stockAnchors = v.stockAnchors.filter((_, k) => k !== used);
  v.minesInStock--;
  v.myMines = [...v.myMines, idx]; // shown now, confirmed next tick
  buzz(20);
  toast(v.minesInStock ? `Mine planted. ${v.minesInStock} left to plant.` : 'Mine planted. Flag it to walk over it safely.');
  updateControls();
}

function undo(): void {
  if (!canAct()) return;
  const m = pending.pop() ?? view!.queue.pop();
  if (!m) return;
  send({ t: 'undo' });
  selected = m.from;
}

function clearQueue(): void {
  if (!canAct()) return;
  send({ t: 'clear' });
  pending = [];
  view!.queue = [];
}

new Input($('board'), renderer, {
  getBoard: () => view,
  onTap(idx) {
    if (!view) return;
    if (gameMenuOpen) closeGameMenu();
    if (menuTile >= 0) return closeMineMenu();
    if (buildTile >= 0 && !relocating) return closeBuildMenu();
    if (relocating) return finishRelocate(idx);
    if (idx < 0) {
      selected = -1;
    } else if (mode === 'flag') {
      flagGesture(idx);
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
  onFlag: flagGesture,
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
    mode = mode === 'flag' ? 'move' : 'flag';
  } else if (e.key === 'Escape') {
    closeGameMenu();
    closeMineMenu();
    closeBuildMenu();
  } else if (e.key === 'm') {
    sounds.toggle();
    renderSoundButton();
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
$('btn-offline-solo').addEventListener('click', startLocal);
$('btn-mode').addEventListener('click', () => {
  mode = mode === 'flag' ? 'move' : 'flag';
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
  selected = g;
  updateControls();
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
  const used = view?.flags.length ?? 0;
  $('btn-mode').classList.toggle('on', mode === 'flag');
  $('mode-label').textContent = mode === 'flag' ? `Flag ${used}/${MAX_FLAGS}` : `Move · ⚑${MAX_FLAGS - used}`;
  $('mode-ico').textContent = mode === 'flag' ? '⚑' : '➔';
  const stock = view?.minesInStock ?? 0;
  // Stocked mines show on the Flag button: the same gesture plants them.
  $('mine-stock').textContent = stock ? `💣${stock}` : '';
  $('btn-half').classList.toggle('on', half);
  $('hud-badge').textContent = relocating ? '⇄' : mode === 'flag' ? '⚑' : half ? '½' : '';
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

/** The HUD floats over the board, so the board gets the whole screen. */
function measureInsets(): void {
  renderer.insetTop = 0;
  renderer.insetBottom = 0;
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

// ---------- Floating game menu ----------

let gameMenuOpen = false;

function openGameMenu(): void {
  gameMenuOpen = true;
  show('game-menu', true);
  $('btn-menu-hud').setAttribute('aria-expanded', 'true');
  updateHud();
}

function closeGameMenu(): void {
  gameMenuOpen = false;
  show('game-menu', false);
  $('btn-menu-hud').setAttribute('aria-expanded', 'false');
}

$('btn-menu-hud').addEventListener('click', () => (gameMenuOpen ? closeGameMenu() : openGameMenu()));
// Actions that finish what you came to the menu for close it, so the board is clear again.
for (const id of ['btn-undo', 'btn-clear', 'btn-home', 'btn-feedback-hud', 'btn-leave']) {
  $(id).addEventListener('click', closeGameMenu);
}

// ---------- Sound ----------

function renderSoundButton(): void {
  const b = $('btn-sound');
  b.innerHTML = sounds.muted ? '&#128263;' : '&#128266;';
  b.setAttribute('aria-label', sounds.muted ? 'Unmute sound' : 'Mute sound');
}
$('btn-sound').addEventListener('click', () => {
  sounds.unlock();
  sounds.toggle();
  renderSoundButton();
});
renderSoundButton();

// ---------- Page lock ----------
// Stop the browser moving or zooming the whole page: pinch, double-tap zoom,
// rubber-band scrolling. Only open menus (overlays) may scroll vertically.
function insideScrollable(t: EventTarget | null): boolean {
  return t instanceof Element && !!t.closest('.overlay:not(.hidden)');
}
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length > 1 || !insideScrollable(e.target)) e.preventDefault();
  },
  { passive: false },
);
for (const name of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(name, (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey) e.preventDefault(); // trackpad pinch on desktop
  },
  { passive: false },
);

// ---------- Render loop ----------

let lastFrame = performance.now();
function frame(now: number): void {
  const dt = Math.min(now - lastFrame, 250);
  lastFrame = now;
  fx.update(dt);
  if (view && screen === 'game') renderer.draw(view, { selected, half, pending, fx, targets: relocationTargets() });
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
$('build').textContent = `Build ${__BUILD__}`;
track('app_open');
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  Object.assign(window, { __bm: { renderer, net, sounds, send, getView: () => view } });
}
