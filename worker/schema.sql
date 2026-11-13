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
  hidden INTEGER NOT NULL DEFAULT 0, -- set to 1 to take a bottle down
  votes INTEGER NOT NULL DEFAULT 0   -- a bottle is a wish for a plugin; these are the "me too"s
);
-- A database created before wishes needs: ALTER TABLE bottles ADD COLUMN votes INTEGER NOT NULL DEFAULT 0;
-- One row per visitor per wish per day (the IP hash rotates daily, so a vote can repeat on another day).
CREATE TABLE IF NOT EXISTS wish_votes (
  iph TEXT NOT NULL,
  id INTEGER NOT NULL,
  day INTEGER NOT NULL,
  PRIMARY KEY (iph, id)
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
  hidden INTEGER NOT NULL DEFAULT 0,
  fish INTEGER NOT NULL DEFAULT 0,      -- plugins landed by fishing
  fishbest INTEGER NOT NULL DEFAULT 0,  -- stars of the biggest catch
  fishname TEXT NOT NULL DEFAULT ''     -- and its name
);
-- A database created before fishing needs the three columns added once:
--   ALTER TABLE scores ADD COLUMN fish INTEGER NOT NULL DEFAULT 0;  (likewise fishbest, and fishname TEXT NOT NULL DEFAULT '')
CREATE INDEX IF NOT EXISTS scores_rank ON scores (seen DESC, deepest DESC);

-- Fishing: how many times each repo has been landed, shown on its page and its badge.
CREATE TABLE IF NOT EXISTS catches (
  repo TEXT PRIMARY KEY,           -- owner/repo, lower case
  n INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS catches_top ON catches (n DESC);
-- One row per visitor per repo per day, so a catch is only counted once. Old rows are deleted.
CREATE TABLE IF NOT EXISTS hooks (
  iph TEXT NOT NULL,
  repo TEXT NOT NULL,
  day INTEGER NOT NULL,
  PRIMARY KEY (iph, repo)
);
