# Changelog

Newest first. Build ids match the `Build <hash>` line on the start screen. Live: https://blockmarshal.rodgersnigel.workers.dev

## 2026-10-12

**New board look: no borders, striped terrain, red mine borders** (not live yet)
- Tiles sit edge to edge with no grid lines. Terrain (what we called mountains) is dark grey with diagonal stripes, no icon; tiles out of sight keep their greys, striped. Visible empty land and owned land stay flat.
- Instead of red dots, a tile you hold gets a **red border** on each side facing a neighbouring mine, and a corner mark for a diagonal one; white for a locked mine. Same information, easier to read at a glance.
- "Mountain" is now "terrain" in the help, the glossary and the rules doc.

**Esc, pinned menu on wide screens, HUD in a row, auto-update; kept-mine fix** (live in `64005cd`)
- **Fix (`138d674`):** the flag on a mine you crossed and kept could still be removed, leaving a hidden mine under your own land that drew dots. Seen in 6 of your games today, all on the old cached build `5b0ee0c`; the server now refuses it as well as the client.
- **Auto-update:** phones kept a tab or installed app alive for days, so new builds never arrived (today's games still ran `5b0ee0c`). When the app comes back to the foreground, and every 30 minutes, it checks for a newer build and reloads on the start screen (or right after the game you're in).
- **Esc** closes an open menu; with nothing open it leaves the game (asking first if it's still running) or closes a replay.
- **Wide screens:** the game menu stays open in the free space left of the board (when there's 376 px or more); tablets and desktops get a 40 px band above and below the board again. Phones are unchanged.
- **HUD:** menu, pause and record buttons sit side by side along the top instead of stacked.

## 2026-10-11

**Replay links, downloads, feedback with your last game; two mine fixes** (live in `7a0401c`)
- **Replays menu:** each game shows a short id (`#72b05c6b`), a 🔗 button that copies (or, on phones, shares) a link anyone can open for 60 days, and ⬇ to save the file.
- **Links** `/?replay=<id>` open that game's replay straight away. The server now keeps replays for 60 days instead of deleting them once they're on the PC; `npm run replays` downloads only new ones (ADR-0005). Sharing uploads a browser game first, even with analytics off.
- **Feedback** has "Attach my last game" (ticked by default, shown once you have a game): the feedback email and `npm run feedback` carry its replay link. Needs `npm run db:migrate` (`0003_feedback_replay.sql`) before deploying.
- **Fix (`9f8d1c2`):** mines you crossed and kept (grey) drew dots for you; they no longer do. A flag left on a tile you later took swallowed your next long-press there (it removed the flag instead of planting); taking the tile now clears it. Long-pressing a kept mine used to remove its flag, turning it back into a hidden mine under your own land; it now tells you how to collect it. All three seen in a reported game (replay `72b05c6b`).

**Lighter replay list; pulled replays are verified** (live in `5b0ee0c`)
- Replays menu (#9): reads one small summary per game instead of loading every stored replay in full (up to 50 games, 1-5 MB) each time it opens; a replay loads in full only when you open it. Replays already in your browser are summarised once, automatically.
- `npm run replays` (#14): every downloaded replay is rebuilt from its seed and checked against its recorded result. `summary.csv` gets a `verified` column: `yes`, `no` (same build, different result: forged or a bug), `stale-build` (played on another build, so it can't tell) or `error`; `pull.log` counts them. Browser games upload their own results, so this flags forged ones before they skew tuning.

## 2026-10-10

**Bring your own mines** (live in `1803cd0`; designed in a grilling session, see PLAN.md and ADR-0004)
- **Mine stock, every mode:** everyone starts with **5 mines** in stock (the cap). Below 5, you get **+1 every 30 turns**; the countdown starts when your stock drops below full and pauses while it's full. The stock shows the countdown (`💣4 ⏱29`). Refill mines can be planted anywhere on your general's stretch of land. Captures still count toward the cap.
- **Full stock no longer wastes mines:** walking onto a flagged mine with a full stock crosses it safely and leaves it there, still flagged. You see it as a grey mine on your land; step on it again once your stock has room to collect it. An enemy who takes that tile without a flag sets it off.
- **Flags come back** when a flagged mine is captured or picked up by its owner (as they already did when it exploded).
- Natural mines never respawn.
- **1 vs 1 board** (`c3a1418`'s mine-heavy duel board, reworked): about **15 natural mines** (11.5% of eligible plains, was 27%) and **41 mountains** (21.8% of tiles, was 15.4%): half the natural mines, with half of the removed ones turned into mountains. One general starts within 4 rows of the top edge, the other within 4 rows of the bottom. Free-for-all's board is unchanged for now.
- Bots play the new stock: they keep flags on mines they crossed, collect them later, and take back a spare flag to pass their own mines when stock and flags are both full (with full stocks from the start, they stalled behind their own traps).
- Bot strength unchanged: 41 of 80 duels against the live bot's code on the same rules (51%). Bot-vs-bot duels: median 368 turns, about 8.5 blasts a game.

**Bots finish off a general that holds out** (live in `1803cd0`)
- A replay showed a bot taking 780 turns to beat a player who never moved. Once it owned everything else, no single stack of its could beat the idle general (which grows every turn), so it did nothing, with thousands of troops spread over its land. Now, with nothing else to do, it **gathers**: it marches its biggest stacks to a tile beside the enemy general it has seen (else onto its biggest stack), then attacks once one stack can win. Its own general stays home.
- A second stall: the attack path crossed one of the bot's own mines, and with a full stock and no flags left it could neither lift nor flag it, so it stopped short every turn. On the way to a general it now takes the blast.
- Against an idle player over 30 duel maps: median 245 turns (was 344), slowest 550; before, 3 maps never ended within 3000 turns. Normal play is unchanged: 39 of 80 duels against the bot from before this change (49%).

**Notices are see-through** (live in `1803cd0`)
- In-game notices (blasts, captures) have a 55% see-through background with a text shadow, so they hide less of the board.

**Games against bots pause when you leave the page** (live in `4d021c7`)
- Switching apps, locking the phone or changing tab now pauses a game against bots running in your browser (1 vs 1 vs bot, solo, offline). Browsers slow timers in hidden pages, so before this the bots kept playing while you couldn't see the board. Coming back shows the Paused panel; tap Resume when ready. Online games can't pause, as before.

**Replays carry their build** (live in `4d021c7`)
- Every replay now records the short git hash of the code that played it (`build`). Browser games use the client build; server games get it from the Worker's `BUILD` var, which `npm run deploy` (now `scripts/deploy.mjs`) sets to the git hash.
- Bots are re-simulated when a replay plays, so a replay made by an older build can play out differently. The replay viewer now notices when the rebuilt game doesn't end the way the real one did and says so ("Made on build …, so this replay no longer matches the real game"). Replay notices show at the top (the controls cover the bottom) and wrap on phones.
- `npm run replays`: `summary.csv` gets a `build` column (empty for older games; existing files are upgraded in place), so results can be split by bot version.
- Checked against the 18 downloaded games: the 2 played before the softer bots no longer rebuild correctly; all 15 since do.

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
