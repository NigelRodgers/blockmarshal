# Changelog

Newest first. Build ids match the `Build <hash>` line on the start screen. Live: https://blockmarshal.rodgersnigel.workers.dev

## 2026-10-10

**The repository is public** (GPL-3.0): https://github.com/NigelRodgers/blockmarshal
- History rewritten first: the two YouTube sound clips and the owner's email were removed from every old commit, so **every commit id changed**. Old build ids (start screen, screenshots, feedback, replays) map to new commits in [docs/history-rewrite.md](docs/history-rewrite.md). The ids in this changelog are the new ones.
- Feedback email address moved to a Worker secret (`FEEDBACK_EMAIL`); `LICENSE` added.

## 2026-10-09

**`875d6f8`: Softer bots** (live in `dab9a22`)
- Bots make no move at all before turn 13, then open with their whole stack (a human-style "13-start").
- They decide a bit less often than every half-turn, react to danger about 2 turns late, build up before picking fights until turn 40, and skip hiding a spotted general/city 1 time in 5. Mine play is unchanged.
- Tuned so the bot wins about 60% of 1 vs 1 games against the bot from before the 2026-10-08 upgrade (61% over 160 games; it was 79%). Same level in every mode.

**`8a784d2`: Mine stock limit, bot planting pace, unflagging** (live in `de14eab`)
- You hold at most **5** unplanted mines. With a full stock, a flagged mine you walk onto is disarmed (no blast) but not kept, and your own mines can't be picked up until you plant one.
- Bots plant **one mine at a time**, each landing 3 turns after they pick the spot.
- Fixed bots occasionally stepping on their own freshly planted mine.
- Long-press (or Flag-mode tap) on one of your tiles that still carries a flag now removes the flag instead of planting a mine.

**`050dcb9`: Pause, replay controls, recording cancel, new sounds** (live in `de14eab`)
- **Pause** for games against bots in your browser (1 vs 1 vs bot, solo, offline): button under ☰, Resume to carry on.
- **Replays:** ⏪ / ⏩ jump 10 turns; speeds 0.5×, 1×, 2×, 5×, 10×.
- **Recording:** ✕ next to the record button stops and throws the recording away.
- **Sounds**, all made from code (`scripts/make-sounds.mjs`), no licensed clips left: a 2 s brass horn at the start; a small low thud for every mine blast (quieter if it isn't yours); a deep boom with a sagging horn when your general falls; a boom with a rising two-note call when you take a crown.

**Replays, security, recorder, bot delay, duel tuning** (live in `be66ce4`; replays table migrated)
- **1 vs 1** (`c3a1418`): twice the mines (27% of eligible plains) and 10% more mountains (15.4%). [Sample duel maps](https://claude.ai/artifact/2SmPigB4mPB8yDG8FbZofW).
- **Your own mines** (`c3a1418`): pick them up any time. The 100-turn lock now only stops enemies capturing a freshly planted mine.
- **Notices** (`c3a1418`, `a562357`): captures, blasts and other messages go in the empty band below the board (above it if there's no room below), so they don't cover tiles. The board itself keeps the full screen.
- **Edge swipes** (`a562357`): swiping from the screen edge no longer goes back/forward out of a game or replay; Back shows how to leave instead.
- **Bots act with a 3-turn delay** (`86873ac`): a bot planting a mine or moving its general/city decides now, and it happens on the third turn, only if still legal (target not taken, land not cut in two). Mirrors a human's long-press time.
- **Replays** (`86873ac`, `a92a03d`): every human action is logged, so a game rebuilds exactly from its seed. Each player's browser keeps their last 50 games (start screen > Replays, end screen > Watch replay): whole board, play/pause, 1-16x, seek. Every game is stored on the server; browser-run games are uploaded (unless analytics is turned off). `npm run replays` downloads them to `Documents\Blockmarshal Replays` (a JSON per game + `summary.csv`) and clears them from the server; a Windows task runs it daily at 09:00. Server copies older than 60 days are deleted by a daily cron.
- **Security** (`a92a03d`): per-IP rate limits (join 30/min, sockets 40/min, feedback 5/min, replay uploads 10/min); API and sockets only from this site; body size caps; per-socket message budget (floods dropped, socket closed); max 24 sockets per match; HSTS and frame blocking.
- **Recorder** (`f19edb2`, `e2320b2`): owner-only record button under the menu button (enable once per browser with `?recorder=on`). Records the board itself to a .webm; `npm run video -- file.webm [--title "..."] [--music track.mp3]` turns it into an MP4 with intro and outro.

**`9d4e840`: 1 vs 1** (live in `a093d8f`)
- Start screen: **Game** = Free-for-all (6 players, as before) or **1 vs 1**. For 1 vs 1 pick **vs Human** (a 2-seat lobby; if nobody joins before the timer, a bot steps in) or **vs Bot** (starts at once in your browser, no server cost). Your picks are remembered.
- Duels use a smaller 11 x 17 board (bigger tiles on phones). Bot-vs-bot duels last about 380 turns (median), against about 600 for free-for-all.
- The matchmaker keeps separate lobby lists, so free-for-all and 1 vs 1 players never land in each other's lobbies.
- `?quick=duel` (or `?quick=1v1`) starts an instant duel against a bot.

**`c60e060`: Locked mines, white dots, colour-blind palette, accessibility** (live in `a093d8f`)
- Fix: freshly planted mines were still being stolen. A mine on its 100-turn cooldown is now locked: an enemy's flag doesn't capture it, it goes off.
- Dots toward a locked mine are **white** (red otherwise), for everyone; your own locked mine wears a white ring. Bots read this and don't try to capture locked mines.
- New player colours (orange, sky, teal, indigo, pink, brown): the hardest pair to tell apart with colour blindness is about a third further apart than before, and so are mine dots vs tiles.
- Troop numbers are dark or white per tile, whichever contrasts more (white on neutral land was 1.55:1). Dots have a solid dark rim.
- Accessibility: visible keyboard focus, bigger menu buttons (44px), larger control labels, screen-reader labels and states for dialogs, toggles, toasts and the board. With "reduce motion" on, no screen shake, pulsing or slide-ins.
- Fix `?quick`: Play again from the end screen now starts the next quick game (the end screen stayed on top). Play and Try again stay in quick mode too.

**`9389343`: Quick start** (live)
- Open https://blockmarshal.rodgersnigel.workers.dev/?quick to skip the lobby and play 5 bots in your browser at once (same as "Play vs bots offline", no server cost). Play again stays in quick mode. Analytics event `quick_start`.

**`f9b6119`: One cooldown for everything you move** (live in `9389343`)
- Every planted mine is held for 100 turns before you can pick it up, including a captured mine planted for the first time. Generals and cities that moved: same 100 turns, as before.
- Replay test limit raised to 30 s (it could time out since the bot changes).

## 2026-10-08

**`fd6adcd`: Mine move cooldown** (live in `1f31af3`)
- Correction to `649e210`: moved mines get the same 100-turn cooldown. A mine you pick up and replant can't be picked up again for 100 turns; the mine menu shows "Pick up (in N turns)" greyed out.
- A captured mine planted for the first time has no cooldown.
- Bots flag their own cooling-down mine to walk over it safely (0 self-blasts in 12 simulated matches).

**`649e210`: Move cooldown** (live in `1f31af3`)
- After a general or city moves, it can't move again for 100 turns (`RELOCATE_COOLDOWN_TICKS` 200). Each building has its own cooldown, and it stays with the building. The menu shows "Move general (in N turns)" greyed out.
- Mines had no cooldown here (changed in `fd6adcd`).
- Bots follow the same cooldown, so they hide their general at most once per 100 turns (their own 4-turn limit is gone).

**`a7235f5`: Island rule; aggressive bots that hide and lay traps** (live in `1f31af3`)
- New rule: generals, cities and mines only move within one connected stretch of your land (sides count, corners don't). No jumping between separate islands.
- A stocked mine remembers the tile it came from (where you captured or picked it up) and can only be planted on land connected to that tile. If you've lost that tile, it goes with your general's land.
- Bots (normal/hard) are more aggressive: they value enemy land and cities more and attack sooner. In 12 simulated bot-only matches the first kill came at turn ~68 instead of ~120.
- Bots hide: once an enemy has seen their general, they move it out of sight, away from enemy land. Cities move when an enemy army nearby could take them. 8-tick cooldown.
- Bots use mines: they flag known mines on their border (between plans, not mid-march) and walk onto them to capture them. They plant ambush traps one row behind the front, where enemy dots can't see them yet, plus up to 3 defence mines 2 to 3 steps from the general. They move idle mines to an active front and lift their own mines off any path they plan, so they never trip their own.
- Bot-only games run a bit longer (median ~615 turns vs ~500) because hidden generals are harder to kill.

**`b4e7976`: Floating menu, movable buildings, towers off** (live)
- HUD is a translucent floating ☰ (top-left) with a panel: turn, standings, Move/Flag, Split, Undo, Clear, Home, sound, feedback, leave. The board fills the screen. A badge on ☰ shows Flag / Split / moving-building mode.
- Long-press your general or a city you hold → Move → tap a pulsing tile. The new spot must be your own open tile, no mine, not touching another general or city (corners included). Instant, no cooldown; troops stay.
- Your flagged planted mines draw grey.
- Watchtowers off (`TOWERS_PER_MATCH = 0`); code and tests kept.
- Bot stall breaker: no land for 40 ticks with 20+ troops → ignores mine costs until it gains ground.
- Removed dead CSS from old screens.
- Rules doc created: [Blockmarshal: Game Rules & Numbers](https://claude.ai/code/artifact/e88a1b81-7a45-4e71-872f-f065ac6019a5).

**`5dbe583`**: build id shows the git hash even when the dev server starts outside the repo.

**`02adaf7`: Own-mine menu; bots blast through mines**
- Long-press your own planted mine: flag/unflag (safe passage) or pick it up back into stock.
- Flags on your own land only allowed on your own mines; clearer hints on generals/cities.
- Bots treat known mines as costly but passable (`MINE_PATH_COST` 25); plans capped at 30 tiles.

**`17a9f0c`**: plant mines with the same flag gesture (no Drop button); classic mine icon (dark body, eight bumps, large, centred).

**`bd2aac7`: Mines become a mechanic**
- Flags are server-side, private, max 5, reset each match (fixed flags carrying over between rounds).
- Moving onto a mine you flagged captures it into stock. Plant stocked mines on your own open tiles: you see an icon, enemies see only dots. Your own mine trips you unless you flagged it; enemies trip it unless they flagged it (then they capture it). Captors inherit a fallen general's mines.
- Every blast is public (event + mark for everyone); the mark fades over 10 turns (`CRATER_TICKS` 20).
- Start screen shows the build id.

**`861fafa`: Sounds, page lock, feedback email**
- Battle horn at match start; heartbeat when a general falls (yours or one you take). Mute button + M key.
- Page-level pinch/scroll/rubber-band blocked during play (iOS ignores `user-scalable=no`).
- Feedback emailed via Resend (`RESEND_API_KEY` secret).

**`cc7fb14`: Fixed board, fairer maps, lobby fix**
- Board no longer pans or zooms; it scales to fit the screen.
- Mines cut by 25% (18% → 13.5% of eligible plains); maps never have a solid 2x2 of mines/mountains or a sealed-off area.
- Matchmaker persists its lobby list; lobbies heartbeat every 10 s (fixed a second device landing in a new game).
- Feedback email code (dormant until key).

## 2026-10-07

- **`b8f35de`**: analytics live on PostHog EU (key in `.env.local`).
- **`6ca8886`**: solo lobbies hand off to a browser-run game (no server cost); "Play vs bots offline".
- **`410ad98`**: in-game anonymous feedback form → private D1 database (`npm run feedback`).
- **`6c3da56`**: old single-player Pages site (blockmarshal.pages.dev) deleted.
- **`3508155`**: first deploy to Cloudflare Workers.

## 2026-10-06

- **`485cee8`**: generals get a gold crown + gold border; cities show buildings.
- **`b73f952`**: `LOBBY_SECONDS` setting (60 live, 0 locally via `.dev.vars`).

## 2026-10-05: Pivot to live 6-player matches

- **`f166c95`**: game server ported to Cloudflare Workers + Durable Objects (global matchmaker, one object per match).
- **`69f5de1`**: live 6-player matches on a fixed 15x25 board; 60 s lobby, bots fill seats; server-side fog filtering; minesweeper numbers replaced by red direction dots; flags client-only (later server-side); daily challenge, tutorial, custom games and Commander stub removed.

## 2026-10-01 to 2026-10-02: Single-player v1 (superseded)

- Bots-only ranked daily challenge with share card and streaks, 3-level tutorial, minesweeper numbers with zero cascade, watchtowers, mine stun, offline PWA, analytics, Commander fake door. Live briefly on Cloudflare Pages. See PLAN.md for the original design.
