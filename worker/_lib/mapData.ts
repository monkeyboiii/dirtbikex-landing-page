import type { PagesEnv } from './types';

/**
 * Serves the world map's operator-curated story data (CONCRETE_MAP_PLAN.md §5.4).
 *
 * R2 is the live projection — the operator overwrites it with `scripts/push-map-data.mjs`
 * and the change is live inside the edge TTL, no redeploy. The committed
 * `public/map/series.seed.json` is the fallback so the page works before the first push.
 *
 * Edge caching goes through `caches.default` on purpose: `s-maxage` alone never stores a
 * worker-generated response, and `cf.cacheTtl` only applies to origin subrequests, not to
 * R2 binding reads.
 */
const EDGE_TTL = 300;
const CACHE_CONTROL = `public, max-age=60, s-maxage=${EDGE_TTL}`;

declare const caches: { default: { match(r: Request): Promise<Response | undefined>; put(r: Request, resp: Response): Promise<void> } };

export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

export async function handleMapSeries(request: Request, env: PagesEnv, ctx: WaitUntil): Promise<Response> {
  const cached = await caches.default.match(request).catch(() => undefined);
  if (cached) return cached;

  const prefix = env.MAP_DATA_PREFIX ?? 'prod';
  let body: string | null = null;

  try {
    const object = await env.MAP_BUCKET?.get(`${prefix}/series.json`);
    if (object) body = await object.text();
  } catch (err) {
    console.error('mapSeries:r2_threw', { err: String(err), prefix });
  }

  if (body === null && env.ASSETS) {
    const seed = await env.ASSETS.fetch(new Request(new URL('/map/series.seed.json', request.url).toString()));
    if (seed.ok) body = await seed.text();
  }

  if (body === null) {
    return new Response(JSON.stringify({ error: 'unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    });
  }

  const response = new Response(body, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': CACHE_CONTROL },
  });
  ctx.waitUntil(caches.default.put(request, response.clone()).catch(() => {}));
  return response;
}
