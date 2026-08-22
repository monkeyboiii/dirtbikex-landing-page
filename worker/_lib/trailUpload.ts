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
import { purgeMapDoc } from './mapData';
import { rateLimitConsume } from './rateLimit';
import {
  COARSE_SPACING_M,
  SIG_VERSION,
  compareSignatures,
  encodeSig,
  resample,
  signable,
  thresholds,
} from './trailOverlap';
import type { Run } from './trailOverlap';
import type { PagesEnv } from './types';

/** Matches gpx.ts's MAX_GPX_BYTES and the forum's max_attachment_size_kb. All three agree. */
const MAX_GPX_BYTES = 10 * 1024 * 1024;
/** How much of the file the worker re-reads. A sanity check, not a parse — see below. */
const SNIFF_BYTES = 64 * 1024;
/** Unclaimed lifetime. Must not exceed clean_orphan_uploads_grace_period_hours, or the
    file is reaped while the row still advertises it. */
const UNCLAIMED_HOURS = 72;
/** No 0/O/1/I/l: these are read aloud and typed from memory. THIRTY-ONE symbols — count
    them — so a secret is 31^8 ≈ 8.5e11. An earlier comment here said 32 and 1.1e12, which
    was simply wrong; the number is still far beyond guessing, but write down what is true. */
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
/** The claim code is 8 of the same alphabet, so 31^8 ≈ 8.5e11.
    It was briefly six digits, on the theory that a rider would type it. Nothing in this
    product accepts a typed claim code — not the web, not the forum, not the app — so
    "easy to type" was buying nothing, and 10^6 was paying for it. The link is the
    interface; the code is only ever inside it.
    The controls that went in alongside the six-digit experiment all stay, because they
    were right independent of the length: /s/c/<code> looks NOTHING up, the forum's claim
    route is the only resolver and is rate-limited, and a claim binds only to its claimer.
    Do not add an endpoint anywhere that answers yes-or-no to a code. */

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

/**
 * The kill switch. Off means off — the endpoint refuses and the button greys out.
 *
 * Deliberately opt-OUT: only an explicit "0" / "false" / "off" disables uploads. A kill
 * switch that arms itself when a var is missing or misspelled takes a shipped feature down
 * on a deploy nobody thought was risky.
 */
export function uploadsEnabled(env: PagesEnv): boolean {
  const raw = String(env.TRAILS_UPLOAD_ENABLED ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(raw);
}

/**
 * GET /api/map/upload.json — is the door open?
 *
 * `no-store`, because the whole point is that flipping the var takes effect on the next
 * tap rather than after a cache expires. It costs one small request at boot and it is what
 * lets the control tell the truth before somebody has picked a file.
 */
export function handleUploadStatus(env: PagesEnv): Response {
  return json(200, {
    enabled: uploadsEnabled(env),
    // The SITE key is public by design — it identifies the widget, not the account. The
    // secret never leaves the worker. Null means Turnstile is not configured, and the
    // client then never fetches challenges.cloudflare.com at all.
    turnstile_site_key: env.TURNSTILE_SITE_KEY || null,
  });
}

/**
 * Verifies a Turnstile token, if Turnstile is configured at all.
 *
 * Off by default and off unless BOTH keys are set. Two reasons this is not simply always
 * on: the widget's script comes from a third-party host on a site whose no-external-assets
 * rule has its own CI test, and this product's audience is mainland China, where
 * challenges.cloudflare.com's reachability is not something this codebase can assume. A
 * challenge nobody can load is not friction, it is an outage.
 */
async function turnstileOk(request: Request, env: PagesEnv, form: FormData, ip: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY) return true;
  const token = String(form.get('turnstile') ?? '');
  if (!token) return false;
  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
    });
    const body = (await resp.json()) as { success?: boolean };
    return body.success === true;
  } catch (err) {
    // Fails CLOSED. The limiter above already refuses when its own dependency is missing,
    // and a challenge that silently passes when its verifier is unreachable is not one.
    console.error('trail:turnstile_threw', { err: String(err) });
    return false;
  }
}

/** POST /api/map/trail — the whole visitor-facing write surface. */
export async function handleTrailUpload(request: Request, env: PagesEnv): Promise<Response> {
  // Checked first, before the rate limiter spends anyone's budget on a closed door.
  if (!uploadsEnabled(env)) return json(503, { error: 'uploads_disabled' });
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
  // Raised from 6/hour and 8/minute, which were set before anyone had used this and were
  // tight enough to catch a club on one office IP, or a rider trying three files. Still a
  // real ceiling — the point is to stop a flood, not to ration ordinary use.
  const perIp = await rateLimitConsume(env.RATELIMIT_KV, `trail:ip:${ip}:1h`, 30, 3600);
  const global = await rateLimitConsume(env.RATELIMIT_KV, 'trail:all:1m', 30, 60);
  if (!perIp.allowed || !global.allowed) {
    return json(429, { error: 'rate_limited' }, { 'Retry-After': '60' });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: 'invalid_form' });
  }

  if (!(await turnstileOk(request, env, form, ip))) return json(403, { error: 'challenge_failed' });

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return json(400, { error: 'no_file' });
  if (file.size > MAX_GPX_BYTES) return json(413, { error: 'too_large' });

  let meta: {
    title?: unknown;
    distance_km?: unknown;
    stats?: TrailStatsInput;
    sig?: unknown;
    sig_v?: unknown;
    sig_len_m?: unknown;
    sig_coarse?: unknown;
  };
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

  interface UploadedFile {
    url?: unknown;
    sha1?: unknown;
    short_url?: unknown;
  }
  let uploaded: UploadedFile | null = null;
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
    uploaded = (await resp.json()) as UploadedFile;
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
  // `let` and a retry below. At 31^8 a UNIQUE collision is vanishingly unlikely, but the
  // file is already in the forum's upload store by this point, so the cost of NOT handling
  // it is an orphaned upload and a 500 — and the handling is four lines.
  let code = token(8);
  const title = typeof meta.title === 'string' ? meta.title.slice(0, 120).trim() : '';
  const distance = Number(meta.distance_km);

  const ipHash = await hashed(ip);

  const insert = () =>
    env.SUBSCRIBERS_DB!.prepare(
    `INSERT INTO trails (id, secret, visibility, gpx_url, gpx_short_url, gpx_sha1, title,
                         distance_km, stats, claim_code, expires_at, ip_hash,
                         sig, sig_v, sig_len_m, sig_coarse)
     VALUES (?, ?, 'unlisted', ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), ?, ?, ?, ?, ?)`,
  )
    .bind(
      secret,
      secret,
      gpxUrl,
      // Kept because the forum only registers an upload_reference for a link written as
      // `[name|attachment](upload://…)`; the CDN URL cooks to plain text and registers
      // nothing, which would leave a claimed trail's file still queued for reaping.
      typeof uploaded?.short_url === 'string' ? uploaded.short_url : null,
      typeof uploaded?.sha1 === 'string' ? uploaded.sha1 : null,
      title || null,
      Number.isFinite(distance) ? distance : null,
      JSON.stringify(stats),
      code,
      `+${UNCLAIMED_HOURS} hours`,
      ipHash,
      // A signature the client could not compute is stored as NULL, which every reader
      // treats as "no verdict" rather than as "no overlap".
      typeof meta.sig === 'string' && meta.sig.length < 32_000 ? meta.sig : null,
      Number(meta.sig_v) === SIG_VERSION ? SIG_VERSION : null,
      Number.isFinite(Number(meta.sig_len_m)) ? Number(meta.sig_len_m) : null,
      meta.sig_coarse ? 1 : 0,
    )
    .run();

  let stored = false;
  for (let attempt = 0; attempt < 5 && !stored; attempt++) {
    try {
      await insert();
      stored = true;
    } catch (err) {
      // Only a claim_code collision is worth another go — the secret is 31^8 and the id
      // is the secret, so those two cannot realistically collide.
      if (!String(err).includes('UNIQUE')) {
        console.error('trail:insert_failed', { err: String(err) });
        return json(500, { error: 'store_failed' });
      }
      code = token(8);
    }
  }
  if (!stored) {
    console.error('trail:code_exhausted');
    return json(503, { error: 'store_failed' });
  }

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
  author_name: string | null;
  author_avatar: string | null;
  post_id: number | null;
  post_url: string | null;
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
    // Proxied for anything link-only: the durable uploads-cdn URL survives the trail's
    // expiry by 30 days of tombstone, so handing it out would make "lose the link, lose
    // the trail" false of the bytes. A public trail is served from the CDN directly —
    // the proxy URL contains the secret and must not reach a public document.
    gpx_url: proxied ? `/api/map/trail/${row.secret}.gpx` : row.gpx_url,
    distance_km: row.distance_km,
    stats,
    author_user_id: row.author_user_id,
    author_username: row.author_username,
    author_name: row.author_name,
    author_avatar: row.author_avatar,
    ...(row.post_url ? { post_url: row.post_url } : {}),
    visibility: row.visibility,
    post_id: row.post_id,
  };
}

/**
 * One uploaded trail by its id, for the share card, whatever its visibility.
 *
 * A link-only trail is not in the map document, so `/share/route/<id>` used to render
 * "not found" for exactly the trails whose only address IS that link — and a rider
 * pasting one into a chat app got a bare URL instead of a card. This is the fallback that
 * makes it unfurl.
 *
 * It leaks nothing the link does not: the id of an unlisted trail IS its secret, so
 * anyone who can call this already had it. The caller must serve it `no-store`.
 */
export async function trailForShare(env: PagesEnv, id: string): Promise<Record<string, unknown> | null> {
  if (!env.SUBSCRIBERS_DB) return null;
  try {
    const row = await env.SUBSCRIBERS_DB.prepare(
      `SELECT id, secret, visibility, gpx_url, title, distance_km, stats,
              author_user_id, author_username, author_name, author_avatar, post_id, post_url
         FROM trails
        WHERE id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))`,
    )
      .bind(id)
      .first<TrailRow>();
    return row ? toEntry(row, row.visibility !== 'public') : null;
  } catch (err) {
    console.error('trail:share_threw', { err: String(err) });
    return null;
  }
}

/** Public, unexpired uploads — merged into /api/map/trails.json beside the curated fixture. */
export async function publicTrailEntries(env: PagesEnv): Promise<Record<string, unknown>[]> {
  if (!env.SUBSCRIBERS_DB) return [];
  try {
    const { results } = await env.SUBSCRIBERS_DB.prepare(
      `SELECT id, secret, visibility, gpx_url, title, distance_km, stats,
              author_user_id, author_username, author_name, author_avatar, post_id, post_url
         FROM trails
        WHERE visibility = 'public'
          AND (expires_at IS NULL OR expires_at > datetime('now'))`,
    ).all<TrailRow>();
    // NOT proxied. A public trail has nothing to hide, so its bytes go straight to the
    // uploads CDN instead of through the worker — and, more importantly, the proxy URL
    // carries the secret, which must never be published in a document that is cached at
    // the edge for a day. Flipping a trail back to private therefore has to mint a NEW
    // secret; the old one is already in every copy of trails.json anyone fetched.
    return (results ?? []).map((row) => toEntry(row, false));
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
            author_user_id, author_username, author_name, author_avatar, post_id, post_url
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

/* ============================================================
   The plugin surface. Everything below is called BY the forum plugin and by nobody
   else — a shared bearer, checked in one place, failing closed when it is not set.

   The direction of trust matters: the worker never asks the forum to do anything, and
   the plugin never gets a Discourse API key. The plugin acts as the visitor, inside a
   session the visitor established, and tells the worker what it did.
   ============================================================ */

/**
 * GET /api/map/trails/admin.json — the whole index, for the forum's moderator surface.
 *
 * The plugin cannot read D1, and this is the half of the operator's job that lives here:
 * the UNCLAIMED rows. Those are the ones worth watching — they are the abuse surface, they
 * expire, and the plugin has no record of them at all because a claim is what creates one.
 *
 * Bearer-gated like every other plugin endpoint, and 404 rather than 401 when it fails.
 * It returns secrets, so it must never be reachable by anything but the plugin.
 */
export async function handleTrailsAdmin(request: Request, env: PagesEnv): Promise<Response> {
  if (!pluginAuthorised(request, env)) return json(404, { error: 'not_found' });
  if (!env.SUBSCRIBERS_DB) return json(503, { error: 'service_misconfigured' });

  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 200) || 200));
  const state = url.searchParams.get('state');
  const where = ['public', 'private', 'unlisted'].includes(String(state)) ? 'WHERE visibility = ?' : '';

  const stmt = env.SUBSCRIBERS_DB.prepare(
    `SELECT id, secret, visibility, title, distance_km, author_user_id, author_username,
            post_id, claimed_at, expires_at, created_at, gpx_sha1, sig_coarse,
            length(COALESCE(sig, '')) AS sig_bytes,
            json_extract(stats, '$.centre[0]') AS lng,
            json_extract(stats, '$.centre[1]') AS lat,
            json_extract(stats, '$.points')    AS points
       FROM trails
       ${where}
      ORDER BY created_at DESC
      LIMIT ?`,
  );
  const { results } = await (where ? stmt.bind(state, limit) : stmt.bind(limit)).all<Record<string, unknown>>();

  const counts = await env.SUBSCRIBERS_DB.prepare(
    `SELECT visibility, COUNT(*) AS n FROM trails GROUP BY visibility`,
  ).all<{ visibility: string; n: number }>();

  return json(200, {
    trails: results ?? [],
    counts: Object.fromEntries((counts.results ?? []).map((r) => [r.visibility, r.n])),
    uploads_enabled: uploadsEnabled(env),
  });
}

/** Fails closed: an unset token means these endpoints do not exist, not that they are open. */
function pluginAuthorised(request: Request, env: PagesEnv): boolean {
  if (!env.TRAILS_PLUGIN_TOKEN) return false;
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (presented.length !== env.TRAILS_PLUGIN_TOKEN.length) return false;
  // Constant-time-ish: compare every byte regardless of where the first mismatch is.
  let diff = 0;
  for (let i = 0; i < presented.length; i++) diff |= presented.charCodeAt(i) ^ env.TRAILS_PLUGIN_TOKEN.charCodeAt(i);
  return diff === 0;
}

/**
 * What the claim card shows about the trail behind a code.
 *
 * This DOES look the code up, which the card deliberately did not while the code was six
 * digits — at 10^6 an endpoint that confirms a code exists is an afternoon's work to sweep.
 * At 8 characters of the 31-symbol alphabet it is 8.5e11, and a rate limiter is enough. If
 * the code is ever shortened again, this has to go back to being stateless.
 */
export async function claimPreview(
  env: PagesEnv,
  code: string,
): Promise<{ id: string; title: string | null; distanceKm: number | null; shape: string | null; hours: number | null; claimed: boolean } | null> {
  if (!env.SUBSCRIBERS_DB) return null;
  try {
    const row = await env.SUBSCRIBERS_DB.prepare(
      `SELECT id, title, distance_km, stats, claimed_at,
              CAST((julianday(expires_at) - julianday('now')) * 24 AS INTEGER) AS hours
         FROM trails
        WHERE claim_code = ? AND (expires_at IS NULL OR expires_at > datetime('now'))`,
    )
      .bind(code)
      .first<{ id: string; title: string | null; distance_km: number | null; stats: string; hours: number | null; claimed_at: string | null }>();
    if (!row) return null;
    let shape: string | null = null;
    try {
      shape = (JSON.parse(row.stats) as { shape?: string }).shape ?? null;
    } catch {
      shape = null;
    }
    return { id: row.id, title: row.title, distanceKm: row.distance_km, shape, hours: row.hours, claimed: row.claimed_at != null };
  } catch (err) {
    console.error('trail:claim_preview_threw', { err: String(err) });
    return null;
  }
}

/**
 * POST /api/map/trail/import — a public forum post becoming a map trail.
 *
 * The other direction of the upload story. The visitor route is file-first: bytes arrive
 * anonymously, then somebody signs for them with a code. This one is post-first, and the
 * post has already settled everything the code exists to establish — who the rider is,
 * that the file is theirs, and that they meant it to be seen. So a row lands here already
 * claimed, with no code and no expiry.
 *
 * Only the plugin may call it, because only the plugin can check any of that. The worker
 * holds one Discourse scope and cannot read a post.
 *
 * `sig` is deliberately NOT accepted. It is a matching key, and a second implementation of
 * it — in Ruby, in a theme — would disagree with this one in ways nothing would catch. The
 * row lands unsigned and `signPendingTrails` fills it in on the next cron tick, which
 * costs the trail a minute of not participating in overlap checks and costs the codebase
 * nothing.
 *
 * Visibility is always `private` on the way in. Publishing is a separate call to
 * handleTrailState, because that is the one path that applies the duplicate-file check,
 * the overlap measure and the publish cap.
 */
export async function handleTrailImport(request: Request, env: PagesEnv): Promise<Response> {
  if (!pluginAuthorised(request, env)) return json(404, { error: 'not_found' });
  if (!env.SUBSCRIBERS_DB) return json(503, { error: 'service_misconfigured' });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: 'invalid_body' });
  }

  const str = (v: unknown, max: number): string | null =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
  const postId = Number(body.post_id);
  const userId = Number(body.user_id);
  const gpxUrl = str(body.gpx_url, 500);
  const username = str(body.username, 60);
  if (!Number.isInteger(postId) || !Number.isInteger(userId) || !gpxUrl || !username) {
    return json(400, { error: 'invalid_body' });
  }
  const stats = (body.stats ?? {}) as TrailStatsInput;
  if (!checkStats(stats)) return json(400, { error: 'invalid_stats' });

  // Idempotent on the post. The button can be pressed twice, the first response can be
  // lost, and the reconcile pull can arrive in the middle of either.
  const already = await env.SUBSCRIBERS_DB.prepare(
    'SELECT id, secret FROM trails WHERE post_id = ?',
  )
    .bind(postId)
    .first<{ id: string; secret: string }>();
  if (already) return json(200, { id: already.id, secret: already.secret, existing: true });

  const secret = token(8);
  const wanted = str(body.id, 60) ?? secret;
  const distance = Number(body.distance_km);

  // The id is readable here rather than opaque, because it is derived from a public topic
  // title and sits alongside the operator's imports, which have always looked like this.
  // A collision has to give way to something, and that something is the secret.
  //
  // Tried rather than checked. D1 writes go to the primary, and from a PoP on the far side
  // of the world a round-trip is most of a second — so the first shape of this, which asked
  // whether each candidate id was free BEFORE inserting, could spend five of them in a row
  // and blow the forum's HTTP timeout on a call that had in fact succeeded. Let the UNIQUE
  // constraint answer the question instead: one round-trip when the id is free, two when it
  // is not, and the second attempt cannot collide.
  const insert = (candidate: string) =>
    env.SUBSCRIBERS_DB!.prepare(
      `INSERT INTO trails (id, secret, visibility, gpx_url, gpx_short_url, gpx_sha1, title,
                           distance_km, stats, post_id, post_url,
                           author_user_id, author_username, author_name, author_avatar,
                           claimed_at, expires_at)
       VALUES (?, ?, 'private', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), NULL)`,
    )
      .bind(
        candidate,
        secret,
        gpxUrl,
        str(body.gpx_short_url, 200),
        str(body.gpx_sha1, 64),
        str(body.title, 120),
        Number.isFinite(distance) ? distance : null,
        JSON.stringify(stats),
        postId,
        str(body.post_url, 500),
        userId,
        username,
        str(body.name, 80),
        str(body.avatar, 200),
      )
      .run();

  let id = wanted;
  try {
    await insert(id);
  } catch (err) {
    if (!String(err).includes('UNIQUE')) {
      console.error('trail:import_failed', { postId, err: String(err) });
      return json(500, { error: 'store_failed' });
    }
    id = secret;
    try {
      await insert(id);
    } catch (retry) {
      console.error('trail:import_failed', { postId, err: String(retry) });
      return json(500, { error: 'store_failed' });
    }
  }

  return json(201, { id, secret });
}

/**
 * GET /api/map/trail/claim/<code> — what the plugin needs to write the post.
 *
 * Read-only on purpose. The claim is only recorded once the post exists, because the post
 * is what keeps the file alive; recording it first would leave a trail that says it is
 * permanent while its upload is still queued for reaping.
 */
export async function handleClaimResolve(request: Request, env: PagesEnv, code: string): Promise<Response> {
  if (!pluginAuthorised(request, env)) return json(404, { error: 'not_found' });
  if (!env.SUBSCRIBERS_DB) return json(503, { error: 'service_misconfigured' });
  const row = await env.SUBSCRIBERS_DB.prepare(
    `SELECT id, secret, gpx_url, gpx_short_url, title, distance_km, claimed_at, author_user_id, post_id
       FROM trails
      WHERE claim_code = ? AND (expires_at IS NULL OR expires_at > datetime('now'))`,
  )
    .bind(code)
    .first<{ id: string; secret: string; gpx_url: string; gpx_short_url: string | null; title: string | null; distance_km: number | null; claimed_at: string | null; author_user_id: number | null; post_id: number | null }>();
  if (!row) return json(404, { error: 'not_found' });
  // A spent code still resolves, and says so. The rider who taps their claim link a
  // second time is the common case, not the attack: 404 there sent them to an error page
  // instead of the message holding their own trail. Nothing is revealed by this that the
  // code did not already reveal — and the caller is the plugin, which checks ownership
  // before it acts on `claimed_at`.
  return json(200, {
    id: row.id,
    secret: row.secret,
    gpx_url: row.gpx_url,
    gpx_short_url: row.gpx_short_url,
    title: row.title,
    distance_km: row.distance_km,
    claimed_at: row.claimed_at,
    author_user_id: row.author_user_id,
    post_id: row.post_id,
  });
}

/**
 * POST /api/map/trail/claim/<code> — the post exists, so the trail stops expiring.
 *
 * `claimed_at` is what spends the code, not deleting it. The code is kept so that the
 * rider who opens their claim link again can be recognised and sent to the message that
 * already holds their trail; `claimed_at IS NULL` in the guard below is what stops it
 * being bound twice. Visibility stays `private` — publishing is a separate act.
 */
export async function handleClaimBind(request: Request, env: PagesEnv, code: string): Promise<Response> {
  if (!pluginAuthorised(request, env)) return json(404, { error: 'not_found' });
  if (!env.SUBSCRIBERS_DB) return json(503, { error: 'service_misconfigured' });

  let body: { user_id?: unknown; username?: unknown; post_id?: unknown; name?: unknown; avatar?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: 'invalid_body' });
  }
  const userId = Number(body.user_id);
  const postId = Number(body.post_id);
  const username = typeof body.username === 'string' ? body.username.slice(0, 60) : '';
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : null;
  const avatar = typeof body.avatar === 'string' && body.avatar.startsWith('/') ? body.avatar.slice(0, 200) : null;
  if (!Number.isInteger(userId) || !Number.isInteger(postId) || !username) {
    return json(400, { error: 'invalid_body' });
  }

  const result = await env.SUBSCRIBERS_DB.prepare(
    `UPDATE trails
        SET author_user_id = ?, author_username = ?, author_name = ?, author_avatar = ?,
            post_id = ?, visibility = 'private', claimed_at = datetime('now'),
            expires_at = NULL
      WHERE claim_code = ? AND claimed_at IS NULL
        AND (expires_at IS NULL OR expires_at > datetime('now'))`,
  )
    .bind(userId, username, name, avatar, postId, code)
    .run();
  if (!result.meta?.changes) return json(404, { error: 'not_found' });

  const row = await env.SUBSCRIBERS_DB.prepare('SELECT secret FROM trails WHERE post_id = ?')
    .bind(postId)
    .first<{ secret: string }>();
  return json(200, { secret: row?.secret ?? null, visibility: 'private' });
}

/**
 * POST /api/map/trail/<secret>/state — publish, unpublish, or drop.
 *
 * `gone` deletes the row rather than tombstoning it, because the reconcile pull is a
 * full comparison and a tombstone would have to be carried in it forever. The bytes are
 * Discourse's to reap once the post is permanently deleted.
 *
 * Going private mints a NEW secret. The old one was published inside trails.json, which
 * is edge-cached for a day, so keeping it would mean a trail that reads private and is
 * still openable by anybody holding a stale copy of the document.
 */
interface CandidateRow {
  id: string;
  title: string | null;
  author_username: string | null;
  sig: string | null;
  sig_v: number | null;
  sig_coarse: number | null;
}

export interface OverlapReport {
  id: string;
  title: string | null;
  author: string | null;
  shared_m: number;
  /** Sampled too widely to refuse on. Reported, never counted toward the cap. */
  coarse: boolean;
}

/**
 * Which published trails share ground with this one, and whether its author already has
 * too many of them.
 *
 * Runs at PUBLISH and nowhere else. Clutter does not exist until somebody publishes —
 * unlisted and private trails are invisible to everyone but their link holder — so a cap at
 * upload would refuse an anonymous visitor, who has no account to count against and whose
 * row deletes itself in 72 hours, for an act that harms nobody.
 *
 * The centre-distance pre-filter is a HEURISTIC, unlike the comparison it feeds. Two traces
 * can share ground while their centres sit far apart — a 60 km ride overlapping a 2 km loop
 * at one end. Such a pair is missed. That is the safe direction: a miss means no refusal.
 */
async function overlapsFor(
  env: PagesEnv,
  row: { secret: string; sig: string | null; sig_v: number | null; author_user_id: number | null; centre: [number, number] | null; extentKm: number },
): Promise<{ overlaps: OverlapReport[]; sameGroundByAuthor: OverlapReport[] } | null> {
  if (!env.SUBSCRIBERS_DB || !row.sig || row.sig_v !== SIG_VERSION || !row.centre) return null;
  const limits = thresholds(env as unknown as Record<string, unknown>);
  const maxCandidates = Math.max(1, Number(env.TRAIL_OVERLAP_MAX_CANDIDATES ?? 12) || 12);
  const budgetMs = Math.max(1, Number(env.TRAIL_OVERLAP_BUDGET_MS ?? 5) || 5);

  // Half of this trail's own extent, plus a generous margin, plus the corridor.
  const reachKm = row.extentKm / 2 + 5;
  const [lng, lat] = row.centre;
  const dLat = reachKm / 111.32;
  const dLng = reachKm / (111.32 * Math.max(0.08, Math.cos((lat * Math.PI) / 180)));

  const { results } = await env.SUBSCRIBERS_DB.prepare(
    `SELECT id, title, author_username, sig, sig_v, sig_coarse
       FROM trails
      WHERE visibility = 'public'
        AND secret != ?
        AND sig IS NOT NULL
        AND centre_lat BETWEEN ? AND ?
        AND centre_lng BETWEEN ? AND ?
      LIMIT ?`,
  )
    .bind(row.secret, lat - dLat, lat + dLat, lng - dLng, lng + dLng, maxCandidates)
    .all<CandidateRow & { author_user_id?: number }>();

  const overlaps: OverlapReport[] = [];
  const started = Date.now();
  for (const cand of results ?? []) {
    // The budget is wall clock, not a count: one very long pair can cost what ten short
    // ones do, and the free plan bills CPU.
    if (Date.now() - started > budgetMs) {
      console.warn('trail:overlap_budget', { secret: row.secret, done: overlaps.length });
      break;
    }
    if (cand.sig_v !== SIG_VERSION) continue;
    const seen = compareSignatures(row.sig, cand.sig, limits);
    if (!seen || seen.sharedM < limits.nudgeM) continue;
    overlaps.push({
      id: cand.id,
      title: cand.title,
      author: cand.author_username,
      shared_m: Math.round(seen.sharedM),
      coarse: !!cand.sig_coarse,
    });
  }

  // The cap counts only this author's own trails: a global cap would let the first riders
  // in a city lock out everybody after them.
  const mine = new Set<string>();
  if (row.author_user_id != null) {
    const { results: own } = await env.SUBSCRIBERS_DB.prepare(
      `SELECT id FROM trails WHERE visibility = 'public' AND author_user_id = ?`,
    )
      .bind(row.author_user_id)
      .all<{ id: string }>();
    for (const r of own ?? []) mine.add(r.id);
  }
  const sameGroundByAuthor = overlaps.filter(
    (o) => mine.has(o.id) && !o.coarse && o.shared_m >= limits.floorM,
  );
  return { overlaps, sameGroundByAuthor };
}

export async function handleTrailState(request: Request, env: PagesEnv, secret: string): Promise<Response> {
  if (!pluginAuthorised(request, env)) return json(404, { error: 'not_found' });
  if (!env.SUBSCRIBERS_DB) return json(503, { error: 'service_misconfigured' });

  let body: { visibility?: unknown; id?: unknown; force?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: 'invalid_body' });
  }
  const want = String(body.visibility ?? '');
  if (!['public', 'private', 'gone'].includes(want)) return json(400, { error: 'invalid_visibility' });

  if (want === 'gone') {
    const gone = await env.SUBSCRIBERS_DB.prepare('DELETE FROM trails WHERE secret = ?').bind(secret).run();
    if (!gone.meta?.changes) return json(404, { error: 'not_found' });
    await purgeMapDoc(request, 'trails');
    return json(200, { visibility: 'gone' });
  }

  const current = await env.SUBSCRIBERS_DB.prepare(
    `SELECT id, visibility, sig, sig_v, sig_coarse, gpx_sha1, author_user_id, stats
       FROM trails WHERE secret = ?`,
  )
    .bind(secret)
    .first<{
      id: string;
      visibility: string;
      sig: string | null;
      sig_v: number | null;
      sig_coarse: number | null;
      gpx_sha1: string | null;
      author_user_id: number | null;
      stats: string;
    }>();
  if (!current) return json(404, { error: 'not_found' });

  let overlaps: OverlapReport[] = [];
  // The escape hatch. A cap with no override turns every false positive into a support
  // ticket somebody has to answer by hand — and the measure has known false positives
  // (two switchback trails on one hillside read as identical). Only the plugin can set
  // this, and only for staff.
  const force = body.force === true;
  if (want === 'public' && current.visibility !== 'public' && !force) {
    // Exactly the same bytes, already on the map. Checked only among PUBLISHED rows: the
    // same file legitimately exists across environments and as somebody's private copy,
    // and checking at upload would let anyone who fetched a published .gpx off the CDN
    // discover whether a stranger's pending trail held the same bytes.
    if (current.gpx_sha1) {
      const twin = await env.SUBSCRIBERS_DB.prepare(
        `SELECT id FROM trails WHERE visibility = 'public' AND gpx_sha1 = ? AND secret != ? LIMIT 1`,
      )
        .bind(current.gpx_sha1, secret)
        .first<{ id: string }>();
      if (twin) return json(409, { error: 'already_published', trail: twin.id });
    }

    const cap = Number(env.TRAIL_PUBLISH_CAP ?? 3);
    const stats = ((): { centre?: unknown; bbox?: unknown } => {
      try {
        return JSON.parse(current.stats) as { centre?: unknown; bbox?: unknown };
      } catch {
        return {};
      }
    })();
    const centre = Array.isArray(stats.centre) && stats.centre.length === 2
      ? ([Number(stats.centre[0]), Number(stats.centre[1])] as [number, number])
      : null;
    const bbox = Array.isArray(stats.bbox) && stats.bbox.length === 4 ? stats.bbox.map(Number) : null;
    const extentKm = bbox
      ? Math.max(
          (bbox[3]! - bbox[1]!) * 111.32,
          (bbox[2]! - bbox[0]!) * 111.32 * Math.max(0.08, Math.cos(((centre?.[1] ?? 0) * Math.PI) / 180)),
        )
      : 0;

    const found = await overlapsFor(env, {
      secret,
      sig: current.sig,
      sig_v: current.sig_v,
      author_user_id: current.author_user_id,
      centre,
      extentKm,
    });
    overlaps = found?.overlaps ?? [];
    // 0 DISABLES the cap here. Note that OUTREACH_DAILY_CAP in the same config uses 0 to
    // mean a hard stop — the opposite — which is exactly the ambiguity that stalled the
    // outreach drip, so it is spelled out in wrangler.jsonc too.
    if (Number.isFinite(cap) && cap > 0 && (found?.sameGroundByAuthor.length ?? 0) >= cap) {
      return json(409, {
        error: 'too_many_nearby',
        cap,
        // Named, so the refusal can say which ones and offer the way out: unpublishing any
        // of them frees a slot immediately.
        trails: found!.sameGroundByAuthor,
      });
    }
  }

  // A public trail is addressed by a readable id; a private one is addressed by nothing
  // but its secret, so its id goes back to being the secret.
  const wanted = typeof body.id === 'string' ? body.id.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60) : '';
  const nextSecret = want === 'private' && current.visibility === 'public' ? token(8) : secret;
  const nextId = want === 'public' ? wanted || current.id : nextSecret;

  try {
    await env.SUBSCRIBERS_DB.prepare(
      `UPDATE trails SET visibility = ?, id = ?, secret = ? WHERE secret = ?`,
    )
      .bind(want, nextId, nextSecret, secret)
      .run();
  } catch {
    // The only unique columns here are `id` and `secret`, and the secret is freshly minted.
    return json(409, { error: 'id_taken' });
  }
  // The map document just changed. Without dropping the cached copy the rider waits out
  // s-maxage before their own trail appears, which reads as "the toggle did nothing".
  await purgeMapDoc(request, 'trails');
  return json(200, { visibility: want, id: nextId, secret: nextSecret, overlaps });
}

/**
 * DELETE /api/map/trail/<secret> — the uploader changing their mind.
 *
 * Authorised by possession of the secret, and by nothing else. That is not a weak check:
 * the secret is 8 characters of a 31-symbol alphabet and it is already the whole of the
 * read credential, so anyone who can call this could already see the trace. A device
 * fingerprint on top would be worse than nothing — forgeable by an attacker and a lockout
 * for the honest rider who cleared their browser.
 *
 * A CLAIMED trail is refused. Once a trail is bound to a forum account its removal is a
 * moderation act with an audit trail, and it happens by deleting the post.
 */
export async function handleTrailDelete(request: Request, env: PagesEnv, secret: string): Promise<Response> {
  if (!env.SUBSCRIBERS_DB) return json(503, { error: 'service_misconfigured' });
  if (env.RATELIMIT_KV) {
    const ip = clientIp(request);
    const limit = await rateLimitConsume(env.RATELIMIT_KV, `traildel:ip:${ip}:1h`, 60, 3600);
    if (!limit.allowed) return json(429, { error: 'rate_limited' }, { 'Retry-After': '60' });
  }

  const row = await env.SUBSCRIBERS_DB.prepare(
    `SELECT author_user_id FROM trails
      WHERE secret = ? AND (expires_at IS NULL OR expires_at > datetime('now'))`,
  )
    .bind(secret)
    .first<{ author_user_id: number | null }>();
  // A miss and an expiry answer identically, as everywhere else on this surface.
  if (!row) return json(404, { error: 'not_found' });
  if (row.author_user_id != null) return json(409, { error: 'claimed' });

  await env.SUBSCRIBERS_DB.prepare('DELETE FROM trails WHERE secret = ?').bind(secret).run();
  return json(200, { deleted: true });
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

/** How far back the reconcile pull looks each minute. Deliberately much wider than the
    cron interval so a run that fails, or a forum that was briefly down, is caught by the
    next one without any cursor to keep. */
const RECONCILE_WINDOW_MINUTES = 15;

interface ReconcileRow {
  secret?: unknown;
  id?: unknown;
  post_id?: unknown;
  user_id?: unknown;
  username?: unknown;
  name?: unknown;
  avatar?: unknown;
  visibility?: unknown;
  gone?: unknown;
}

/**
 * Cron: pull the plugin's view of every recently-changed claim and make D1 agree.
 *
 * The push from the plugin is what makes the map update in a second; this is what makes
 * it correct. A claim writes a forum post and then tells the worker, and the second half
 * can fail — leaving a trail that expires in 72 hours while its post says it is
 * permanent. Discourse's own webhook retry gives up after four attempts in two and a half
 * minutes and then stays silent, which is fine for a cache nudge and not for this.
 *
 * The plugin is the authority here, because the plugin is where the post lives.
 */
/**
 * Runs of track points, straight out of the file. Segments stay apart: joining them would
 * draw the corridor through every pause, and a pen lift is not ground anybody rode.
 *
 * Regex rather than a parser because this has to agree with the browser's reader on
 * malformed input, which is the input that actually turns up. Attribute order is not
 * significant in XML, so lat and lon are read independently.
 */
function runsFromGpx(source: string): Run[] {
  const runs: Run[] = [];
  for (const chunk of source.split('</trkseg>')) {
    const run: Run = [];
    for (const m of chunk.matchAll(/<trkpt([^>]*?)(?:\/>|>)/g)) {
      const lat = Number(/\blat="(-?[\d.]+)"/.exec(m[1] ?? '')?.[1]);
      const lng = Number(/\blon="(-?[\d.]+)"/.exec(m[1] ?? '')?.[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) run.push([lng, lat]);
    }
    if (run.length > 1) runs.push(run);
  }
  return runs;
}

/**
 * Signs the trails that arrived without a signature.
 *
 * Only the import route produces those. The visitor upload signs in the browser, where
 * the file already is and where the one implementation of the algorithm lives; an import
 * has no browser in the loop at all, and putting a second implementation in Ruby — or a
 * vendored copy in a Discourse theme — would give the map two matching keys that disagree
 * in ways nothing would catch.
 *
 * So the row lands unsigned and is signed here instead, off the rider's critical path and
 * inside a cron invocation's CPU allowance rather than a request's. The cost is that an
 * imported trail does not participate in overlap checks for up to a minute; the gain is
 * that `encodeSig` exists exactly once.
 *
 * One per tick. The fetch and the resample are the expensive things this worker does, and
 * a backlog is a queue, not an emergency.
 */
export async function signPendingTrails(env: PagesEnv, limit = 1): Promise<number> {
  if (!env.SUBSCRIBERS_DB) return 0;

  const pending = await env.SUBSCRIBERS_DB.prepare(
    `SELECT secret, gpx_url, stats FROM trails
      WHERE sig IS NULL AND sig_v IS NULL AND gpx_url IS NOT NULL
      ORDER BY created_at ASC LIMIT ?`,
  )
    .bind(limit)
    .all<{ secret: string; gpx_url: string; stats: string }>();

  let signed = 0;
  for (const row of pending.results ?? []) {
    try {
      const bbox = ((): [number, number, number, number] | null => {
        try {
          const b = (JSON.parse(row.stats) as { bbox?: unknown }).bbox;
          return Array.isArray(b) && b.length === 4 ? (b.map(Number) as [number, number, number, number]) : null;
        } catch {
          return null;
        }
      })();
      // Unsignable ground — a pole, or a trace crossing the antimeridian. Mark the row so
      // it is not refetched every minute for ever; NULL sig with a set version reads as
      // "asked and answered: no verdict".
      if (!bbox || !signable(bbox)) {
        await env.SUBSCRIBERS_DB.prepare('UPDATE trails SET sig_v = ? WHERE secret = ?')
          .bind(SIG_VERSION, row.secret)
          .run();
        continue;
      }

      const resp = await fetch(row.gpx_url);
      if (!resp.ok) {
        console.error('trail:sign_fetch', { secret: row.secret, status: resp.status });
        continue;
      }
      const runs = runsFromGpx(await resp.text());
      const sampled = resample(runs);
      await env.SUBSCRIBERS_DB.prepare(
        'UPDATE trails SET sig = ?, sig_v = ?, sig_len_m = ?, sig_coarse = ? WHERE secret = ?',
      )
        .bind(
          sampled.runs.length ? encodeSig(sampled.runs) : null,
          SIG_VERSION,
          Math.round(sampled.lengthM),
          sampled.spacingM > COARSE_SPACING_M ? 1 : 0,
          row.secret,
        )
        .run();
      signed++;
    } catch (err) {
      console.error('trail:sign_threw', { secret: row.secret, err: String(err) });
    }
  }
  return signed;
}

export async function reconcileTrails(env: PagesEnv): Promise<number> {
  if (!env.SUBSCRIBERS_DB || !env.FORUM_BASE || !env.TRAILS_PLUGIN_TOKEN) return 0;

  let rows: ReconcileRow[] = [];
  try {
    const resp = await fetch(
      `${env.FORUM_BASE}/dbx/trails/reconcile.json?minutes=${RECONCILE_WINDOW_MINUTES}`,
      { headers: { Authorization: `Bearer ${env.TRAILS_PLUGIN_TOKEN}`, Accept: 'application/json' } },
    );
    if (!resp.ok) {
      console.error('trail:reconcile_status', { status: resp.status });
      return 0;
    }
    const body = (await resp.json()) as { trails?: unknown };
    rows = Array.isArray(body.trails) ? (body.trails as ReconcileRow[]) : [];
  } catch (err) {
    console.error('trail:reconcile_threw', { err: String(err) });
    return 0;
  }

  let applied = 0;
  for (const row of rows) {
    const secret = typeof row.secret === 'string' ? row.secret : '';
    if (!secret) continue;
    try {
      if (row.gone) {
        await env.SUBSCRIBERS_DB.prepare('DELETE FROM trails WHERE secret = ?').bind(secret).run();
        applied++;
        continue;
      }
      const visibility = ['public', 'private'].includes(String(row.visibility)) ? String(row.visibility) : 'private';
      const id = typeof row.id === 'string' && row.id ? row.id : secret;
      const userId = Number(row.user_id);
      const postId = Number(row.post_id);
      if (!Number.isInteger(userId) || !Number.isInteger(postId)) continue;
      const result = await env.SUBSCRIBERS_DB.prepare(
        `UPDATE trails
            SET visibility = ?, id = ?, post_id = ?, author_user_id = ?, author_username = ?,
                author_name = COALESCE(?, author_name), author_avatar = COALESCE(?, author_avatar),
                expires_at = NULL,
                claimed_at = COALESCE(claimed_at, datetime('now'))
          WHERE secret = ?`,
      )
        .bind(
          visibility,
          id,
          postId,
          userId,
          typeof row.username === 'string' ? row.username : null,
          typeof row.name === 'string' && row.name ? row.name.slice(0, 80) : null,
          typeof row.avatar === 'string' && row.avatar.startsWith('/') ? row.avatar.slice(0, 200) : null,
          secret,
        )
        .run();
      applied += result.meta?.changes ?? 0;
    } catch (err) {
      // One bad row must not stop the rest — an id collision is the likely cause.
      console.error('trail:reconcile_row', { secret, err: String(err) });
    }
  }
  return applied;
}
