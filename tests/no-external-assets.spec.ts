import { test, expect } from '@playwright/test';

// Enforces the README.md invariant: the served site must not load any
// third-party runtime assets (Google Fonts, GA, jsdelivr, unpkg, cdnjs,
// cloudfront, etc.) — these silently break mainland-China users.
//
// Strategy: visit a representative set of pages, observe every network
// request via page.on('request'), and assert that every host is either
// same-origin (localhost in dev, the canonical site in prod) or in the
// explicit allowlist.

const ROUTES = [
  '/',
  '/zh-CN/',
  '/zh-TW/',
  '/ja/',
  '/privacy',
  '/terms',
  '/cookies',
  '/founders',
  '/contact',
];

const ALLOWED_HOST_PATTERNS: RegExp[] = [
  /^localhost(:\d+)?$/,
  /^127\.0\.0\.1(:\d+)?$/,
  /\.dirtbikex\.com$/,
  /\.dirtbikechina\.com$/,
];

// Belt-and-suspenders: even if the allowlist is widened by accident,
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

function isAllowed(host: string): boolean {
  return ALLOWED_HOST_PATTERNS.some((re) => re.test(host));
}

function isDenied(host: string): boolean {
  return DENIED_HOST_PATTERNS.some((re) => re.test(host));
}

function formatHits(entries: [string, string[]][]): string {
  return entries
    .map(([host, urls]) => `  ${host}\n${urls.map((u) => `    - ${u}`).join('\n')}`)
    .join('\n');
}

for (const route of ROUTES) {
  test(`${route} loads no third-party runtime assets`, async ({ page }) => {
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
      if (isAllowed(host)) return;
      const list = offOrigin.get(host) ?? [];
      list.push(req.url());
      offOrigin.set(host, list);
    });

    await page.goto(route, { waitUntil: 'load' });

    const allEntries = [...offOrigin.entries()];
    const denied = allEntries.filter(([h]) => isDenied(h));
    const unknown = allEntries.filter(([h]) => !isDenied(h));

    expect(denied, `denied CDN hosts hit on ${route}:\n${formatHits(denied)}`).toEqual([]);
    expect(unknown, `unexpected off-origin hosts on ${route}:\n${formatHits(unknown)}`).toEqual(
      [],
    );
  });
}
