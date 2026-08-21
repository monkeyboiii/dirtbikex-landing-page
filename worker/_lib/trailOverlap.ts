/**
 * How much ground two rides share. See docs/TRAIL_OVERLAP_MODULE.md.
 *
 * The measure is bidirectional length-weighted corridor coverage, reduced to one number:
 *
 *   cov(A→B)  = length of A lying within CORRIDOR_M of the polyline B, over length(A)
 *   shared_m  = min( cov(A→B)·len(A) , cov(B→A)·len(B) )
 *   same      = shared_m ≥ max( FLOOR_M , SHARE_FRAC · min(len(A), len(B)) )
 *
 * It answers exactly one question: *how many metres of the same ground do these two rides
 * cover, and is that most of the shorter one?*
 *
 * Three things are load-bearing:
 *
 * - **`shared_m` is monotone.** It only rises as overlap rises. A verdict table built from
 *   two independent ratios is not, and has a band where "contained" reads as "different" —
 *   which you defeat by slicing one ride into six pins and publishing each. Containment IS
 *   same ground here, by construction.
 * - **`min()` of the two directed products discards the endcap bias.** A corridor has
 *   terminal half-discs, so coverage measured from the longer side always reads slightly
 *   high; the shorter side's product is the honest one and `min` picks it.
 * - **No polygon is ever built.** `pointInPolygon(p, buffer(L, D))` is by definition
 *   `dist(p, L) ≤ D` — a Minkowski buffer of a polyline by a disc is its D-sublevel set.
 *   So this is @turf/buffer's measure with none of @turf/buffer's cost: clamped
 *   point-to-segment algebra over a hash grid, and no dependency at all.
 *
 * This module imports NOTHING. Two reasons: it is shared between the Worker and the
 * browser bundle (the client computes the signature at upload, the Worker compares
 * signatures at publish) and the two must never disagree about spacing — a mismatch
 * produces silently wrong verdicts with no error. And Node's type stripping, which runs the
 * unit tests, requires explicit `.ts` extensions on relative specifiers; having none
 * sidesteps that entirely.
 */

/** Bumping this is how stale signatures become visibly incomparable instead of silently
    wrong. Any change to spacing, projection or codec must bump it. */
export const SIG_VERSION = 1;

/** Metres of arc length between resampled points. BAKED INTO EVERY STORED SIGNATURE:
    changing it makes new signatures incomparable with every existing row, with no error.
    That is why it is a code constant and not a wrangler var. Must stay ≤ CORRIDOR_M / 2,
    or a segment can cross the corridor between two samples without either sample seeing it. */
export const SIG_SPACING_M = 25;

/** ≈ 60 km of trace at 25 m spacing. Also the per-comparison CPU ceiling. Past this the
    step widens rather than truncating: losing resolution is recoverable, losing the tail
    is not, and the Worker can see that it happened. */
export const SIG_MAX_POINTS = 2400;

/** Above this the signature is "coarse" — sampled too widely to trust for a refusal. */
export const COARSE_SPACING_M = 30;

/** Defaults for every compare-time threshold. Each is overridable per environment; see
    docs/TRAIL_OVERLAP_MODULE.md § tunables. Read them through `thresholds()`, never
    directly, so a typo in config degrades to the default instead of to NaN. */
export const DEFAULTS = {
  /** The similarity threshold: how far apart two traces may be and still be one ride. */
  CORRIDOR_M: 60,
  /** Fraction of the SHORTER ride that must be shared. */
  SHARE_FRAC: 0.6,
  /** Absolute floor, so a car-park stub cannot claim a 50 km ride. */
  FLOOR_M: 300,
  /** Report an overlap at or above this many shared metres. */
  NUDGE_M: 500,
} as const;

export interface Thresholds {
  corridorM: number;
  shareFrac: number;
  floorM: number;
  nudgeM: number;
}

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

/**
 * Config in, usable numbers out. Every value is a string in wrangler vars, and a typo must
 * degrade to the default rather than to NaN — `NaN >= 0.6` is false, which would silently
 * disable the cap rather than loudly break it.
 */
export function thresholds(env: Record<string, unknown> = {}): Thresholds {
  const num = (key: string, fallback: number) => {
    const raw = env[key];
    // '' must read as absent, not as 0: Number('') is 0 and finite, so a blank var would
    // silently set a floor of zero — which is a real config, just never the intended one.
    if (raw === undefined || raw === null || raw === '') return fallback;
    const parsed = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    // Clamped so the SIG_SPACING_M ≤ CORRIDOR_M/2 invariant cannot be broken from config.
    corridorM: clamp(num('TRAIL_OVERLAP_CORRIDOR_M', DEFAULTS.CORRIDOR_M), SIG_SPACING_M * 2, 500),
    shareFrac: clamp(num('TRAIL_OVERLAP_SHARE_FRAC', DEFAULTS.SHARE_FRAC), 0, 1),
    floorM: Math.max(0, num('TRAIL_OVERLAP_FLOOR_M', DEFAULTS.FLOOR_M)),
    nudgeM: Math.max(0, num('TRAIL_OVERLAP_NUDGE_M', DEFAULTS.NUDGE_M)),
  };
}

/* ---------- geometry ---------- */

export type LngLat = [number, number];
/** One continuous stretch of riding. A `</trkseg>` is a pen lift, not a pause, and the two
    are never joined — bridging them would invent ground nobody rode. */
export type Run = LngLat[];

const R = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function metres(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Can this trace be signed at all?
 *
 * Two refusals, both honest rather than clever:
 *
 * - **An antimeridian crossing.** A bbox spanning more than 180° of longitude wraps, and
 *   every downstream number breaks the same way — `stats.centre` is a raw bbox midpoint, so
 *   a 180°-crossing trace already stores a centre in the Gulf of Guinea. That is a
 *   pre-existing bug in the map's own centre/bbox handling, not one this measure creates,
 *   and refusing to sign is one line rather than a pretence of having fixed it.
 * - **Above 85°.** cos(lat) collapses and the local frame stops being a frame.
 *
 * A null signature means **no verdict**, never "no overlap": the caller skips both the cap
 * and the nudge rather than guessing.
 */
export function signable(bbox: [number, number, number, number]): boolean {
  const [west, south, east, north] = bbox;
  if (![west, south, east, north].every(Number.isFinite)) return false;
  // Both spellings of a crossing: expanded (west 179.9, east 180.1) and wrapped
  // (west 179.9, east -179.9). The second is the one the map actually stores.
  if (east < west || east - west > 180) return false;
  return Math.abs(south) <= 85 && Math.abs(north) <= 85;
}

export interface Resampled {
  runs: Run[];
  /** Total ridden length in metres, summed within runs only. */
  lengthM: number;
  /** Actual spacing achieved. Above COARSE_SPACING_M the trace was too long for the budget. */
  spacingM: number;
  points: number;
}

/**
 * Fixed ARC LENGTH, not a fixed point count.
 *
 * This is the property the whole measure rests on: the same road drawn with two vertices
 * and with five hundred resamples to the same points, so coverage is a statement about
 * ground rather than about how densely somebody's recorder happened to sample.
 */
export function resample(runs: Run[], spacingM = SIG_SPACING_M, maxPoints = SIG_MAX_POINTS): Resampled {
  const usable = runs.filter((r) => r.length > 1);
  if (!usable.length) return { runs: [], lengthM: 0, spacingM, points: 0 };

  let total = 0;
  for (const run of usable) for (let i = 1; i < run.length; i++) total += metres(run[i - 1]!, run[i]!);
  if (total <= 0) return { runs: [], lengthM: 0, spacingM, points: 0 };

  // Widen rather than truncate. Every run costs BOTH its endpoints before a single
  // interior sample is spent, so the budget is what is left after paying for all of them —
  // counting one per run overshoots the ceiling by exactly one point per run.
  let step = spacingM;
  const budget = Math.max(1, maxPoints - 2 * usable.length);
  if (total / spacingM > budget) step = total / budget;

  const out: Run[] = [];
  let points = 0;
  for (const run of usable) {
    const line: Run = [run[0]!];
    let carry = 0;
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1]!;
      const b = run[i]!;
      const seg = metres(a, b);
      if (seg <= 0) continue;
      let at = step - carry;
      while (at < seg) {
        const t = at / seg;
        line.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        at += step;
      }
      carry = (carry + seg) % step;
    }
    const last = run[run.length - 1]!;
    const tail = line[line.length - 1]!;
    // Always close on the real end, or the trace stops short of where the ride did.
    if (tail[0] !== last[0] || tail[1] !== last[1]) line.push(last);
    out.push(line);
    points += line.length;
  }
  return { runs: out, lengthM: total, spacingM: step, points };
}

/* ---------- codec ---------- */

/**
 * Google encoded polyline, precision 5 (~1.1 m), one polyline per run, joined by `;`.
 *
 * The alphabet is bytes 63–126, so `;` (0x3B) can never occur inside a polyline and the
 * split is unambiguous without escaping.
 */
export function encodeSig(runs: Run[]): string {
  return runs.map(encodeLine).join(';');
}

export function decodeSig(sig: string): Run[] {
  if (!sig) return [];
  return sig.split(';').map(decodeLine);
}

function encodeLine(line: Run): string {
  let out = '';
  let lastLng = 0;
  let lastLat = 0;
  for (const [lng, lat] of line) {
    const y = Math.round(lat * 1e5);
    const x = Math.round(lng * 1e5);
    out += encodeNumber(y - lastLat) + encodeNumber(x - lastLng);
    lastLat = y;
    lastLng = x;
  }
  return out;
}

function encodeNumber(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

function decodeLine(text: string): Run {
  const line: Run = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < text.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = text.charCodeAt(i++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && i < text.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = text.charCodeAt(i++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && i < text.length);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    line.push([lng / 1e5, lat / 1e5]);
  }
  return line;
}

/* ---------- the measure ---------- */

interface Frame {
  lng0: number;
  lat0: number;
  mx: number;
  my: number;
}

/**
 * One shared local frame for both traces, so x and y are both metres.
 *
 * Comparing raw degrees is the classic bug here and it hides at low latitude: a degree of
 * longitude is 111 km at the equator and 21 km at 79° N, so an unscaled comparison passes a
 * north–south test and fails the east–west one at the same separation.
 */
function frameFor(lat: number): Frame {
  return {
    lng0: 0,
    lat0: 0,
    mx: (Math.PI / 180) * R * Math.cos(rad(lat)),
    my: (Math.PI / 180) * R,
  };
}

const projX = (lng: number, f: Frame) => (lng - f.lng0) * f.mx;
const projY = (lat: number, f: Frame) => (lat - f.lat0) * f.my;

/** Squared distance from a point to a segment, with the parameter clamped to the segment —
    which is what makes the corridor a stadium rather than an infinite band. */
function segDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len > 0 ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

interface Grid {
  cell: number;
  buckets: Map<number, number[]>;
  ax: Float64Array;
  ay: Float64Array;
  bx: Float64Array;
  by: Float64Array;
}

/** A uniform hash grid over one trace's segments. Cell size is the corridor, so a query
    only ever touches the 3×3 neighbourhood. */
function buildGrid(runs: Run[], f: Frame, cell: number): Grid {
  const ax: number[] = [];
  const ay: number[] = [];
  const bx: number[] = [];
  const by: number[] = [];
  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      ax.push(projX(run[i - 1]![0], f));
      ay.push(projY(run[i - 1]![1], f));
      bx.push(projX(run[i]![0], f));
      by.push(projY(run[i]![1], f));
    }
  }
  const grid: Grid = {
    cell,
    buckets: new Map(),
    ax: Float64Array.from(ax),
    ay: Float64Array.from(ay),
    bx: Float64Array.from(bx),
    by: Float64Array.from(by),
  };
  for (let i = 0; i < grid.ax.length; i++) {
    const x0 = Math.floor(Math.min(grid.ax[i]!, grid.bx[i]!) / cell);
    const x1 = Math.floor(Math.max(grid.ax[i]!, grid.bx[i]!) / cell);
    const y0 = Math.floor(Math.min(grid.ay[i]!, grid.by[i]!) / cell);
    const y1 = Math.floor(Math.max(grid.ay[i]!, grid.by[i]!) / cell);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = x * 73_856_093 + y * 19_349_663;
        const bucket = grid.buckets.get(key);
        if (bucket) bucket.push(i);
        else grid.buckets.set(key, [i]);
      }
    }
  }
  return grid;
}

function nearGrid(px: number, py: number, grid: Grid, dSq: number): boolean {
  const cx = Math.floor(px / grid.cell);
  const cy = Math.floor(py / grid.cell);
  for (let x = cx - 1; x <= cx + 1; x++) {
    for (let y = cy - 1; y <= cy + 1; y++) {
      const bucket = grid.buckets.get(x * 73_856_093 + y * 19_349_663);
      if (!bucket) continue;
      for (const i of bucket) {
        if (segDistSq(px, py, grid.ax[i]!, grid.ay[i]!, grid.bx[i]!, grid.by[i]!) <= dSq) return true;
      }
    }
  }
  return false;
}

/**
 * The fraction of `runs`'s length that lies within `corridorM` of the trace the grid holds.
 *
 * Each vertex carries half the length to each of its neighbours, so the weights sum to the
 * trace's own length and coverage lands in [0, 1]. Because the resampling guarantees a
 * vertex at least every SIG_SPACING_M, and SIG_SPACING_M ≤ corridor/2, no stretch can cross
 * the corridor unseen between two samples.
 */
function coverage(runs: Run[], f: Frame, grid: Grid, corridorM: number): { covered: number; total: number } {
  const dSq = corridorM * corridorM;
  let covered = 0;
  let total = 0;
  for (const run of runs) {
    if (run.length < 2) continue;
    const xs = run.map((p) => projX(p[0], f));
    const ys = run.map((p) => projY(p[1], f));
    const seg: number[] = [];
    for (let i = 1; i < run.length; i++) {
      seg.push(Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!));
    }
    for (let i = 0; i < run.length; i++) {
      const before = i > 0 ? seg[i - 1]! / 2 : 0;
      const after = i < seg.length ? seg[i]! / 2 : 0;
      const weight = before + after;
      total += weight;
      if (weight > 0 && nearGrid(xs[i]!, ys[i]!, grid, dSq)) covered += weight;
    }
  }
  return { covered, total };
}

export interface Overlap {
  /** Metres of ground both rides cover. The only quantity a caller should threshold on. */
  sharedM: number;
  /** Directed coverages, for reporting and for tests. */
  covAB: number;
  covBA: number;
  lengthA: number;
  lengthB: number;
  /** The floor this pair had to clear. */
  requiredM: number;
  sameGround: boolean;
}

/**
 * Compare two already-resampled traces. Returns null when either side has no measurable
 * geometry — a null is "no verdict", and every caller must treat it as "do nothing" rather
 * than as "no overlap".
 */
export function compare(a: Run[], b: Run[], limits: Thresholds = thresholds()): Overlap | null {
  const usableA = a.filter((r) => r.length > 1);
  const usableB = b.filter((r) => r.length > 1);
  if (!usableA.length || !usableB.length) return null;

  // One frame for both, anchored on the pair so neither is distorted relative to the other.
  let latSum = 0;
  let latCount = 0;
  for (const runs of [usableA, usableB]) {
    for (const run of runs) {
      for (const p of run) {
        latSum += p[1];
        latCount++;
      }
    }
  }
  const f = frameFor(latSum / latCount);

  const gridB = buildGrid(usableB, f, limits.corridorM);
  const gridA = buildGrid(usableA, f, limits.corridorM);
  const ab = coverage(usableA, f, gridB, limits.corridorM);
  const ba = coverage(usableB, f, gridA, limits.corridorM);
  if (ab.total <= 0 || ba.total <= 0) return null;

  const covAB = ab.covered / ab.total;
  const covBA = ba.covered / ba.total;
  // min() of the two directed PRODUCTS, not of the two ratios: the longer side's corridor
  // has terminal half-discs that inflate its reading, and this discards them for free.
  const sharedM = Math.min(covAB * ab.total, covBA * ba.total);
  const requiredM = Math.max(limits.floorM, limits.shareFrac * Math.min(ab.total, ba.total));

  return {
    sharedM,
    covAB,
    covBA,
    lengthA: ab.total,
    lengthB: ba.total,
    requiredM,
    sameGround: sharedM >= requiredM,
  };
}

/** Convenience for callers holding encoded signatures rather than geometry. */
export function compareSignatures(a: string | null, b: string | null, limits: Thresholds = thresholds()): Overlap | null {
  if (!a || !b) return null;
  return compare(decodeSig(a), decodeSig(b), limits);
}
