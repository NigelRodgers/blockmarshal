# Blockmarshal v1 plan

## Direction change, 2026-10-05: live 6-player matches

Supersedes the bots-only daily challenge below. Kept for history; the daily, tutorial, custom games and Commander stub are removed from the app (still in git history).

- **One game type:** 6 seats, one fixed 15x25 board (fits portrait phones at ~26px tiles).
- **Lobby:** joining puts you in the fullest open lobby. It starts when 6 humans are in, or after a 60-second countdown with bots filling empty seats. Any number of matches run at once.
- **Server-authoritative:** `server/match.ts`, hosted in a Durable Object per match, runs the engine; each player gets only their fog-filtered view (`src/net/view.ts`). Mines and fogged armies never reach the client while you're alive.
- **Mines without minesweeper:** tiles look like plain generals.io squares. No numbers, no zero cascade. Tiles you've held (or seen from a watchtower) show **red dots** on the side facing each neighbouring mine (8 positions: corners for diagonals, edge centres for straight). Exploded mines lose their dots.
- **Flags are client-only:** never sent to the server, so opponents can't see them.
- Kept: mine damage + 6-tick stun, watchtowers (now one per two players), cities, generals.
- Analytics events now: `app_open`, `lobby_join`, `game_start {humans, bots}`, `game_end {won, turn, alive}`, `install_prompt`.

- **Solo play is free for the server:** a lobby that ends with one human hands the game to the browser (`src/local.ts`); unreachable server offers "Play vs bots offline".

- **2026-10-08:** fixed board (no pan/zoom; scales to fill the space between the bars), tap the standings to collapse them to colour + numbers, mines cut by 25% (13.5% of eligible plains), map generator guarantees no all-blocked 2x2 of mines/mountains and no sealed-off areas, matchmaker persists its lobby list + lobbies heartbeat (fixes second device landing in a new game), feedback emailed via Resend once `RESEND_API_KEY` is set.

### Open next steps
1. ~~Hosting for the game server.~~ Chosen 2026-10-05: Cloudflare Workers + Durable Objects (one `MatchDO` per match, one global `MatchmakerDO`); the free plan covers roughly 170 ten-minute matches a day. See DEPLOY.md.
2. **Matchmaking that groups humans** (so one human rarely faces five bots): e.g. hold solo lobbies a little longer when other lobbies are filling, merge lobbies before the countdown ends, or show a live "players online" count.
3. Reconnect to a running match after a dropped connection.

### Ideas for later mechanics
From Nigel: turrets, walls that can be blasted, building walls. Additions:
- **Turret:** captured structure that hits adjacent enemy armies for N troops per turn; can be destroyed.
- **Walls:** spend troops to raise a wall on your tile (blocks movement like a mountain); mines or a big army can blast it open.
- **Sappers / defusing:** move onto a tile you flagged to defuse it slowly instead of triggering it.
- **Armory / mine-laying:** capture to gain mine charges and plant them in your own territory (shown to you only).
- **Flares:** one-shot reveal of a 5x5 area anywhere, recharging slowly.
- **Bridges and rivers:** narrow crossings that make chokepoints worth fortifying.
- **Decoy crown:** a fake general that looks real in enemy fog.

Agreed in the design grilling session, 2026-10-01. Changes to locked decisions should be recorded here.

**Launch date: 2026-10-10 (UTC). That day's puzzle is #1.** Days before it show as "Daily preview".

## Product

- generals.io x minesweeper vs bots, mobile-first. Architecture stays multiplayer-ready (pure deterministic engine).
- **Ranked daily challenge** (the core loop):
  - Medium map (15x21), 2 bots, Normal speed (500 ms tick).
  - Bot difficulty by UTC weekday: Mon-Thu Normal, Fri-Sun Hard.
  - Seed = hash of UTC date; bot RNG derived from the same seed. Reset at 00:00 UTC.
  - One ranked attempt, starting at first move. Quitting = loss. No pause in ranked.
  - App backgrounded = 1 strike (game paused); 3 strikes = forfeit.
  - Score = win turn; tiebreak = troops lost to mines. Loss shows "survived N turns".
  - Streak = consecutive days played. Unlimited unranked practice of today's map afterwards.
- **Share card** (Wordle-style, clipboard). No global leaderboard in v1.
- Implementation notes (step 4):
  - Records live in localStorage (`blockmarshal.daily.v1`); input logs kept for the last 14 days only.
  - Ranked progress (turn, mines) is checkpointed every 10 turns so a closed tab still records how far it got.
  - If the player never moves and is eliminated, the attempt is still recorded (no free retry by idling).
  - In ranked, the in-game menu only offers "Back to game" or "Forfeit" (confirm dialog); the clock keeps running.
- Record a full input log (seed + tick-stamped queue/undo/clear events) from day one, for replays and later server-verified leaderboards.

## Rule changes vs prototype

- **Mine stun**: triggering player cannot move for 6 ticks. Moves queued during the stun execute afterwards. Keeps the existing 15 damage, neighbour halving and queue wipe.
- **Watchtower** (new neutral structure):
  - Garrison 25, no troop production.
  - While owned: vision in Chebyshev radius 3 (7x7) and every number in that area revealed (numbers only, never mines).
  - On loss: vision ends, learned numbers stay.
  - Count = 1 per player, placed roughly equidistant between generals, >= 5 tiles from any general.
  - Bots value it like a city (~70) on Normal/Hard; Easy ignores it.
  - Enemy-held towers are valued as ordinary enemy land (25), not like a city. Valuing them like a city made bots re-snipe towers endlessly (Hard 90th-percentile game length 490 -> 1202 turns in sims). Changed during step 2.
  - Distinct eye/radar icon; faint 7x7 outline when selected.
- **Number badges**: only on frontier owned tiles. Implemented as: the tile touches a non-owned tile whose mine status you can't tell yet (not revealed, not a known mountain/city/tower/crater). Larger top-left pill (~40% tile height), army text shifted right/down.
- **Stun HUD**: orange pill next to the turn counter with a draining ring and turns left.
- Default zoom 30 px per tile on phones.

## Onboarding

Interactive 3-level tutorial, ~2 min, skippable: (1) Expand, (2) Deduce (logic-only path, flag, forced blast + stun), (3) Conquer (passive bot, watchtower en route). First launch routes into it; ranked daily unlocks after completion or skip.

Implementation notes (step 5):
- Levels are hand-drawn layouts (`src/engine/layout.ts`); steps and coaching text in `src/tutorial.ts`.
- Level 2's minefield was found by search and is guarded by a test: the flag target is provable from the opening and the star is reachable by deduction alone.
- Level 3 starts with the tower and Blue's general already scouted (drawn in fog) so the coaching makes sense.
- Tutorial boards fit whole on screen (22px minimum tile) instead of the 30px default.
- Leaving the tutorial without finishing shows a gate on the Daily card ("Start tutorial" / "Skip tutorial"). "Replay tutorial" lives under custom games.
- Engine fix found while building level 2: capturing a zero tile that a depth-capped cascade had already revealed now continues the cascade.

## Platform

- Web/PWA first, offline service worker. Hosted on Cloudflare Pages at `blockmarshal.pages.dev`, deployed by wrangler direct upload from the dev PC (changed from Git integration at deploy time).
- Android via Capacitor once retention is proven. iOS deferred.
- Buy a domain (.io or .gg; .com/.app are taken) only on a "keep going" verdict.

## Measurement

PostHog Cloud, anonymous ID, no PII, localStorage persistence, one-line privacy note in the menu.

Events: `tutorial_step`, `tutorial_done`, `tutorial_skipped`, `daily_start`, `daily_end {won, turn, minesLost, strikes}`, `share_click`, `practice_start`, `commander_stub_click`, `install_prompt`.

Verdict after 4 weeks live and >= 300 unique players:

| Signal | Kill / rethink | Keep going | Build Commander |
| --- | --- | --- | --- |
| D1 retention | < 15% | 15-30% | > 30% |
| D7 retention | < 5% | 5-12% | > 12% |
| Daily share rate (of finishers) | | > 5% | > 10% |
| Commander stub clicks (of weekly players) | | | > 8% |

Tutorial completion < 50% means fix onboarding before judging anything else.

Implementation notes (step 6):
- `src/analytics.ts` posts to PostHog's `/batch/` endpoint directly (no SDK, no cookies). Anonymous random ID in localStorage, batched every 10 s and flushed with `sendBeacon` when the page hides. Off when no key is set, when the browser sends Do Not Track, or when the player taps "Turn off" in the menu's privacy line.
- Extra event `app_open` (for daily actives / retention base). `daily_start` fires when the attempt locks (first move), not when the screen opens.
- Configure with `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` (see `.env.example`). **Before launch:** send a test event and confirm it appears in PostHog Live Events (body is sent as `text/plain` to skip the CORS preflight; verified locally against a stub, not yet against PostHog itself).
- Commander stub: menu card "Coming soon" opens an honest "not available yet, your tap counts as a vote" dialog. Basic custom games stay free; the stub advertises mine density and seed control, extra modes, themes and full stats.
- "Install as app" button appears when the browser offers installation (`install_prompt {outcome}`).

## Monetization

Free at launch, no ads ever. Fake-door "Commander" stub (custom games, extra modes, themes, stats). If the verdict is "build", research Zimbabwe-compatible payouts (Play merchant, Stripe, or a merchant of record like Paddle/Lemon Squeezy) before billing work.

## Build order

1. [x] Rename to Blockmarshal, git init, private repo `NigelRodgers/blockmarshal`.
2. [x] Engine: stun, watchtower, input log, seeded daily config. Tests.
3. [x] Renderer: frontier badges, zoom 30, watchtower art.
4. [x] Daily mode: ranked flow, strikes, share card, streak, practice.
5. [x] Tutorial (3 levels) and gating.
6. [x] Commander stub, PostHog events, privacy note.
7. [x] Service worker, Cloudflare Pages deploy. Live at https://blockmarshal.pages.dev via `npm run deploy` (wrangler direct upload, not Git integration; see [DEPLOY.md](DEPLOY.md)). Remaining checklist items need the PostHog key and a phone.

## Roadmap after v1

1. Defuse by flag: moving onto a correctly flagged mine defuses it (slow move, no blast); wrong flag still blows.
2. Armory: capture to gain mine charges you can plant against enemies.
3. Portals (never spawn near generals).
4. Solo minefield-conquest daily (second mode).
5. Server-verified global leaderboard (re-simulate input logs).
6. Friend rooms (2-4 players, invite link), then public matchmaking.

## Known caveat

The shipped bundle contains the engine, so tomorrow's map can be precomputed by a determined player. Acceptable while scores are share-card only; server verification is the real defence.
