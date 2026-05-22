#!/usr/bin/env node
// Mirror DiscourseAssetKit emoji PNGs into public/emojis/<shortcode>.png so
// the FeaturedTopics section can substitute Discourse :shortcode: tokens with
// <img src="/emojis/<shortcode>.png">.
//
// Source filename pattern: emoji_<shortcode>[_t<n>].png  (DiscourseAssetKit)
// Destination filename:    <shortcode>[_t<n>].png
//
// Run from the landing-page repo root: `npm run sync-emojis`
// Commit the resulting public/emojis/ — Cloudflare Pages only sees this repo,
// not the parent DiscourseAssetKit checkout.
//
// Source resolution (first existing wins):
//   1. DISCOURSE_ASSET_KIT_DIR env var (CI override)
//   2. ../../../iOS/submodules/DiscourseAssetKit/...  (DirtBikeX layout)
//   3. ../../../../Pinmoji/iOS/submodules/DiscourseAssetKit/...  (sibling repo fallback)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const candidates = [
  process.env.DISCOURSE_ASSET_KIT_DIR,
  path.resolve(repoRoot, '../../../iOS/submodules/DiscourseAssetKit/Sources/DiscourseAssetKit/Resources/Emojis'),
  path.resolve(repoRoot, '../../../../Pinmoji/iOS/submodules/DiscourseAssetKit/Sources/DiscourseAssetKit/Resources/Emojis'),
].filter(Boolean);

const srcDir = candidates.find((p) => fs.existsSync(p));
if (!srcDir) {
  console.error('DiscourseAssetKit emoji source not found. Tried:');
  for (const c of candidates) console.error('  ' + c);
  console.error('Set DISCOURSE_ASSET_KIT_DIR to override.');
  process.exit(1);
}

const destDir = path.join(repoRoot, 'public', 'emojis');
fs.mkdirSync(destDir, { recursive: true });

const PREFIX = 'emoji_';
let copied = 0;
let skipped = 0;

for (const file of fs.readdirSync(srcDir)) {
  if (!file.startsWith(PREFIX) || !file.endsWith('.png')) {
    skipped++;
    continue;
  }
  fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file.slice(PREFIX.length)));
  copied++;
}

console.log(`Copied ${copied} emoji PNG(s) → ${path.relative(repoRoot, destDir)}/  (source: ${srcDir})`);
if (skipped) console.log(`Skipped ${skipped} non-emoji file(s).`);
