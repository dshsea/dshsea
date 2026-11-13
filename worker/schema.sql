-- D1 schema for the two features that need a server: bottles and the leaderboard.
--   npx wrangler d1 execute dshsea --remote --file worker/schema.sql
CREATE TABLE IF NOT EXISTS bottles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  depth INTEGER NOT NULL,          -- metres
  text TEXT NOT NULL,
  name TEXT NOT NULL,
  created INTEGER NOT NULL,        -- unix seconds
  iph TEXT NOT NULL,               -- daily-rotating hash of the sender's IP, for rate limiting only
  reports INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0 -- set to 1 to take a bottle down
);
CREATE INDEX IF NOT EXISTS bottles_depth ON bottles (depth);
CREATE INDEX IF NOT EXISTS bottles_iph ON bottles (iph, created);

CREATE TABLE IF NOT EXISTS scores (
  id TEXT PRIMARY KEY,             -- random id kept in the diver's browser
  name TEXT NOT NULL,
  seen INTEGER NOT NULL,
  species INTEGER NOT NULL,
  deepest INTEGER NOT NULL,
  ach INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  iph TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS scores_rank ON scores (seen DESC, deepest DESC);
