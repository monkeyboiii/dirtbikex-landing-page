/**
 * Visitor trail upload — the client half. See docs/TRAIL_UPLOAD_MODULE.md.
 *
 * Everything expensive happens here rather than at the edge: the worker runs on the free
 * plan's ~10 ms CPU budget and cannot parse a 10 MB file, so it re-checks only the cheap
 * invariants and trusts these numbers to draw with. That is proportionate for content that
 * expires in 72 hours and is link-only until somebody claims it.
 *
 * The three rejection rules are not ours. They are what gpx.studio does with a bad file
 * (discourse-dbx-gpx-preview/RESEARCH.md): route points throw inside its statistics
 * constructor even alongside a valid track, a waypoint-only file throws nothing at all and
 * silently draws nothing, and a zero-extent trace renders blank at 0.00 km. Refusing them
 * here is what stops a trail that the forum embed would not be able to show.
 */
import { MAX_GPX_BYTES, parseGpx } from './gpx';
// The first src/ -> worker/ import in this repo, and a deliberate one: the browser computes
// the overlap signature and the Worker compares it, and the two must never disagree about
// spacing or codec — a mismatch produces silently wrong verdicts with no error. Duplicating
// the constants is how that mismatch would happen. The module imports nothing itself.
import { SIG_VERSION, encodeSig, resample, signable } from '../../../worker/_lib/trailOverlap';
import type { TrailStats } from './types';

/** Above the scanner's own ceiling, so the pre-flight measures the points as scanned
    rather than a decimated copy of them. */
const NO_DECIMATION = 1_000_000;
/** Matches gpx.ts's SCAN_LIMIT. The rich pass walks the same tags and must stop with it. */
const RICH_LIMIT = 80_000;

export type UploadReason =
  | 'uploads_disabled'
  | 'challenge_failed'
  | 'too_large'
  | 'no_track'
  | 'route_points'
  | 'empty'
  | 'rate_limited'
  | 'failed';

export interface UploadResult {
  id: string;
  secret: string;
  claim_code: string;
  expires_in_hours: number;
  map_url: string;
  claim_url: string;
}

export interface Preflight {
  title: string;
  distance_km: number;
  stats: TrailStats;
  /**
   * The overlap signature: a 25 m resampling of the trace, Google-encoded. Null when the
   * trace cannot be signed — across the antimeridian, or near a pole.
   *
   * A null signature means **no verdict**, never "no overlap": the Worker skips both the
   * publish cap and the duplicate nudge rather than guessing. It is sent as a top-level
   * `meta` field and stored in its own column, NOT inside `stats` — toEntry() copies stats
   * verbatim into the public map document, which is measured at 676 B/entry.
   */
  sig: string | null;
  sigVersion: number;
  sigLengthM: number;
  sigCoarse: boolean;
}

const R = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Haversine. Distance is shown to one decimal of a kilometre, so the sphere is enough. */
function metres(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const round = (n: number, places: number) => Number(n.toFixed(places));

/**
 * A second, bounded pass that reads what the coordinate scanner deliberately does not:
 * the `<ele>` and `<time>` children of each trackpoint.
 *
 * gpx.ts reads attributes off the `<trkpt ...>` open tag and never descends into it, which
 * is right for drawing a line and wrong for describing a ride. Without these an uploaded
 * trail has no climb and no date — and, worse, the sheet labelled every upload a "Plotted
 * route", which is the one thing the pre-flight exists to reject.
 *
 * Same discipline as the scanner it complements: indexOf only, no regex that can
 * backtrack, terminators hoisted out of the loop, and a hard point ceiling.
 */
interface Run {
  ele: (number | null)[];
  at: (number | null)[];
}

function richScan(text: string): Run[] {
  const OPEN = '<trkpt';
  const SEG_END = '</trkseg>';
  const runs: Run[] = [];
  let current: Run | null = null;
  let at = 0;
  let points = 0;

  const child = (body: string, tag: string): string | null => {
    const open = body.indexOf(`<${tag}`);
    if (open === -1) return null;
    const gt = body.indexOf('>', open);
    if (gt === -1) return null;
    const close = body.indexOf(`</${tag}>`, gt);
    return close === -1 ? null : body.slice(gt + 1, close);
  };

  while (points < RICH_LIMIT) {
    const start = text.indexOf(OPEN, at);
    if (start === -1) break;

    // A </trkseg> between the previous point and this one is a pen lift, not a pause, so
    // the runs stay separate and nothing is measured across the gap.
    const segEnd = text.indexOf(SEG_END, at);
    if (!current || (segEnd !== -1 && segEnd < start)) {
      current = { ele: [], at: [] };
      runs.push(current);
    }

    const gt = text.indexOf('>', start);
    if (gt === -1) break;
    // A self-closing trackpoint has no children at all, which is legal and common.
    const body = text.charCodeAt(gt - 1) === 47 ? '' : (() => {
      const close = text.indexOf('</trkpt>', gt);
      return close === -1 ? '' : text.slice(gt + 1, close);
    })();

    const eleText = body ? child(body, 'ele') : null;
    const timeText = body ? child(body, 'time') : null;
    const ele = eleText === null ? NaN : Number(eleText);
    const stamp = timeText === null ? NaN : Date.parse(timeText);
    current.ele.push(Number.isFinite(ele) ? ele : null);
    current.at.push(Number.isFinite(stamp) ? stamp : null);
    points++;
    at = gt + 1;
  }
  return runs;
}

/**
 * Consumer GPS wanders vertically at rest, so a naive sum invents climb nobody rode.
 * Same rule and the same constants as scripts/lib/gpx-trail.mjs, deliberately: an uploaded
 * trail and an imported one must not disagree about the same file.
 */
function ascentOf(runs: Run[]): number | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const run of runs) {
    for (const ele of run.ele) {
      if (ele == null) continue;
      if (ele < lo) lo = ele;
      if (ele > hi) hi = ele;
    }
  }
  // Keeps "flat" distinguishable from "unknown": below the noise floor we say nothing.
  if (!Number.isFinite(lo) || hi - lo < 20) return null;
  let total = 0;
  for (const run of runs) {
    let anchor: number | null = null;
    for (const ele of run.ele) {
      if (ele == null) continue;
      if (anchor == null) {
        anchor = ele;
        continue;
      }
      if (ele - anchor >= 3) {
        total += ele - anchor;
        anchor = ele;
      } else if (anchor - ele >= 3) anchor = ele;
    }
  }
  return total > 0 ? Math.round(total) : null;
}

/**
 * Parses and measures the file, or names the reason it cannot be shown. Returns the same
 * stats shape `scripts/lib/gpx-trail.mjs` emits, so a visitor upload and an operator import
 * produce one entry format — with two fields it cannot fill: the scanner reads coordinates
 * out of trackpoint attributes and never sees `<ele>` or `<time>`, so an uploaded trail
 * carries no climb and no recorded date until somebody imports it properly.
 */
export function preflight(file: File, text: string): Preflight | UploadReason {
  if (file.size > MAX_GPX_BYTES) return 'too_large';
  // Checked before parsing: gpx.studio refuses a file with route points even when a
  // perfectly good <trk> sits beside them, so finding a track first would be misleading.
  if (text.includes('<rtept')) return 'route_points';
  if (!text.includes('<trkpt')) return 'no_track';

  const segments = parseGpx(text, NO_DECIMATION).filter((s) => s.length > 1);
  if (!segments.length) return 'no_track';

  const flat = segments.flat();
  // A loop, not Math.min(...flat) — the scanner allows up to 80,000 points and spreading
  // that many arguments overflows the call stack in every engine.
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of flat) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  const bbox: [number, number, number, number] = [
    round(west, 5),
    round(south, 5),
    round(east, 5),
    round(north, 5),
  ];
  // Every point identical: gpx.studio's third failure, and a dead pin on our map.
  if (bbox[0] === bbox[2] && bbox[1] === bbox[3]) return 'empty';

  let total = 0;
  for (const seg of segments) for (let i = 1; i < seg.length; i++) total += metres(seg[i - 1]!, seg[i]!);

  // Same rule as the importer: a loop is only claimed on a single segment, because on a
  // multi-segment trace the return leg can hide in the gap between two of them.
  const closure = metres(segments[0]![0]!, segments.at(-1)!.at(-1)!);
  const shape =
    closure > 0.15 * total
      ? ('point_to_point' as const)
      : closure < 250 && closure < 0.05 * total && segments.length === 1
        ? ('loop' as const)
        : null;

  // What the coordinate scanner threw away. Without it the sheet has no climb, no date,
  // and — because "no recorded time" is what it renders as — labels a genuine ride a
  // "Plotted route", which is precisely what the pre-flight above refuses to accept.
  const runs = richScan(text);
  const stamps: number[] = [];
  for (const run of runs) for (const t of run.at) if (t != null) stamps.push(t);
  const first = stamps.length ? Math.min(stamps[0]!, stamps[stamps.length - 1]!) : null;
  const last = stamps.length ? Math.max(stamps[0]!, stamps[stamps.length - 1]!) : null;
  // Falls back to <metadata><time>, which many recorders write even when the points do not.
  const metaTime = ((): number | null => {
    const open = text.indexOf('<metadata');
    if (open === -1) return null;
    const close = text.indexOf('</metadata>', open);
    if (close === -1) return null;
    const block = text.slice(open, close);
    const t = block.indexOf('<time');
    if (t === -1) return null;
    const gt = block.indexOf('>', t);
    const end = block.indexOf('</time>', gt);
    if (gt === -1 || end === -1) return null;
    const parsed = Date.parse(block.slice(gt + 1, end));
    return Number.isFinite(parsed) ? parsed : null;
  })();

  const recordedAt = first ?? metaTime;
  const ascent = ascentOf(runs);

  const signed = signable(bbox) ? resample(segments) : null;
  const sig = signed && signed.runs.length ? encodeSig(signed.runs) : null;

  return {
    // The filename is the only title a visitor gives us, and it is usually the date the
    // recorder wrote. Better than "ride.gpx" as a heading, and they can rename on claim.
    title: (file.name || '').replace(/\.gpx$/i, '').slice(0, 120).trim(),
    distance_km: round(total / 1000, 1),
    stats: {
      segments: segments.length,
      points: flat.length,
      bbox,
      centre: [round((bbox[0] + bbox[2]) / 2, 5), round((bbox[1] + bbox[3]) / 2, 5)],
      shape,
      ele: { ascent_m: ascent },
      time: {
        recorded_at: recordedAt == null ? null : new Date(recordedAt).toISOString(),
        // Moving time needs a per-point speed gate; the importer does it, this does not.
        // Null is honest — the sheet only renders it when it is there.
        moving_s: null,
        elapsed_s: first != null && last != null ? Math.round((last - first) / 1000) : null,
        source: first != null ? 'trkpt' : metaTime != null ? 'metadata' : null,
      },
      gpx_bytes: file.size,
    },
    sig,
    sigVersion: SIG_VERSION,
    sigLengthM: signed ? Math.round(signed.lengthM) : 0,
    // Sampled more widely than 25 m because the ride was too long for the point budget.
    // Such a trail can still be REPORTED as an overlap but must never be refused on one.
    sigCoarse: !!signed && signed.spacingM > 30,
  };
}

export type UploadPhase = 'sending' | 'finishing';

/**
 * POSTs the file and the measurements the worker will trust.
 *
 * XMLHttpRequest rather than fetch, for one reason: `xhr.upload.onprogress` is the only
 * way a browser will tell you how many bytes of a request body have actually left. fetch
 * cannot report request progress at all — streaming request bodies need `duplex: 'half'`,
 * which is Chromium-only and does not apply to a FormData body anyway. A progress bar that
 * cannot see the upload is a spinner wearing a costume, so this uses the API that can.
 *
 * Once the last byte is sent the bar has nothing true left to report: the worker is
 * talking to Discourse and the browser is simply waiting. That is what 'finishing' means,
 * and the caller shows it as indeterminate rather than inventing a number.
 */
export function uploadTrail(
  file: File,
  pre: Preflight,
  onProgress?: (phase: UploadPhase, ratio: number | null) => void,
  turnstileToken?: string | null,
): Promise<UploadResult | UploadReason> {
  const body = new FormData();
  body.set('file', file, file.name || 'ride.gpx');
  body.set(
    'meta',
    JSON.stringify({
      title: pre.title,
      distance_km: pre.distance_km,
      stats: pre.stats,
      // Top level, never inside stats — see Preflight.sig.
      sig: pre.sig,
      sig_v: pre.sigVersion,
      sig_len_m: pre.sigLengthM,
      sig_coarse: pre.sigCoarse,
    }),
  );
  // Absent unless the operator configured Turnstile. The worker skips verification when
  // it has no secret, so an absent token is a working upload, not a rejected one.
  if (turnstileToken) body.set('turnstile', turnstileToken);

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/map/trail');
    xhr.responseType = 'text';

    xhr.upload.addEventListener('progress', (e) => {
      onProgress?.('sending', e.lengthComputable && e.total > 0 ? e.loaded / e.total : null);
    });
    // The body is gone; everything after this is somebody else's round trip.
    xhr.upload.addEventListener('load', () => onProgress?.('finishing', null));

    xhr.addEventListener('load', () => {
      if (xhr.status === 429) return resolve('rate_limited');
      // The kill switch, learned the hard way: the button may have been drawn before the
      // door shut, so the answer has to come back through this path too.
      if (xhr.status === 503) return resolve('uploads_disabled');
      if (xhr.status === 403) return resolve('challenge_failed');
      if (xhr.status === 413) return resolve('too_large');
      if (xhr.status < 200 || xhr.status >= 300) return resolve('failed');
      try {
        resolve(JSON.parse(xhr.responseText) as UploadResult);
      } catch {
        resolve('failed');
      }
    });
    xhr.addEventListener('error', () => resolve('failed'));
    xhr.addEventListener('abort', () => resolve('failed'));
    xhr.addEventListener('timeout', () => resolve('failed'));

    xhr.send(body);
  });
}
