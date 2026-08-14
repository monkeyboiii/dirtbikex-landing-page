#!/usr/bin/env node
// Turns a forum GPX upload into a trails.seed.json entry.
//
//   node scripts/import-gpx-trail.mjs --gpx <url|path> --id xihu-loop \
//     --title-en "West Lake loop" --title-zh "西湖环线" \
//     --author-id 1 --author-username calvin [--post <topic url>] [--tolerance 12]
//
// The doc is METADATA ONLY — a point, a bbox and the ride's numbers. Geometry is
// fetched from `gpx_url` when a visitor taps the trail, so the payload stays flat as
// the catalog grows. That URL must be the forum's own uploads CDN
// (uploads-cdn.<apex>), which serves ACAO * and is already inside the site's
// allowlist; never the /uploads/short-url/ form, which 302s to the raw bucket host.
// Publish with `push-map-data.mjs --doc trails`. See MAP_LAYERS_PLAN.md §3b.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SEED = fileURLToPath(new URL('../public/map/trails.seed.json', import.meta.url));

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

const id = arg('id');
const gpx = arg('gpx');
const authorId = Number(arg('author-id'));
const authorUsername = arg('author-username');
if (!id || !gpx || !Number.isInteger(authorId) || !authorUsername) {
  console.error('usage: import-gpx-trail.mjs --gpx <url|path> --id <slug> --author-id <n> --author-username <name> [--title-en …] [--title-zh …]  [--post <url>] [--forum <base>]');
  process.exit(1);
}

const source = /^https?:/.test(gpx) ? await fetch(gpx).then((r) => {
  if (!r.ok) throw new Error(`${r.status} fetching ${gpx}`);
  return r.text();
}) : readFileSync(gpx, 'utf8');

/** Track points only — route points crash gpx.studio's stats and are not a ridden line.
    Segments stay separate: joining them would draw a stroke through every pause. */
/** Attribute order is not significant in XML, so read lat and lon independently
    rather than requiring lat to come first. */
const point = (tag, body) => {
  const lat = Number(/\blat="([-\d.]+)"/.exec(tag)?.[1]);
  const lng = Number(/\blon="([-\d.]+)"/.exec(tag)?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const ele = Number(/<ele>([-\d.]+)<\/ele>/.exec(body ?? '')?.[1]);
  const time = /<time>([^<]+)<\/time>/.exec(body ?? '')?.[1];
  const at = time ? Date.parse(time) : NaN;
  return { lng, lat, ele: Number.isFinite(ele) ? ele : null, at: Number.isFinite(at) ? at : null };
};

const readPoints = (chunk) =>
  [...chunk.matchAll(/<trkpt([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/g)]
    .map((m) => point(m[1], m[2]))
    .filter(Boolean);

const rich = source
  .split(/<trkseg\b[^>]*>/)
  .slice(1)
  .map((chunk) => readPoints(chunk.split('</trkseg>')[0]))
  .filter((seg) => seg.length >= 2);

// Route-only exports are legal and carry real geometry; take it, but never claim a
// duration from route points.
const routeOnly = !rich.length;
const fromRoutes = routeOnly
  ? source
      .split(/<rte\b[^>]*>/)
      .slice(1)
      .map((chunk) =>
        [...chunk.split('</rte>')[0].matchAll(/<rtept([^>]*?)(?:\/>|>([\s\S]*?)<\/rtept>)/g)]
          .map((m) => point(m[1], m[2]))
          .filter(Boolean)
          .map((pt) => ({ ...pt, at: null })),
      )
      .filter((seg) => seg.length >= 2)
  : [];

const richSegments = routeOnly ? fromRoutes : rich;
const segments = richSegments.map((seg) => seg.map((pt) => [pt.lng, pt.lat]));
if (!segments.length) {
  console.error(`no usable <trkpt> or <rtept> geometry in ${gpx}`);
  process.exit(1);
}

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
/** Local flat-earth metres — fine at trail scale and it keeps the maths readable. */
const metres = (a, b) => {
  const x = rad(b[0] - a[0]) * Math.cos(rad((a[1] + b[1]) / 2));
  const y = rad(b[1] - a[1]);
  return Math.hypot(x, y) * R;
};

const metresTotal = segments.reduce(
  (total, seg) => total + seg.reduce((sum, p, i) => (i ? sum + metres(seg[i - 1], p) : 0), 0),
  0,
);
const distanceKm = Number((metresTotal / 1000).toFixed(1));

/** Consumer GPS wanders vertically at rest, so a naive sum invents climb that was
    never ridden — on the West Lake doodle it reports +21 m across a flat lake. Only
    count sustained gain, and keep "flat" distinguishable from "unknown". */
function ascent(segs) {
  const range = (() => {
    const all = segs.flat().map((p) => p.ele).filter((e) => e != null);
    return all.length ? Math.max(...all) - Math.min(...all) : 0;
  })();
  if (range < 20) return null;
  let total = 0;
  for (const seg of segs) {
    let anchor = null;
    for (const pt of seg) {
      if (pt.ele == null) continue;
      if (anchor == null) { anchor = pt.ele; continue; }
      if (pt.ele - anchor >= 3) { total += pt.ele - anchor; anchor = pt.ele; }
      else if (anchor - pt.ele >= 3) anchor = pt.ele;
    }
  }
  return total > 0 ? Math.round(total) : null;
}

/** Moving time only, and never across a segment boundary — the gap between segments
    is a pen lift, not a pause in the ride. */
function moving(segs) {
  let seconds = 0;
  for (const seg of segs) {
    for (let i = 1; i < seg.length; i++) {
      const a = seg[i - 1];
      const b = seg[i];
      if (a.at == null || b.at == null) continue;
      const dt = (b.at - a.at) / 1000;
      if (dt <= 0 || dt > 600) continue;
      const dm = metres([a.lng, a.lat], [b.lng, b.lat]);
      if (dm / dt >= 0.5) seconds += dt;
    }
  }
  return Math.round(seconds);
}

const stamps = richSegments.flat().map((p) => p.at).filter((t) => t != null);
const metaTime = /<metadata>[\s\S]*?<time>([^<]+)<\/time>/.exec(source)?.[1];
const timeStats = stamps.length
  ? {
      recorded_at: new Date(Math.min(...stamps)).toISOString(),
      moving_s: moving(richSegments),
      elapsed_s: Math.round((Math.max(...stamps) - Math.min(...stamps)) / 1000),
      source: 'trkpt',
    }
  : { recorded_at: metaTime ?? null, moving_s: null, elapsed_s: null, source: metaTime ? 'metadata' : null };

const flat = segments.flat();
const bbox = [
  Math.min(...flat.map((c) => c[0])),
  Math.min(...flat.map((c) => c[1])),
  Math.max(...flat.map((c) => c[0])),
  Math.max(...flat.map((c) => c[1])),
].map((n) => Number(n.toFixed(5)));

/** A loop claim is refused on a multi-segment trace: the return leg can hide in a gap. */
const closure = metres(segments[0][0], segments.at(-1).at(-1));
const shape =
  closure > 0.15 * metresTotal
    ? 'point_to_point'
    : closure < 250 && closure < 0.05 * metresTotal && segments.length === 1
      ? 'loop'
      : null;

/** The forum is the source of truth for who a rider is; the cached copy only keeps
    the profile link working between imports. */
let authorName = arg('author-name') ?? null;
let authorAvatar = arg('author-avatar') ?? null;
if (arg('forum') && (!authorName || !authorAvatar)) {
  try {
    const who = await fetch(`${arg('forum')}/u/${encodeURIComponent(authorUsername)}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    authorName = authorName ?? who.user?.name ?? null;
    authorAvatar = authorAvatar ?? who.user?.avatar_template ?? null;
  } catch (err) {
    console.warn(`could not resolve ${authorUsername} on the forum: ${err.message}`);
  }
}

const doc = (() => {
  try {
    return JSON.parse(readFileSync(SEED, 'utf8'));
  } catch {
    return { version: 1, trails: [] };
  }
})();

const entry = {
  id,
  title: { en: arg('title-en') ?? id, ...(arg('title-zh') ? { 'zh-CN': arg('title-zh') } : {}) },
  author_user_id: authorId,
  author_username: authorUsername,
  ...(arg('post') ? { post_url: arg('post') } : {}),
  gpx_url: /^https?:/.test(gpx) ? gpx : undefined,
  author_name: authorName,
  author_avatar: authorAvatar,
  distance_km: distanceKm,
  stats: {
    segments: segments.length,
    points: flat.length,
    bbox,
    centre: [Number(((bbox[0] + bbox[2]) / 2).toFixed(5)), Number(((bbox[1] + bbox[3]) / 2).toFixed(5))],
    shape,
    ele: { ascent_m: ascent(richSegments) },
    time: timeStats,
    gpx_bytes: source.length,
  },
};
if (!entry.gpx_url) delete entry.gpx_url;

const at = doc.trails.findIndex((t) => t.id === id);
if (at === -1) doc.trails.push(entry);
else doc.trails[at] = entry;

writeFileSync(SEED, `${JSON.stringify(doc, null, 2)}\n`);
const before = segments.reduce((n, s) => n + s.length, 0);
console.log(
  `${id}: ${before} points in ${segments.length} segment(s), ${distanceKm} km — metadata only, ` +
    `geometry stays at ${entry.gpx_url ?? 'the source file'} (${doc.trails.length} trail(s) in seed)`,
);
