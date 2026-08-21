#!/usr/bin/env node
// A forum post id is all you need to put someone's ride on the map.
//
//   node scripts/import-forum-trail.mjs --post 164 --env preview
//   node scripts/import-forum-trail.mjs --post 164 --env preview --push
//   node scripts/import-forum-trail.mjs --post 812 --env prod --id chongqing-shapingba --push
//
// Everything is derived from `GET /posts/<id>.json`, which is anonymous:
//
//   author       user_id + username + name + avatar_template   (the rider, from the forum)
//   post_url     topic_id + slug + post_number                 (back-link on the trail card)
//   gpx_url      the post's .gpx attachment, resolved to the uploads CDN
//   title        the topic's title, unless --title-en overrides
//   id           slugified title + post id, unless --id overrides
//
// Why the CDN form and not the link in the post: cooked HTML always carries the
// `/uploads/short-url/<base62>.gpx` form, which 302s to the raw object-store host.
// That host serves the bytes, but the map must fetch `uploads-cdn.<apex>` — it is what
// the site's allowlist and the China invariant are written against. So the short URL
// is followed once here, at import time, and only the HOST is swapped. The path is kept
// verbatim: Discourse nests uploads by id (`original/1X`, then `2X/<a>`, and deeper),
// so rebuilding it as `original/1X/<sha1>` 404s for every upload above id 1000.
//
// Writes fixtures/map/<env>/trails.json. `--push` then publishes it to R2 for that
// environment; without it, review the diff and run push-map-data.mjs yourself.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readTrailStats, buildTrailEntry } from './lib/gpx-trail.mjs';
import { ENVS, forumBase, uploadsCdn, fixturePath, readDoc, writeDoc, upsertById } from './lib/map-source.mjs';

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const flag = (name) => argv.includes(`--${name}`);

const postId = Number(arg('post'));
const env = arg('env');
if (!Number.isInteger(postId) || !ENVS[env]) {
  console.error('usage: import-forum-trail.mjs --post <id> --env <preview|prod> [--id <slug>] [--title-en …] [--title-zh …] [--push] [--dry-run]');
  process.exit(1);
}

const base = forumBase(env);
const die = (message) => {
  console.error(`post ${postId}: ${message}`);
  process.exit(1);
};

const getJSON = async (url) => {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};

// 1. The post — author, topic, and the attachment.
const post = await getJSON(`${base}/posts/${postId}.json`).catch((e) => die(`unreadable (${e.message})`));

// The post is the author's, so the trail is theirs. A user may only put their OWN
// ride on the map from their own post; the operator running this is not the author.
if (!post.username || !Number.isInteger(post.user_id)) die('has no resolvable author');

// 2. The GPX. `raw` carries `upload://<base62>.gpx`, `cooked` the short-url form;
// accept either, and refuse ambiguity rather than guessing which trace was meant.
const shortIds = [
  ...String(post.raw ?? '').matchAll(/upload:\/\/([A-Za-z0-9]+)\.gpx/g),
  ...String(post.cooked ?? '').matchAll(/\/uploads\/short-url\/([A-Za-z0-9]+)\.gpx/g),
].map((m) => m[1]);
const unique = [...new Set(shortIds)];
if (!unique.length) die('has no .gpx attachment');
if (unique.length > 1) die(`has ${unique.length} .gpx attachments — split them across posts, or import each one separately`);

const shortURL = `${base}/uploads/short-url/${unique[0]}.gpx`;
const redirect = await fetch(shortURL, { redirect: 'manual' });
if (redirect.status !== 302 && redirect.status !== 301) {
  die(`${shortURL} did not redirect (${redirect.status}) — is the upload secure, or the post hidden?`);
}
const location = redirect.headers.get('location') ?? '';
if (!/\/original\/[^/]+?\/(?:[0-9a-f]\/)*[0-9a-f]{40}\.gpx$/.test(new URL(location, base).pathname)) {
  die(`${location} is not an upload path — is the upload secure, or the post hidden?`);
}

const gpxUrl = `${uploadsCdn(env)}${new URL(location, base).pathname}`;
const source = await fetch(gpxUrl).then((r) => {
  if (!r.ok) throw new Error(`${r.status} fetching ${gpxUrl}`);
  return r.text();
}).catch((e) => die(e.message));

let parsed;
try {
  parsed = readTrailStats(source);
} catch (e) {
  die(`${e.message} in the attached file`);
}

// 3. The topic, for a title worth showing. Falls back to the post id so a private or
// deleted topic degrades to something importable rather than blocking.
const topic = post.topic_id ? await getJSON(`${base}/t/${post.topic_id}.json`).catch(() => null) : null;
const title = arg('title-en') ?? topic?.title ?? `Trail from post ${postId}`;

/** ASCII slug; CJK titles collapse to nothing, hence the post-id suffix always. */
const slugify = (s) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\p{ASCII}]/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const id = arg('id') ?? `${slugify(title) || 'trail'}-${postId}`.replace(/^-/, '');

const postUrl = post.topic_id
  ? `${base}/t/${post.topic_slug ?? 'topic'}/${post.topic_id}/${post.post_number ?? 1}`
  : undefined;

const entry = buildTrailEntry({
  id,
  titleEn: title,
  titleZh: arg('title-zh'),
  authorId: post.user_id,
  authorUsername: post.username,
  authorName: post.name || post.username,
  authorAvatar: post.avatar_template ?? null,
  gpxUrl,
  postUrl,
  parsed,
});

const path = fixturePath(env, 'trails');
const doc = readDoc(path, { version: 1, trails: [] });
doc.trails ??= [];
const how = upsertById(doc.trails, entry);

const summary =
  `${id}: ${entry.stats.points} points in ${entry.stats.segments} segment(s), ${entry.distance_km} km` +
  `${entry.stats.shape ? ` (${entry.stats.shape})` : ''} by @${entry.author_username} — ${how}`;

if (flag('dry-run')) {
  console.log(`${summary} [dry run, nothing written]`);
  console.log(JSON.stringify(entry, null, 2));
  process.exit(0);
}

writeDoc(path, doc);
console.log(`${summary}\n  → ${path} (${doc.trails.length} trail(s))\n  geometry stays at ${gpxUrl}`);

if (flag('push')) {
  execFileSync('node', [fileURLToPath(new URL('push-map-data.mjs', import.meta.url)), '--env', env, '--doc', 'trails'], {
    stdio: 'inherit',
  });
}
