-- Where a trail's public post lives. Only an imported trail has one: a claimed upload's
-- post is a personal message, and linking that from the public map would be a dead end
-- for everybody except its owner.
ALTER TABLE trails ADD COLUMN post_url TEXT;
