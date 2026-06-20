import type { PagesEnv, EventRow } from './types';

/**
 * Fetches a single discourse-post-event for `/s/e/<id>` from the **anon-readable**
 * show endpoint `GET /discourse-post-event/events/<id>.json` → `{ event: {...} }`
 * — exactly like `userLookup`'s `/u/<username>.json` (no API key).
 *
 * NOT the admin Data-Explorer path and NOT the list endpoint `events.json?post_id=`:
 *   - The show endpoint is publicly readable (verified), so requiring/forwarding
 *     `FORUM_API_KEY` only breaks it where the key is absent or scoped (the invite
 *     key is scoped to its Explorer query and 403s other routes).
 *   - The list/index action filters by guardian visibility, so it can hide an event;
 *     the show endpoint returns it directly. (event id == post id.)
 */
export type EventLookupResult =
  | { status: 'valid'; event: EventRow }
  | { status: 'not_found' }
  | { status: 'unreachable' };

interface DiscourseEvent {
  id?: number;
  name?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  all_day?: boolean | null;
  timezone?: string | null;
  location?: string | null;
  description?: string | null;
  is_ongoing?: boolean | null;
  is_expired?: boolean | null;
  is_closed?: boolean | null;
  creator?: { username?: string; name?: string | null; avatar_template?: string | null } | null;
  post?: { url?: string | null; topic?: { tags?: ({ name?: string | null } | string)[] | null } | null } | null;
  stats?: { going?: number | null; interested?: number | null; invited?: number | null } | null;
  sample_invitees?: {
    status?: string | null;
    user?: { name?: string | null; avatar_template?: string | null } | null;
  }[] | null;
  /** Event hero image — absolute CDN URL. */
  image_upload?: { url?: string | null } | null;
}

export async function lookupEvent(env: PagesEnv, eventId: string): Promise<EventLookupResult> {
  if (!env.FORUM_BASE) {
    console.error('lookupEvent:missing_env', { has_base: !!env.FORUM_BASE });
    return { status: 'unreachable' };
  }

  const url = `${env.FORUM_BASE}/discourse-post-event/events/${encodeURIComponent(eventId)}.json`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      // Anonymous — the show endpoint is public; no API key (see header doc).
      headers: { Accept: 'application/json' },
      // 5min edge cache, matches the invite/user lookups.
      ...({ cf: { cacheTtl: 300, cacheEverything: true } } as RequestInit),
    });
  } catch (err) {
    console.error('lookupEvent:fetch_threw', { err: String(err), url });
    return { status: 'unreachable' };
  }

  if (resp.status === 404) return { status: 'not_found' };
  if (resp.status !== 200) {
    console.error('lookupEvent:non_200', { status: resp.status });
    return { status: 'unreachable' };
  }

  let body: { event?: DiscourseEvent };
  try {
    body = (await resp.json()) as typeof body;
  } catch (err) {
    console.error('lookupEvent:json_parse_failed', { err: String(err) });
    return { status: 'unreachable' };
  }

  const e = body.event;
  if (!e || typeof e.id !== 'number') return { status: 'not_found' };

  const event: EventRow = {
    id: e.id,
    name: (e.name ?? '').trim() || 'Event',
    starts_at: e.starts_at ?? '',
    ends_at: e.ends_at ?? null,
    all_day: e.all_day === true,
    timezone: e.timezone ?? null,
    location: e.location ?? null,
    description: e.description ?? null,
    organizer: {
      username: e.creator?.username ?? '',
      name: e.creator?.name ?? null,
      avatar_template: e.creator?.avatar_template ?? null,
    },
    post_url: e.post?.url ?? null,
    stats: e.stats
      ? { going: e.stats.going ?? 0, interested: e.stats.interested ?? 0, invited: e.stats.invited ?? 0 }
      : null,
    tags: (e.post?.topic?.tags ?? [])
      .map((t) => (typeof t === 'string' ? t : (t?.name ?? '')))
      .filter(Boolean),
    invitees: (e.sample_invitees ?? []).slice(0, 6).map((inv) => ({
      avatar_template: inv?.user?.avatar_template ?? null,
      name: inv?.user?.name ?? null,
      status: inv?.status ?? null,
    })),
    is_ongoing: e.is_ongoing === true,
    is_expired: e.is_expired === true,
    is_closed: e.is_closed === true,
    image_url: e.image_upload?.url ?? null,
  };
  return { status: 'valid', event };
}
