#!/usr/bin/env node
// Publishes the world map's story data to R2 without a redeploy.
//
//   node scripts/push-map-data.mjs --env preview                 → preview/series.json
//   node scripts/push-map-data.mjs --env preview --doc trails    → preview/trails.json
//   node scripts/push-map-data.mjs --env prod                     → prod/series.json   (explicit-ask)
//
// The repo file is canonical; R2 is only the live projection. Never hand-edit the
// bucket — edit public/map/<doc>.seed.json, commit, then push. Rollback = re-push
// the previous commit's file. See CONCRETE_MAP_PLAN.md §5.4.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BUCKET = 'dbx-map';

const args = process.argv.slice(2);
const env = args[args.indexOf('--env') + 1];
const name = args.includes('--doc') ? args[args.indexOf('--doc') + 1] : 'series';
if (!['preview', 'prod'].includes(env ?? '') || !['series', 'trails', 'shops'].includes(name ?? '')) {
  console.error('usage: push-map-data.mjs --env <preview|prod> [--doc <series|trails|shops>]');
  process.exit(1);
}

const SOURCE = fileURLToPath(new URL(`../public/map/${name}.seed.json`, import.meta.url));
const doc = JSON.parse(readFileSync(SOURCE, 'utf8'));

const bail = (message) => {
  console.error(`${name}.seed.json: ${message}`);
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
  const cdn = env === 'prod' ? 'https://uploads-cdn.dirtbikex.com' : 'https://uploads-cdn.dirtbikechina.com';
  const seen = new Set();
  for (const trail of doc.trails) {
    if (!trail.id || !trail.author_username || !Number.isInteger(trail.author_user_id)) {
      bail(`every trail needs an id and a forum author: ${JSON.stringify(trail.id ?? trail)}`);
    }
    // Metadata-only: the map needs a point to place the blip and a URL to fetch on tap.
    const centre = trail.stats?.centre;
    if (!Array.isArray(centre) || centre.length !== 2 || !centre.every(Number.isFinite)) {
      bail(`${trail.id} has no numeric stats.centre — re-run import-gpx-trail.mjs`);
    }
    // [lng, lat], and in range. Hand-editing the seed is the documented workflow and
    // the series doc uses {lat, lng}, so a swapped pair is the likely mistake — and it
    // throws inside MapLibre's bounds check, which would take the whole catalog down.
    if (Math.abs(centre[0]) > 180 || Math.abs(centre[1]) > 90) {
      bail(`${trail.id} centre must be [lng, lat] in range; got ${JSON.stringify(centre)}`);
    }
    if (seen.has(trail.id)) bail(`duplicate trail id ${trail.id}`);
    seen.add(trail.id);
    if (trail.gpx_url !== `${cdn}/original/1X/${trail.gpx_url?.split('/').pop() ?? ''}`) {
      bail(`${trail.id} gpx_url must live on ${cdn} for --env ${env}; got ${trail.gpx_url ?? 'nothing'}`);
    }
  }
  count = doc.trails.length;
}

const key = `${BUCKET}/${env}/${name}.json`;
console.log(`pushing ${count} ${name} → r2://${key}`);
execFileSync(
  'pnpm',
  ['dlx', 'wrangler', 'r2', 'object', 'put', key, '--file', SOURCE, '--content-type', 'application/json', '--remote'],
  { stdio: 'inherit' },
);
console.log('done — live within the 5 minute edge TTL');
