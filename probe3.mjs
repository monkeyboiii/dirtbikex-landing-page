import { chromium } from '/home/calvin/Desktop/Projects/DirtBikeX/infra/submodules/dirtbikex-landing-page/node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.mjs';
const BASE = 'https://forum.dirtbikechina.com';
const b = await chromium.launch({ args: ['--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1728, height: 1000 } });
const measure = () => page.evaluate(() => {
  const wrap = document.querySelector('#main-outlet-wrapper');
  const outlet = document.querySelector('#main-outlet');
  const root = getComputedStyle(document.documentElement);
  const bodyCS = getComputedStyle(document.body);
  return {
    dMaxWidth: (root.getPropertyValue('--d-max-width') || bodyCS.getPropertyValue('--d-max-width')).trim(),
    dSidebar: (root.getPropertyValue('--d-sidebar-width') || bodyCS.getPropertyValue('--d-sidebar-width')).trim(),
    wrapMax: wrap && getComputedStyle(wrap).maxWidth,
    wrapW: Math.round(wrap?.getBoundingClientRect().width || 0),
    display: outlet && getComputedStyle(outlet).display,
    outletW: Math.round(outlet?.getBoundingClientRect().width || 0),
  };
});
for (const [label, url] of [
  ['/about  FKB Pro (current)', '/about'],
  ['/about  Foundation theme',  '/about?preview_theme_id=-1'],
  ['/about  Horizon theme',     '/about?preview_theme_id=-2'],
]) {
  try {
    await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#main-outlet', { timeout: 15000 });
    await page.waitForTimeout(1200);
    console.log(JSON.stringify({ label, ...(await measure()) }));
  } catch (e) { console.log(JSON.stringify({ label, error: String(e).slice(0, 90) })); }
}
await b.close();
