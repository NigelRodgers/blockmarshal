import './style.css';
import type { Bot, Difficulty } from './ai/bot';
import { MINE_STUN_TICKS, PLAYER_NAMES } from './engine/constants';
import { clearQueue as engineClear, createGame, playerStats, queueMove, stunTicksLeft, undoMove, visionFor } from './engine/game';
import { Memory, Terrain, type GameState } from './engine/types';
import { Effects } from './ui/effects';
import { Input } from './ui/input';
import { createBots, runTick } from './session';
import { formatArmy, Renderer } from './ui/renderer';

const HUMAN = 0;

interface Settings {
  opponents: string;
  difficulty: Difficulty;
  size: 'S' | 'M' | 'L';
  speed: 'chill' | 'normal' | 'blitz';
}

const SIZES = { S: { w: 12, h: 16 }, M: { w: 15, h: 21 }, L: { w: 18, h: 26 } };
const TICK_MS = { chill: 700, normal: 500, blitz: 320 };
const SETTINGS_KEY = 'blockmarshal.settings';
const DEFAULT_TILE_PX = 30;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const settings: Settings = loadSettings();
const renderer = new Renderer($<HTMLCanvasElement>('board'));
const fx = new Effects();

let state: GameState | null = null;
let bots: Bot[] = [];
let selected = -1;
let half = false;
let mode: 'move' | 'flag' = 'move';
let running = false;
let spectating = false;
let acc = 0;
let lastFrame = performance.now();

// ---------- Settings ----------

function loadSettings(): Settings {
  const defaults: Settings = { opponents: '1', difficulty: 'normal', size: 'M', speed: 'normal' };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}

document.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
  const key = seg.dataset.key as keyof Settings;
  const sync = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings[key]));
  seg.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b?.dataset.v) return;
    (settings as unknown as Record<string, string>)[key] = b.dataset.v;
    saveSettings();
    sync();
  });
  sync();
});

// ---------- Game lifecycle ----------

function startGame(): void {
  const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
  const { w, h } = SIZES[settings.size];
  const n = 1 + Number(settings.opponents);
  state = createGame({
    w,
    h,
    seed,
    players: Array.from({ length: n }, (_, i) => ({ name: PLAYER_NAMES[i], isBot: i !== HUMAN })),
  });
  bots = createBots(state, settings.difficulty);
  selected = state.players[HUMAN].general;
  half = false;
  mode = 'move';
  spectating = false;
  acc = 0;
  running = true;

  show('menu', false);
  show('gameover', false);
  show('pause', false);
  show('hud-top', true);
  show('hud-bottom', true);
  measureInsets();
  renderer.fit(w, h);
  // Phones: don't shrink tiles below a readable size; pinch out to see more.
  if (renderer.cam.scale < DEFAULT_TILE_PX) {
    renderer.cam.scale = DEFAULT_TILE_PX;
    renderer.centerOn(state, selected);
  }
  updateHud();
}

function tick(): void {
  if (!state) return;
  runTick(state, bots);

  const vis = visionFor(state, HUMAN);
  for (const ev of state.events) {
    if (ev.kind === 'explode') {
      if (vis[ev.idx] || spectating) fx.explode((ev.idx % state.w) + 0.5, Math.floor(ev.idx / state.w) + 0.5);
      if (ev.player === HUMAN) {
        buzz([30, 40, 90]);
        toast(`Boom! Lost ${ev.lost} troops, stunned 3 turns`);
      }
    } else if (ev.kind === 'eliminated') {
      const by = state.players[ev.by].name;
      const victim = state.players[ev.victim].name;
      if (ev.victim === HUMAN) {
        endGame(false, `${by} captured your general.`);
      } else {
        toast(ev.by === HUMAN ? `You captured ${victim}'s general!` : `${by} captured ${victim}`);
      }
    } else if (ev.kind === 'captureCity' && ev.player === HUMAN) {
      toast('City captured');
    } else if (ev.kind === 'captureTower' && ev.player === HUMAN) {
      toast('Watchtower captured: area revealed');
    }
  }

  if (state.winner >= 0) {
    running = false;
    if (state.winner === HUMAN) endGame(true, `Won on turn ${Math.floor(state.tick / 2)}.`);
    else if (spectating) endGame(false, `${state.players[state.winner].name} wins.`);
  }
  updateHud();
}

function endGame(won: boolean, sub: string): void {
  $('go-title').textContent = won ? 'Victory' : 'Defeat';
  $('go-sub').textContent = sub;
  show('btn-watch', !won && !!state && state.winner < 0);
  show('gameover', true);
  selected = -1;
  if (won) buzz([20, 60, 20, 60, 120]);
}

function show(id: string, on: boolean): void {
  $(id).classList.toggle('hidden', !on);
}

// ---------- Player actions ----------

function ownsTile(idx: number): boolean {
  return !!state && idx >= 0 && state.owner[idx] === HUMAN;
}

function toggleFlag(idx: number): void {
  if (!state || idx < 0 || !state.players[HUMAN].alive) return;
  const me = state.players[HUMAN];
  if (me.revealed[idx] || state.owner[idx] >= 0 || state.crater[idx] || me.memory[idx] !== Memory.None) return;
  if (state.terrain[idx] !== Terrain.Plain && visionFor(state, HUMAN)[idx]) return;
  me.flags[idx] ^= 1;
  buzz(12);
  updateHud();
}

function tryMove(from: number, to: number): boolean {
  if (!state || !queueMove(state, HUMAN, from, to, half)) return false;
  selected = to;
  half = false;
  return true;
}

new Input($('board'), renderer, {
  getState: () => state,
  onTap(idx) {
    if (!state || !state.players[HUMAN].alive) return;
    if (idx < 0) {
      selected = -1;
    } else if (mode === 'flag') {
      toggleFlag(idx);
    } else if (selected >= 0 && state.n4[selected].includes(idx) && tryMove(selected, idx)) {
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
    if (mode !== 'move' || !ownsTile(idx) || !state?.players[HUMAN].alive) return false;
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
  if (!state || !running) return;
  const dir = DIRS[e.key];
  if (dir && selected >= 0) {
    e.preventDefault();
    const x = (selected % state.w) + dir[0];
    const y = Math.floor(selected / state.w) + dir[1];
    if (x >= 0 && y >= 0 && x < state.w && y < state.h) tryMove(selected, y * state.w + x);
  } else if (e.key === ' ') {
    half = !half;
  } else if (e.key === 'q') {
    clearQueue();
  } else if (e.key === 'e') {
    undo();
  } else if (e.key === 'f') {
    toggleMode();
  } else if (e.key === 'Escape') {
    pause();
  }
  updateControls();
});

function undo(): void {
  const m = state && undoMove(state, HUMAN);
  if (m) selected = m.from;
}

function clearQueue(): void {
  if (state) engineClear(state, HUMAN);
}

function toggleMode(): void {
  mode = mode === 'move' ? 'flag' : 'move';
}

function pause(): void {
  if (!state || state.winner >= 0 || !$('gameover').classList.contains('hidden')) return;
  running = false;
  show('pause', true);
}

$('btn-mode').addEventListener('click', () => {
  toggleMode();
  updateControls();
});
$('btn-half').addEventListener('click', () => {
  half = !half;
  updateControls();
});
$('btn-undo').addEventListener('click', undo);
$('btn-clear').addEventListener('click', clearQueue);
$('btn-home').addEventListener('click', () => {
  if (!state) return;
  const g = state.players[HUMAN].general;
  renderer.centerOn(state, g);
  if (ownsTile(g)) selected = g;
});
$('btn-play').addEventListener('click', startGame);
$('btn-pause').addEventListener('click', pause);
$('btn-resume').addEventListener('click', () => {
  show('pause', false);
  running = true;
});
$('btn-restart').addEventListener('click', startGame);
$('btn-again').addEventListener('click', startGame);
$('btn-watch').addEventListener('click', () => {
  spectating = true;
  running = true;
  show('gameover', false);
});
for (const id of ['btn-quit', 'btn-menu']) {
  $(id).addEventListener('click', () => {
    running = false;
    show('pause', false);
    show('gameover', false);
    show('hud-top', false);
    show('hud-bottom', false);
    show('menu', true);
  });
}

const autoPause = !(import.meta.env.DEV && new URLSearchParams(location.search).has('nopause'));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && autoPause) pause();
});

// ---------- HUD ----------

function updateControls(): void {
  $('btn-mode').classList.toggle('on', mode === 'flag');
  $('mode-label').textContent = mode === 'flag' ? 'Flag' : 'Move';
  $('mode-ico').textContent = mode === 'flag' ? '⚑' : '➔';
  $('btn-half').classList.toggle('on', half);
}

function updateHud(): void {
  if (!state) return;
  const st = playerStats(state);
  $('turn').textContent = `Turn ${Math.floor(state.tick / 2)}`;
  const me = state.players[HUMAN];
  let flags = 0;
  for (let i = 0; i < state.size; i++) flags += me.flags[i];
  $('mines-left').textContent = String(state.mineCount - flags);
  const stun = stunTicksLeft(state, HUMAN);
  show('stun', stun > 0);
  if (stun > 0) {
    $('stun').style.setProperty('--p', String(stun / MINE_STUN_TICKS));
    $('stun-n').textContent = String(Math.ceil(stun / 2));
  }
  $('board-ranks').innerHTML = state.players
    .map((p) => ({ p, s: st[p.id] }))
    .sort((a, b) => b.s.army - a.s.army)
    .map(
      ({ p, s }) =>
        `<li style="--c:${p.color}" class="${p.alive ? '' : 'dead'}"><b>${p.name}</b><span>${formatArmy(s.army)} · ${s.land}</span></li>`,
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
});

// ---------- Main loop ----------

// Simulation runs on a timer, independent of rendering, so the tick rate holds
// even when the browser throttles animation frames. Backgrounding pauses the game.
let lastPump = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(now - lastPump, 1000);
  lastPump = now;
  if (!running || !state || state.winner >= 0) return;
  acc += dt;
  const ms = TICK_MS[settings.speed];
  while (acc >= ms) {
    acc -= ms;
    tick();
  }
}, 50);

function frame(now: number): void {
  const dt = Math.min(now - lastFrame, 250);
  lastFrame = now;
  fx.update(dt);
  if (state) {
    const me = state.players[HUMAN];
    renderer.draw(state, { pid: HUMAN, selected, half, revealAll: !me.alive || state.winner >= 0, fx });
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  Object.assign(window, { __mf: { renderer, getState: () => state, tick } });
}
