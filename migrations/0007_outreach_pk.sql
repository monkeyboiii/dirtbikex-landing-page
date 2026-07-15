-- Rebuild `outreach` so concurrent TEST jobs (override / dry_run) to the SAME tracks don't
-- collide. The old `email` PRIMARY KEY made a second override job UPSERT-overwrite the first
-- job's rows (ON CONFLICT(email)), orphaning the first job — it showed 0/N "done" and never
-- sent. Now the PK is a synthetic `id`; REAL send-once is enforced by a PARTIAL UNIQUE INDEX
-- (email unique only WHERE mode='real'), and test rows may repeat freely. The drip now keys
-- per-row work on `id`, not `email`. See docs/OUTREACH_MODULE.md §"Batch outreach".
--   pnpm wrangler d1 execute dbx-subscribers --remote --env preview --file ./migrations/0007_outreach_pk.sql
CREATE TABLE outreach_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL,                    -- lowercased operator email; NOT unique for test rows
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','claimed','sent','sent_dryrun','suppressed','failed_permanent')),
  mode          TEXT NOT NULL DEFAULT 'real'
                CHECK (mode IN ('real','dry_run','override')),
  track_name    TEXT NOT NULL DEFAULT 'your track',
  track_region  TEXT,
  locale        TEXT NOT NULL DEFAULT 'en',
  job_id        TEXT,
  override_to   TEXT,
  unsub_token   TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  claimed_at    TEXT,
  sent_at       TEXT,
  last_error    TEXT,
  send_after    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO outreach_new
  (email,status,mode,track_name,track_region,locale,job_id,override_to,unsub_token,attempts,claimed_at,sent_at,last_error,send_after,created_at)
  SELECT email,status,mode,track_name,track_region,locale,job_id,override_to,unsub_token,attempts,claimed_at,sent_at,last_error,send_after,created_at
  FROM outreach;
DROP TABLE outreach;
ALTER TABLE outreach_new RENAME TO outreach;
CREATE UNIQUE INDEX idx_outreach_real_email ON outreach(email) WHERE mode='real';  -- send-once, real only
CREATE UNIQUE INDEX idx_outreach_unsub      ON outreach(unsub_token);
CREATE INDEX        idx_outreach_status     ON outreach(status);
CREATE INDEX        idx_outreach_job        ON outreach(job_id);
CREATE INDEX        idx_outreach_sent_at    ON outreach(sent_at);
CREATE INDEX        idx_outreach_send_after ON outreach(send_after);
