-- Visitor-uploaded rider trails. See agents.d/modules/trail-upload.md.
--
-- The GPX bytes live in Discourse (uploads-cdn), not here — this table is the index the
-- map reads and the only place a trail's visibility, secret and expiry are decided.
--
-- Why D1 and not R2, which is where the operator-curated trails.json lives: uploads
-- arrive concurrently from strangers. R2 `put` has no compare-and-set, so a single
-- document would lost-update, and a key-per-trail would mean a `list` plus a `get` per
-- trail on every cache miss. This wants atomic inserts, an indexed secret lookup and
-- `WHERE expires_at > now` — which is a table.
--
-- An UNCLAIMED row expires. So does its upload: with no post referencing it, Discourse's
-- CleanUpUploads reaps the file after clean_orphan_uploads_grace_period_hours. Claiming
-- creates the post that creates the upload_reference that stops the reaping, so the two
-- expiries are the same event by construction — see the module doc.

CREATE TABLE IF NOT EXISTS trails (
  -- Public slug once published, otherwise the same opaque value as `secret`.
  id              TEXT PRIMARY KEY,
  -- The private link. 8 alphanumerics: this is the ONLY thing protecting a precise
  -- trace of where somebody lives and rides, so a miss must be indistinguishable from
  -- an expiry (no enumeration oracle) and the resolve endpoint must be rate-limited.
  secret          TEXT NOT NULL UNIQUE,
  -- unlisted = uploaded, never claimed, link-only, expiring.
  -- private  = claimed, link-only, kept secret by its owner at their own discretion.
  -- public   = claimed and published; the only state that reaches the map document.
  visibility      TEXT NOT NULL DEFAULT 'unlisted',

  -- Exactly the `url` POST /uploads.json returned, with only the host swapped to
  -- uploads-cdn. NEVER rebuilt from the sha1: Discourse's storage depth is
  -- ceil(log16(id/1000)), so `original/1X/<sha1>` is only correct below upload id 1000.
  gpx_url         TEXT NOT NULL,
  gpx_sha1        TEXT,

  title           TEXT,
  distance_km     REAL,
  -- bbox, centre, points, segments, shape, ele, time — the same shape scripts/lib/gpx-trail.mjs
  -- emits, so a visitor upload and an operator import produce one entry format.
  stats           TEXT NOT NULL,

  -- Null until claimed. An unclaimed trail has NO author, which is why the byline and
  -- push-map-data had to stop requiring one.
  author_user_id  INTEGER,
  author_username TEXT,
  -- The post whose upload_reference keeps the file alive. Deleting it deletes the trail.
  post_id         INTEGER,

  -- One-time, shown once, cleared on claim.
  claim_code      TEXT UNIQUE,
  claimed_at      TEXT,
  -- NULL once claimed — that is what "claiming makes it permanent" means here.
  expires_at      TEXT,

  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  -- Hashed, not stored raw: abuse triage should not need a log of who rode where.
  ip_hash         TEXT
);

-- The map document's query: public and not expired.
CREATE INDEX IF NOT EXISTS trails_visible ON trails (visibility, expires_at);
-- The reconcile query, and post_destroyed -> drop the trail.
CREATE INDEX IF NOT EXISTS trails_post ON trails (post_id);
-- Sweeping expired rows off the per-minute cron.
CREATE INDEX IF NOT EXISTS trails_expiry ON trails (expires_at);
