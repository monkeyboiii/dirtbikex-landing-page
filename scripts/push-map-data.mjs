#!/usr/bin/env node
// Publishes the world map's story data to R2 without a redeploy.
//
//   node scripts/push-map-data.mjs --env preview      → preview/series.json
//   node scripts/push-map-data.mjs --env prod         → prod/series.json   (explicit-ask)
//
// The repo file is canonical; R2 is only the live projection. Never hand-edit the
// bucket — edit public/map/series.seed.json, commit, then push. Rollback = re-push
// the previous commit's file. See CONCRETE_MAP_PLAN.md §5.4.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BUCKET = 'dbx-map';
const SOURCE = fileURLToPath(new URL('../public/map/series.seed.json', import.meta.url));

const args = process.argv.slice(2);
const env = args[args.indexOf('--env') + 1];
if (!['preview', 'prod'].includes(env ?? '')) {
  console.error('usage: push-map-data.mjs --env <preview|prod>');
  process.exit(1);
}

const payload = readFileSync(SOURCE, 'utf8');
const doc = JSON.parse(payload);
if (!Array.isArray(doc.entries) || typeof doc.target !== 'number') {
  console.error('series.seed.json is missing `entries` or `target`');
  process.exit(1);
}
for (const entry of doc.entries) {
  if (typeof entry.main !== 'number' || typeof entry.sub !== 'number' || !entry.label) {
    console.error('every entry needs numeric main/sub and a label:', entry);
    process.exit(1);
  }
  if (!['visited', 'live'].includes(entry.status)) {
    console.error(`unknown status "${entry.status}" on ${entry.label}`);
    process.exit(1);
  }
}

const key = `${BUCKET}/${env}/series.json`;
console.log(`pushing ${doc.entries.length} entries → r2://${key}`);
execFileSync(
  'pnpm',
  ['dlx', 'wrangler', 'r2', 'object', 'put', key, '--file', SOURCE, '--content-type', 'application/json', '--remote'],
  { stdio: 'inherit' },
);
console.log('done — live within the 5 minute edge TTL');
