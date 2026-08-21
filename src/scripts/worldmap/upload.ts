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
import type { TrailStats } from './types';

/** Above the scanner's own ceiling, so the pre-flight measures the points as scanned
    rather than a decimated copy of them. */
const NO_DECIMATION = 1_000_000;

export type UploadReason =
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
  const bbox: [number, number, number, number] = [
    round(Math.min(...flat.map((c) => c[0])), 5),
    round(Math.min(...flat.map((c) => c[1])), 5),
    round(Math.max(...flat.map((c) => c[0])), 5),
    round(Math.max(...flat.map((c) => c[1])), 5),
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
      ele: null,
      time: null,
      gpx_bytes: file.size,
    },
  };
}

/** POSTs the file and the measurements the worker will trust. */
export async function uploadTrail(file: File, pre: Preflight): Promise<UploadResult | UploadReason> {
  const body = new FormData();
  body.set('file', file, file.name || 'ride.gpx');
  body.set('meta', JSON.stringify({ title: pre.title, distance_km: pre.distance_km, stats: pre.stats }));

  let resp: Response;
  try {
    resp = await fetch('/api/map/trail', { method: 'POST', body });
  } catch {
    return 'failed';
  }
  if (resp.status === 429) return 'rate_limited';
  if (resp.status === 413) return 'too_large';
  if (!resp.ok) return 'failed';
  try {
    return (await resp.json()) as UploadResult;
  } catch {
    return 'failed';
  }
}
