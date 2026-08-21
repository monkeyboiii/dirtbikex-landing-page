import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS,
  SIG_MAX_POINTS,
  SIG_SPACING_M,
  SIG_VERSION,
  compare,
  compareSignatures,
  decodeSig,
  encodeSig,
  metres,
  resample,
  signable,
  thresholds,
  type LngLat,
  type Run,
} from '../../worker/_lib/trailOverlap.ts';

/**
 * The overlap measure. See docs/TRAIL_OVERLAP_MODULE.md.
 *
 * Run with `pnpm test:unit`. Node's native type stripping, no loader, no dev dependency,
 * no browser — deliberately NOT @playwright/test, whose `webServer` is config-global, so
 * running any spec without PLAYWRIGHT_BASE_URL boots `astro dev` on this two-core box.
 * Making the cheapest tests in the repo the most dangerous to run wrong is not a trade
 * worth taking.
 *
 * Every behavioural test injects its own thresholds. Exactly one test pins the production
 * defaults, so a deliberate threshold change fails that one and nothing else.
 */

const LIMITS = thresholds();

/* ---------- fixtures ---------- */

const M_PER_DEG_LAT = 110_574;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** A straight line of `lengthM`, heading east from (lng, lat), as `n` vertices. */
function line(lng: number, lat: number, lengthM: number, n = 2, offsetM = 0): Run {
  const dLng = lengthM / mPerDegLng(lat);
  const dLat = offsetM / M_PER_DEG_LAT;
  return Array.from({ length: n }, (_, i) => [lng + (dLng * i) / (n - 1), lat + dLat] as LngLat);
}

/** A circular loop of circumference `lengthM`, sampled at `n` points, phase-shifted and
    jittered so two recordings of the same track are never bit-identical. */
function loop(lng: number, lat: number, lengthM: number, n = 200, phase = 0, jitterM = 0): Run {
  const r = lengthM / (2 * Math.PI);
  const out: Run = [];
  for (let i = 0; i <= n; i++) {
    const t = phase + (i / n) * 2 * Math.PI;
    const j = jitterM ? Math.sin(t * 7.3) * jitterM : 0;
    out.push([
      lng + ((r + j) * Math.cos(t)) / mPerDegLng(lat),
      lat + ((r + j) * Math.sin(t)) / M_PER_DEG_LAT,
    ]);
  }
  return out;
}

const len = (runs: Run[]) => resample(runs).lengthM;

/* ---------- A. signature and codec ---------- */

test('vertex density does not change the signature — the property everything rests on', () => {
  const coarse = resample([line(120, 30, 5000, 2)]);
  const dense = resample([line(120, 30, 5000, 500)]);
  assert.equal(coarse.points, dense.points);
  const seen = compare(coarse.runs, dense.runs, LIMITS)!;
  assert.equal(seen.covAB, 1);
  assert.equal(seen.covBA, 1);
});

test('resampling puts a vertex every SIG_SPACING_M and always keeps the last one', () => {
  const { runs } = resample([line(120, 30, 5000, 2)]);
  const pts = runs[0]!;
  for (let i = 2; i < pts.length - 1; i++) {
    assert.ok(Math.abs(metres(pts[i - 1]!, pts[i]!) - SIG_SPACING_M) < 0.05);
  }
  // The tail is whatever is left over, never dropped and never stretched.
  const tail = metres(pts[pts.length - 2]!, pts[pts.length - 1]!);
  assert.ok(tail > 0 && tail <= SIG_SPACING_M + 0.05);
});

test('encode/decode round trips inside the codec precision', () => {
  const { runs } = resample([loop(120, 30, 12_000, 900)]);
  const back = decodeSig(encodeSig(runs));
  assert.equal(back.length, runs.length);
  let worst = 0;
  for (let i = 0; i < runs[0]!.length; i++) worst = Math.max(worst, metres(runs[0]![i]!, back[0]![i]!));
  assert.ok(worst <= 0.9, `worst round-trip error ${worst.toFixed(3)} m`);
});

test('the separator can never appear inside a polyline', () => {
  const sig = encodeSig(resample([loop(120, 30, 8000, 400), line(121, 31, 3000, 40)]).runs);
  for (const part of sig.split(';')) {
    for (const ch of part) {
      const code = ch.charCodeAt(0);
      assert.ok(code >= 63 && code <= 126, `byte ${code} outside the polyline alphabet`);
    }
  }
});

test('runs survive the round trip — a pen lift is not a pause', () => {
  const runs = Array.from({ length: 50 }, (_, i) => line(120 + i * 0.01, 30, 100, 3));
  const { runs: sampled } = resample(runs);
  assert.equal(decodeSig(encodeSig(sampled)).length, sampled.length);
});

test('a long trace widens its spacing rather than losing its tail', () => {
  const long = resample([line(100, 10, 200_000, 3000)]);
  assert.ok(long.points <= SIG_MAX_POINTS, `${long.points} points`);
  assert.ok(long.spacingM > 30, `spacing ${long.spacingM.toFixed(1)} m should be coarse`);
  // The end of the ride is still the end of the signature.
  const last = long.runs[0]!.at(-1)!;
  assert.ok(Math.abs(last[0] - (100 + 200_000 / mPerDegLng(10))) < 1e-6);
});

test('an antimeridian crossing and the poles refuse to sign', () => {
  assert.equal(signable([179.9, 30, -179.9, 30.1]), false);
  assert.equal(signable([100, 86, 100.1, 87]), false);
  assert.equal(signable([120, 30, 120.1, 30.1]), true);
});

/* ---------- B. degenerate inputs ---------- */

test('empty, single-point and zero-extent traces produce no verdict, not a wrong one', () => {
  const real = resample([line(120, 30, 5000, 2)]).runs;
  assert.equal(compare([], real, LIMITS), null);
  assert.equal(compare([[[120, 30]]], real, LIMITS), null);
  const still: Run = Array.from({ length: 200 }, () => [120, 30] as LngLat);
  assert.equal(compare([still], real, LIMITS), null);
});

test('a null signature is never a conflict', () => {
  const sig = encodeSig(resample([line(120, 30, 5000, 2)]).runs);
  assert.equal(compareSignatures(null, sig, LIMITS), null);
  assert.equal(compareSignatures(sig, null, LIMITS), null);
});

/* ---------- C. the measure ---------- */

const verdict = (a: Run[], b: Run[]) => compare(resample(a).runs, resample(b).runs, LIMITS)!;

test('identical rides are the same ground', () => {
  const v = verdict([line(120, 30, 8000, 2)], [line(120, 30, 8000, 2)]);
  assert.equal(v.covAB, 1);
  assert.equal(v.covBA, 1);
  assert.ok(v.sameGround);
  assert.ok(Math.abs(v.sharedM - 8000) < 30);
});

test('rides two kilometres apart share nothing', () => {
  const v = verdict([line(120, 30, 5000, 2)], [line(120, 30, 5000, 2, 2000)]);
  assert.equal(v.covAB, 0);
  assert.equal(v.covBA, 0);
  assert.equal(v.sharedM, 0);
  assert.ok(!v.sameGround);
});

test('a slice of a ride is the same ground as the ride — the cap-evasion hole, closed', () => {
  const whole = line(120, 30, 20_000, 2);
  // An INTERIOR slice, which is the version somebody would use to dodge a cap.
  const slice = whole[0]!;
  const dLng = 2000 / mPerDegLng(30);
  const inner: Run = [
    [slice[0] + dLng * 4, 30],
    [slice[0] + dLng * 5, 30],
  ];
  const v = verdict([whole], [inner]);
  assert.ok(v.covBA > 0.99, `covBA ${v.covBA}`);
  assert.ok(v.sameGround, `sharedM ${v.sharedM.toFixed(0)} vs required ${v.requiredM.toFixed(0)}`);
});

test('a 200 m stub inside a 50 km ride is not the same ground — the floor doing its job', () => {
  const whole = line(120, 30, 50_000, 2);
  const dLng = 200 / mPerDegLng(30);
  const stub: Run = [
    [120 + dLng * 30, 30],
    [120 + dLng * 31, 30],
  ];
  const v = verdict([whole], [stub]);
  assert.ok(v.sharedM < LIMITS.floorM, `sharedM ${v.sharedM.toFixed(0)}`);
  assert.ok(!v.sameGround);
});

test('twelve laps and three laps of one track are the same ground', () => {
  const many = Array.from({ length: 12 }, (_, i) => loop(120, 30, 400, 60, i * 0.5, 8)).flat();
  const few = Array.from({ length: 3 }, (_, i) => loop(120, 30, 400, 60, Math.PI / 2 + i * 0.5, 8)).flat();
  const v = verdict([many], [few]);
  assert.ok(v.sameGround, `sharedM ${v.sharedM.toFixed(0)} vs required ${v.requiredM.toFixed(0)}`);
});

test('the same track ridden the other way is the same ground', () => {
  const forward = loop(120, 30, 400, 120, 0, 6);
  const backward = [...loop(120, 30, 400, 120, 0, 6)].reverse();
  const v = verdict([forward], [backward]);
  assert.ok(v.sameGround);
});

test('two tracks 200 m apart are distinct even though their footprints nearly touch', () => {
  const a = loop(120, 30, 400, 120);
  const b = loop(120, 30 + 200 / M_PER_DEG_LAT, 400, 120);
  const v = verdict([a], [b]);
  assert.equal(v.sharedM, 0);
  assert.ok(!v.sameGround);
});

test('two rides sharing only a connector are distinct', () => {
  const shared = line(120, 30, 3000, 2);
  const east = line(120 + 3000 / mPerDegLng(30), 30, 7000, 2);
  const west: Run = [[120 - 7000 / mPerDegLng(30), 30], [120, 30]];
  const v = verdict([[...west, ...shared]], [[...shared, ...east]]);
  assert.ok(!v.sameGround, `sharedM ${v.sharedM.toFixed(0)} vs required ${v.requiredM.toFixed(0)}`);
});

/* ---------- D. the corridor is a knife edge, and that is visible here ---------- */

test('the corridor has no soft zone — 59 m in, 61 m out', () => {
  const base = line(120, 30, 3000, 2);
  const near = verdict([base], [line(120, 30, 3000, 2, 40)]);
  assert.equal(near.covAB, 1);
  assert.ok(near.sameGround);

  const far = verdict([base], [line(120, 30, 3000, 2, 90)]);
  assert.equal(far.covAB, 0);
  assert.ok(!far.sameGround);
});

/* ---------- E. GPS quality, and an asserted MISS ---------- */

test('the same trail recorded badly enough is missed, and that is the safe direction', () => {
  const clean = loop(120, 30, 12_000, 800);
  const noisy = loop(120, 30, 12_000, 800, 0, 100);
  const v = verdict([clean], [noisy]);
  // Asserted as a MISS on purpose: the errors run toward "no nudge", never toward a wrong
  // refusal. CORRIDOR_M is a wrangler var precisely so this is the number to move first.
  assert.ok(!v.sameGround, `100 m of wander should miss; sharedM ${v.sharedM.toFixed(0)}`);
});

/* ---------- F. pen lift and latitude ---------- */

test('a pen lift is never bridged', () => {
  const gapped: Run[] = [line(120, 30, 1000, 2), line(120 + 6000 / mPerDegLng(30), 30, 1000, 2)];
  const straight = [line(120, 30, 7000, 2)];
  const v = compare(resample(gapped).runs, resample(straight).runs, LIMITS)!;
  assert.equal(v.covAB, 1);
  // If a regression joined the runs, coverage from the long side would be 1.000.
  assert.ok(v.covBA < 0.45, `covBA ${v.covBA.toFixed(3)} — the gap is being bridged`);
  assert.ok(Math.abs(v.sharedM - 2000) < 60, `sharedM ${v.sharedM.toFixed(0)}`);
});

test('longitude is scaled by latitude — the bug that passes north-south and fails east-west', () => {
  const lat = 78.9;
  const nsA = line(20, lat, 2000, 2);
  const nsB = line(20, lat, 2000, 2, 90);
  assert.equal(verdict([nsA], [nsB]).covAB, 0);

  // The same 90 m, but east-west. Unscaled degrees make this look like 0.4 km.
  const ewA: Run = [
    [20, lat],
    [20, lat + 2000 / M_PER_DEG_LAT],
  ];
  const ewB: Run = [
    [20 + 90 / mPerDegLng(lat), lat],
    [20 + 90 / mPerDegLng(lat), lat + 2000 / M_PER_DEG_LAT],
  ];
  assert.equal(verdict([ewA], [ewB]).covAB, 0);

  // And identical traces up there still read as identical.
  assert.equal(verdict([nsA], [line(20, lat, 2000, 2)]).covAB, 1);
});

/* ---------- G. config ---------- */

test('a broken threshold falls back to its default, never to NaN', () => {
  const t = thresholds({ TRAIL_OVERLAP_SHARE_FRAC: 'abc', TRAIL_OVERLAP_FLOOR_M: '' });
  assert.equal(t.shareFrac, DEFAULTS.SHARE_FRAC);
  assert.equal(t.floorM, DEFAULTS.FLOOR_M);
});

test('the corridor cannot be configured below twice the sample spacing', () => {
  // Otherwise a trace could cross the corridor unseen between two samples.
  assert.equal(thresholds({ TRAIL_OVERLAP_CORRIDOR_M: '5' }).corridorM, SIG_SPACING_M * 2);
  assert.equal(thresholds({ TRAIL_OVERLAP_CORRIDOR_M: '9999' }).corridorM, 500);
});

test('the production defaults, pinned in exactly one place', () => {
  assert.equal(DEFAULTS.CORRIDOR_M, 60);
  assert.equal(DEFAULTS.SHARE_FRAC, 0.6);
  assert.equal(DEFAULTS.FLOOR_M, 300);
  assert.equal(SIG_SPACING_M, 25);
  assert.equal(SIG_MAX_POINTS, 2400);
  assert.equal(SIG_VERSION, 1);
  // The invariant the clamp exists to protect.
  assert.ok(SIG_SPACING_M <= DEFAULTS.CORRIDOR_M / 2);
});

test('shared ground is monotone — the property a ratio table does not have', () => {
  // Sliding one ride away from another must never make them look MORE alike.
  const base = line(120, 30, 4000, 2);
  let previous = Infinity;
  for (const offset of [0, 20, 40, 55, 70, 120, 400]) {
    const v = verdict([base], [line(120, 30, 4000, 2, offset)]);
    assert.ok(v.sharedM <= previous + 1e-9, `sharedM rose at ${offset} m offset`);
    previous = v.sharedM;
  }
});
