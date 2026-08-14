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
    if (!['visited', 'live'].includes(entry.status)) bail(`unknown status "${entry.status}" on ${entry.label}`);
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
  for (const trail of doc.trails) {
    if (!trail.id || !trail.author_username || !Number.isInteger(trail.author_user_id)) {
      bail(`every trail needs an id and a forum author: ${JSON.stringify(trail.id ?? trail)}`);
    }
    if (!Array.isArray(trail.lines) || trail.lines.some((seg) => !Array.isArray(seg) || seg.length < 2)) {
      bail(`${trail.id} has no drawable segments — re-run import-gpx-trail.mjs`);
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
