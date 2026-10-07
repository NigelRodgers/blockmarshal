# Deploying Blockmarshal

**Live: https://blockmarshal.rodgersnigel.workers.dev** (first deployed 2026-10-07).

Runs on **Cloudflare Workers** with **Durable Objects** (account [owner email: Worker secret], Workers Free plan):

- One Worker (`worker/index.ts`) serves the built client from `dist/` and two routes:
  - `POST /api/join` asks the matchmaker for a match ID.
  - `GET /ws/<matchId>` opens the player's WebSocket into that match.
- `MatchmakerDO` (one global instance) routes players to the fullest open lobby. No sockets.
- `MatchDO` (one per match) holds the sockets and runs lobby countdown + game loop using the shared `server/match.ts`.

Config: [`wrangler.jsonc`](wrangler.jsonc). Free plan requires SQLite-backed Durable Objects (`new_sqlite_classes`), even though matches keep their state in memory.

## Deploy

```bash
npm run deploy   # typecheck client + worker, vite build, wrangler deploy
```

Deploys go to `https://blockmarshal.rodgersnigel.workers.dev`. Pushing to GitHub does not deploy.

Build-time settings come from `.env.local` (copy `.env.example`): `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` for analytics. Without a key, analytics are off.

## Local development

```bash
npm run server   # wrangler dev on :8787 — Worker + both Durable Objects, serves dist/
npm run dev      # Vite on :5199 with hot reload; proxies /api and /ws to :8787
```

Local games start instantly (no lobby countdown) because `.dev.vars` (gitignored) sets `LOBBY_SECONDS=0`; production uses the 60 in `wrangler.jsonc`. Delete or change `.dev.vars` to test the countdown.

Open http://localhost:5199 (or `http://<this PC's LAN IP>:5199` from a phone on the same Wi-Fi). `npm run server` serves whatever is in `dist/`, so run `npm run build` once first. After changing `wrangler.jsonc`, run `npm run types` to refresh `worker/worker-configuration.d.ts`.

## Costs (Workers Free plan, as of 2026-10)

- Durable Objects: 100,000 requests/day and 13,000 GB-s/day of duration.
- A match keeps its object busy for the whole game (500 ms ticks). At 128 MB that's ~75 GB-s per 10-minute match, so roughly **170 ten-minute matches/day** free.
- Incoming WebSocket messages bill at 20:1; outgoing messages are free.
- Beyond that: Workers Paid, $5/month, includes 400,000 GB-s/month (~5,000 matches).

## The old Pages site

The single-player build at `blockmarshal.pages.dev` (Pages project `blockmarshal`) was deleted on 2026-10-07.

## Post-deploy checklist

- [x] Open the Worker URL: start screen loads, no console errors (2026-10-07).
- [ ] Two devices join within a minute: same lobby, game starts at 0:00 with bots.
- [x] Headers from `public/_headers` are applied (CSP, `sw.js` no-cache) (2026-10-07).
- [x] Solo player: 60 s lobby, then a match with 5 bots, ticking (2026-10-07).
- [ ] With a PostHog key: `app_open` and `lobby_join` arrive in Live events.
- [ ] Cloudflare dashboard → Workers → blockmarshal → Durable Objects: usage looks sane after a few matches.
