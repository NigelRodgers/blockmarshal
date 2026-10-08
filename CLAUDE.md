# Blockmarshal: session guide

Real-time 6-player territory war (generals.io-style) on a hidden minefield. Mobile-first web game.

- **Live:** https://blockmarshal.rodgersnigel.workers.dev (start screen shows `Build <git hash> · <time>`)
- **Repo:** github.com/NigelRodgers/blockmarshal (PRIVATE, branch `main`)
- **Player rules + every number:** [Blockmarshal: Game Rules & Numbers](https://claude.ai/code/artifact/e88a1b81-7a45-4e71-872f-f065ac6019a5) (Claude Doc). Update it whenever a rule or number changes.
- **What shipped, when:** [CHANGELOG.md](CHANGELOG.md). **Open work:** the Backlog below (single source of truth).
- History of design decisions: [PLAN.md](PLAN.md). Hosting, costs, feedback storage: [DEPLOY.md](DEPLOY.md).

## Start of every session

1. `git status` and `git log --oneline -5` (the working tree should be clean; the newest commit should match CHANGELOG's top entry).
2. Read the top of CHANGELOG.md and the Backlog below.
3. Start local servers (Claude Code preview names in `.claude/launch.json` and `C:\Users\User\.claude\launch.json`):
   - `blockmarshal-server`: `wrangler dev` on :8787 (Worker + Durable Objects + local D1). Serves `dist/`, so run `npm run build` first.
   - `blockmarshal`: Vite on :5199 (hot reload; proxies `/api` and `/ws` to :8787). Phones on the same Wi-Fi: `http://<PC LAN IP>:5199` (was <PC LAN IP>).
4. Locally, `.dev.vars` sets `LOBBY_SECONDS=0`, so Play starts a solo game instantly (handed off to the browser). To test lobbies with two tabs, set it to e.g. 25 and restart `blockmarshal-server`, then set it back to 0.

## Commands

```bash
npm run build      # typecheck client + worker/server, vite build -> dist/
npm test           # vitest: engine, mapgen, mines, bots, lobby/matchmaker, views, feedback
npm run deploy     # build + wrangler deploy (ONLY from this PC; see Secrets)
npm run feedback   # latest 50 feedback rows from production D1
npm run db:migrate # apply D1 migrations to production (db:migrate:local for wrangler dev)
npm run types      # regenerate worker/worker-configuration.d.ts after editing wrangler.jsonc
```

Before every commit: `npx tsc --noEmit && npx tsc --noEmit -p tsconfig.server.json && npx vitest run`.

## Architecture

| Path | What |
| --- | --- |
| `src/engine/` | Pure, deterministic rules. `game.ts` (state, step, moves, mines, flags, planting, relocation), `mapgen.ts` (fair maps: no sealed areas, no 2x2 blocks), `knowledge.ts` (what a player can infer from dots), `constants.ts` (every tunable number), `layout.ts` (hand-drawn boards for tests) |
| `src/ai/bot.ts` | Bots: same info as players; Dijkstra paths; known mines cost `MINE_PATH_COST`; stall breaker |
| `src/net/` | `protocol.ts` (client/server messages, `PlayerView`), `view.ts` (fog-of-war filter, runs server-side), `client.ts` (fetch `/api/join`, WebSocket per match) |
| `server/` | Runtime-independent: `match.ts` (lobby countdown, bot fill, tick loop, input handling, solo handoff), `lobbyIndex.ts` (matchmaker routing), `feedback.ts` (validation + email text) |
| `worker/` | Cloudflare Worker: `index.ts` routes (`POST /api/join`, `POST /api/feedback`, `/ws/<matchId>`, static assets), `matchDO.ts` (one Durable Object per match), `matchmakerDO.ts` (one global, persisted lobby index) |
| `src/local.ts` | Browser-run match (solo handoff + "Play vs bots offline"), same `Match` class |
| `src/main.ts` | Client controller: screens, lobby, input actions, floating menu, mine/building menus, HUD, sounds, feedback form |
| `src/ui/` | `renderer.ts` (canvas; fixed board, no pan/zoom), `input.ts` (tap, long-press, drag paths), `effects.ts`, `sound.ts` |
| `public/` | icons, manifest, `_headers` (CSP etc.), `sounds/` |
| `sw/sw.js` | Service worker template; `vite.config.ts` fills the precache list and injects `__BUILD__` |
| `migrations/` | D1 schema (feedback table) |

## Secrets, accounts, settings

- **Cloudflare** account [owner email: Worker secret]; wrangler is logged in on this PC. Worker `blockmarshal`; D1 `blockmarshal-feedback` (id in wrangler.jsonc).
- **PostHog EU** project key lives only in `.env.local` (gitignored). Deploying from elsewhere without it silently turns analytics off.
- **Resend** API key (send-only) is a Worker secret `RESEND_API_KEY`; feedback emails go to `FEEDBACK_EMAIL` ([owner email: Worker secret]) from `onboarding@resend.dev` (may land in Spam).
- Never commit keys; never echo them back in chat.

## Working conventions

- The user tests on a phone and usually ends a request with "go live": deploy with `npm run deploy`, then confirm the deployed build id (`grep` the hash in `dist/assets/index-*.js`) and spot-check the live site.
- Every shipped change: commit (message ends with the Co-Authored-By line), push, add a CHANGELOG entry, update the rules doc if rules/numbers changed, and move items in/out of the Backlog here.
- Tunable numbers belong in `src/engine/constants.ts` (or the named file in the rules doc's reference table).
- Browser testing in the Claude preview pane: dev builds expose `window.__bm` (`renderer`, `net`, `sounds`, `send`, `getView`). Synthetic `PointerEvent`s on `#board` drive taps/long-presses/drags. The pane throttles timers when hidden, so keep scripted waits short and split long flows across calls.
- Game rules are server-authoritative; anything players must not see is filtered in `src/net/view.ts`. Add a test there for any new hidden info.

## Backlog (open issues and next ideas)

**Bugs / unconfirmed reports**
1. **"Map is still draggable"** on the user's phone. Not reproducible on desktop (real drags, wheel, page lock all hold). Waiting on: phone + browser, whether the whole screen or only the grid moves, one finger or pinch, and the build id shown. Possibly the address bar resizing the page.
2. **Bots stuck behind natural mines**: not reproducible in 10+ simulated matches; map generation guarantees no sealed areas. Stall breaker added (40 ticks, 20+ troops). Ask for a screenshot + build id if seen again.

**Before a wider launch**
3. Replace the two YouTube "no copyright" sound clips (`public/sounds/start.mp3`, `fall.mp3`) with CC0 sounds (Kenney, OpenGameArt CC0, Freesound CC0) and add a credits/licences line on the start screen.
4. Trademark search for "Blockmarshal" (USPTO, WIPO) before buying a domain.
5. Custom domain (about $20/yr) + a Cloudflare rate-limiting rule; Workers Paid ($5/mo) before any big traffic push (free plan ~170 ten-minute server matches/day).
6. Reconnect to a running match after a dropped connection (currently you can't rejoin).
7. Matchmaking that groups humans better (beyond "fullest open lobby").

**Balance / design questions**
8. Bots now hide their general and cities and use mines (`a583eb8`). Moves now have a 100-turn cooldown for everyone (`7afd7e4`), so a bot dodges at most once per 100 turns. Easy bots still do none of this.
9. Bot-only games are longer (median ~615 turns since hiding, ~500 with towers).

**Portals (undecided)**: CrazyGames Basic Launch first (no SDK needed), Poki only if numbers are strong (web exclusivity). Needs: shorter lobby (~15 s), a portal build without the service worker/install button, SDK hooks (gameplay start/stop, ads between matches, invite rooms on CrazyGames).

**Mechanic ideas**: turrets; walls you can build and that can be blasted; flares (reveal 5x5); rivers + bridges; decoy crown; armory/mine charges; watchtowers back on (`TOWERS_PER_MATCH`).
