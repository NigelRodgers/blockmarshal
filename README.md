# Blockmarshal

Real-time territory war (generals.io) on a minesweeper board. Mobile-first web game, built to be wrapped as a native app later. See [PLAN.md](PLAN.md) for the agreed v1 scope and roadmap.

## Rules

- Six players per match on a 15x25 board. A lobby starts when six humans join or after a one-minute countdown; bots take empty seats.
- Your **general** and owned **cities** make +1 troop per turn; all owned land makes +1 every 25 turns. One turn = 2 ticks (500 ms each).
- Each tick you execute one queued move: all-but-one troops (or half) to an orthogonal neighbour.
- Neutral land hides **mines**. Tiles you've held show **red dots** on the side facing each neighbouring mine.
- Stepping on a mine: up to 15 arriving troops die, every army in the 8 surrounding tiles is halved, your move queue is wiped and you're stunned for 6 ticks.
- Watchtowers (eye) give vision and mine dots in a 7x7 area while held.
- Capture an enemy general to take their land (troops halved). Last general standing wins.

## Controls

| Touch | Mouse / keys |
| --- | --- |
| Tap own tile, tap neighbour: move | Click, click / WASD, arrows |
| Drag from own tile: queue a path | Drag |
| Tap selected tile again: move half | Space |
| Long-press: flag (only you see flags) | Right-click, or `F` for flag mode |
| Drag empty area / pinch: pan / zoom | Drag / wheel |
| Undo / Clear buttons | `E` / `Q` |

## Develop

Two processes: the game server and the Vite dev server (which proxies `/ws` to it).

```bash
npm install
npm run server   # game server on :5200 (WebSocket at /ws), restarts on change
npm run dev      # client on :5199, also reachable from phones on the same Wi-Fi
npm test         # engine, bots, matchmaking, fog-of-war views
npm run build    # typechecks client + server, static client bundle in dist/
npm start        # production-style: one process serving dist/ and /ws on $PORT
```

## Layout

- `src/engine/`: pure, deterministic, DOM-free game state (seeded map gen, tick resolution, mine dots, knowledge).
- `src/ai/bot.ts`: bots use only their own vision and the mine dots on their own tiles (easy bots ignore the dots).
- `src/net/`: wire protocol, the per-player fog-of-war view builder (server side) and the browser WebSocket client.
- `server/`: matchmaker (lobbies, countdown, bot fill), matches (one tick loop each) and the HTTP/WebSocket entry point.
- `src/ui/`: canvas renderer, touch/mouse input, effects. `src/main.ts` wires up start screen, lobby, HUD and render loop.

See [PLAN.md](PLAN.md) for the current direction, next steps and mechanic ideas.
