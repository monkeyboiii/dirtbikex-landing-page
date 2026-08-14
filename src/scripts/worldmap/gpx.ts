/**
 * Turns a fetched .gpx into drawable segments, on demand.
 *
 * A hand-rolled scanner rather than DOMParser or a regex, for three measured reasons:
 * DOMParser retains roughly twelve times the file size in renderer memory and yields
 * nothing at all from a stream truncated by a byte cap; a regex can be made to
 * backtrack (this project has already taken a worker-CPU outage from one). The scanner
 * cannot backtrack by construction and recovers whatever prefix it was given.
 *
 * Simplification is deliberately NOT Douglas-Peucker here: MapLibre re-simplifies per
 * zoom level anyway, and DP costs several times more than simply handing it the points.
 * The stride decimation below exists only to bound memory and index cost.
 */

/** Points kept per trail. Past this, MapLibre's own per-zoom simplification is doing
    the visual work and extra points only cost memory. */
const MAX_POINTS = 2000;
/** Refuse a file larger than the forum itself accepts as an attachment. */
export const MAX_GPX_BYTES = 10 * 1024 * 1024;

/** Reads a double-quoted attribute out of an already-bounded tag slice. */
function attr(tag: string, name: string): number | null {
  const at = tag.indexOf(` ${name}="`);
  if (at === -1) return null;
  const from = at + name.length + 3;
  const to = tag.indexOf('"', from);
  if (to === -1) return null;
  const value = Number(tag.slice(from, to));
  return Number.isFinite(value) ? value : null;
}

function scan(text: string, tag: string, closer: string): [number, number][][] {
  const open = `<${tag}`;
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  let i = 0;

  for (;;) {
    const start = text.indexOf(open, i);
    if (start === -1) break;
    const boundary = closer ? text.indexOf(closer, i) : -1;
    if (boundary !== -1 && boundary < start) {
      // A segment ended before the next point: a pause, not a line.
      if (current.length >= 2) segments.push(current);
      current = [];
      i = boundary + closer.length;
      continue;
    }
    const end = text.indexOf('>', start);
    if (end === -1) break;
    const head = text.slice(start, end);
    const lat = attr(head, 'lat');
    const lng = attr(head, 'lon');
    if (lat !== null && lng !== null) current.push([lng, lat]);
    i = end + 1;
  }
  if (current.length >= 2) segments.push(current);
  return segments;
}

/** Fixed stride, keeping the last point of every segment so the trace still closes. */
function decimate(segments: [number, number][][], max: number): [number, number][][] {
  const total = segments.reduce((n, seg) => n + seg.length, 0);
  if (total <= max) return segments;
  const stride = Math.ceil(total / max);
  return segments.map((seg) => {
    const kept = seg.filter((_, i) => i % stride === 0);
    const last = seg[seg.length - 1]!;
    if (kept[kept.length - 1] !== last) kept.push(last);
    return kept;
  });
}

export function parseGpx(text: string, max = MAX_POINTS): [number, number][][] {
  // Track segments are a ridden line; routes are a plotted one. Prefer the former.
  const tracks = scan(text, 'trkpt', '</trkseg>');
  const segments = tracks.length ? tracks : scan(text, 'rtept', '</rte>');
  return decimate(segments, max);
}

/**
 * Fetches a GPX with a size ceiling. Content-Length is checked first so an oversized
 * file costs one round trip and zero body bytes; the streaming cap is the backstop for
 * a server that does not declare a length.
 */
export async function fetchGpx(url: string, signal: AbortSignal): Promise<string> {
  const resp = await fetch(url, { signal, credentials: 'omit' });
  if (!resp.ok) throw new Error(`${resp.status} ${url}`);

  const declared = Number(resp.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_GPX_BYTES) {
    throw new Error(`gpx too large: ${declared} bytes`);
  }
  if (!resp.body) return resp.text();

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_GPX_BYTES) {
      await reader.cancel();
      // The scanner recovers a usable prefix, which is why truncating beats rejecting.
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
