import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderShareLanding } from '../../worker/_lib/render.ts';

/**
 * The in-app-browser escape hatch (`browserHint`).
 *
 * The hazard these guard is structural: the `appCTA` anchor is duplicated byte-identically
 * in three separate template literals (invite / profile / event). Hooking each one
 * separately is how a card silently loses the behaviour — no type error, no failing build.
 * So the implementation uses one script and one selector, and these tests assert that the
 * one selector actually matches on all three.
 */

const hint = { line: '点击 ··· 用默认浏览器打开' };

const base = {
  locale: 'en' as const,
  primaryCTA: { label: 'Get DirtBikeX', url: 'https://apps.apple.com/app/id6765577701' },
  returnTapCopy: 'Tap the link again after installing.',
  forumBase: 'https://forum.example.com',
};

// Minimal but structurally real: `buildOgImage` reaches into `invited_by` / `organizer`,
// so a fixture that omits them crashes the renderer rather than failing an assertion.
const who = { username: 'calvin', name: 'Calvin', avatar_template: null };
const invite = {
  ...base,
  kind: 'i' as const,
  invite: {
    id: 1, invite_key: 'k', description: null,
    max_redemptions_allowed: null, redemption_count: 0,
    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
    expires_at: null, expired: false, topics: [], groups: [], invited_by: who,
  },
};
const profile = { ...base, kind: 'u' as const, user: { ...who } };
const event = {
  ...base,
  kind: 'e' as const,
  event: {
    id: 1, name: 'Round 1', starts_at: '2026-09-01T00:00:00Z', ends_at: null,
    all_day: false, timezone: 'Asia/Shanghai', location: null, description: null,
    organizer: who, post_url: null, stats: null, tags: [], invitees: [],
    is_ongoing: false, is_expired: false, is_closed: false, image_url: null,
  },
};

async function render(props: any): Promise<string> {
  return await renderShareLanding(props, 'https://www.dirtbikechina.com/s/u/calvin').text();
}

test('no hint means no overlay and no script — a normal browser pays nothing', async () => {
  const html = await render({ ...profile, appCTA: { label: 'Open in the app', url: 'dirtbikex://s/u/calvin' } });
  assert.ok(!html.includes('data-hint'), 'overlay must not render without a hint');
  // Not a class name — those ship in the stylesheet on every page. This is the script.
  assert.ok(!html.includes('function arm('), 'no fallback script wired');
  assert.ok(!html.includes('<div class="hint"'), 'no hint markup');
  assert.ok(html.includes('dirtbikex://s/u/calvin'), 'the app CTA is still there');
});

for (const [name, props, url] of [
  ['invite', invite, 'dirtbikex://s/i/k'],
  ['profile', profile, 'dirtbikex://s/u/calvin'],
  ['event', event, 'dirtbikex://s/e/1'],
] as const) {
  test(`${name} card: the one selector matches the app CTA it must hook`, async () => {
    const html = await render({ ...props, appCTA: { label: 'Open in the app', url }, browserHint: hint });
    // The selector the script uses, asserted against the markup it has to match.
    assert.match(html, /<a class="cta cta-secondary" href="dirtbikex:/, `${name} anchor shape changed — the selector will silently stop matching`);
    assert.ok(html.includes('data-hint'), 'the hint renders');
    assert.ok(html.includes('hint-arrow'), 'the arrow renders');
    assert.ok(html.includes('用默认浏览器打开'), "the menu item's own words are shown");
  });
}

test('the label is untouched — the button still says what the rider wanted', async () => {
  const html = await render({ ...profile, appCTA: { label: 'Open in the app', url: 'dirtbikex://s/u/calvin' }, browserHint: hint });
  assert.ok(html.includes('>Open in the app</a>'), 'label preserved');
  assert.ok(html.includes('https://apps.apple.com/app/id6765577701'), 'the store CTA is untouched');
});

test('the hint ships hidden, and is never a dialog', async () => {
  const html = await render({ ...profile, appCTA: { label: 'Open in the app', url: 'dirtbikex://s/u/calvin' }, browserHint: hint });
  assert.match(html, /<div class="hint" data-hint hidden>/, 'must render hidden');
  assert.ok(!html.includes('role="dialog"'), 'must not be a dialog');
  assert.ok(!html.includes('data-hint-close'), 'no dismiss control — it is pointer-events:none');
});

test('copy is escaped, not interpolated raw', async () => {
  const html = await render({
    ...profile,
    appCTA: { label: 'Open in the app', url: 'dirtbikex://s/u/calvin' },
    browserHint: { line: '<script>alert(1)</script>' },
  });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'hint copy must be escaped');
});

test('the error card (/share/<kind>/<missing>) hooks the store CTA — it has no app CTA', async () => {
  const html = await render({
    ...base,
    kind: 'tr' as const,
    title: 'This link has nothing behind it',
    subtitle: 'It may have been removed, or the link was mistyped.',
    browserHint: hint,
  });
  // The selector the script uses for the store link, asserted against real markup. This is
  // the card from the device report where "Get DirtBikeX" did nothing in WeChat.
  assert.match(html, /<a class="cta" href="https:\/\/apps\.apple\.com/, 'store CTA shape changed — the selector will stop matching');
  assert.ok(!html.includes('dirtbikex://'), 'error cards carry no app CTA');
  assert.ok(html.includes('data-hint'), 'the hint still renders, hooked to the store CTA');
});
