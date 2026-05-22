import type { PagesEnv } from './types';

/**
 * Fetches the top 5 monthly topics from Discourse `/top.json?period=monthly`,
 * resolves each topic's first poster against the top-level `users[]` table
 * (since Discourse returns user_id references, not embedded user objects),
 * and returns a normalized payload for the marketing-site Featured Topics
 * section.
 *
 * Public endpoint — no API key required. 24h CF edge cache via `cf.cacheTtl`.
 * `forum_base` is echoed back in the response so the client can build topic
 * and avatar URLs without `import.meta.env` (worker/ cannot import from src/).
 */

export interface FeaturedPoster {
  username: string;
  name: string | null;
  avatar_template: string | null;
}

export interface FeaturedTopic {
  id: number;
  slug: string;
  title: string;
  fancy_title: string | null;
  excerpt: string | null;
  image_url: string | null;
  last_posted_at: string | null;
  posts_count: number;
  like_count: number;
  tags: { name: string; slug: string }[];
  poster: FeaturedPoster | null;
}

export interface ForumFeaturedPayload {
  topics: FeaturedTopic[];
  forum_base: string;
}

export type ForumFeaturedResult =
  | { status: 'ok'; payload: ForumFeaturedPayload }
  | { status: 'unreachable' };

interface RawUser {
  id?: number;
  username?: string;
  name?: string | null;
  avatar_template?: string | null;
}

interface RawTopic {
  id?: number;
  slug?: string;
  title?: string;
  fancy_title?: string | null;
  excerpt?: string | null;
  image_url?: string | null;
  last_posted_at?: string | null;
  posts_count?: number;
  like_count?: number;
  tags?: { name?: string; slug?: string }[];
  posters?: { user_id?: number }[];
}

export async function fetchForumFeatured(env: PagesEnv): Promise<ForumFeaturedResult> {
  if (!env.FORUM_BASE) {
    console.error('forumFeatured:missing_env', { has_base: false });
    return { status: 'unreachable' };
  }

  const url = `${env.FORUM_BASE}/top.json?period=monthly`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { Accept: 'application/json' },
      ...({ cf: { cacheTtl: 86400, cacheEverything: true } } as RequestInit),
    });
  } catch (err) {
    console.error('forumFeatured:fetch_threw', { err: String(err), url });
    return { status: 'unreachable' };
  }

  if (resp.status !== 200) {
    console.error('forumFeatured:non_200', { status: resp.status, url });
    return { status: 'unreachable' };
  }

  let body: { users?: RawUser[]; topic_list?: { topics?: RawTopic[] } };
  try {
    body = (await resp.json()) as typeof body;
  } catch (err) {
    console.error('forumFeatured:json_parse_failed', { err: String(err), url });
    return { status: 'unreachable' };
  }

  const rawTopics = body?.topic_list?.topics;
  if (!Array.isArray(rawTopics)) {
    console.error('forumFeatured:bad_shape', { has_topic_list: !!body?.topic_list });
    return { status: 'unreachable' };
  }

  const userMap = new Map<number, FeaturedPoster>();
  for (const u of body?.users ?? []) {
    if (u && typeof u.id === 'number') {
      userMap.set(u.id, {
        username: String(u.username ?? ''),
        name: typeof u.name === 'string' ? u.name : null,
        avatar_template: typeof u.avatar_template === 'string' ? u.avatar_template : null,
      });
    }
  }

  const topics: FeaturedTopic[] = rawTopics.slice(0, 5).map((t) => {
    const posterId = Array.isArray(t.posters) && t.posters[0] ? t.posters[0].user_id : undefined;
    const poster = typeof posterId === 'number' ? userMap.get(posterId) ?? null : null;
    const tags = Array.isArray(t.tags)
      ? t.tags
          .slice(0, 3)
          .map((tag) => ({ name: String(tag?.name ?? ''), slug: String(tag?.slug ?? '') }))
          .filter((tag) => tag.name)
      : [];

    return {
      id: Number(t.id),
      slug: String(t.slug ?? 'topic'),
      title: String(t.title ?? ''),
      fancy_title: typeof t.fancy_title === 'string' ? t.fancy_title : null,
      excerpt: typeof t.excerpt === 'string' ? t.excerpt : null,
      image_url: typeof t.image_url === 'string' ? t.image_url : null,
      last_posted_at: typeof t.last_posted_at === 'string' ? t.last_posted_at : null,
      posts_count: typeof t.posts_count === 'number' ? t.posts_count : 0,
      like_count: typeof t.like_count === 'number' ? t.like_count : 0,
      tags,
      poster,
    };
  });

  return { status: 'ok', payload: { topics, forum_base: env.FORUM_BASE } };
}
