# Blockmarshal

Real-time territory war (generals.io) on a minesweeper board. Mobile-first web game, built to be wrapped as a native app later. See [PLAN.md](PLAN.md) for the agreed v1 scope and roadmap.

## Rules

- Your **general** and owned **cities** make +1 troop per turn; all owned land makes +1 every 25 turns. One turn = 2 ticks.
- Each tick you execute one queued move: all-but-one troops (or half) to an orthogonal neighbour.
- Neutral land hides **mines** (~18% of plains). Every tile you capture reveals its minesweeper number (mines among the 8 neighbours); zeros cascade up to 3 steps.
- Stepping on a mine: up to 15 arriving troops die, every army in the 8 surrounding tiles is halved (neutral cities too), and your move queue is wiped. The tile becomes a crater.
- The 3x3 around every general is mine-free (minesweeper's safe first click).
- Capture an enemy general to take their land (troops halved). Last general standing wins.

## Controls

| Touch | Mouse / keys |
| --- | --- |
| Tap own tile, tap neighbour: move | Click, click / WASD, arrows |
| Drag from own tile: queue a path | Drag |
| Tap selected tile again: move half | Space |
| Long-press: flag | Right-click, or `F` for flag mode |
| Drag empty area / pinch: pan / zoom | Drag / wheel |
| Undo / Clear buttons | `E` / `Q` |

## Develop

```bash
npm install
npm run dev      # http://localhost:5199 (add ?nopause to stop auto-pause when the tab hides)
npm test         # engine + bot-vs-bot simulation
npm run build    # static bundle in dist/, relative paths
```

## Layout

- `src/engine/`: pure, deterministic, DOM-free game state (seeded map gen, tick resolution, mine knowledge). Meant to run unchanged on a multiplayer server.
- `src/ai/bot.ts`: bots use only their own vision and known numbers, with simple minesweeper deduction (easy bots don't deduce).
- `src/ui/`: canvas renderer, touch/mouse input, effects. `src/main.ts` wires up the HUD and game loop.

## Roadmap

1. Native app: add Capacitor (`@capacitor/core`, `@capacitor/android`), `webDir: dist`. Swap `navigator.vibrate` for `@capacitor/haptics`.
2. Multiplayer: authoritative server running `src/engine` (WebSocket), clients send moves and receive per-player fog-filtered state.
3. PWA offline service worker, sounds, replays (seed + move log already reproduce a game).
