# History rewrite (2026-10-10)

Before the repository went public, its history was rewritten with `git filter-repo` to:

- remove two sound clips taken from YouTube "no copyright" uploads (`public/sounds/start.mp3` and the original `fall.mp3`), which the project had no right to redistribute;
- replace the owner's personal email in every old file version (it now lives in the Worker secret `FEEDBACK_EMAIL`);
- set every commit's author to the owner's GitHub no-reply address.

Every commit got a new id. **Build ids shown on the start screen before 2026-10-10, in screenshots, feedback rows or replay records, are old ids.** Use the table to find the matching commit. The CHANGELOG and other docs now use the new ids; ids mentioned inside commit messages were rewritten automatically.

| Old build id | New commit | Date | Commit |
| --- | --- | --- | --- |
| `ef77e2a` | `40882cd` | 2026-10-10 | Prepare for public repo: GPL-3.0 licence, feedback email moved to a Worker secret |
| `31cab0f` | `850b867` | 2026-10-10 | Docs: vision (two games, one engine), hardening phase focused on 1 vs 1 vs bot, Reddit kickoff 2026-10-16 |
| `1345075` | `0a585f2` | 2026-10-09 | Changelog: 2461d81 is live |
| `2461d81` | `dab9a22` | 2026-10-09 | Changelog + plan: softer bots, week of data, Reddit edition |
| `48228dd` | `875d6f8` | 2026-10-09 | Softer bots: no moves before turn 13, slower decisions, late reactions, build-up phase |
| `04270b6` | `3665c92` | 2026-10-09 | Changelog: 5b465a2 is live |
| `5b465a2` | `de14eab` | 2026-10-09 | Changelog: mine stock limit, bot pace, unflagging |
| `55fbcba` | `8a784d2` | 2026-10-09 | Mine stock capped at 5, bots plant one mine at a time, long-press unflags your own tiles |
| `d874b50` | `aa444ed` | 2026-10-09 | Changelog + guide: pause, replay controls, sounds; npm run sounds |
| `163fc36` | `050dcb9` | 2026-10-09 | Pause vs bots, recording cancel, replay back/forward and 0.5-10x, new synthesised sounds |
| `9205d6d` | `e3e89e4` | 2026-10-09 | Changelog: e1af773 is live |
| `e1af773` | `be66ce4` | 2026-10-09 | Changelog: notices and edge swipes |
| `1360a99` | `a562357` | 2026-10-09 | No bottom padding; notices in the free band around the board; edge swipes no longer leave the game |
| `6c80edb` | `aed4ad7` | 2026-10-09 | Docs: replays, security, recorder, bot delay, duel tuning |
| `db81256` | `e2320b2` | 2026-10-09 | Video pipeline: npm run video -- recording.webm -> MP4 with intro and outro |
| `33f7458` | `f19edb2` | 2026-10-09 | Owner-only record button: records the board to a .webm |
| `32ca3b9` | `a92a03d` | 2026-10-09 | Replays (server, browser, PC download, viewer) and request limits |
| `56c43ed` | `86873ac` | 2026-10-09 | Bots plant mines and move buildings 3 turns after deciding; every human action is logged for replays |
| `203491d` | `c3a1418` | 2026-10-09 | Duel: double mines, 10% more mountains; own mines pick up any time; notices in a strip below the board |
| `caa5d8d` | `97d7c78` | 2026-10-09 | Changelog: a545b13 is live |
| `a545b13` | `a093d8f` | 2026-10-09 | Changelog + guide: 1 vs 1 |
| `4494898` | `9d4e840` | 2026-10-09 | 1 vs 1 mode: duel against a human (matchmaking) or a bot (in the browser) |
| `06561d2` | `688b072` | 2026-10-09 | Changelog: locked mines, palette, accessibility, ?quick fix |
| `9af73d2` | `c60e060` | 2026-10-09 | Locked fresh mines, white dots, colour-blind palette, a11y pass, ?quick restart fix |
| `5262f39` | `949d76a` | 2026-10-09 | Changelog + guide: ?quick quick start, live in 850d8ce |
| `850d8ce` | `9389343` | 2026-10-09 | Quick start: ?quick skips the lobby and plays bots in the browser |
| `6fdb97c` | `c7870db` | 2026-10-09 | Changelog: cooldown on every planted mine |
| `bba785e` | `f9b6119` | 2026-10-09 | Cooldown on every planted mine, new or moved |
| `082e0d1` | `84fee9f` | 2026-10-08 | Changelog: 0a1dc44 is live |
| `0a1dc44` | `1f31af3` | 2026-10-08 | Changelog: mine move cooldown |
| `50101da` | `fd6adcd` | 2026-10-08 | Same 100-turn cooldown for moved mines |
| `a5a2ad5` | `678dbf4` | 2026-10-08 | Changelog + backlog: move cooldown |
| `7afd7e4` | `649e210` | 2026-10-08 | 100-turn cooldown after moving a general or city; mines stay free to move |
| `e98b8c4` | `f41c22a` | 2026-10-08 | Changelog + backlog: island rule, aggressive bots |
| `a583eb8` | `a7235f5` | 2026-10-08 | Island rule for moving generals, cities and mines; aggressive bots that hide and lay traps |
| `d9a19d1` | `fc3673e` | 2026-10-08 | Session hand-off docs: CLAUDE.md (guide + backlog) and CHANGELOG.md |
| `ba04024` | `b4e7976` | 2026-10-08 | Floating menu, movable generals/cities, grey flagged mines, towers off, bot stall breaker |
| `2c4b8cc` | `5dbe583` | 2026-10-08 | Build id: run git in the project folder so dev servers started elsewhere show the hash |
| `8c7cb40` | `02adaf7` | 2026-10-08 | Own-mine menu (flag/unflag, pick up); bots blast through mines when stuck |
| `8e8145e` | `17a9f0c` | 2026-10-08 | Plant mines with the flag gesture; classic mine icon |
| `091a0cd` | `bd2aac7` | 2026-10-08 | Flags capture mines; plant captured mines; public, fading blasts |
| `4308428` | `861fafa` | 2026-10-08 | Sounds, page gesture lock, feedback email live |
| `434e2e3` | `cc7fb14` | 2026-10-08 | Fixed full-size board, collapsible standings, fairer maps, lobby fix, feedback email |
| `cd0143d` | `b8f35de` | 2026-10-07 | Analytics live on PostHog EU; record in deploy docs |
| `2c9a6a1` | `6ca8886` | 2026-10-07 | Run solo games in the browser; offline play vs bots |
| `b01fb46` | `410ad98` | 2026-10-07 | In-game anonymous feedback stored privately in D1 |
| `7dc6f1a` | `6c3da56` | 2026-10-07 | Note deletion of the old Pages site |
| `407d78f` | `3508155` | 2026-10-07 | Record first Workers deploy and live URL |
| `845fe7d` | `485cee8` | 2026-10-06 | Distinct icons: gold crown + border for generals, buildings for cities |
| `435048b` | `b73f952` | 2026-10-06 | Make lobby countdown configurable; zero locally for solo testing |
| `09598f3` | `f166c95` | 2026-10-05 | Port the game server to Cloudflare Workers + Durable Objects |
| `b93b7e6` | `69f5de1` | 2026-10-05 | Live 6-player matches: game server, lobby countdown, mine dots |
| `f6aec56` | `dcd7f63` | 2026-10-02 | Deploy via wrangler: npm run deploy, live at blockmarshal.pages.dev |
| `ea21a48` | `7483b3f` | 2026-10-02 | Launch date 2026-10-10; label pre-launch dailies as a preview |
| `17bcc0e` | `a9ec7a6` | 2026-10-02 | Offline play, install icons, Cloudflare headers, deploy guide |
| `3cbe14b` | `1fb8014` | 2026-10-02 | Analytics, Commander fake door, install button, privacy note |
| `9732a26` | `3714d20` | 2026-10-02 | Tutorial: 3 coached levels, ranked gated behind it |
| `5b26ef4` | `577589e` | 2026-10-02 | Daily challenge: ranked attempt, strikes, share card, streak, practice |
| `897d9a6` | `f051bcb` | 2026-10-01 | Renderer: frontier number badges, watchtower art, stun HUD, zoom 30 |
| `0e68b3a` | `4de8760` | 2026-10-01 | Engine: mine stun, watchtowers, input log + replay, daily config |
| `1f44ad7` | `9f011a8` | 2026-10-01 | Initial commit: Blockmarshal prototype and v1 plan |
