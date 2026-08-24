import { chromium } from '/home/calvin/Desktop/Projects/DirtBikeX/infra/submodules/dirtbikex-landing-page/node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.mjs';
const BASE = 'https://forum.dirtbikechina.com';
const FIX = `
html:not(.has-full-page-chat) body:not([class^=category-]):not([class*=" category-"]):not([class^=tag-]):not([class*=" tag-"]):not(.navigation-topics):not(.categories-list) #main-outlet{display:block !important}
html:not(.has-full-page-chat) body:not([class^=category-]):not([class*=" category-"]):not([class^=tag-]):not([class*=" tag-"]):not(.navigation-topics):not(.categories-list) #main-outlet-wrapper.wrap{max-width:var(--d-max-width) !important}
html:not(.has-full-page-chat) body:not([class^=category-]):not([class*=" category-"]):not([class^=tag-]):not([class*=" tag-"]):not(.navigation-topics):not(.categories-list).has-sidebar-page #main-outlet-wrapper.wrap{max-width:calc(var(--d-sidebar-width) + var(--d-max-width)) !important}
`;
const b = await chromium.launch({ args: ['--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1728, height: 1000 } });
const measure = () => page.evaluate(() => {
  const wrap = document.querySelector('#main-outlet-wrapper');
  const outlet = document.querySelector('#main-outlet');
  return {
    sidebar: document.body.classList.contains('has-sidebar-page'),
    wrapMax: wrap && getComputedStyle(wrap).maxWidth,
    display: outlet && getComputedStyle(outlet).display,
    cols: outlet && getComputedStyle(outlet).gridTemplateColumns,
    outletW: Math.round(outlet?.getBoundingClientRect().width || 0),
  };
});
async function run(url, label, collapse = false) {
  try {
    await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#main-outlet', { timeout: 15000 });
    await page.waitForTimeout(1000);
    if (collapse) {
      const t = await page.$('.header-sidebar-toggle button, button.btn-sidebar-toggle');
      if (t) { await t.click(); await page.waitForTimeout(700); }
    }
    const before = await measure();
    /* deployed for real now */
    await page.waitForTimeout(300);
    const after = await measure();
    console.log(JSON.stringify({ label, before, after }));
  } catch (e) { console.log(JSON.stringify({ label, error: String(e).slice(0, 90) })); }
}
const t = await (await b.newPage()).goto(BASE + '/latest.json').then(r => r.json()).catch(() => null);
const topic = t?.topic_list?.topics?.[0];
await run('/about', 'about  sidebar ON');
await run('/about', 'about  sidebar OFF', true);
await run('/u', 'users  sidebar ON');
await run('/latest', 'latest  (must NOT change)');
await run('/categories', 'categories  (must NOT change)');
if (topic) await run(`/t/${topic.slug}/${topic.id}`, 'topic  (must NOT change)');
await b.close();
