# Changelog

Newest first. Build ids match the `Build <hash>` line on the start screen. Live: https://blockmarshal.rodgersnigel.workers.dev

## 2026-10-08

**`ba04024`: Floating menu, movable buildings, towers off** (live)
- HUD is a translucent floating ☰ (top-left) with a panel: turn, standings, Move/Flag, Split, Undo, Clear, Home, sound, feedback, leave. The board fills the screen. A badge on ☰ shows Flag / Split / moving-building mode.
- Long-press your general or a city you hold → Move → tap a pulsing tile. The new spot must be your own open tile, no mine, not touching another general or city (corners included). Instant, no cooldown; troops stay.
- Your flagged planted mines draw grey.
- Watchtowers off (`TOWERS_PER_MATCH = 0`); code and tests kept.
- Bot stall breaker: no land for 40 ticks with 20+ troops → ignores mine costs until it gains ground.
- Removed dead CSS from old screens.
- Rules doc created: [Blockmarshal: Game Rules & Numbers](https://claude.ai/code/artifact/e88a1b81-7a45-4e71-872f-f065ac6019a5).

**`2c4b8cc`**: build id shows the git hash even when the dev server starts outside the repo.

**`8c7cb40`: Own-mine menu; bots blast through mines**
- Long-press your own planted mine: flag/unflag (safe passage) or pick it up back into stock.
- Flags on your own land only allowed on your own mines; clearer hints on generals/cities.
- Bots treat known mines as costly but passable (`MINE_PATH_COST` 25); plans capped at 30 tiles.

**`8e8145e`**: plant mines with the same flag gesture (no Drop button); classic mine icon (dark body, eight bumps, large, centred).

**`091a0cd`: Mines become a mechanic**
- Flags are server-side, private, max 5, reset each match (fixed flags carrying over between rounds).
- Moving onto a mine you flagged captures it into stock. Plant stocked mines on your own open tiles: you see an icon, enemies see only dots. Your own mine trips you unless you flagged it; enemies trip it unless they flagged it (then they capture it). Captors inherit a fallen general's mines.
- Every blast is public (event + mark for everyone); the mark fades over 10 turns (`CRATER_TICKS` 20).
- Start screen shows the build id.

**`4308428`: Sounds, page lock, feedback email**
- Battle horn at match start; heartbeat when a general falls (yours or one you take). Mute button + M key.
- Page-level pinch/scroll/rubber-band blocked during play (iOS ignores `user-scalable=no`).
- Feedback emailed via Resend (`RESEND_API_KEY` secret).

**`434e2e3`: Fixed board, fairer maps, lobby fix**
- Board no longer pans or zooms; it scales to fit the screen.
- Mines cut by 25% (18% → 13.5% of eligible plains); maps never have a solid 2x2 of mines/mountains or a sealed-off area.
- Matchmaker persists its lobby list; lobbies heartbeat every 10 s (fixed a second device landing in a new game).
- Feedback email code (dormant until key).

## 2026-10-07

- **`cd0143d`**: analytics live on PostHog EU (key in `.env.local`).
- **`2c9a6a1`**: solo lobbies hand off to a browser-run game (no server cost); "Play vs bots offline".
- **`b01fb46`**: in-game anonymous feedback form → private D1 database (`npm run feedback`).
- **`7dc6f1a`**: old single-player Pages site (blockmarshal.pages.dev) deleted.
- **`407d78f`**: first deploy to Cloudflare Workers.

## 2026-10-06

- **`845fe7d`**: generals get a gold crown + gold border; cities show buildings.
- **`435048b`**: `LOBBY_SECONDS` setting (60 live, 0 locally via `.dev.vars`).

## 2026-10-05: Pivot to live 6-player matches

- **`09598f3`**: game server ported to Cloudflare Workers + Durable Objects (global matchmaker, one object per match).
- **`b93b7e6`**: live 6-player matches on a fixed 15x25 board; 60 s lobby, bots fill seats; server-side fog filtering; minesweeper numbers replaced by red direction dots; flags client-only (later server-side); daily challenge, tutorial, custom games and Commander stub removed.

## 2026-10-01 to 2026-10-02: Single-player v1 (superseded)

- Bots-only ranked daily challenge with share card and streaks, 3-level tutorial, minesweeper numbers with zero cascade, watchtowers, mine stun, offline PWA, analytics, Commander fake door. Live briefly on Cloudflare Pages. See PLAN.md for the original design.
