import { chromium } from '/home/calvin/Desktop/Projects/DirtBikeX/infra/submodules/dirtbikex-landing-page/node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.mjs';
const ROUTES = ['/latest', '/about', '/u', '/categories'];
const b = await chromium.launch({ args: ['--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1728, height: 1000 } });
for (const r of ROUTES) {
  try {
    await page.goto('https://forum.dirtbikechina.com' + r, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#main-outlet', { timeout: 15000 });
    await page.waitForTimeout(1200);
    const m = await page.evaluate(() => {
      const cls = document.body.className.split(/\s+/).filter(Boolean);
      const wrap = document.querySelector('#main-outlet-wrapper');
      const outlet = document.querySelector('#main-outlet');
      const w = wrap && getComputedStyle(wrap), o = outlet && getComputedStyle(outlet);
      return {
        substringHits: cls.filter(c => c.includes('category-') || c.includes('tag-')),
        classes: cls.join(' ').slice(0, 260),
        hasSidebarPage: document.body.classList.contains('has-sidebar-page'),
        wrapMaxWidth: w?.maxWidth, wrapW: Math.round(wrap?.getBoundingClientRect().width || 0),
        outletDisplay: o?.display, outletCols: o?.gridTemplateColumns,
        outletW: Math.round(outlet?.getBoundingClientRect().width || 0),
      };
    });
    console.log(JSON.stringify({ route: r, ...m }));
  } catch (e) { console.log(JSON.stringify({ route: r, error: String(e).slice(0, 100) })); }
}
await b.close();
