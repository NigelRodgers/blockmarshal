# Games against bots run in the player's browser

A match with one human and only bots (1 vs 1 vs bot, a lobby nobody else joined, offline play, `?quick`) runs in the browser with the same `Match` class the server uses (`src/local.ts`), instead of on a Durable Object. It costs the server nothing (the free Workers plan covers about 170 ten-minute server matches a day), works offline, and lets those games pause.

## Considered Options

- Run every match on the server: one code path, trustworthy results, but every solo game burns server time for no shared benefit.

## Consequences

- Results and replays from browser games are self-reported and can be forged; they are analytics, never trusted for anything with stakes. A leaderboard would need server-run or server-verified games.
- Only browser games can pause (including automatically when the page is hidden); online games keep running for everyone.
