-- The overlap signature, and the columns the candidate query needs.
--
-- The signature is a 25 m arc-length resampling of the trace, Google-encoded, computed in
-- the BROWSER at upload — the only place the geometry exists cheaply. The worker gets ~1 KB
-- per trail instead of a 10 MB GPX it could never parse inside the free plan's ~10 ms.
-- See worker/_lib/trailOverlap.ts and docs/TRAIL_UPLOAD_MODULE.md.
--
-- It is deliberately NOT inside the `stats` JSON blob. toEntry() copies `stats` verbatim
-- into /api/map/trails.json, which is measured at 676 B/entry with a sharding horizon
-- around 2,000 trails; a 1–9 KB signature in there would multiply that by 5–15x for a value
-- the map never reads.
ALTER TABLE trails ADD COLUMN sig TEXT;
-- Which spacing/projection/codec produced it. A signature from another version is skipped
-- rather than compared: incomparable is a verdict, silently-wrong is not.
ALTER TABLE trails ADD COLUMN sig_v INTEGER;
-- Ridden length in metres, as measured from the SIGNATURE rather than from the raw file, so
-- the two sides of a comparison are always measured the same way.
ALTER TABLE trails ADD COLUMN sig_len_m REAL;
-- Sampled more widely than 25 m because the trace was too long for the point budget. Such a
-- trail may still be reported as an overlap, but must never be refused on one.
ALTER TABLE trails ADD COLUMN sig_coarse INTEGER NOT NULL DEFAULT 0;

-- The candidate pre-filter. Generated rather than written, so they can never drift from the
-- stats they come from; VIRTUAL because SQLite refuses to ADD COLUMN … STORED.
-- `centre` is [lng, lat] — see checkStats() — so $.centre[0] is longitude.
ALTER TABLE trails ADD COLUMN centre_lng REAL GENERATED ALWAYS AS (json_extract(stats, '$.centre[0]')) VIRTUAL;
ALTER TABLE trails ADD COLUMN centre_lat REAL GENERATED ALWAYS AS (json_extract(stats, '$.centre[1]')) VIRTUAL;

-- Partial: only published trails are ever candidates, and they are a small minority.
CREATE INDEX IF NOT EXISTS trails_centre_public
  ON trails (centre_lat, centre_lng)
  WHERE visibility = 'public';
-- The exact-duplicate check, also only over what is published.
CREATE INDEX IF NOT EXISTS trails_sha1_public
  ON trails (gpx_sha1)
  WHERE visibility = 'public';
