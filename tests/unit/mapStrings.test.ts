import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The map's string plumbing, which fails silently in both directions.
 *
 * `DEFAULTS` in WorldMap.astro is not a fallback table — it is the **allowlist**. `dict` is
 * seeded from it and the overlay loop iterates `Object.keys(DEFAULTS)`, so a key that is
 * absent there can never reach the island no matter how well it is translated, and a key
 * present there but missing from a locale file falls back to English for that language.
 *
 * Neither failure throws, logs, or shows up in a build. Both shipped: the entire trail
 * upload surface was English inside a fully translated page, and four keys — including
 * "Uploaded by" — were translated into all 21 languages and rendered English anyway.
 */

const ROOT = new URL('../../', import.meta.url).pathname;
const LOCALES = join(ROOT, 'src/i18n/locales');

const defaultKeys = (): Set<string> => {
  const astro = readFileSync(join(ROOT, 'src/components/WorldMap.astro'), 'utf8');
  const block = astro.slice(astro.indexOf('const DEFAULTS'), astro.indexOf('const dict:'));
  const keys = block.match(/^\s*'([a-z][A-Za-z0-9._]+)':/gm) ?? [];
  return new Set(keys.map((k) => k.trim().replace(/^'/, '').replace(/':$/, '')));
};

const locale = (code: string): Record<string, string> =>
  JSON.parse(readFileSync(join(LOCALES, `${code}.json`), 'utf8')) as Record<string, string>;

const codes = readdirSync(LOCALES)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));

test('there are locale files at all', () => {
  assert.ok(codes.length >= 20, `${codes.length} locales found`);
  assert.ok(codes.includes('en') && codes.includes('zh-CN'));
});

test('every string the map asks for is translated in every language', () => {
  const wanted = defaultKeys();
  assert.ok(wanted.size > 50, `only ${wanted.size} keys parsed out of DEFAULTS — the parser broke`);
  const gaps: string[] = [];
  for (const code of codes) {
    const have = locale(code);
    for (const key of wanted) if (!(key in have)) gaps.push(`${code}: ${key}`);
  }
  assert.deepEqual(gaps, [], `untranslated: falls back to English for that language`);
});

test('every translated map string can actually reach the map', () => {
  const wanted = defaultKeys();
  // en.json is the reference set: a map.* key translated there and absent from DEFAULTS is
  // work somebody did that no visitor will ever see.
  const orphaned = Object.keys(locale('en'))
    .filter((k) => k.startsWith('map.'))
    .filter((k) => !wanted.has(k));
  assert.deepEqual(orphaned, [], 'translated but not listed in DEFAULTS, so unreachable');
});

test('no locale silently keeps the English text for a key it claims to translate', () => {
  // A real translation may legitimately match English (proper nouns, "OK"), so this only
  // catches a locale that is mostly a copy — the shape a half-done import leaves behind.
  const en = locale('en');
  const mapKeys = Object.keys(en).filter((k) => k.startsWith('map.'));
  for (const code of codes) {
    if (code === 'en') continue;
    const have = locale(code);
    const identical = mapKeys.filter((k) => have[k] === en[k]);
    assert.ok(
      identical.length < mapKeys.length * 0.5,
      `${code}: ${identical.length}/${mapKeys.length} map strings are byte-identical to English`,
    );
  }
});
