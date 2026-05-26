import type { PagesEnv } from './types';

// Edge-cached proxy to sponsorhub's `/sponsors.json` + `/leaderboard/<period>.json`.
// 60-second TTL — iOS refresh window is 24h, but the Worker cache absorbs
// burst traffic from the /sponsors page client-side fetch.
const PUBLIC_CACHE_TTL = 60;

async function passThrough(env: PagesEnv, path: string): Promise<Response> {
  if (!env.SPONSOR_API_BASE) {
    return new Response(JSON.stringify({ error: 'unreachable', reason: 'sponsor_api_unconfigured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    });
  }
  const url = `${env.SPONSOR_API_BASE}${path}`;
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { Accept: 'application/json' },
      ...({ cf: { cacheTtl: PUBLIC_CACHE_TTL, cacheEverything: true } } as RequestInit),
    });
  } catch (err) {
    console.error('sponsorProxy:fetch_threw', { err: String(err), path });
    return new Response(JSON.stringify({ error: 'unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    });
  }
  if (!upstream.ok) {
    console.error('sponsorProxy:non_2xx', { status: upstream.status, path });
    return new Response(JSON.stringify({ error: 'upstream_error', status: upstream.status }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    });
  }
  // Re-emit with our own Cache-Control so browsers + intermediates honor the
  // 60s TTL even when upstream omits the header.
  const body = await upstream.text();
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${PUBLIC_CACHE_TTL}, s-maxage=${PUBLIC_CACHE_TTL}`,
    },
  });
}

export function fetchSponsors(env: PagesEnv): Promise<Response> {
  return passThrough(env, '/sponsors.json');
}

// `period` is whitelisted; sponsorhub's `LeaderboardPeriod` enum from
// src/schemas/wire.ts. Keeping the set duplicated here is intentional — we
// don't want sponsorhub's URL shape leaking through unvalidated.
const ALLOWED_PERIODS = new Set(['monthly', 'all_time', 'weekly', 'yearly']);

export function fetchLeaderboard(env: PagesEnv, period: string): Promise<Response> {
  if (!ALLOWED_PERIODS.has(period)) {
    return Promise.resolve(
      new Response(JSON.stringify({ error: 'bad_request', reason: 'unknown_period' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }
  return passThrough(env, `/leaderboard/${period}.json`);
}
