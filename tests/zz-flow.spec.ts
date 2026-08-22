import { test, expect } from '@playwright/test';
const gpx = (() => {
  const pts: string[] = []; const t0 = Date.UTC(2026, 4, 17, 8, 0, 0);
  for (let i = 0; i < 400; i++) { const t = (i / 400) * 2 * Math.PI;
    pts.push(`<trkpt lat="${(30.05 + 0.01 * Math.sin(t)).toFixed(6)}" lon="${(119.68 + 0.013 * Math.cos(t)).toFixed(6)}"><ele>${(120 + 40 * Math.sin(t)).toFixed(1)}</ele><time>${new Date(t0 + i * 9000).toISOString()}</time></trkpt>`); }
  return `<?xml version="1.0"?><gpx version="1.1" creator="e2e"><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
})();

test('intro → ready → rename → confirm → done → anon link', async ({ page }) => {
  test.setTimeout(240_000);
  const dir = process.env.SHOT_DIR!;
  await page.goto('/zh-CN/');
  await expect(page.locator('[data-map-gate]')).toHaveAttribute('data-state', 'done', { timeout: 60_000 });

  await page.locator('[data-upload]').click();
  await expect(page.locator('.wm-peek__frame')).toHaveCount(3);
  await page.screenshot({ path: `${dir}/f1-intro.png` });

  await page.locator('[data-upload-input]').setInputFiles({ name: '2026-05-17_08-00-00.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpx) });
  await expect(page.locator('.wm-panel__claim')).toBeVisible({ timeout: 40_000 });
  await expect(page.locator("h2.wm-panel__title")).toHaveText('2026-05-17_08-00-00');
  await page.screenshot({ path: `${dir}/f2-ready.png` });

  // Rename behind the pencil.
  await page.locator('.wm-panel__titlerow .wm-panel__share').click();
  const field = page.locator('.wm-panel__title-input');
  await expect(field).toBeVisible();
  await field.fill('桐庐练习圈');
  await field.press('Enter');
  await expect(page.locator("h2.wm-panel__title")).toHaveText('桐庐练习圈');

  await page.locator('.wm-panel__claim').click();
  await expect(page.locator("h2.wm-panel__title")).toHaveText('桐庐练习圈', { timeout: 60_000 });
  await expect(page.locator('.wm-eye')).toHaveCount(1);
  const body = await page.locator('.wm-panel__body').innerText();
  console.log(`--- done ---\n${body}\n---`);
  expect(body).not.toContain('https://');
  await page.screenshot({ path: `${dir}/f3-done.png` });

  const share = page.locator('.wm-panel__titlerow .wm-panel__share');
  await expect(share).toHaveCount(1);
});
