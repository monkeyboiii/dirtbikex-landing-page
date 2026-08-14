#!/usr/bin/env node
// Turns a forum GPX upload into a trails.seed.json entry.
//
//   node scripts/import-gpx-trail.mjs --gpx <url|path> --id xihu-loop \
//     --title-en "West Lake loop" --title-zh "西湖环线" \
//     --author-id 1 --author-username calvin [--post <topic url>] [--tolerance 12]
//
// The line is simplified and embedded in the seed file: the map draws it without
// fetching anything third-party, which is the site-wide no-external-assets rule.
// The GPX URL is kept only so the sheet can hand the file to gpx.studio, so it must
// be a URL that serves ACAO * (the raw OCI object, not the forum short-url).
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
  console.error('usage: import-gpx-trail.mjs --gpx <url|path> --id <slug> --author-id <n> --author-username <name> [--title-en …] [--title-zh …] [--post <url>] [--tolerance <m>]');
  process.exit(1);
}

const source = /^https?:/.test(gpx) ? await fetch(gpx).then((r) => {
  if (!r.ok) throw new Error(`${r.status} fetching ${gpx}`);
  return r.text();
}) : readFileSync(gpx, 'utf8');

/** Track points only — route points crash gpx.studio's stats and are not a ridden line.
    Segments stay separate: joining them would draw a stroke through every pause. */
const segments = source
  .split(/<trkseg\b[^>]*>/)
  .slice(1)
  .map((chunk) =>
    [...chunk.split('</trkseg>')[0].matchAll(/<trkpt[^>]*\blat="([-\d.]+)"[^>]*\blon="([-\d.]+)"/g)]
      .map((m) => [Number(m[2]), Number(m[1])])
      .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat)),
  )
  .filter((seg) => seg.length >= 2);
if (!segments.length) {
  console.error(`no <trkseg> with <trkpt> pairs in ${gpx}`);
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

function simplify(pts, tolerance) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let index = -1;
    let far = tolerance;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicular(pts[i], pts[first], pts[last]);
      if (d > far) {
        far = d;
        index = i;
      }
    }
    if (index === -1) continue;
    keep[index] = 1;
    stack.push([first, index], [index, last]);
  }
  return pts.filter((_, i) => keep[i]);
}

function perpendicular(p, a, b) {
  const ab = metres(a, b);
  if (ab === 0) return metres(p, a);
  const ap = metres(a, p);
  const bp = metres(b, p);
  // Heron's formula: twice the triangle area over the base is the height.
  const s = (ab + ap + bp) / 2;
  const area = Math.sqrt(Math.max(0, s * (s - ab) * (s - ap) * (s - bp)));
  return (2 * area) / ab;
}

const tolerance = Number(arg('tolerance') ?? 12);
const lines = segments.map((seg) =>
  simplify(seg, tolerance).map(([lng, lat]) => [Number(lng.toFixed(5)), Number(lat.toFixed(5))]),
);
const metresTotal = segments.reduce(
  (total, seg) => total + seg.reduce((sum, p, i) => (i ? sum + metres(seg[i - 1], p) : 0), 0),
  0,
);
const distanceKm = Number((metresTotal / 1000).toFixed(1));

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
  distance_km: distanceKm,
  lines,
};
if (!entry.gpx_url) delete entry.gpx_url;

const at = doc.trails.findIndex((t) => t.id === id);
if (at === -1) doc.trails.push(entry);
else doc.trails[at] = entry;

writeFileSync(SEED, `${JSON.stringify(doc, null, 2)}\n`);
const before = segments.reduce((n, s) => n + s.length, 0);
const after = lines.reduce((n, s) => n + s.length, 0);
console.log(`${id}: ${before} → ${after} points in ${lines.length} segment(s), ${distanceKm} km, ${doc.trails.length} trail(s) in seed`);
