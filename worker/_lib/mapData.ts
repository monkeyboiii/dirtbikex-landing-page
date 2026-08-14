import type { PagesEnv } from './types';

/**
 * Serves the world map's operator-curated data — the series story and the promoted
 * trails (CONCRETE_MAP_PLAN.md §5.4, MAP_LAYERS_PLAN.md §3b).
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

/** `doc` is the basename shared by the R2 key and the committed seed: series, trails. */
export async function handleMapDoc(
  request: Request,
  env: PagesEnv,
  ctx: WaitUntil,
  doc: string,
): Promise<Response> {
  const cached = await caches.default.match(request).catch(() => undefined);
  if (cached) return cached;

  const prefix = env.MAP_DATA_PREFIX ?? 'prod';
  let body: string | null = null;

  try {
    const object = await env.MAP_BUCKET?.get(`${prefix}/${doc}.json`);
    if (object) body = await object.text();
  } catch (err) {
    console.error('mapDoc:r2_threw', { err: String(err), prefix, doc });
  }

  if (body === null && env.ASSETS) {
    const seed = await env.ASSETS.fetch(new Request(new URL(`/map/${doc}.seed.json`, request.url).toString()));
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
