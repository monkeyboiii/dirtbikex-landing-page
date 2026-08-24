import { chromium } from '/home/calvin/Desktop/Projects/DirtBikeX/infra/submodules/dirtbikex-landing-page/node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.mjs';
const BASE = 'https://forum.dirtbikechina.com';
const b = await chromium.launch({ args: ['--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1728, height: 1000 } });

const measure = () => page.evaluate(() => {
  const cls = [...document.body.classList];
  const wrap = document.querySelector('#main-outlet-wrapper');
  const outlet = document.querySelector('#main-outlet');
  const w = wrap && getComputedStyle(wrap), o = outlet && getComputedStyle(outlet);
  return {
    sidebar: document.body.classList.contains('has-sidebar-page'),
    realCategoryOrTag: cls.some(c => /^(category|tag)-/.test(c)),
    archetype: cls.filter(c => c.startsWith('archetype-')),
    navTopics: cls.includes('navigation-topics') || cls.includes('categories-list'),
    wrapMax: w?.maxWidth, wrapW: Math.round(wrap?.getBoundingClientRect().width || 0),
    display: o?.display, cols: o?.gridTemplateColumns,
    outletW: Math.round(outlet?.getBoundingClientRect().width || 0),
  };
});

async function visit(url, label, collapse = false) {
  try {
    await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#main-outlet', { timeout: 15000 });
    await page.waitForTimeout(1000);
    if (collapse) {
      const t = await page.$('.header-sidebar-toggle button, button.btn-sidebar-toggle');
      if (t) { await t.click(); await page.waitForTimeout(800); }
    }
    console.log(JSON.stringify({ label, url, ...(await measure()) }));
  } catch (e) { console.log(JSON.stringify({ label, url, error: String(e).slice(0, 90) })); }
}

// A topic is the ONE path FKB's :not(.archetype-regular) excludes — the honest baseline.
const t = await (await b.newPage()).goto(BASE + '/latest.json').then(r => r.json()).catch(() => null);
const topic = t?.topic_list?.topics?.[0];
if (topic) await visit(`/t/${topic.slug}/${topic.id}`, 'TOPIC (FKB excluded = baseline)');
await visit('/latest', 'latest (legit FKB target)');
await visit('/about', 'about (collateral, sidebar on)');
await visit('/about', 'about (collateral, sidebar OFF)', true);
await visit('/u', 'users (collateral)');
await b.close();
