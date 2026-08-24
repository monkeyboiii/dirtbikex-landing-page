import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderShareLanding } from '../../worker/_lib/render.ts';

/**
 * The `/s/c/<code>` claim card.
 *
 * Two bugs shipped into this file before these tests existed, and neither was visible
 * without actually rendering it:
 *
 *  1. A backtick inside a CSS comment closed the `CSS` template literal, which breaks the
 *     whole worker — every route, not just this card.
 *  2. `errorBody` and `trailClaimBody` end with byte-identical markup, so an edit aimed at
 *     one landed in the other. `errorBody` was left referencing a variable it does not
 *     have, which esbuild bundles happily because it does not type-check.
 *
 * So: assert on real rendered output, and assert the error card still renders at all.
 */

const base = {
  kind: 'c' as const,
  locale: 'en' as const,
  primaryCTA: { label: 'Set up my profile', url: 'https://forum.example.com/dbx/trails/claim?code=ABC' },
  returnTapCopy: '',
  forumBase: 'https://forum.example.com',
  title: 'Unionsleden N W->E',
  subtitle: 'One more step.',
};

const claim = {
  facts: [{ value: '39 km', label: 'Distance' }, { value: '+403 m', label: 'Climb' }],
  shape: 'Point to point',
  expiry: 'expires in 68 h',
  claimed: false,
  kicker: 'Ready to sign',
};

const html = async (props: unknown) =>
  await renderShareLanding(props as never, 'https://www.example.com/s/c/ABC').text();

test('the card renders the map sheet, not the error layout', async () => {
  const out = await html({ ...base, trailClaim: claim });
  // Class names must be matched in their MARKUP form: the stylesheet is inlined into
  // every card, so a bare 'claim-tick' matches the CSS and proves nothing.
  for (const bit of ['<div class="claim-tick"', '<dl class="claim-facts"', '39 km', 'Climb',
                     'Point to point', 'Ready to sign', 'expires in 68 h']) {
    assert.ok(out.includes(bit), `missing ${bit}`);
  }
  // The error card's avatar block, not the bare filename: /icon-512.png is also the
  // og:image fallback and appears in the <head> of every card.
  assert.ok(!out.includes('<div class="avatar">'), 'fell through to the error card');
});

test('the iOS ask ships only to iOS', async () => {
  const plain = await html({ ...base, trailClaim: claim });
  assert.ok(!plain.includes('data-claim-ask'), 'dialog leaked to a non-iOS visitor');
  assert.ok(!plain.includes('data-claim-cta'), 'CTA hook leaked');

  const ios = await html({
    ...base,
    trailClaim: {
      ...claim,
      app: {
        prompt: 'DirtBikeX works best in the app.',
        yes: 'Open in the app',
        web: 'Open in browser',
        appURL: 'dirtbikex://s/c/ABC',
        storeURL: 'https://apps.apple.com/app/id6765577701',
      },
    },
  });
  assert.ok(ios.includes('data-claim-ask'), 'no dialog');
  assert.ok(ios.includes('data-claim-cta'), 'CTA not hooked');
  assert.ok(ios.includes('data-app="dirtbikex://s/c/ABC"'), 'scheme missing');
  assert.ok(ios.includes('data-store="https://apps.apple.com/app/id6765577701"'), 'store missing');
  assert.ok(ios.includes('#007aff'), 'system blue missing');
});

test('a spent code drops the kicker and keeps the tick', async () => {
  const out = await html({ ...base, trailClaim: { ...claim, claimed: true } });
  assert.ok(!out.includes('Ready to sign'), 'a promise on a spent code');
  assert.ok(out.includes('<div class="claim-tick"'), 'tick lost');
});

test('the error card still renders', async () => {
  // The rate-limited claim path, and every other error route, go through errorBody.
  const out = await html({ ...base, title: 'Too many attempts', trailClaim: undefined });
  assert.ok(out.includes('Too many attempts'));
  assert.ok(out.includes('<div class="avatar">'), 'not the error layout');
  assert.ok(!out.includes('<div class="claim-tick"'), 'a tick over a failure');
});

test('no backtick can close the CSS template literal', () => {
  const src = readFileSync(new URL('../../worker/_lib/render.ts', import.meta.url), 'utf8');
  const open = src.indexOf('const CSS = `');
  assert.ok(open > -1, 'CSS constant moved — update this test');
  const body = src.slice(open + 'const CSS = `'.length);
  const close = body.indexOf('\n`;');
  assert.ok(close > -1, 'could not find the end of the CSS literal');
  assert.equal(body.slice(0, close).includes('`'), false,
    'a backtick inside the CSS literal closes it and breaks the entire worker');
});
