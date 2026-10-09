-- One row per finished game, for replays and game analytics. Anonymous: only the
-- display names players typed (or bot names), no accounts or IP addresses.
-- Rows are downloaded to the owner's PC by `npm run replays` and deleted after that,
-- or after 60 days by the daily cron.
CREATE TABLE replays (
  id TEXT PRIMARY KEY,
  -- When the game ended, ms since 1970.
  created_at INTEGER NOT NULL,
  mode TEXT NOT NULL,
  -- 'server' (online match) or 'browser' (vs bot / solo, uploaded by the player's browser).
  source TEXT NOT NULL,
  humans INTEGER NOT NULL,
  ticks INTEGER NOT NULL,
  winner INTEGER NOT NULL,
  -- The whole replay (seed, players, input log) as JSON.
  data TEXT NOT NULL
);
CREATE INDEX replays_created ON replays (created_at);
