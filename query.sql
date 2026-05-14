-- [params]
-- string :invite_key

SELECT
  i.id,
  i.invite_key,
  i.custom_message AS description,
  i.created_at,
  i.updated_at,
  i.expires_at,
  (i.expires_at IS NOT NULL AND i.expires_at < NOW()) AS expired,
  i.max_redemptions_allowed,
  i.redemption_count,

  u.username                  AS inviter_username,
  u.name                      AS inviter_name,
  u.title                     AS inviter_title,
  u.uploaded_avatar_id        AS inviter_uploaded_avatar_id,

  COALESCE(
    jsonb_agg(DISTINCT jsonb_build_object(
      'id',        g.id,
      'name',      g.name,
      'full_name', g.full_name
    )) FILTER (WHERE g.id IS NOT NULL),
    '[]'::jsonb
  ) AS groups,

  COALESCE(
    jsonb_agg(DISTINCT jsonb_build_object(
      'id',          t.id,
      'title',       t.title,
      'fancy_title', t.fancy_title,
      'slug',        t.slug,
      'posts_count', t.posts_count
    )) FILTER (WHERE t.id IS NOT NULL),
    '[]'::jsonb
  ) AS topics

FROM invites i
JOIN users u ON u.id = i.invited_by_id
LEFT JOIN invited_groups ig ON ig.invite_id = i.id
LEFT JOIN groups g          ON g.id         = ig.group_id
LEFT JOIN topic_invites ti  ON ti.invite_id = i.id
LEFT JOIN topics t          ON t.id         = ti.topic_id

WHERE i.invite_key = :invite_key
  AND i.deleted_at IS NULL

GROUP BY i.id, u.id
LIMIT 1