-- The byline on a claimed trail. Cached from the forum at claim time because trails.json
-- is served to anonymous visitors and the worker holds no scope to read a user.
ALTER TABLE trails ADD COLUMN author_name TEXT;
ALTER TABLE trails ADD COLUMN author_avatar TEXT;
