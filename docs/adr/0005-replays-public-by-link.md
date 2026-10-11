# Replays stay on the server for 60 days and are readable by anyone with their link

To point at a bug, share a game, or attach the last game to feedback, a replay needs an address. Replays now stay in D1 after the daily pull (which only copies new ones to the PC) until the existing 60-day cron prunes them, and `GET /api/replay/<id>` returns one to anyone who asks for its id. The id is a random UUID, so nobody can list or guess replays; the link is the permission. The read route skips the Origin check (browsers send no Origin on same-origin GETs, and links are meant to be opened from anywhere) and has its own per-IP rate limit.

## Considered Options

- **Upload only when shared, into a separate table:** fewer public replays, but a second storage path and a share step that can fail before the link exists.
- **No links, files only:** players can download a replay and send it, but nothing in feedback or chat can point at a game.

## Consequences

- Replays show the names players typed; anyone holding a link can see them. No accounts or other personal data are in a replay.
- Sharing or attaching a replay to feedback uploads a browser game even when the player turned analytics off: it is an explicit action.
- D1 now holds up to 60 days of games (about 20-100 KB each), well inside the free tier for current traffic.
