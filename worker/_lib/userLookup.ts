import type { PagesEnv, UserRow } from './types';

/**
 * Fetches a public Discourse profile for `/s/u/<username>` via the unauthenticated
 * `GET /u/<username>.json` endpoint — no API key needed (verified anon-readable).
 *
 * `email` is not part of the public payload; do not start emitting it.
 *
 * A hidden profile (`profile_hidden:true`) returns a minimal Discourse shape —
 * collapsed here into a `valid` result with `hidden:true` so the renderer shows
 * the private-profile card rather than a generic error.
 */
export type UserLookupResult =
  | { status: 'valid'; user: UserRow }
  | { status: 'not_found' }
  | { status: 'unreachable' };

interface DiscourseUser {
  username?: string;
  name?: string | null;
  title?: string | null;
  admin?: boolean;
  moderator?: boolean;
  avatar_template?: string | null;
  profile_hidden?: boolean;
  bio_excerpt?: string | null;
  total_followers?: number | null;
  total_following?: number | null;
  gamification_score?: number | null;
  primary_group_name?: string | null;
  created_at?: string | null;
  website?: string | null;
  website_name?: string | null;
  geo_location?: { state?: string | null; country?: string | null; address?: string | null } | null;
  status?: { emoji?: string | null; description?: string | null } | null;
}

/** Short location, mirroring iOS `ProfileHeaderView.locationShortText`. */
function shortLocation(geo: DiscourseUser['geo_location']): string | null {
  if (!geo) return null;
  const pick = (s: string | null | undefined) => {
    const t = s?.trim();
    return t ? t : null;
  };
  return pick(geo.state) ?? pick(geo.country) ?? pick(geo.address);
}

export async function lookupUser(env: PagesEnv, username: string): Promise<UserLookupResult> {
  if (!env.FORUM_BASE) {
    console.error('lookupUser:missing_env', { has_base: !!env.FORUM_BASE });
    return { status: 'unreachable' };
  }

  const url = `${env.FORUM_BASE}/u/${encodeURIComponent(username)}.json`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { Accept: 'application/json' },
      // 5min edge cache, matches the invite lookup.
      ...({ cf: { cacheTtl: 300, cacheEverything: true } } as RequestInit),
    });
  } catch (err) {
    console.error('lookupUser:fetch_threw', { err: String(err), url });
    return { status: 'unreachable' };
  }

  if (resp.status === 404) return { status: 'not_found' };
  if (resp.status !== 200) {
    console.error('lookupUser:non_200', { status: resp.status, url });
    return { status: 'unreachable' };
  }

  let body: { user?: DiscourseUser };
  try {
    body = (await resp.json()) as typeof body;
  } catch (err) {
    console.error('lookupUser:json_parse_failed', { err: String(err), url });
    return { status: 'unreachable' };
  }

  const u = body.user;
  if (!u || typeof u.username !== 'string') {
    console.error('lookupUser:bad_shape', { has_user: !!u });
    return { status: 'unreachable' };
  }

  const hidden = u.profile_hidden === true;
  const status =
    !hidden && u.status?.emoji?.trim() && u.status?.description?.trim()
      ? { emoji: u.status.emoji.trim(), description: u.status.description.trim() }
      : null;
  const user: UserRow = {
    username: u.username,
    name: u.name ?? null,
    title: u.title ?? null,
    admin: u.admin === true,
    moderator: u.moderator === true,
    avatar_template: u.avatar_template ?? null,
    bio_excerpt: hidden ? null : (u.bio_excerpt ?? null),
    total_followers: hidden ? null : (u.total_followers ?? null),
    total_following: hidden ? null : (u.total_following ?? null),
    gamification_score: hidden ? null : (u.gamification_score ?? null),
    primary_group_name: u.primary_group_name ?? null,
    created_at: hidden ? null : (u.created_at ?? null),
    location: hidden ? null : shortLocation(u.geo_location),
    website: hidden ? null : (u.website ?? null),
    website_name: hidden ? null : (u.website_name ?? null),
    status,
    hidden,
  };
  return { status: 'valid', user };
}
