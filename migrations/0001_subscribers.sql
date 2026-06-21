-- D1 schema for the /join double-opt-in waitlist. See docs (worker/_lib/join.ts).
-- Apply:  pnpm wrangler d1 execute dbx-subscribers --file ./migrations/0001_subscribers.sql
--   local: add --local   ·   remote: add --remote
--
-- One row per email. `token` is a per-row secret used for BOTH the confirm link
-- and the (persistent) one-click unsubscribe link, so it is not cleared on confirm.
CREATE TABLE IF NOT EXISTS subscribers (
  email            TEXT PRIMARY KEY,                 -- lowercased
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','confirmed','unsubscribed')),
  token            TEXT NOT NULL,
  locale           TEXT NOT NULL DEFAULT 'en',
  source           TEXT NOT NULL DEFAULT 'join',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at     TEXT,
  unsubscribed_at  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_token  ON subscribers(token);
CREATE INDEX        IF NOT EXISTS idx_subscribers_status ON subscribers(status);
