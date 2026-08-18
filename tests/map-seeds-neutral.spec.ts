import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The committed seeds ship INSIDE the bundle and are served to whichever environment
// loses R2 — so anything environment-specific in them is a lie told to the other one.
// PROD_INSTALL_DEBT.md §1 records what that cost: a staging trail on the prod map,
// attributed to a staging user, silently, for anyone who hit an R2 hiccup. §3d asks
// for this guard, because the fix is only permanent once the bad state cannot be
// committed rather than merely being absent today.
//
// Environment data lives in fixtures/map/<env>/ and reaches an environment through R2.
// This spec needs no browser; it is here so it rides the same CI as everything else.

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const read = (p: string) => JSON.parse(readFileSync(root(p), 'utf8'));

/** Hosts that name one environment. `dirtbikex.com` is the canonical apex and is
    equally wrong in a file that also serves staging. */
const ENV_HOSTS = /dirtbikechina\.com|dirtbikex\.com/;
const PLACEHOLDER = /\b(demo|test|sample|dummy|example|placeholder)\b/i;

test('committed map seeds name no environment', () => {
  for (const file of readdirSync(root('public/map')).filter((f) => f.endsWith('.seed.json'))) {
    const text = readFileSync(root(`public/map/${file}`), 'utf8');
    const hit = ENV_HOSTS.exec(text);
    expect(
      hit,
      `public/map/${file} names ${hit?.[0]} — environment data belongs in fixtures/map/<env>/, ` +
        `not in a file the bundle serves to both environments (PROD_INSTALL_DEBT.md §3a)`,
    ).toBeNull();
  }
});

test('trails and shops seeds are empty', () => {
  // "No trails" is the truthful degradation when R2 is unreachable. "Here is some
  // other environment's trail" is not, and it is what shipped before alpha.4.
  expect(read('public/map/trails.seed.json').trails, 'public/map/trails.seed.json must be []').toEqual([]);
  expect(read('public/map/shops.seed.json').shops, 'public/map/shops.seed.json must be []').toEqual([]);
});

test('seeds carry no placeholder content', () => {
  for (const file of readdirSync(root('public/map')).filter((f) => f.endsWith('.seed.json'))) {
    const text = readFileSync(root(`public/map/${file}`), 'utf8');
    const hit = PLACEHOLDER.exec(text);
    expect(hit, `public/map/${file} contains "${hit?.[0]}" — demo content belongs in fixtures/`).toBeNull();
  }
});

test('each environment fixture matches its own forum', () => {
  // The mirror image of the seed rule: a fixture must name its OWN environment and
  // no other, or push-map-data.mjs would publish a cross-environment reference that
  // renders (200, plausible, wrong) instead of failing.
  for (const [env, apex] of [['preview', 'dirtbikechina.com'], ['prod', 'dirtbikex.com']] as const) {
    const other = env === 'prod' ? 'dirtbikechina.com' : 'dirtbikex.com';
    for (const doc of ['trails', 'shops']) {
      const text = readFileSync(root(`fixtures/map/${env}/${doc}.json`), 'utf8');
      expect(text.includes(other), `fixtures/map/${env}/${doc}.json references ${other}`).toBe(false);
      for (const trail of JSON.parse(text).trails ?? []) {
        expect(trail.gpx_url, `${env}/${trail.id} gpx_url`).toContain(`uploads-cdn.${apex}`);
        if (trail.author_avatar) {
          expect(trail.author_avatar, `${env}/${trail.id} author_avatar`).toContain(`forum.${apex}`);
        }
      }
    }
  }
});
