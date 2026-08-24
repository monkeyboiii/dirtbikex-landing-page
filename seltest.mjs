import { chromium } from '/home/calvin/Desktop/Projects/DirtBikeX/infra/submodules/dirtbikex-landing-page/node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.mjs';
const SEL = "body:not([class^=category-]):not([class*=\" category-\"]):not([class^=tag-]):not([class*=\" tag-\"]):not(.navigation-topics):not(.categories-list)";
const b = await chromium.launch({ args: ['--no-sandbox'] });
const page = await b.newPage();
// Real class attributes captured from the live forum, plus the legitimate cases.
const UC = 'uc-chat-pinned-messages uc-enable-ideas-category-type-setup uc-enable-new-checkbox-style uc-enable-simplified-category-creation uc-enable-support-category-type-setup';
const CASES = [
  ['/about       (collateral)',        `${UC} static-about`,                                    true],
  ['/u           (collateral)',        `${UC} users-page`,                                      true],
  ['/admin       (collateral)',        `${UC} admin-interface`,                                 true],
  ['/latest      (legit listing)',     `${UC} navigation-topics`,                               false],
  ['/categories  (legit listing)',     `${UC} categories-list navigation-categories`,           false],
  ['/c/<slug>    (legit category)',    `${UC} category-trails navigation-topics`,               false],
  ['/c first tok (legit category)',    `category-trails ${UC}`,                                 false],
  ['/tag/<name>  (legit tag)',         `${UC} tag-gpx navigation-topics`,                       false],
  ['/tag first tok (legit tag)',       `tag-gpx ${UC}`,                                         false],
  ['topic        (FKB excludes it)',   `${UC} archetype-regular category-trails`,               false],
  ['tag named "category-x"',           `${UC} tag-category-x`,                                  false],
];
await page.setContent('<html><body></body></html>');
let bad = 0;
for (const [label, cls, wantNeutralised] of CASES) {
  const got = await page.evaluate(([c, s]) => {
    document.body.className = c;
    return document.body.matches(s);
  }, [cls, SEL]);
  const ok = got === wantNeutralised;
  if (!ok) bad++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label.padEnd(34)} neutralised=${String(got).padEnd(5)} want=${wantNeutralised}`);
}
console.log(bad ? `\n${bad} WRONG` : '\nSELECTOR CLASSIFIES EVERY CASE CORRECTLY');
await b.close();
process.exit(bad ? 1 : 0);
