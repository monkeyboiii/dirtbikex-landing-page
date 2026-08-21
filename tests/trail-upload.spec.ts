import { test, expect } from '@playwright/test';

/**
 * The visitor trail upload, against a deployed environment. See docs/TRAIL_UPLOAD_MODULE.md.
 *
 * Opt-in (TRAIL_UPLOAD_E2E=1) because it really uploads: it puts a file in the forum's
 * upload store, a row in D1 and spends one of six uploads an IP gets per hour. There is no
 * way to write a hard-coded deep-link test instead — an unclaimed trail is gone in 72 hours
 * by design, so the only trail this can open is one it just made.
 *
 *   PLAYWRIGHT_BASE_URL=https://www.dirtbikechina.com TRAIL_UPLOAD_E2E=1 \
 *     ~/bin/pw-limited pnpm exec playwright test trail-upload --project=chromium --workers=1
 */
test.describe('trail upload', () => {
  test.skip(!process.env.TRAIL_UPLOAD_E2E, 'opt-in: uploads for real');
  test.describe.configure({ mode: 'serial' });

  // Carries <ele> and <time>, because a real recorder does and because the sheet's chips
  // and stats are read off them.
  const gpx = (() => {
    const points: string[] = [];
    const t0 = Date.UTC(2026, 4, 17, 8, 0, 0);
    for (let i = 0; i < 400; i++) {
      const t = (i / 400) * 2 * Math.PI;
      points.push(
        `<trkpt lat="${(30.05 + 0.01 * Math.sin(t)).toFixed(6)}" lon="${(119.68 + 0.013 * Math.cos(t)).toFixed(6)}">` +
          `<ele>${(120 + 40 * Math.sin(t)).toFixed(1)}</ele>` +
          `<time>${new Date(t0 + i * 9000).toISOString()}</time></trkpt>`,
      );
    }
    return `<?xml version="1.0"?><gpx version="1.1" creator="e2e"><trk><trkseg>${points.join('')}</trkseg></trk></gpx>`;
  })();

  let secret = '';

  /** The rail is wired at the end of boot, so a click before the gate lifts does nothing. */
  const ready = async (page: import('@playwright/test').Page, path: string) => {
    await page.goto(path);
    await expect(page.locator('[data-map-gate]')).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
  };

  test('a valid ride uploads and hands back a link and a code', async ({ page }) => {
    await ready(page, '/');
    await page.locator('[data-upload]').click();
    await expect(page.locator('.wm-panel__title')).toContainText('Put your ride on the map');

    await page.locator('[data-upload-input]').setInputFiles({
      name: 'e2e-ride.gpx',
      mimeType: 'application/gpx+xml',
      buffer: Buffer.from(gpx),
    });

    await expect(page.locator('.wm-panel__title')).toContainText('Your trail is on the map', { timeout: 30_000 });
    const values = page.locator('.wm-panel__copy-value');
    await expect(values).toHaveCount(2);
    const link = (await values.first().textContent()) ?? '';
    expect(link).toMatch(/\/\?trail=[a-z0-9]{8}$/);
    secret = link.split('=')[1]!;
    // Six digits, like an SMS code. Its safety is not its entropy — see the module doc —
    // so if this assertion ever loosens, the rate limiting on the claim route is what has
    // to be checked, not this line.
    expect((await values.nth(1).textContent()) ?? '').toMatch(/^\d{6}$/);

    // Drawn from the file we already hold, so the trace is on screen before any fetch.
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();

    // The link and the code cannot be shown again, so a tap on empty map must not take
    // them away. Regression for the sheet that used to dismiss itself.
    const box = (await page.locator('canvas.maplibregl-canvas').boundingBox())!;
    await page.mouse.click(box.x + 40, box.y + box.height - 40);
    await page.waitForTimeout(400);
    await expect(page.locator('.wm-panel__title')).toContainText('Your trail is on the map');
    await expect(page.locator('.wm-panel__copy-value')).toHaveCount(2);
  });

  test('the secret link reopens it, and the public document does not carry it', async ({ page, request }) => {
    expect(secret, 'the upload test must run first').toBeTruthy();

    const doc = await (await request.get(`/api/map/trails.json?cb=${secret}`)).json();
    expect((doc.trails as { id: string }[]).map((t) => t.id)).not.toContain(secret);

    // ?layers= without `trails` is the state the reported bug needed: the trace layer used
    // to be hidden with the rail's toggle, so a private link rendered an empty map.
    await ready(page, `/?trail=${secret}&layers=tracks,ride`);
    // It opens as the trail card it is, kicker and all — the secret only decides how it
    // was found, not what it is.
    await expect(page.locator('.wm-panel__slot')).toContainText('Rider trail', { timeout: 30_000 });
    await expect(page.locator('.wm-panel__title')).toContainText('e2e-ride');
    // An unclaimed trail has no rider, so it gets no byline and no share button.
    await expect(page.locator('.wm-panel__byline .wm-person')).toHaveCount(0);
    await expect(page.locator('.wm-panel__share')).toHaveCount(0);

    // The chips come off <ele>/<time>, which the coordinate scanner does not read. Every
    // upload used to be labelled "Plotted route" — the one thing the pre-flight rejects.
    const chips = (await page.locator('.wm-chip').allTextContents()).join(' | ');
    expect(chips).not.toContain('Plotted route');
    expect(chips).toContain('Recorded');
    expect(chips).toContain('Loop');
  });

  test('a link that resolves to nothing says so without confirming anything', async ({ page }) => {
    await ready(page, '/?trail=zzzzzzzz');
    await expect(page.locator('.wm-panel__title')).toContainText('no longer here', { timeout: 30_000 });
  });

  /**
   * The three gpx.studio failures, refused before the network: a file with route points, a
   * file with no track at all, and a trace that never moved. None of these spend an upload.
   */
  for (const [name, body] of [
    ['route points', '<gpx><rte><rtept lat="30" lon="119"/><rtept lat="30.1" lon="119.1"/></rte></gpx>'],
    ['waypoints only', '<gpx><wpt lat="30" lon="119"><name>x</name></wpt></gpx>'],
    ['zero extent', `<gpx><trk><trkseg>${'<trkpt lat="30.05" lon="119.68"/>'.repeat(10)}</trkseg></trk></gpx>`],
  ] as const) {
    test(`refuses ${name} without uploading`, async ({ page }) => {
      let posted = false;
      await page.route('**/api/map/trail', (route) => {
        posted = true;
        return route.abort();
      });
      await ready(page, '/');
      await page.locator('[data-upload]').click();
      await page.locator('[data-upload-input]').setInputFiles({
        name: 'bad.gpx',
        mimeType: 'application/gpx+xml',
        buffer: Buffer.from(`<?xml version="1.0"?>${body}`),
      });
      await expect(page.locator('.wm-panel__title')).toContainText('could not be added');
      expect(posted, 'the pre-flight must reject before the network').toBe(false);
    });
  }
});
