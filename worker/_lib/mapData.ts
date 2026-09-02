import type { PagesEnv } from './types';

/**
 * Serves the world map's operator-curated data — the series story and the promoted
 * trails (agents.d/modules/map.md, agents.d/modules/trails.md).
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

declare const caches: {
  default: {
    match(r: Request): Promise<Response | undefined>;
    put(r: Request, resp: Response): Promise<void>;
    delete(r: Request): Promise<boolean>;
  };
};

export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * R2 first, committed seed second — the one place that resolution order lives, so
 * the JSON route and the share cards can never disagree about which document is
 * canonical. Returns null when neither is readable.
 */
export async function readMapDocBody(request: Request, env: PagesEnv, doc: string): Promise<string | null> {
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

  return body;
}

/**
 * `doc` is the basename shared by the R2 key and the committed seed: series, trails.
 *
 * `augment` lets a document gain rows the operator did not curate — today only visitor
 * trail uploads, which live in D1 and are merged here rather than written into the R2
 * document. Keeping them out of R2 is deliberate: the curated file stays an artifact one
 * person edits and pushes, and no visitor write can corrupt it.
 */
/**
 * Drops the cached copy of one map document.
 *
 * Publishing a trail changes what /api/map/trails.json says, and without this the change
 * waits out `s-maxage` — five minutes during which a rider toggles "show on the map",
 * looks, sees nothing, and toggles back. The cache key is the request URL, so the purge
 * has to name it: this covers the plain URL, which is what the island fetches.
 */
export async function purgeMapDoc(request: Request, doc: string): Promise<void> {
  const url = new URL(request.url);
  url.pathname = `/api/map/${doc}.json`;
  url.search = '';
  await caches.default.delete(new Request(url.toString())).catch(() => {});
}

export async function handleMapDoc(
  request: Request,
  env: PagesEnv,
  ctx: WaitUntil,
  doc: string,
  augment?: (parsed: Record<string, unknown>) => Promise<Record<string, unknown>>,
): Promise<Response> {
  const cached = await caches.default.match(request).catch(() => undefined);
  if (cached) return cached;

  let body = await readMapDocBody(request, env, doc);

  if (body !== null && augment) {
    try {
      body = JSON.stringify(await augment(JSON.parse(body) as Record<string, unknown>));
    } catch (err) {
      // A broken merge must not take the curated document down with it.
      console.error('mapDoc:augment_threw', { err: String(err), doc });
    }
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
