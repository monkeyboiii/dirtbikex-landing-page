import { readMapDocBody } from './mapData';
import type { PagesEnv } from './types';

/**
 * Share cards for the things on the map: a route someone rode, a track, a shop, an
 * episode of the 100 challenge. They all resolve the same way (a map document or the
 * track catalog), they all deep-link back into the map the same way (`?t=` / `?ep=`),
 * and they all render through the same card — so this file is the lookup and the
 * shape, and `render.ts` draws it.
 *
 * `/s/<kind>/<key>` keeps the grammar every other share already uses, which means
 * AASA covers these for free — and which is exactly why each one needs a matching
 * `ShareKind` case in the app, or the link opens the app and dies there.
 */

export type EntityKind = 'route' | 'track' | 'shop' | 'challenge';

/**
 * Path segment → kind. The segment is the word, because a share URL is read
 * aloud, pasted into chat and typed from memory — and `tr` vs `ta` is exactly
 * the pair that gets transposed. Full words also settle the collision the short
 * codes were invented to avoid: `/s/track/` and a future `/s/topic/` cannot be
 * confused, so `t` stays free without costing legibility.
 *
 * The two-letter codes stay forever as aliases; they were live, and a share URL
 * that ever worked must keep working. `SHARE_ALIASES` is the whole migration.
 */
export const ENTITY_KINDS: Record<string, EntityKind> = {
  route: 'route',
  track: 'track',
  shop: 'shop',
  challenge: 'challenge',
};

/** Retired spellings, kept resolvable. Canonical output always uses the word. */
export const SHARE_ALIASES: Record<string, string> = {
  tr: 'route',
  ta: 'track',
  sh: 'shop',
  ch: 'challenge',
  l: 'lineage',
};

export interface EntityFact {
  /** A copy key on `EntityCopy['facts']`, or null when `value` is already a label. */
  key: 'distance' | 'ascent' | 'shape' | 'recorded' | 'where' | null;
  value: string;
}

export interface EntityCard {
  kind: EntityKind;
  key: string;
  /** The line above the title. `03 / 100` for an episode — the product's own motif. */
  kicker: string | null;
  title: string;
  subtitle: string | null;
  facts: EntityFact[];
  /** Deep link back into the map, relative so it works on either apex. */
  mapURL: string;
  /** Forum thread, shop website — whatever "the source" is for this kind. */
  sourceURL: string | null;
  /** The rider whose ride this is. Routes only; everything else has no author. */
  author: { username: string; name: string; avatarPath: string | null } | null;
  ogImage: string | null;
}

const num = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null);

/** `ebike_park` -> `Ebike park`. Enum values are for the database, not the reader. */
const humanize = (code: string): string => {
  const words = code.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** `{en, zh-CN}` blobs appear in trails and series; take the viewer's, else English. */
function pickText(value: unknown, locale: string): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!value || typeof value !== 'object') return null;
  const map = value as Record<string, string>;
  return (map[locale] ?? map.en ?? Object.values(map)[0] ?? '').trim() || null;
}

async function mapDoc<T>(request: Request, env: PagesEnv, doc: string): Promise<T | null> {
  const body = await readMapDocBody(request, env, doc);
  if (body === null) return null;
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

export async function loadEntity(
  request: Request,
  env: PagesEnv,
  kind: EntityKind,
  key: string,
  locale: string,
): Promise<EntityCard | null> {
  switch (kind) {
    case 'route':
      return loadRoute(request, env, key, locale);
    case 'shop':
      return loadShop(request, env, key);
    case 'challenge':
      return loadChallenge(request, env, key, locale);
    case 'track':
      return loadTrack(env, key);
  }
}

async function loadRoute(request: Request, env: PagesEnv, id: string, locale: string): Promise<EntityCard | null> {
  const doc = await mapDoc<{ trails?: Record<string, unknown>[] }>(request, env, 'trails');
  const trail = doc?.trails?.find((t) => t.id === id);
  if (!trail) return null;

  const stats = (trail.stats ?? {}) as Record<string, unknown>;
  const ele = (stats.ele ?? {}) as Record<string, unknown>;
  const time = (stats.time ?? {}) as Record<string, unknown>;
  const distance = num(trail.distance_km);
  const ascent = num(ele.ascent_m);
  const recorded = typeof time.recorded_at === 'string' ? time.recorded_at.slice(0, 10) : null;

  const facts: EntityFact[] = [];
  if (distance !== null) facts.push({ key: 'distance', value: `${distance} km` });
  if (ascent !== null) facts.push({ key: 'ascent', value: `${ascent} m` });
  if (typeof stats.shape === 'string' && stats.shape) facts.push({ key: 'shape', value: stats.shape });
  if (recorded) facts.push({ key: 'recorded', value: recorded });

  const username = typeof trail.author_username === 'string' ? trail.author_username : null;
  return {
    kind: 'route',
    key: id,
    kicker: null,
    title: pickText(trail.title, locale) ?? id,
    subtitle: null,
    facts,
    mapURL: `/?layers=tracks,trails&t=${encodeURIComponent(id)}`,
    sourceURL: typeof trail.post_url === 'string' ? trail.post_url : null,
    author: username
      ? {
          username,
          name: (typeof trail.author_name === 'string' && trail.author_name) || username,
          avatarPath: typeof trail.author_avatar === 'string' ? trail.author_avatar : null,
        }
      : null,
    ogImage: null,
  };
}

async function loadShop(request: Request, env: PagesEnv, slug: string): Promise<EntityCard | null> {
  const doc = await mapDoc<{ shops?: Record<string, unknown>[] }>(request, env, 'shops');
  const shop = doc?.shops?.find((s) => s.slug === slug);
  if (!shop) return null;

  const locality = typeof shop.locality === 'string' ? shop.locality : null;
  return {
    kind: 'shop',
    key: slug,
    kicker: null,
    title: (typeof shop.name_local === 'string' && shop.name_local) || String(shop.name ?? slug),
    subtitle: locality,
    // The subtitle already says where. Repeating it as a fact was the card
    // printing the same column twice.
    facts: [],
    mapURL: `/?layers=tracks,shops&t=${encodeURIComponent(slug)}`,
    sourceURL: typeof shop.website === 'string' ? shop.website : null,
    author: null,
    ogImage: null,
  };
}

async function loadChallenge(request: Request, env: PagesEnv, label: string, locale: string): Promise<EntityCard | null> {
  const doc = await mapDoc<{ entries?: Record<string, unknown>[]; target?: number }>(request, env, 'series');
  const entry = doc?.entries?.find((e) => String(e.label) === label);
  if (!entry) return null;

  // `03 / 100` is the most distinctive thing the series has. It leads.
  const target = num(doc?.target);

  const venue = pickText(entry.venue, locale);
  // `status` is a production-pipeline value (live / upcoming / visited). It says
  // nothing to a recipient and reads as a leaked column, so it stays off the card.
  const facts: EntityFact[] = venue ? [{ key: 'where', value: venue }] : [];

  // An episode's own social links are the sharable artefact when it is published;
  // the map is the fallback for one that is still upcoming.
  const links = (entry.links ?? {}) as Record<string, string>;
  const firstLink = ['douyin', 'tiktok', 'instagram', 'facebook'].map((k) => links[k]).find(Boolean) ?? null;

  return {
    kind: 'challenge',
    key: label,
    kicker: target ? `${label} / ${target}` : label,
    title: pickText(entry.title, locale) ?? `#${label}`,
    subtitle: pickText(entry.tagline, locale),
    facts,
    mapURL: `/?ep=${encodeURIComponent(label)}`,
    sourceURL: firstLink,
    author: null,
    ogImage: typeof entry.thumb === 'string' ? entry.thumb : null,
  };
}

/**
 * Tracks are not in a map document — the catalog is 3,600 baked features and
 * scanning it per card would be absurd. The plugin already answers by slug.
 */
async function loadTrack(env: PagesEnv, slug: string): Promise<EntityCard | null> {
  if (!env.FORUM_BASE) return null;
  const resp = await fetch(`${env.FORUM_BASE}/dirtbikex/tracks/${encodeURIComponent(slug)}.json`, {
    headers: { Accept: 'application/json' },
    ...({ cf: { cacheTtl: 300, cacheEverything: true } } as RequestInit),
  }).catch(() => null);
  if (!resp?.ok) return null;

  const track = ((await resp.json().catch(() => null)) as { track?: Record<string, unknown> } | null)?.track;
  if (!track) return null;

  const locality = typeof track.locality === 'string' ? track.locality : null;
  // Locality is the subtitle; the category is the only other thing worth saying,
  // and `ebike_park` is a database value, not a word anyone writes.
  const facts: EntityFact[] =
    typeof track.category === 'string' && track.category
      ? [{ key: null, value: humanize(track.category) }]
      : [];

  // Owner and topic are optional on the catalog row; a track that has neither
  // simply renders without them rather than with an empty byline.
  const owner = track.owner as { username?: string; name?: string; avatar_template?: string } | undefined;
  const topicId = num(track.topic_id);

  return {
    kind: 'track',
    key: slug,
    kicker: null,
    title: (typeof track.name_local === 'string' && track.name_local) || String(track.name ?? slug),
    subtitle: locality,
    facts,
    mapURL: `/?layers=tracks&t=${encodeURIComponent(slug)}`,
    sourceURL: topicId
      ? `${env.FORUM_BASE}/t/${topicId}`
      : typeof track.website === 'string'
        ? track.website
        : null,
    author: owner?.username
      ? {
          username: owner.username,
          name: owner.name || owner.username,
          avatarPath: owner.avatar_template ?? null,
        }
      : null,
    ogImage: null,
  };
}
