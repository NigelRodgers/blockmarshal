# Blockmarshal v1 plan

Agreed in the design grilling session, 2026-10-01. Changes to locked decisions should be recorded here.

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

- Web/PWA first, offline service worker. Hosted on Cloudflare Pages at `blockmarshal.pages.dev`.
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

## Monetization

Free at launch, no ads ever. Fake-door "Commander" stub (custom games, extra modes, themes, stats). If the verdict is "build", research Zimbabwe-compatible payouts (Play merchant, Stripe, or a merchant of record like Paddle/Lemon Squeezy) before billing work.

## Build order

1. [x] Rename to Blockmarshal, git init, private repo `NigelRodgers/blockmarshal`.
2. [x] Engine: stun, watchtower, input log, seeded daily config. Tests.
3. [x] Renderer: frontier badges, zoom 30, watchtower art.
4. [x] Daily mode: ranked flow, strikes, share card, streak, practice.
5. [x] Tutorial (3 levels) and gating.
6. [ ] Commander stub, PostHog events, privacy note.
7. [ ] Service worker, Cloudflare Pages deploy. Set `EPOCH` in `src/daily.ts` to launch day so the first public puzzle is #1.

## Roadmap after v1

1. Defuse by flag: moving onto a correctly flagged mine defuses it (slow move, no blast); wrong flag still blows.
2. Armory: capture to gain mine charges you can plant against enemies.
3. Portals (never spawn near generals).
4. Solo minefield-conquest daily (second mode).
5. Server-verified global leaderboard (re-simulate input logs).
6. Friend rooms (2-4 players, invite link), then public matchmaking.

## Known caveat

The shipped bundle contains the engine, so tomorrow's map can be precomputed by a determined player. Acceptable while scores are share-card only; server verification is the real defence.
