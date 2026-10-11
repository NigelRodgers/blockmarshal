# Deploying Blockmarshal

**Live: https://blockmarshal.rodgersnigel.workers.dev** (first deployed 2026-10-07).

Runs on **Cloudflare Workers** with **Durable Objects** (the owner's account, Workers Free plan):

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

Build-time settings come from `.env.local` (gitignored; copy `.env.example`): `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` for analytics. Production uses the **PostHog EU Cloud** project (`https://eu.i.posthog.com`). Without a key, analytics are off. `.env.local` only exists on this PC, so deploy from here (or recreate it) to keep analytics on.

## Local development

```bash
npm run server   # wrangler dev on :8787 — Worker + both Durable Objects, serves dist/
npm run dev      # Vite on :5199 with hot reload; proxies /api and /ws to :8787
```

Local games start instantly (no lobby countdown, so you're handed straight to a browser-run game) because `.dev.vars` (gitignored) sets `LOBBY_SECONDS=0`; production uses the 60 in `wrangler.jsonc`. Delete or change `.dev.vars` to test the countdown.

Open http://localhost:5199 (or `http://<this PC's LAN IP>:5199` from a phone on the same Wi-Fi). `npm run server` serves whatever is in `dist/`, so run `npm run build` once first. After changing `wrangler.jsonc`, run `npm run types` to refresh `worker/worker-configuration.d.ts`.

## Player feedback (private)

In-game feedback goes to the D1 database `blockmarshal-feedback` (binding `FEEDBACK_DB`). There is **no public route that reads it**; `POST /api/feedback` is write-only. Nothing identifying is stored: no name, account or IP, only rating, two text answers and a small context blob (screen, turn, result, device type, viewport, version).

Each submission is also **emailed to `FEEDBACK_EMAIL`** (a Worker secret: the owner's address) through [Resend](https://resend.com) once the secret is set:

```bash
npx wrangler secret put RESEND_API_KEY   # paste the Resend API key when prompted
npx wrangler secret put FEEDBACK_EMAIL   # the address that receives feedback (kept out of the public repo)
```

Without both secrets, feedback is only stored, not emailed. Resend's free plan sends from `onboarding@resend.dev` to the account owner's own address, so the Resend account must use the same address as `FEEDBACK_EMAIL`.

```bash
npm run feedback          # latest 50 responses from production
npm run db:migrate        # apply new migrations to production D1
npm run db:migrate:local  # same for the local wrangler dev database
```

Or browse it in the Cloudflare dashboard: Storage & Databases → D1 → blockmarshal-feedback → feedback.

## Costs (Workers Free plan, as of 2026-10)

- Durable Objects: 100,000 requests/day and 13,000 GB-s/day of duration.
- A match keeps its object busy for the whole game (500 ms ticks). At 128 MB that's ~75 GB-s per 10-minute match, so roughly **170 ten-minute matches/day** free.
- Incoming WebSocket messages bill at 20:1; outgoing messages are free.
- **Solo games run in the browser:** when a lobby's countdown ends with one human, the server sends `solo` and the player's browser runs the match (`src/local.ts`, same `Match` class). A solo player costs only the lobby wait (~60 s), not a whole match. Only 2+ human matches run on Durable Objects.
- Beyond that: Workers Paid, $5/month, includes 400,000 GB-s/month (~5,000 matches).

## The old Pages site

The single-player build at `blockmarshal.pages.dev` (Pages project `blockmarshal`) was deleted on 2026-10-07.

## Replays (private)

Every finished game is a row in the D1 table `replays` (migration `0002_replays.sql`). Run `npm run db:migrate` once before the first deploy that writes replays. `npm run replays` downloads rows not yet on the PC (by id, against `summary.csv`) and leaves them in D1, so replay links keep working; a daily cron (03:17 UTC) deletes anything older than 60 days. Browser-run games are uploaded by the player's browser to `POST /api/replay` unless they turned analytics off; sharing a replay or attaching it to feedback uploads it regardless. `GET /api/replay/<id>` serves one replay to anyone with its id (a random UUID), for links like `/?replay=<id>` (ADR-0005). Feedback can carry the sender's last replay id (`replay_id`, migration `0003_feedback_replay.sql`).

## Request limits

Rate-limit bindings in `wrangler.jsonc` (`ratelimits`): join 30/min, sockets 40/min, feedback 5/min, replay uploads 10/min, replay link reads 60/min per IP. Counted per Cloudflare location, so approximate. The Worker also refuses API/socket requests from other sites (Origin check; replay reads are exempt, see ADR-0005) and caps body sizes; each match socket has a message budget and a match takes at most 24 sockets.

## Post-deploy checklist

- [x] Open the Worker URL: start screen loads, no console errors (2026-10-07).
- [ ] Two devices join within a minute: same lobby, game starts at 0:00 with bots.
- [x] Headers from `public/_headers` are applied (CSP, `sw.js` no-cache) (2026-10-07).
- [x] Solo player: 60 s lobby, then a match with 5 bots, ticking (2026-10-07).
- [x] PostHog EU accepts the client's `text/plain` batch upload (`200 {"status":"Ok"}`) (2026-10-07).
- [ ] Cloudflare dashboard → Workers → blockmarshal → Durable Objects: usage looks sane after a few matches.
