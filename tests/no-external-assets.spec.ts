import { test, expect, type Page } from '@playwright/test';

// Enforces the README.md invariant: the served site must not load any
// third-party runtime assets (Google Fonts, GA, jsdelivr, unpkg, cdnjs,
// cloudfront, etc.) — these silently break mainland-China users.
//
// Strategy: visit a representative set of pages, observe every network
// request via page.on('request'), and assert that every host is either
// same-origin (localhost in dev, the canonical site in prod) or allowed
// for that specific route.
//
// The homepage carries a DELIBERATE, TEMPORARY exception: the MVP world map
// streams tiles/glyphs/sprites from OpenFreeMap while self-hosted PMTiles are
// still a later milestone (CONCRETE_MAP_PLAN.md §5.2, D6). The allowlist is
// per-route so that breach cannot silently spread to the rest of the site, and
// it is removed when tiles move in-house.

const BASE_ALLOWED: RegExp[] = [
  /^localhost(:\d+)?$/,
  /^127\.0\.0\.1(:\d+)?$/,
  /\.dirtbikex\.com$/,
  /\.dirtbikechina\.com$/,
];

const MAP_TILES_ALLOWED: RegExp[] = [/^tiles\.openfreemap\.org$/];

interface RouteSpec {
  path: string;
  /** Extra hosts legal on THIS route only. */
  allow?: RegExp[];
  /** Homepage: let the deferred map boot and fetch tiles before asserting. */
  exerciseMap?: boolean;
}

/**
 * A seeded rider on the target environment. Overridable so the check can follow
 * whatever the current seed is without editing the spec.
 */
const LINEAGE_RESUME_PATH = process.env.LINEAGE_TEST_PATH ?? '/lineage/@calvin';

/** The share spelling of the same résumé — a bare segment is a forum username. */
const LINEAGE_SHARE_PATH = process.env.LINEAGE_TEST_SHARE_PATH ?? '/share/lineage/calvin';

/** A seeded map entity; overridable for the same reason as the rider above. */
const ENTITY_SHARE_PATH = process.env.ENTITY_TEST_PATH ?? '/share/route/chongqing-shapingba-164';

const ROUTES: RouteSpec[] = [
  { path: '/', allow: MAP_TILES_ALLOWED, exerciseMap: true },
  { path: '/zh-CN/', allow: MAP_TILES_ALLOWED, exerciseMap: true },
  { path: '/zh-TW/', allow: MAP_TILES_ALLOWED },
  { path: '/ja/', allow: MAP_TILES_ALLOWED },
  { path: '/privacy' },
  { path: '/terms' },
  { path: '/cookies' },
  { path: '/founders' },
  { path: '/contact' },
  // Lineage pages are worker-rendered and read by people who never sign in —
  // the China invariant has to extend to them (LINEAGE_PLAN.md §4.2).
  { path: LINEAGE_RESUME_PATH },
  { path: LINEAGE_SHARE_PATH },
  // `?debug=true` renders an extra panel; it must stay as asset-free as the page.
  { path: `${LINEAGE_SHARE_PATH}?debug=true` },
  // Map-entity cards. `?stay=1` disarms the redirect countdown — without it the
  // page forwards to the map mid-test and the run would assert the map's hosts
  // (which have their own deliberate tile allowance) instead of the card's.
  { path: `${ENTITY_SHARE_PATH}?stay=1` },
];

// Belt-and-suspenders: even if an allowlist is widened by accident,
// these hosts must never appear.
const DENIED_HOST_PATTERNS: RegExp[] = [
  /(^|\.)fonts\.googleapis\.com$/,
  /(^|\.)fonts\.gstatic\.com$/,
  /(^|\.)google-analytics\.com$/,
  /(^|\.)googletagmanager\.com$/,
  /(^|\.)jsdelivr\.net$/,
  /(^|\.)unpkg\.com$/,
  /(^|\.)cdnjs\.cloudflare\.com$/,
  /(^|\.)cloudfront\.net$/,
];

function isDenied(host: string): boolean {
  return DENIED_HOST_PATTERNS.some((re) => re.test(host));
}

function formatHits(entries: [string, string[]][]): string {
  return entries
    .map(([host, urls]) => `  ${host}\n${urls.map((u) => `    - ${u}`).join('\n')}`)
    .join('\n');
}

/**
 * Waits for the map to settle, then pans once so tile requests for a second
 * viewport are observed too. Assertions at `load` would miss all of it — the
 * island is deferred and fetches style/glyphs/tiles afterwards.
 *
 * Headless engines without WebGL2 land on the `is-unavailable` branch instead;
 * the run then degrades to a plain page check rather than failing.
 */
async function exerciseMap(page: Page): Promise<void> {
  await page.waitForSelector('.wm.is-live, .wm.is-unavailable', { timeout: 45_000 });
  if (!(await page.locator('.wm.is-live').count())) return;
  const box = page.viewportSize();
  if (box) {
    await page.mouse.move(box.width / 2, box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.width / 2 - 220, box.height / 2 - 120, { steps: 12 });
    await page.mouse.up();
  }
  await page.waitForTimeout(3_000);
}

for (const route of ROUTES) {
  test(`${route.path} loads no unexpected third-party runtime assets`, async ({ page }) => {
    const allowed = [...BASE_ALLOWED, ...(route.allow ?? [])];
    const offOrigin = new Map<string, string[]>();

    page.on('request', (req) => {
      let url: URL;
      try {
        url = new URL(req.url());
      } catch {
        return;
      }
      if (url.protocol === 'data:' || url.protocol === 'blob:') return;
      const host = url.host;
      if (allowed.some((re) => re.test(host))) return;
      const list = offOrigin.get(host) ?? [];
      list.push(req.url());
      offOrigin.set(host, list);
    });

    await page.goto(route.path, { waitUntil: 'load' });
    if (route.exerciseMap) await exerciseMap(page);

    const allEntries = [...offOrigin.entries()];
    const denied = allEntries.filter(([h]) => isDenied(h));
    const unknown = allEntries.filter(([h]) => !isDenied(h));

    expect(denied, `denied CDN hosts hit on ${route.path}:\n${formatHits(denied)}`).toEqual([]);
    expect(unknown, `unexpected off-origin hosts on ${route.path}:\n${formatHits(unknown)}`).toEqual(
      [],
    );
  });
}
