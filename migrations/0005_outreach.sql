-- D1 schema for the pre-invite BATCH outreach pipeline. See docs/OUTREACH_MODULE.md
-- §"Batch outreach". Apply:
--   pnpm wrangler d1 execute dbx-subscribers --file ./migrations/0005_outreach.sql
--   local: add --local   ·   remote: add --remote   (repeat with --env preview)
--
-- `outreach` is BOTH the send-once ledger (email PK) and the drip queue. On the
-- prod worker rows are `mode='real'` (send-once = never re-queued); on the preview
-- worker they are only test rows (`override`/`dry_run`), which re-queue freely.
CREATE TABLE IF NOT EXISTS outreach (
  email         TEXT PRIMARY KEY,                 -- lowercased; the send-once key
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','claimed','sent','sent_dryrun','suppressed','failed_permanent')),
  mode          TEXT NOT NULL DEFAULT 'real'
                CHECK (mode IN ('real','dry_run','override')),
  track_name    TEXT NOT NULL DEFAULT 'your track',
  track_region  TEXT,                             -- informational only (never keyed on)
  locale        TEXT NOT NULL DEFAULT 'en',
  job_id        TEXT,
  override_to   TEXT,                             -- override mode: real delivery target (your inbox)
  unsub_token   TEXT NOT NULL,                    -- per-row secret for /api/outreach/u
  attempts      INTEGER NOT NULL DEFAULT 0,
  claimed_at    TEXT,                             -- set on claim; the reaper re-queues stale claims
  sent_at       TEXT,
  last_error    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_unsub   ON outreach(unsub_token);
CREATE INDEX        IF NOT EXISTS idx_outreach_status  ON outreach(status);
CREATE INDEX        IF NOT EXISTS idx_outreach_job     ON outreach(job_id);
CREATE INDEX        IF NOT EXISTS idx_outreach_sent_at ON outreach(sent_at);

-- One row per batch enqueue — powers the CRM Outreach tab's Send-jobs panel.
CREATE TABLE IF NOT EXISTS outreach_jobs (
  id            TEXT PRIMARY KEY,                 -- crypto.randomUUID()
  mode          TEXT NOT NULL DEFAULT 'real'
                CHECK (mode IN ('real','dry_run','override')),
  override_to   TEXT,
  requested     INTEGER NOT NULL DEFAULT 0,       -- recipients in the POST
  enqueued      INTEGER NOT NULL DEFAULT 0,       -- newly queued (or re-queued in test modes)
  already       INTEGER NOT NULL DEFAULT 0,       -- send-once conflict (real mode)
  suppressed    INTEGER NOT NULL DEFAULT 0,
  rejected      INTEGER NOT NULL DEFAULT 0,       -- invalid email
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_outreach_jobs_created ON outreach_jobs(created_at);

-- Sending-side opt-out + hard-bounce ledger. Authoritative for whether a send fires.
-- The CRM's SQLite `suppressions` pushes here synchronously (unsubscribe.py); the
-- tokened /api/outreach/u one-click writes here; the Resend bounce webhook will too.
CREATE TABLE IF NOT EXISTS suppressions (
  email       TEXT PRIMARY KEY,                   -- lowercased
  reason      TEXT NOT NULL DEFAULT 'unsub'
              CHECK (reason IN ('unsub','bounce','complaint','manual')),
  source      TEXT,                               -- 'one_click' | 'crm' | 'resend_webhook'
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
