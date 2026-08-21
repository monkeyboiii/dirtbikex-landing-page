-- The forum's own `upload://<base62>.<ext>` handle for the same file.
--
-- Needed because a claim is a POST the plugin composes, and Discourse only creates the
-- upload_reference that stops the reaping when the upload appears inside a link:
-- `[ride.gpx|attachment](upload://…gpx)` cooks to an attachment and registers; the bare
-- short URL, or the CDN URL, cooks to plain text and registers nothing. Verified on
-- staging 2026-08-21 — the first form left upload_references at 1, the second at 0.
ALTER TABLE trails ADD COLUMN gpx_short_url TEXT;
