#!/usr/bin/env node
/**
 * WGS-84 → GCJ-02, for Amap links.
 *
 * Why this exists: every coordinate we store is WGS-84 — the CRM's
 * `tracks.latitude/longitude`, `/map/tracks.json`, a GPX file, a phone's raw fix. Amap
 * links carry `coordinate=gaode`, which is GCJ-02. Using a stored coordinate raw in an
 * Amap link puts the pin roughly half a kilometre off, and it looks close enough to ship.
 *
 * That has already happened once (a track post's link), which is why this is a script and
 * not a note in a runbook.
 *
 * Usage:
 *   node scripts/wgs84-to-gcj02.mjs 120.080339 30.816235
 *   node scripts/wgs84-to-gcj02.mjs --amap 120.080339 30.816235 "湖州越野杉野营地"
 *   node scripts/wgs84-to-gcj02.mjs --selftest
 *
 * The transform is the standard published one and is only defined inside China; outside
 * the country GCJ-02 is identical to WGS-84 and the offset is skipped. `--selftest`
 * checks it against a known-good pair rather than asserting the constants are typed right.
 */

const A = 6378245.0;            // Krasovsky 1940 semi-major axis
const EE = 0.00669342162296594; // its eccentricity squared

function outOfChina(lon, lat) {
  return !(lon > 73.66 && lon < 135.05 && lat > 3.86 && lat < 53.55);
}

function transformLat(x, y) {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  ret += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return ret;
}

function transformLon(x, y) {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  ret += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return ret;
}

/** @returns {[number, number]} `[lon, lat]` in GCJ-02. */
export function wgs84ToGcj02(lon, lat) {
  if (outOfChina(lon, lat)) return [lon, lat];
  let dLat = transformLat(lon - 105.0, lat - 35.0);
  let dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI);
  dLon = (dLon * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [lon + dLon, lat + dLat];
}

/** Metres between two lon/lat pairs. Only used to report self-test error. */
function metres(a, b) {
  const R = 6371008.8;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const x = dLon * Math.cos(lat);
  return Math.sqrt(x * x + dLat * dLat) * R;
}

function amapURL(lon, lat, name) {
  const q = new URLSearchParams({
    position: `${lon.toFixed(6)},${lat.toFixed(6)}`,
    name,
    src: 'dirtbikex',
    coordinate: 'gaode',
    callnative: '1',
  });
  // `position` must stay unencoded-comma to match the shape the app rewrites.
  return `https://uri.amap.com/marker?${q.toString().replace('%2C', ',')}`;
}

/**
 * The Tonglu post is a known-good WGS-84/GCJ-02 pair — its Amap link was produced by Amap
 * itself, so it is evidence rather than a second guess. If the transform reproduces it to
 * within a metre, it is right.
 */
const SELFTEST = {
  name: 'Tonglu',
  wgs84: [119.69926, 29.75491],
  expected: [119.704096, 29.752376],
  toleranceM: 1,
};

function selftest() {
  const got = wgs84ToGcj02(...SELFTEST.wgs84);
  const err = metres(got, SELFTEST.expected);
  const ok = err <= SELFTEST.toleranceM;
  console.log(`${SELFTEST.name}: wgs84 ${SELFTEST.wgs84.join(',')}`);
  console.log(`  expected gcj02 ${SELFTEST.expected.join(',')}`);
  console.log(`  got      gcj02 ${got[0].toFixed(6)},${got[1].toFixed(6)}`);
  console.log(`  error ${err.toFixed(2)} m — ${ok ? 'PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
}

const argv = process.argv.slice(2);
if (argv[0] === '--selftest') selftest();

const wantURL = argv[0] === '--amap';
const args = wantURL ? argv.slice(1) : argv;
const lon = Number(args[0]);
const lat = Number(args[1]);

if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
  console.error('usage: wgs84-to-gcj02.mjs [--amap] <lon> <lat> [name]');
  console.error('       wgs84-to-gcj02.mjs --selftest');
  console.error('note: lon first, lat second — the order Amap links use, not CLLocation order.');
  process.exit(2);
}

const [gLon, gLat] = wgs84ToGcj02(lon, lat);
if (wantURL) {
  console.log(amapURL(gLon, gLat, args[2] ?? 'DirtBikeX'));
} else {
  console.log(`${gLon.toFixed(6)},${gLat.toFixed(6)}`);
}
