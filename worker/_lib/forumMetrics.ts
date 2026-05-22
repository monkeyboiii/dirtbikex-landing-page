import type { PagesEnv } from './types';

/**
 * Fetches `/about.json` from the Discourse forum, edge-cached 24h, and
 * returns a minimal stats payload for the marketing-site Hero strip.
 *
 * `/about.json` is a public endpoint — no API key required, only
 * `FORUM_BASE`. Failure paths log under `forumMetrics:<reason>` so
 * `wrangler tail` can surface which branch fired.
 */
export interface ForumMetricsPayload {
  users_count: number;
  active_users_30_days: number;
  topics_count: number;
  posts_count: number;
  likes_count: number;
  forum_base: string;
}

export type ForumMetricsResult =
  | { status: 'ok'; payload: ForumMetricsPayload }
  | { status: 'unreachable' };

export async function fetchForumMetrics(env: PagesEnv): Promise<ForumMetricsResult> {
  if (!env.FORUM_BASE) {
    console.error('forumMetrics:missing_env', { has_base: false });
    return { status: 'unreachable' };
  }

  const url = `${env.FORUM_BASE}/about.json`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { Accept: 'application/json' },
      ...({ cf: { cacheTtl: 86400, cacheEverything: true } } as RequestInit),
    });
  } catch (err) {
    console.error('forumMetrics:fetch_threw', { err: String(err), url });
    return { status: 'unreachable' };
  }

  if (resp.status !== 200) {
    console.error('forumMetrics:non_200', { status: resp.status, url });
    return { status: 'unreachable' };
  }

  let body: { about?: { stats?: Record<string, unknown> } };
  try {
    body = (await resp.json()) as typeof body;
  } catch (err) {
    console.error('forumMetrics:json_parse_failed', { err: String(err), url });
    return { status: 'unreachable' };
  }

  const stats = body?.about?.stats;
  if (!stats || typeof stats !== 'object') {
    console.error('forumMetrics:bad_shape', { has_about: !!body?.about });
    return { status: 'unreachable' };
  }

  return {
    status: 'ok',
    payload: {
      users_count: numberOr(stats.users_count, 0),
      active_users_30_days: numberOr(stats.active_users_30_days, 0),
      topics_count: numberOr(stats.topics_count, 0),
      posts_count: numberOr(stats.posts_count, 0),
      likes_count: numberOr(stats.likes_count, 0),
      forum_base: env.FORUM_BASE,
    },
  };
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
