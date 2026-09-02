#!/usr/bin/env node
// Publishes the world map's story data to R2 without a redeploy.
//
//   node scripts/push-map-data.mjs --env preview                 → preview/series.json
//   node scripts/push-map-data.mjs --env preview --doc trails    → preview/trails.json
//   node scripts/push-map-data.mjs --env prod                     → prod/series.json   (explicit-ask)
//   node scripts/push-map-data.mjs --env prod --check             → diff only, push nothing
//
// The repo file is canonical; R2 is only the live projection. Never hand-edit the
// bucket — edit the source, commit, then push. Rollback = re-push the previous
// commit's file. See agents.d/modules/map.md "R2 wins over the bundle" and agents.d/modules/trails.md.
//
// Source per document (scripts/lib/map-source.mjs):
//   trails, shops → fixtures/map/<env>/<doc>.json   environment data, never in the bundle
//   series        → public/map/series.seed.json     identical in both environments
//
// --check answers the question that made an alpha.3 release ship nothing: R2 wins over
// the bundle, so editing a seed and deploying changes NOTHING until it is pushed here.

import { execFileSync } from 'node:child_process';
import { DOCS, ENVS, readDoc, sourcePath, uploadsCdn } from './lib/map-source.mjs';

const BUCKET = 'dbx-map';

const args = process.argv.slice(2);
const env = args[args.indexOf('--env') + 1];
const name = args.includes('--doc') ? args[args.indexOf('--doc') + 1] : 'series';
const checkOnly = args.includes('--check');
if (!ENVS[env ?? ''] || !DOCS.includes(name ?? '')) {
  console.error('usage: push-map-data.mjs --env <preview|prod> [--doc <series|trails|shops>] [--check]');
  process.exit(1);
}

const SOURCE = sourcePath(env, name);
const doc = readDoc(SOURCE);

const bail = (message) => {
  console.error(`${SOURCE}: ${message}`);
  process.exit(1);
};

let count;
if (name === 'series') {
  if (!Array.isArray(doc.entries) || typeof doc.target !== 'number') bail('missing `entries` or `target`');
  for (const entry of doc.entries) {
    if (typeof entry.main !== 'number' || typeof entry.sub !== 'number' || !entry.label) {
      bail(`every entry needs numeric main/sub and a label: ${JSON.stringify(entry)}`);
    }
    if (!['visited', 'live', 'upcoming'].includes(entry.status)) {
      bail(`unknown status "${entry.status}" on ${entry.label}`);
    }
  }
  // The verdict block is a public statement about named venues, so a typo in a slug
  // must not read as "we do not vouch for it" — it has to be a slug the map knows.
  if (doc.verified !== undefined) {
    if (doc.verified === null || typeof doc.verified !== 'object' || Array.isArray(doc.verified)) {
      bail('`verified` must be an object of slug -> boolean');
    }
    for (const [slug, called] of Object.entries(doc.verified)) {
      if (typeof called !== 'boolean') bail(`verified.${slug} must be true or false`);
      if (!slug.trim()) bail('`verified` has an empty slug');
    }
  }
  count = doc.entries.length;
} else if (name === 'shops') {
  if (!Array.isArray(doc.shops)) bail('missing `shops`');
  for (const shop of doc.shops) {
    if (!shop.slug || !shop.name) bail(`every shop needs a slug and a name: ${JSON.stringify(shop.slug ?? shop)}`);
    if (!Number.isFinite(shop.lng) || !Number.isFinite(shop.lat)) bail(`${shop.slug} has no coordinates`);
  }
  count = doc.shops.length;
} else {
  if (!Array.isArray(doc.trails)) bail('missing `trails`');
  // The upload host follows the environment; a staging URL served to prod visitors
  // would 404 every trace.
  const cdn = uploadsCdn(env);
  const seen = new Set();
  for (const trail of doc.trails) {
    if (!trail.id || !trail.author_username || !Number.isInteger(trail.author_user_id)) {
      bail(`every trail needs an id and a forum author: ${JSON.stringify(trail.id ?? trail)}`);
    }
    // Metadata-only: the map needs a point to place the blip and a URL to fetch on tap.
    const centre = trail.stats?.centre;
    if (!Array.isArray(centre) || centre.length !== 2 || !centre.every(Number.isFinite)) {
      bail(`${trail.id} has no numeric stats.centre — re-run import-forum-trail.mjs`);
    }
    // [lng, lat], and in range. Hand-editing is a documented workflow and the series
    // doc uses {lat, lng}, so a swapped pair is the likely mistake — and it throws
    // inside MapLibre's bounds check, which would take the whole catalog down.
    if (Math.abs(centre[0]) > 180 || Math.abs(centre[1]) > 90) {
      bail(`${trail.id} centre must be [lng, lat] in range; got ${JSON.stringify(centre)}`);
    }
    if (seen.has(trail.id)) bail(`duplicate trail id ${trail.id}`);
    seen.add(trail.id);
    // Host, not path: Discourse nests uploads by id, so `original/2X/<a>/<sha1>.gpx` is
    // as correct as `original/1X/<sha1>.gpx` and asserting the shallow form rejects
    // every upload above id 1000. What matters is only that it is this env's CDN.
    if (!trail.gpx_url?.startsWith(`${cdn}/`)) {
      bail(`${trail.id} gpx_url must live on ${cdn} for --env ${env}; got ${trail.gpx_url ?? 'nothing'}`);
    }
    // The author cache is a forum reference; pointing it at the other environment
    // attributes the ride to a stranger, which reads as true and is not.
    const host = `forum.${ENVS[env].apex}`;
    if (trail.author_avatar && !trail.author_avatar.includes(host)) {
      bail(`${trail.id} author_avatar is not on ${host}: ${trail.author_avatar}`);
    }
  }
  count = doc.trails.length;
}

const key = `${BUCKET}/${env}/${name}.json`;
const liveURL = `https://${env === 'prod' ? 'www.dirtbikex.com' : 'www.dirtbikechina.com'}/api/map/${name}.json`;

/** What the world sees right now, so a push can be compared against it. */
const live = await fetch(liveURL, { cache: 'no-store' })
  .then((r) => (r.ok ? r.text() : null))
  .catch(() => null);

// `/api/map/trails.json` is the R2 document PLUS the public visitor uploads D1 holds,
// merged at serve time and never written to R2. Diffing the merged view against the
// source would report drift the moment anyone publishes an upload — and tell the
// operator R2 was stale when it is not. A merged entry is the only one carrying
// `visibility`, so dropping those leaves exactly the document R2 stores.
const curated = (text) => {
  const parsed = JSON.parse(text);
  if (name !== 'trails' || !Array.isArray(parsed.trails)) return parsed;
  return { ...parsed, trails: parsed.trails.filter((t) => !t.visibility) };
};

const same = live !== null && JSON.stringify(curated(live)) === JSON.stringify(doc);
if (live === null) console.log(`live ${liveURL}: unreadable (treating as drifted)`);
else console.log(`live ${liveURL}: ${same ? 'already matches the source' : 'DIFFERS from the source'}`);

if (checkOnly) {
  if (same) {
    console.log(`${name}/${env}: in sync — nothing to push`);
    process.exit(0);
  }
  console.error(
    `${name}/${env}: R2 holds a different document than ${SOURCE}.\n` +
      `R2 wins over the bundle, so deploying this change alone would be a silent no-op.\n` +
      `Run: node scripts/push-map-data.mjs --env ${env} --doc ${name}`,
  );
  process.exit(1);
}

console.log(`pushing ${count} ${name} → r2://${key}`);
execFileSync(
  'pnpm',
  ['dlx', 'wrangler', 'r2', 'object', 'put', key, '--file', SOURCE, '--content-type', 'application/json', '--remote'],
  { stdio: 'inherit' },
);
console.log('done — live within the 5 minute edge TTL');
