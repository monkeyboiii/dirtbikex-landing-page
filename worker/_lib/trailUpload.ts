/**
 * Visitor trail upload. See TRAIL_UPLOAD_MODULE.md.
 *
 * The worker holds ONE Discourse scope, `uploads:create`. It never posts, never creates a
 * topic and never speaks for a user — everything needing a forum identity is done by the
 * plugin, server-side, as the visitor themselves. That is why a leak of this key can only
 * put files in the upload store and nothing else.
 *
 * The bytes go to Discourse; the index lives in D1. An upload nobody claims has no post
 * referencing it, so Discourse's own CleanUpUploads reaps the file — the row's `expires_at`
 * and the file's reaping are the same deadline, expressed twice.
 */
import { rateLimitConsume } from './rateLimit';
import type { PagesEnv } from './types';

/** Matches gpx.ts's MAX_GPX_BYTES and the forum's max_attachment_size_kb. All three agree. */
const MAX_GPX_BYTES = 10 * 1024 * 1024;
/** How much of the file the worker re-reads. A sanity check, not a parse — see below. */
const SNIFF_BYTES = 64 * 1024;
/** Unclaimed lifetime. Must not exceed clean_orphan_uploads_grace_period_hours, or the
    file is reaped while the row still advertises it. */
const UNCLAIMED_HOURS = 72;
/** No 0/O/1/I/l: these are read aloud and typed from memory. 32^8 ≈ 1.1e12. */
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

function token(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

async function hashed(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

const clientIp = (request: Request): string =>
  request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';

/**
 * The uploads CDN host for this environment, derived from FORUM_BASE so the two can never
 * disagree: forum.dirtbikex.com -> uploads-cdn.dirtbikex.com.
 */
function uploadsCdn(env: PagesEnv): string | null {
  if (!env.FORUM_BASE) return null;
  try {
    return new URL(env.FORUM_BASE).host.replace(/^forum\./, 'uploads-cdn.');
  } catch {
    return null;
  }
}

/**
 * Takes the `url` Discourse returned and swaps ONLY the host. Discourse computes an
 * upload's storage depth as ceil(log16(id/1000)), so `original/1X/<sha1>` stops being
 * correct above upload id 1000 — the path must be carried, never rebuilt.
 * Staging returns it protocol-relative (`//bucket.../original/1X/…`).
 */
function toCdnUrl(raw: unknown, env: PagesEnv): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  const cdn = uploadsCdn(env);
  if (!cdn) return null;
  try {
    const parsed = new URL(raw.startsWith('//') ? `https:${raw}` : raw, env.FORUM_BASE);
    return `https://${cdn}${parsed.pathname}`;
  } catch {
    return null;
  }
}

export interface TrailStatsInput {
  bbox?: unknown;
  centre?: unknown;
  points?: unknown;
  segments?: unknown;
  shape?: unknown;
}

/**
 * The client parsed the file with the same scanner the map draws with, so its numbers are
 * what the map will use. This re-checks the cheap invariants only: that the declared centre
 * sits inside the declared bbox, and that the first trackpoint in the file agrees with both.
 *
 * It is a sanity check, not proof — a determined client can still land a pin somewhere it
 * did not ride. For content that expires in 72 hours and is link-only until somebody claims
 * it, that is proportionate, and parsing 10 MB inside the free plan's CPU budget is not.
 */
function checkStats(stats: TrailStatsInput): { bbox: number[]; centre: number[] } | null {
  const bbox = Array.isArray(stats.bbox) ? stats.bbox.map(Number) : null;
  const centre = Array.isArray(stats.centre) ? stats.centre.map(Number) : null;
  if (!bbox || bbox.length !== 4 || !bbox.every(Number.isFinite)) return null;
  if (!centre || centre.length !== 2 || !centre.every(Number.isFinite)) return null;

  const [west, south, east, north] = bbox as [number, number, number, number];
  const [lng, lat] = centre as [number, number];
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  if (Math.abs(west) > 180 || Math.abs(east) > 180) return null;
  if (Math.abs(south) > 90 || Math.abs(north) > 90) return null;
  if (west > east || south > north) return null;
  // A zero-extent box is the third way gpx.studio renders nothing (RESEARCH.md): every
  // point identical, blank at 0.00 km. Reject it here rather than publish a dead pin.
  if (east - west === 0 && north - south === 0) return null;
  if (lng < west || lng > east || lat < south || lat > north) return null;

  return { bbox, centre };
}

/**
 * Reads the head of the file and confirms it looks like the track the client described.
 * Bounded to SNIFF_BYTES on purpose — a substring search over 10 MB is a real cost on the
 * free plan, and the expensive rules (route points, waypoint-only) are already enforced
 * client-side by the same pre-flight gpx.studio needs. A client that bypasses them gets a
 * trail that fails to render in the embed, which is self-punishing rather than dangerous.
 */
function sniff(head: string, bbox: number[]): string | null {
  if (head.includes('<rtept')) return 'route_points';
  const first = head.match(/<trkpt[^>]*\blat\s*=\s*["']([-\d.]+)["'][^>]*\blon\s*=\s*["']([-\d.]+)["']/i)
    ?? head.match(/<trkpt[^>]*\blon\s*=\s*["']([-\d.]+)["'][^>]*\blat\s*=\s*["']([-\d.]+)["']/i);
  if (!first) return head.includes('<trkpt') ? null : 'no_track';
  const lat = Number(first[1]);
  const lng = Number(first[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const [west, south, east, north] = bbox as [number, number, number, number];
  const pad = 0.01;
  if (lng < west - pad || lng > east + pad || lat < south - pad || lat > north + pad) return 'bbox_mismatch';
  return null;
}

/** POST /api/map/trail — the whole visitor-facing write surface. */
export async function handleTrailUpload(request: Request, env: PagesEnv): Promise<Response> {
  if (!env.SUBSCRIBERS_DB) {
    console.error('trail:no_db');
    return json(503, { error: 'service_misconfigured' });
  }
  if (!env.FORUM_BASE || !env.FORUM_TRAILS_KEY || !env.FORUM_TRAILS_USERNAME) {
    console.error('trail:no_forum_key');
    return json(503, { error: 'service_misconfigured' });
  }
  // Fail CLOSED. This is an unauthenticated write endpoint reachable by anyone, and the
  // limiter is the only control in front of it — unlike /api/join, which may warn and allow.
  if (!env.RATELIMIT_KV) {
    console.error('trail:no_ratelimit_kv');
    return json(503, { error: 'service_misconfigured' });
  }

  const ip = clientIp(request);
  const perIp = await rateLimitConsume(env.RATELIMIT_KV, `trail:ip:${ip}:1h`, 6, 3600);
  const global = await rateLimitConsume(env.RATELIMIT_KV, 'trail:all:1m', 8, 60);
  if (!perIp.allowed || !global.allowed) {
    return json(429, { error: 'rate_limited' }, { 'Retry-After': '60' });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: 'invalid_form' });
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return json(400, { error: 'no_file' });
  if (file.size > MAX_GPX_BYTES) return json(413, { error: 'too_large' });

  let meta: { title?: unknown; distance_km?: unknown; stats?: TrailStatsInput };
  try {
    meta = JSON.parse(String(form.get('meta') ?? '{}'));
  } catch {
    return json(400, { error: 'invalid_meta' });
  }
  const stats = (meta.stats ?? {}) as TrailStatsInput;
  const checked = checkStats(stats);
  if (!checked) return json(400, { error: 'invalid_stats' });

  const head = new TextDecoder().decode(new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()));
  const problem = sniff(head, checked.bbox);
  if (problem) return json(400, { error: problem });

  // --- the one forum call ------------------------------------------------
  const upload = new FormData();
  upload.set('upload_type', 'composer');
  upload.set('synchronous', 'true');
  upload.set('file', file, file.name || 'ride.gpx');

  let uploaded: { url?: unknown; sha1?: unknown; short_url?: unknown } | null = null;
  try {
    const resp = await fetch(`${env.FORUM_BASE}/uploads.json`, {
      method: 'POST',
      headers: {
        'Api-Key': env.FORUM_TRAILS_KEY,
        'Api-Username': env.FORUM_TRAILS_USERNAME,
        Accept: 'application/json',
      },
      body: upload,
    });
    if (!resp.ok) {
      console.error('trail:upload_rejected', { status: resp.status });
      return json(502, { error: 'upload_failed' });
    }
    uploaded = (await resp.json()) as typeof uploaded;
  } catch (err) {
    console.error('trail:upload_threw', { err: String(err) });
    return json(502, { error: 'upload_failed' });
  }

  const gpxUrl = toCdnUrl(uploaded?.url, env);
  if (!gpxUrl) {
    console.error('trail:no_url', { got: uploaded?.url });
    return json(502, { error: 'upload_failed' });
  }

  // --- the index ---------------------------------------------------------
  const secret = token(8);
  const code = token(8);
  const title = typeof meta.title === 'string' ? meta.title.slice(0, 120).trim() : '';
  const distance = Number(meta.distance_km);

  await env.SUBSCRIBERS_DB.prepare(
    `INSERT INTO trails (id, secret, visibility, gpx_url, gpx_sha1, title, distance_km, stats,
                         claim_code, expires_at, ip_hash)
     VALUES (?, ?, 'unlisted', ?, ?, ?, ?, ?, ?, datetime('now', ?), ?)`,
  )
    .bind(
      secret,
      secret,
      gpxUrl,
      typeof uploaded?.sha1 === 'string' ? uploaded.sha1 : null,
      title || null,
      Number.isFinite(distance) ? distance : null,
      JSON.stringify(stats),
      code,
      `+${UNCLAIMED_HOURS} hours`,
      await hashed(ip),
    )
    .run();

  return json(201, {
    id: secret,
    secret,
    claim_code: code,
    expires_in_hours: UNCLAIMED_HOURS,
    map_url: `/?trail=${secret}`,
    claim_url: `/s/c/${code}`,
  });
}

export interface TrailRow {
  id: string;
  secret: string;
  visibility: string;
  gpx_url: string;
  title: string | null;
  distance_km: number | null;
  stats: string;
  author_user_id: number | null;
  author_username: string | null;
  post_id: number | null;
}

/** The map entry shape, identical to what an operator import emits. */
function toEntry(row: TrailRow, proxied: boolean): Record<string, unknown> {
  const stats = ((): Record<string, unknown> => {
    try {
      return JSON.parse(row.stats) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  return {
    id: row.id,
    title: row.title ? { en: row.title } : null,
    // Proxied so the durable uploads-cdn URL never reaches a visitor of a private trail —
    // losing the link then means losing the trail, which is not true of a bare CDN URL.
    gpx_url: proxied ? `/api/map/trail/${row.secret}.gpx` : row.gpx_url,
    distance_km: row.distance_km,
    stats,
    author_user_id: row.author_user_id,
    author_username: row.author_username,
    visibility: row.visibility,
    post_id: row.post_id,
  };
}

/** Public, unexpired uploads — merged into /api/map/trails.json beside the curated fixture. */
export async function publicTrailEntries(env: PagesEnv): Promise<Record<string, unknown>[]> {
  if (!env.SUBSCRIBERS_DB) return [];
  try {
    const { results } = await env.SUBSCRIBERS_DB.prepare(
      `SELECT id, secret, visibility, gpx_url, title, distance_km, stats,
              author_user_id, author_username, post_id
         FROM trails
        WHERE visibility = 'public'
          AND (expires_at IS NULL OR expires_at > datetime('now'))`,
    ).all<TrailRow>();
    return (results ?? []).map((row) => toEntry(row, true));
  } catch (err) {
    console.error('trail:list_threw', { err: String(err) });
    return [];
  }
}

/** GET /api/map/trail/<secret>.json — the only way a private or unlisted trail is reachable. */
export async function handleTrailResolve(env: PagesEnv, secret: string): Promise<Response> {
  if (!env.SUBSCRIBERS_DB) return json(503, { error: 'service_misconfigured' });
  const row = await env.SUBSCRIBERS_DB.prepare(
    `SELECT id, secret, visibility, gpx_url, title, distance_km, stats,
            author_user_id, author_username, post_id
       FROM trails
      WHERE secret = ?
        AND (expires_at IS NULL OR expires_at > datetime('now'))`,
  )
    .bind(secret)
    .first<TrailRow>();

  // A miss and an expiry answer identically on purpose: the secret is the whole access
  // control, so the endpoint must not become an oracle that confirms which ids exist.
  if (!row) return json(404, { error: 'not_found' });
  return json(200, { trail: toEntry(row, true) });
}

/**
 * GET /api/map/trail/<secret>.gpx — streams the file from the uploads CDN.
 *
 * The point is that the client never learns the durable URL. Discourse keeps a deleted
 * upload in `tombstone/` for purge_deleted_uploads_grace_period_days (30), so a CDN URL a
 * visitor once held stays fetchable long past the trail's expiry. Proxying is what makes
 * "lose the link, lose the trail" true of the bytes and not only of the pin.
 */
export async function handleTrailGpx(env: PagesEnv, secret: string): Promise<Response> {
  if (!env.SUBSCRIBERS_DB) return new Response('unavailable', { status: 503 });
  const row = await env.SUBSCRIBERS_DB.prepare(
    `SELECT gpx_url FROM trails
      WHERE secret = ? AND (expires_at IS NULL OR expires_at > datetime('now'))`,
  )
    .bind(secret)
    .first<{ gpx_url: string }>();
  if (!row) return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

  const upstream = await fetch(row.gpx_url, { cf: { cacheTtl: 300, cacheEverything: true } } as RequestInit);
  if (!upstream.ok || !upstream.body) return new Response('unavailable', { status: 502 });

  return new Response(upstream.body, {
    headers: {
      // Pinned, and nosniff: this is a stranger's file being served from the app's origin.
      'Content-Type': 'application/gpx+xml',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline; filename="trail.gpx"',
      // Never edge-cached: a private trail cached at a PoP outlives its own expiry.
      'Cache-Control': 'no-store',
    },
  });
}

/** Cron: drop rows whose deadline has passed. The file is reaped by Discourse on its own. */
export async function sweepExpiredTrails(env: PagesEnv): Promise<number> {
  if (!env.SUBSCRIBERS_DB) return 0;
  const result = await env.SUBSCRIBERS_DB.prepare(
    `DELETE FROM trails WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')`,
  ).run();
  return result.meta?.changes ?? 0;
}
