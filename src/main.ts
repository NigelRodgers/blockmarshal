import './style.css';
import { analyticsConfigured, analyticsOptedOut, setAnalyticsOptOut, track } from './analytics';
import { MAX_FLAGS, MAX_MINE_STOCK, MINE_STUN_TICKS, TICK_MS, isMode, type GameMode } from './engine/constants';
import { Terrain, type Move } from './engine/types';
import { LocalGame } from './local';
import { fetchReplay, findMatch, Net, replayLink, storeReplay, uploadReplay } from './net/client';
import { replaySeat, replayTurns, validateReplay, type ReplayRecord } from './replay';
import { ReplayPlayer } from './replayPlayer';
import { getReplay, listReplays, saveReplay } from './replayStore';
import type { ClientMessage, PlayerView, ServerMessage } from './net/protocol';
import { Effects } from './ui/effects';
import { Input } from './ui/input';
import { formatArmy, Renderer } from './ui/renderer';
import { CanvasRecorder, recorderEnabled } from './ui/recorder';
import { Sounds } from './ui/sound';

const NAME_KEY = 'blockmarshal.name';
const MODE_KEY = 'blockmarshal.mode';
const OPPONENT_KEY = 'blockmarshal.opponent';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Owner-only screen recorder (see ui/recorder.ts). */
const RECORDER = recorderEnabled();

const renderer = new Renderer($<HTMLCanvasElement>('board'));
const fx = new Effects();
const net = new Net(onServer, onDisconnect);
const sounds = new Sounds();

type Screen = 'start' | 'lobby' | 'game' | 'replay';
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

/** A browser-run game the player has paused (see the Pause section at the end). */
let gamePaused = false;

// Replay playback (see the Replays section at the end).
/** The game that just ended, for "Watch replay" on the end screen. */
let lastReplay: ReplayRecord | null = null;
let replayer: ReplayPlayer | null = null;
let replayView: PlayerView | null = null;
let replayTimer = 0;
let replaySpeed = 1;
let replayPaused = false;
/** The "replay no longer matches" notice was shown for the replay being watched. */
let replayWarned = false;
let lobbyEndsAt = 0;
/** Set while playing a browser-only match against bots. */
let local: LocalGame | null = null;

// ---------- Screens ----------

function show(id: string, on: boolean): void {
  $(id).classList.toggle('hidden', !on);
}

function setScreen(next: Screen): void {
  screen = next;
  if (next === 'game' || next === 'replay') guardHistory();
  show('start', next === 'start');
  show('lobby', next === 'lobby');
  show('hud', next === 'game');
  setPaused(false);
  show('replay-bar', next === 'replay');
  show('btn-rec', RECORDER && (next === 'game' || next === 'replay'));
  // In a replay only the record button of the HUD column shows (see .replaying in style.css).
  document.body.classList.toggle('replaying', next === 'replay');
  if (next !== 'replay') stopReplay();
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

/**
 * `?quick` in the URL: skip the lobby and play bots in this browser at once (for testing on a phone,
 * or a link to share). `?quick=duel` (or `?quick=1v1`) makes it a 1 vs 1. "Play again" stays in quick mode.
 */
const params = new URLSearchParams(location.search);
const QUICK = params.has('quick');
const QUICK_MODE: GameMode = ['duel', '1v1'].includes(params.get('quick') ?? '') ? 'duel' : 'ffa';

/** Start-screen choice: free-for-all, or 1 vs 1 against a human (matchmaking) or a bot (in the browser). */
let gameMode: GameMode = 'ffa';
let opponent: 'human' | 'bot' = 'human';
try {
  const m = localStorage.getItem(MODE_KEY);
  if (isMode(m)) gameMode = m;
  if (localStorage.getItem(OPPONENT_KEY) === 'bot') opponent = 'bot';
} catch {
  /* defaults */
}
if (QUICK) gameMode = QUICK_MODE;

/** A new game from any button: online, or straight into bots (`?quick`, or 1 vs 1 against a bot). */
function newGame(): void {
  if (QUICK || (gameMode === 'duel' && opponent === 'bot')) startLocal();
  else void play();
}

/** Play against bots in this browser: used for solo handoffs, offline, and `?quick`. */
function startLocal(): void {
  sounds.unlock();
  stopLocal();
  net.close();
  show('offline', false);
  view = null;
  local = new LocalGame(playerName(), onServer, gameMode);
  show('btn-pause', true);
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
    show('btn-pause', false);
    await net.connect(await findMatch(gameMode));
  } catch {
    setScreen('start');
    $('offline-sub').textContent = 'Check your connection and try again.';
    show('offline', true);
    return;
  }
  joinAttempt = attempt;
  net.send({ t: 'join', name: playerName(), mode: gameMode });
  if (attempt === 0) track('lobby_join', { game: gameMode });
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
    // A game can start straight from the end screen (`?quick` Play again): close it.
    show('gameover', false);
    show('btn-go-replay', false);
    view = null;
    pending = [];
    selected = -1;
    half = false;
    mode = 'move';
    fitted = false;
    endShown = false;
    setScreen('game');
    void sounds.play('horn');
  } else if (msg.t === 'view') {
    onView(msg.view);
  } else if (msg.t === 'solo') {
    // Nobody else joined: the server hands this game to the browser.
    startLocal();
  } else if (msg.t === 'replay') {
    if (lastReplay?.id === msg.replay.id) return; // a browser game can hand it over twice
    lastReplay = msg.replay;
    show('btn-go-replay', true);
    void saveReplay(msg.replay);
    // The server already has its own games; browser-run ones are sent for analytics (unless turned off).
    if (msg.replay.source === 'browser' && !analyticsOptedOut()) uploadReplay(msg.replay);
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
    track('game_start', { humans, bots: v.players.length - humans, mode: local ? 'local' : 'online', game: gameMode });
    selected = v.owner.findIndex((o, i) => o === v.you && v.terrain[i] === Terrain.General);
  }
  if (!fitted) {
    measureInsets();
    renderer.fit(v);
    placeToast(v);
    fitted = true;
  }

  for (const ev of v.events) {
    if (ev.kind === 'explode') {
      fx.explode((ev.idx % v.w) + 0.5, Math.floor(ev.idx / v.w) + 0.5);
      void sounds.play('thud', ev.player === v.you ? 1 : 0.45); // every blast is public; yours is loud
      if (ev.player === v.you) {
        buzz([30, 40, 90]);
        toast(`Boom! Lost ${ev.lost} troops, stunned 3 turns`);
      }
    } else if (ev.kind === 'eliminated') {
      const by = v.players[ev.by].name;
      const victim = v.players[ev.victim].name;
      // A crown falls: yours, or one you just took.
      // Your crown falls (deep boom, sagging horn) or you take one (boom, rising call).
      if (ev.victim === v.you) void sounds.play('fall');
      else if (ev.by === v.you) void sounds.play('capture');
      if (ev.victim !== v.you) toast(ev.by === v.you ? `You captured ${victim}'s crown!` : `${by} captured ${victim}`);
    } else if (ev.kind === 'defuse' && ev.player === v.you) {
      buzz(30);
      toast(
        ev.kept
          ? `Mine captured! Long-press one of your tiles connected to it to plant it (${v.minesInStock} in stock)`
          : `Stock full (${MAX_MINE_STOCK}): crossed safely, the mine stays here. Step on it again later to collect it`,
      );
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
  const duel = capacity === 2;
  $('lobby-title').textContent = duel ? 'Finding an opponent' : 'Finding players';
  $('lobby-sub').textContent = duel
    ? 'The game starts when another player joins. If nobody does before the timer ends, you play a bot.'
    : `The game starts when ${capacity} players join or the timer ends. Bots fill any empty seats.`;
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
  return !!view && screen === 'game' && !gamePaused && view.players[view.you].alive && view.winner < 0;
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
    // A mine you crossed with a full stock: its flag is what keeps it safe for you, so it stays.
    if (v.keptMines.includes(idx)) {
      toast(
        v.minesInStock < MAX_MINE_STOCK
          ? 'A mine you crossed: move onto it to collect it'
          : `A mine you crossed: plant one (stock ${MAX_MINE_STOCK}/${MAX_MINE_STOCK}), then move onto it to collect it`,
      );
      return;
    }
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
  // Your own mine can always be picked up; its lock (white ring) only stops enemies capturing it.
  const locked = v.moveCooldowns.find((c) => c.idx === idx)?.turns ?? 0;
  const full = v.minesInStock >= MAX_MINE_STOCK;
  const pick = $<HTMLButtonElement>('mm-pickup');
  pick.disabled = full;
  pick.textContent = full
    ? `Stock full (${MAX_MINE_STOCK}): plant one first`
    : locked
      ? `Pick up (locked to enemies ${locked} more turns)`
      : 'Pick up (move it)';
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

$('btn-play').addEventListener('click', newGame);

// ---------- Game mode picker ----------

function renderModePicker(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#mode-seg button')) {
    const on = b.dataset.mode === gameMode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#opp-seg button')) {
    const on = b.dataset.opp === opponent;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  show('opp-seg', gameMode === 'duel');
  $('btn-play').textContent = gameMode === 'duel' ? (opponent === 'bot' ? 'Play vs bot' : 'Find opponent') : 'Play';
}

function savePick(): void {
  try {
    localStorage.setItem(MODE_KEY, gameMode);
    localStorage.setItem(OPPONENT_KEY, opponent);
  } catch {
    /* just not remembered */
  }
  renderModePicker();
}

for (const b of document.querySelectorAll<HTMLButtonElement>('#mode-seg button')) {
  b.addEventListener('click', () => {
    if (isMode(b.dataset.mode)) gameMode = b.dataset.mode;
    savePick();
  });
}
for (const b of document.querySelectorAll<HTMLButtonElement>('#opp-seg button')) {
  b.addEventListener('click', () => {
    opponent = b.dataset.opp === 'bot' ? 'bot' : 'human';
    savePick();
  });
}
renderModePicker();
$('name').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') newGame();
});
$('btn-lobby-leave').addEventListener('click', toStart);
$('btn-leave').addEventListener('click', () => {
  if (!canAct() || window.confirm('Leave this game? Your general stays on the board, undefended.')) toStart();
});
$('btn-again').addEventListener('click', newGame);
$('btn-menu').addEventListener('click', toStart);
$('btn-watch').addEventListener('click', () => show('gameover', false));
$('btn-retry').addEventListener('click', newGame);
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
  // "Attach my last game" only shows when there is one.
  show('fb-attach-row', false);
  void listReplays().then((list) => show('fb-attach-row', list.length > 0));
  show('feedback', true);
}

/** The id of the newest replay in this browser, put on the server first; null if none or it failed. */
async function lastReplayId(): Promise<string | null> {
  const newest = (await listReplays())[0];
  const r = newest && (await getReplay(newest.id));
  return r && (await storeReplay(r)) ? r.id : null;
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
  document.querySelectorAll('#fb-rating button').forEach((x) => {
    x.classList.toggle('on', x === b);
    x.setAttribute('aria-pressed', String(x === b));
  });
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
    const attach = !$('fb-attach-row').classList.contains('hidden') && $<HTMLInputElement>('fb-attach').checked;
    const replayId = attach ? await lastReplayId() : null;
    const res = await fetch('./api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: fbRating || null,
        confusing,
        improve,
        context: feedbackContext(),
        website: $<HTMLInputElement>('fb-website').value,
        replayId,
      }),
    });
    if (!res.ok) throw new Error(String(res.status));
    show('feedback', false);
    toast('Thanks! Your feedback was sent.');
    track('feedback_sent', { rating: fbRating || null, replay: !!replayId });
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
  $('btn-mode').setAttribute('aria-pressed', String(mode === 'flag'));
  $('mode-label').textContent = mode === 'flag' ? `Flag ${used}/${MAX_FLAGS}` : `Move · ⚑${MAX_FLAGS - used}`;
  $('mode-ico').textContent = mode === 'flag' ? '⚑' : '➔';
  const stock = view?.minesInStock ?? 0;
  const refill = view?.refillTurns ?? 0;
  // Stocked mines show on the Flag button: the same gesture plants them. ⏱ = turns to the next refill.
  $('mine-stock').textContent = stock || refill ? `💣${stock}${refill ? ` ⏱${refill}` : ''}` : '';
  $('mine-stock').title = refill ? `${stock} mines in stock, +1 in ${refill} turns` : `${stock} mines in stock`;
  $('btn-half').classList.toggle('on', half);
  $('btn-half').setAttribute('aria-pressed', String(half));
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

/**
 * The HUD floats over the board, so in a game the board gets the whole screen. A replay
 * keeps room at the bottom for its control bar.
 */
function measureInsets(): void {
  renderer.insetTop = 0;
  renderer.insetBottom = screen === 'replay' ? $('replay-bar').offsetHeight + 10 || 54 : 0;
}

/**
 * Notices go in empty space next to the board so they don't cover tiles: below it if
 * there's room (usual on phones, where the board is limited by the screen's width),
 * else above it. Only a board that fills the whole height gets them on top of it.
 */
function placeToast(b: { w: number; h: number }): void {
  const el = $('toast');
  const need = (el.offsetHeight || 30) + 8;
  const top = renderer.toScreen(0, 0)[1];
  const below = renderer.vh - renderer.toScreen(0, b.h)[1];
  el.classList.toggle('above', below < need && top >= need);
}

let toastTimer = 0;
function toast(msg: string, ms = 1800): void {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
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
  const shown = view ?? replayView;
  if (shown) {
    renderer.fit(shown);
    placeToast(shown);
  }
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

/** No screen shake or pulsing for people who ask their system for less motion. */
const calmMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let lastFrame = performance.now();
function frame(now: number): void {
  const dt = Math.min(now - lastFrame, 250);
  lastFrame = now;
  fx.update(dt);
  if (view && screen === 'game') {
    renderer.draw(view, { selected, half, pending, fx, targets: relocationTargets(), calm: calmMotion.matches });
  } else if (replayView && screen === 'replay') {
    renderer.draw(replayView, { selected: -1, half: false, pending: [], fx, calm: calmMotion.matches });
  }
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

if (QUICK) {
  startLocal();
  track('quick_start', { game: gameMode });
} else if (params.get('replay')) {
  void openReplayLink(params.get('replay')!);
}

// ---------- Replays ----------

const REPLAY_SPEEDS = [0.5, 1, 2, 5, 10];
/** ⏪ / ⏩ jump this many ticks (10 turns). */
const REPLAY_JUMP = 20;

function stopReplay(): void {
  clearInterval(replayTimer);
  replayTimer = 0;
  replayer = null;
  replayView = null;
}

/** Watch a finished game: the whole board, from the first human's seat. */
function watchReplay(r: ReplayRecord): void {
  stopLocal();
  net.close();
  view = null;
  show('replays', false);
  show('gameover', false);
  setScreen('replay');
  replayer = new ReplayPlayer(r);
  replayPaused = false;
  replayWarned = false;
  ($('rp-seek') as HTMLInputElement).max = String(r.ticks);
  fitted = false;
  showReplayFrame();
  restartReplayTimer();
  renderReplayBar();
}

function showReplayFrame(): void {
  if (!replayer) return;
  replayView = replayer.view(replaySeat(replayer.record));
  if (!fitted) {
    measureInsets();
    renderer.fit(replayView);
    fitted = true;
  }
  for (const ev of replayView.events) {
    if (ev.kind === 'explode') fx.explode((ev.idx % replayView.w) + 0.5, Math.floor(ev.idx / replayView.w) + 0.5);
  }
  if (replayer.diverged && !replayWarned) {
    replayWarned = true;
    const made = replayer.record.build ? `build ${replayer.record.build}` : 'an older version';
    toast(`Made on ${made}, so this replay no longer matches the real game.`, 6000);
  }
  renderReplayBar();
}

function restartReplayTimer(): void {
  clearInterval(replayTimer);
  replayTimer = window.setInterval(() => {
    if (!replayer || replayPaused) return;
    if (replayer.done) {
      replayPaused = true;
      renderReplayBar();
      return;
    }
    replayer.step();
    showReplayFrame();
  }, TICK_MS / replaySpeed);
}

function renderReplayBar(): void {
  if (!replayer) return;
  const r = replayer.record;
  $('rp-play').textContent = replayPaused ? '▶' : '❚❚';
  $('rp-play').setAttribute('aria-label', replayPaused ? 'Play' : 'Pause');
  $('rp-speed').textContent = `${replaySpeed}×`;
  $('rp-turn').textContent = `Turn ${Math.floor(replayer.tick / 2)} / ${replayTurns(r)}`;
  ($('rp-seek') as HTMLInputElement).value = String(replayer.tick);
}

$('rp-play').addEventListener('click', () => {
  if (!replayer) return;
  if (replayer.done) {
    replayer.restart();
    showReplayFrame();
  }
  replayPaused = !replayPaused;
  renderReplayBar();
});
function replayJump(ticks: number): void {
  if (!replayer) return;
  replayer.seek(Math.max(0, Math.min(replayer.record.ticks, replayer.tick + ticks)));
  showReplayFrame();
}
$('rp-back').addEventListener('click', () => replayJump(-REPLAY_JUMP));
$('rp-fwd').addEventListener('click', () => replayJump(REPLAY_JUMP));

$('rp-speed').addEventListener('click', () => {
  replaySpeed = REPLAY_SPEEDS[(REPLAY_SPEEDS.indexOf(replaySpeed) + 1) % REPLAY_SPEEDS.length];
  restartReplayTimer();
  renderReplayBar();
});
$('rp-seek').addEventListener('change', () => {
  if (!replayer) return;
  replayer.seek(Number(($('rp-seek') as HTMLInputElement).value));
  showReplayFrame();
});
$('rp-close').addEventListener('click', () => {
  setScreen('start');
  void openReplayList();
});

$('btn-go-replay').addEventListener('click', () => {
  if (lastReplay) watchReplay(lastReplay);
});

/** The list of games kept in this browser. */
async function openReplayList(): Promise<void> {
  const list = await listReplays();
  const ul = $('replay-list');
  ul.innerHTML = list.length
    ? list
        .map((r) => {
          const result = r.winner < 0 ? 'Unfinished' : r.winner === r.seat ? 'Won' : 'Lost';
          const when = new Date(r.endedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
          const what = r.mode === 'duel' ? '1 vs 1' : 'Free-for-all';
          const id = escapeHtml(r.id);
          return (
            `<li><button data-id="${id}"><b>${result}</b> · ${what} · ${replayTurns(r)} turns` +
            `<span>${when} · <span class="rid">#${id.slice(0, 8)}</span></span></button>` +
            `<button class="act" data-share="${id}" aria-label="Copy a link to this replay">🔗</button>` +
            `<button class="act" data-download="${id}" aria-label="Save this replay as a file">⬇</button></li>`
          );
        })
        .join('')
    : '<li class="empty">No games yet. Finished games show up here.</li>';
  show('replays', true);
}

$('replay-list').addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest('button');
  const id = b?.dataset.id ?? b?.dataset.share ?? b?.dataset.download;
  if (!b || !id) return;
  const r = await getReplay(id);
  if (!r) return;
  if (b.dataset.share) return void shareReplay(r);
  if (b.dataset.download) return downloadReplay(r);
  watchReplay(r);
});

/** Put the replay on the server (a browser game may not be there yet), then share or copy its link. */
async function shareReplay(r: ReplayRecord): Promise<void> {
  if (!(await storeReplay(r))) return toast("Couldn't upload this replay. Check your connection and try again.");
  const url = replayLink(r.id);
  track('replay_shared');
  try {
    if (navigator.share) return void (await navigator.share({ title: 'Blockmarshal replay', url }));
  } catch {
    return; // closed the share sheet
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Replay link copied (it works for 60 days)', 3000);
  } catch {
    prompt('Replay link (works for 60 days):', url);
  }
}

function downloadReplay(r: ReplayRecord): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(r)], { type: 'application/json' }));
  a.download = `blockmarshal-replay-${new Date(r.endedAt).toISOString().slice(0, 10)}-${r.id.slice(0, 8)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** `?replay=<id>`: open a shared replay. */
async function openReplayLink(id: string): Promise<void> {
  const r = validateReplay(await fetchReplay(id), ['server', 'browser']);
  if (!r) return toast('That replay is gone (links last 60 days) or the link is wrong', 4000);
  track('replay_link_opened');
  watchReplay(r);
}
$('btn-replays').addEventListener('click', () => void openReplayList());
$('btn-replays-close').addEventListener('click', () => show('replays', false));

// A replay file downloaded to the PC (npm run replays): watch it here.
$('btn-replay-file').addEventListener('click', () => $('replay-file').click());
$('replay-file').addEventListener('change', async () => {
  const input = $<HTMLInputElement>('replay-file');
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const r = validateReplay(JSON.parse(await file.text()), ['server', 'browser']);
    if (r) watchReplay(r);
    else toast("That file isn't a Blockmarshal replay");
  } catch {
    toast("That file isn't a Blockmarshal replay");
  }
});

// ---------- Recorder (owner only) ----------

const recorder = new CanvasRecorder($<HTMLCanvasElement>('board'));
let recTimer = 0;

function renderRecButton(): void {
  const b = $('btn-rec');
  const on = recorder.recording;
  const secs = Math.floor(recorder.elapsed);
  b.textContent = on ? `● ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '●';
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', on ? 'Stop recording and save the video' : 'Start recording');
  show('btn-rec-cancel', on);
}

$('btn-rec-cancel').addEventListener('click', () => {
  recorder.cancel();
  clearInterval(recTimer);
  toast('Recording thrown away');
  renderRecButton();
});

$('btn-rec').addEventListener('click', () => {
  if (recorder.recording) {
    recorder.stop();
    clearInterval(recTimer);
    toast('Recording saved to your downloads');
  } else if (recorder.start()) {
    recTimer = window.setInterval(renderRecButton, 500);
    toast('Recording the board. Tap ● again to stop.');
  } else {
    toast("This browser can't record the board");
  }
  renderRecButton();
});

// ---------- Edge swipes (browser back/forward) ----------

/**
 * Phones turn a swipe from the screen edge into Back (left edge) or Forward (right edge),
 * which threw players out of a game. While a game or replay is on screen there's an extra
 * history entry, so Back lands on it and we stay; Forward has nowhere to go once we've
 * pushed it. Android's system back gesture can't be switched off by a page, so this catch
 * is what saves the game there.
 */
function guardHistory(): void {
  if (!history.state?.bmGuard) history.pushState({ bmGuard: true }, '');
}

window.addEventListener('popstate', () => {
  if (screen !== 'game' && screen !== 'replay') return;
  history.pushState({ bmGuard: true }, '');
  toast(screen === 'game' ? 'To leave the game, open ☰ and tap ✕' : 'To close the replay, tap ✕');
});

/** iOS Safari starts its back/forward swipe from about 20px in from either edge. */
const EDGE_PX = 24;
document.addEventListener(
  'touchstart',
  (e) => {
    if (screen !== 'game' && screen !== 'replay') return;
    if ((e.target as HTMLElement).closest('button, input, a, textarea')) return; // keep taps on controls working
    const x = e.touches[0]?.clientX ?? EDGE_PX;
    if (x < EDGE_PX || x > window.innerWidth - EDGE_PX) e.preventDefault();
  },
  { passive: false },
);

// ---------- Pause (games against bots in this browser) ----------

function setPaused(on: boolean): void {
  gamePaused = on && !!local && screen === 'game';
  if (gamePaused) local!.pause();
  else local?.resume();
  show('paused', gamePaused);
}

$('btn-pause').addEventListener('click', () => {
  closeGameMenu();
  setPaused(true);
});
$('btn-resume').addEventListener('click', () => setPaused(false));

// Leaving the page (switching apps, locking the phone, another tab) pauses it too: browsers
// slow down timers in hidden pages, so the bots would keep playing while you can't.
// Coming back shows the Paused panel, so you pick up when you're ready.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !gamePaused && !endShown) setPaused(true);
});
