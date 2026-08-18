// Where each map document's canonical copy lives, and which forum it belongs to.
//
// The split exists because the repo must contain nothing environment-specific
// (PROD_INSTALL_DEBT.md §3): `public/map/*.seed.json` is shipped inside the bundle
// and is served to BOTH environments whenever R2 is unreachable, so anything in it
// that names one environment becomes a lie told to the other one. Trails and shops
// are environment data — the trail's GPX lives on that forum's upload CDN and the
// author is that forum's user — so their real content lives in `fixtures/`, which
// is never copied into `dist/`, and reaches an environment only through R2.
//
//   fixtures/map/<env>/<doc>.json   canonical content, pushed to r2://dbx-map/<env>/
//   public/map/<doc>.seed.json      neutral outage fallback, shipped in the bundle
//
// `series` is real product content that is identical in both environments, so it has
// no fixture and is pushed from its seed. That is also why its seed is not empty.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENVS = {
  preview: { apex: 'dirtbikechina.com' },
  prod: { apex: 'dirtbikex.com' },
};

export const DOCS = ['series', 'trails', 'shops'];

/** Documents whose content differs per environment and therefore live in fixtures/. */
export const ENV_SCOPED = new Set(['trails', 'shops']);

export const forumBase = (env) => `https://forum.${ENVS[env].apex}`;
export const uploadsCdn = (env) => `https://uploads-cdn.${ENVS[env].apex}`;

export const seedPath = (doc) => fileURLToPath(new URL(`../../public/map/${doc}.seed.json`, import.meta.url));
export const fixturePath = (env, doc) => fileURLToPath(new URL(`../../fixtures/map/${env}/${doc}.json`, import.meta.url));

/** The file `push-map-data.mjs` publishes for this (env, doc) pair. */
export function sourcePath(env, doc) {
  return ENV_SCOPED.has(doc) ? fixturePath(env, doc) : seedPath(doc);
}

export function readDoc(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    if (fallback === undefined) throw new Error(`cannot read ${path}`);
    return fallback;
  }
}

export function writeDoc(path, doc) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
}

/** Insert or replace by `id`, keeping the file stable for review. */
export function upsertById(list, entry) {
  const at = list.findIndex((item) => item.id === entry.id);
  if (at === -1) list.push(entry);
  else list[at] = entry;
  return at === -1 ? 'added' : 'replaced';
}
