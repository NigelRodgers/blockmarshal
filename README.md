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

Two processes: the Worker (via `wrangler dev`) and Vite (which proxies `/api` and `/ws` to it). Hosted on Cloudflare Workers + Durable Objects; see [DEPLOY.md](DEPLOY.md).

```bash
npm install
npm run build    # once: the local Worker serves dist/
npm run server   # Worker + Durable Objects on :8787
npm run dev      # client on :5199 with hot reload, also reachable from phones on the same Wi-Fi
npm test         # engine, bots, lobby/matchmaking, fog-of-war views
npm run deploy   # build + wrangler deploy
```

## Layout

- `src/engine/`: pure, deterministic, DOM-free game state (seeded map gen, tick resolution, mine dots, knowledge).
- `src/ai/bot.ts`: bots use only their own vision and the mine dots on their own tiles (easy bots ignore the dots).
- `src/net/`: wire protocol, the per-player fog-of-war view builder (server side) and the browser WebSocket client.
- `server/`: runtime-independent match logic (`match.ts`: lobby, countdown, bot fill, tick loop) and the matchmaker's lobby index.
- `worker/`: Cloudflare Worker entry plus the `MatchDO` / `MatchmakerDO` Durable Objects that host the above.
- `src/ui/`: canvas renderer, touch/mouse input, effects. `src/main.ts` wires up start screen, lobby, HUD and render loop.

Start with [CLAUDE.md](CLAUDE.md) (how to work on it + backlog). Shipped changes: [CHANGELOG.md](CHANGELOG.md). Design history: [PLAN.md](PLAN.md).
