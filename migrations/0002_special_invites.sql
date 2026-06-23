-- D1 schema for special influencer invites (the /join?c=<code> flow).
-- Apply: pnpm wrangler d1 execute dbx-subscribers --remote --file ./migrations/0002_special_invites.sql
-- See worker/_lib/join.ts (claimCode / sendInviteEmail) and docs/JOIN_MODULE.md.

-- Per-kind config. Rotate `invite_url`/`label` with a plain UPDATE (no deploy).
-- QR images live in R2 at qr/<kind>/<locale>.png (en fallback), NOT stored here.
CREATE TABLE IF NOT EXISTS invite_kinds (
  kind        TEXT PRIMARY KEY
              CHECK (kind IN ('holeshot_crew','track_stewards','plain')),
  label       TEXT NOT NULL,
  invite_url  TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Seed the 3 kinds (labels are operator-editable via `admin.mjs kinds set`).
INSERT OR IGNORE INTO invite_kinds (kind, label) VALUES
  ('holeshot_crew',  'Holeshot Crew'),
  ('track_stewards', 'Track Stewards'),
  ('plain',          'DirtBikeX');

-- One row per minted code. Single-use by default; claimCode() does the race-safe
-- claim with `UPDATE … WHERE used_count<max_uses AND not-expired RETURNING …`.
CREATE TABLE IF NOT EXISTS invite_codes (
  code            TEXT PRIMARY KEY,                  -- unguessable; what goes in the DM link ?c=
  kind            TEXT NOT NULL
                  CHECK (kind IN ('holeshot_crew','track_stewards','plain')),
  campaign        TEXT,                              -- free-text label (influencer / batch)
  max_uses        INTEGER NOT NULL DEFAULT 1,
  used_count      INTEGER NOT NULL DEFAULT 0,
  expires_at      TEXT,                              -- nullable; ISO/datetime
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  redeemed_email  TEXT,
  redeemed_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_invite_codes_campaign ON invite_codes(campaign);
