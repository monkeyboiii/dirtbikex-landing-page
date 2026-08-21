#!/usr/bin/env node
// Turns a GPX file you already have into a trail entry, when there is no forum post
// to derive it from. If the trace IS attached to a post, use import-forum-trail.mjs
// instead — it derives the author, the back-link and the CDN URL for you.
//
//   node scripts/import-gpx-trail.mjs --env preview --gpx <url|path> --id xihu-loop \
//     --title-en "West Lake loop" --title-zh "西湖环线" \
//     --author-id 1 --author-username calvin [--post <topic url>]
//
// The doc is METADATA ONLY — geometry is fetched from `gpx_url` on tap. That URL must
// be the forum's own uploads CDN (uploads-cdn.<apex>), which serves ACAO * and is
// inside the site's allowlist; never the /uploads/short-url/ form, which 302s to the
// raw bucket host. Writes fixtures/map/<env>/trails.json; publish with
// push-map-data.mjs --doc trails. See docs/TRAILS_MODULE.md.

import { readFileSync } from 'node:fs';
import { readTrailStats, buildTrailEntry } from './lib/gpx-trail.mjs';
import { ENVS, forumBase, fixturePath, readDoc, writeDoc, upsertById } from './lib/map-source.mjs';

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

const env = arg('env');
const id = arg('id');
const gpx = arg('gpx');
const authorId = Number(arg('author-id'));
const authorUsername = arg('author-username');
if (!ENVS[env] || !id || !gpx || !Number.isInteger(authorId) || !authorUsername) {
  console.error('usage: import-gpx-trail.mjs --env <preview|prod> --gpx <url|path> --id <slug> --author-id <n> --author-username <name> [--title-en …] [--title-zh …] [--post <url>]');
  process.exit(1);
}

const source = /^https?:/.test(gpx)
  ? await fetch(gpx).then((r) => {
      if (!r.ok) throw new Error(`${r.status} fetching ${gpx}`);
      return r.text();
    })
  : readFileSync(gpx, 'utf8');

let parsed;
try {
  parsed = readTrailStats(source);
} catch (e) {
  console.error(`${e.message} in ${gpx}`);
  process.exit(1);
}

/** The forum is the source of truth for who a rider is; the cached copy only keeps
    the profile link working between imports. */
let authorName = arg('author-name') ?? null;
let authorAvatar = arg('author-avatar') ?? null;
if (!authorName || !authorAvatar) {
  try {
    const who = await fetch(`${forumBase(env)}/u/${encodeURIComponent(authorUsername)}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    authorName = authorName ?? who.user?.name ?? null;
    authorAvatar = authorAvatar ?? who.user?.avatar_template ?? null;
  } catch (err) {
    console.warn(`could not resolve ${authorUsername} on ${forumBase(env)}: ${err.message}`);
  }
}

const entry = buildTrailEntry({
  id,
  titleEn: arg('title-en'),
  titleZh: arg('title-zh'),
  authorId,
  authorUsername,
  authorName,
  authorAvatar,
  gpxUrl: /^https?:/.test(gpx) ? gpx : undefined,
  postUrl: arg('post'),
  parsed,
});

const path = fixturePath(env, 'trails');
const doc = readDoc(path, { version: 1, trails: [] });
doc.trails ??= [];
const how = upsertById(doc.trails, entry);
writeDoc(path, doc);

console.log(
  `${id}: ${entry.stats.points} points in ${entry.stats.segments} segment(s), ${entry.distance_km} km — ${how}\n` +
    `  → ${path} (${doc.trails.length} trail(s))\n` +
    `  geometry stays at ${entry.gpx_url ?? 'the source file'}`,
);
