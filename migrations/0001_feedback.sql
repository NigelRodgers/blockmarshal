-- Anonymous player feedback. No names, accounts or IP addresses are stored.
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- How fun, 1-5; NULL if skipped.
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  confusing TEXT,
  improve TEXT,
  -- JSON: screen it was sent from, turn, result, device class, app version.
  context TEXT
);
