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
 * The decimation below exists only to bound memory and index cost.
 */

/** Points kept per trail. Past this, MapLibre's own per-zoom simplification is doing
    the visual work and extra points only cost memory. */
const MAX_POINTS = 2000;
/** Scanning stops here regardless of file size, so work is bounded by points and not
    only by bytes — a 10 MB file of nothing but coordinates is otherwise all cost. */
const SCAN_LIMIT = MAX_POINTS * 40;
/** Refuse a file larger than the forum itself accepts as an attachment. */
export const MAX_GPX_BYTES = 10 * 1024 * 1024;

/**
 * Reads an attribute out of an already-bounded tag slice, tolerating the whitespace
 * and single quotes XML permits. Done by hand rather than by regex so the parser has
 * exactly one acceptance rule and no backtracking anywhere.
 */
function attr(tag: string, name: string): number | null {
  let at = 0;
  for (;;) {
    at = tag.indexOf(name, at);
    if (at === -1) return null;
    const before = tag.charCodeAt(at - 1);
    // Must be a whole attribute name: preceded by space, and followed by optional
    // space then '='. Otherwise `lon` would match inside `lat`-like neighbours.
    if (at > 0 && (before === 32 || before === 9 || before === 10 || before === 13)) {
      let i = at + name.length;
      while (i < tag.length && (tag[i] === ' ' || tag[i] === '\t')) i++;
      if (tag[i] === '=') {
        i++;
        while (i < tag.length && (tag[i] === ' ' || tag[i] === '\t')) i++;
        const quote = tag[i];
        if (quote === '"' || quote === "'") {
          const end = tag.indexOf(quote, i + 1);
          if (end !== -1) {
            const value = Number(tag.slice(i + 1, end));
            return Number.isFinite(value) ? value : null;
          }
        }
      }
    }
    at += name.length;
  }
}

function scan(text: string, tag: string, closer: string): [number, number][][] {
  const open = `<${tag}`;
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  let i = 0;
  let seen = 0;
  // Hoisted: searching for the segment terminator inside the loop made this
  // O(points × filesize) — a single-segment 20,000-point ride took 5.4 seconds on the
  // main thread, and a 10 MB file took minutes. It is now one linear pass.
  let nextClose = closer ? text.indexOf(closer) : -1;

  for (;;) {
    const start = text.indexOf(open, i);
    if (start === -1) break;
    while (nextClose !== -1 && nextClose < start) {
      // A segment ended before this point: a pause, not a line.
      if (current.length >= 2) segments.push(current);
      current = [];
      nextClose = text.indexOf(closer, nextClose + closer.length);
    }
    const end = text.indexOf('>', start);
    if (end === -1) break;
    const head = text.slice(start, end);
    const lat = attr(head, 'lat');
    const lng = attr(head, 'lon');
    if (lat !== null && lng !== null) {
      current.push([lng, lat]);
      if (++seen >= SCAN_LIMIT) break;
    }
    i = end + 1;
  }
  if (current.length >= 2) segments.push(current);
  return segments;
}

/**
 * Thins to a global ceiling with a fractional accumulator, so the kept count lands
 * near `max` for any input instead of oscillating with an integer stride.
 *
 * Every segment costs at least its two endpoints, so a trace made of thousands of
 * short segments cannot be honoured in full — a 6,667-segment file needs 13,334
 * points before a single interior one is kept. When that happens the longest
 * segments win the budget and the rest are dropped, loudly, rather than blowing
 * through the ceiling silently.
 */
function decimate(segments: [number, number][][], max: number): [number, number][][] {
  const total = segments.reduce((n, seg) => n + seg.length, 0);
  if (total <= max) return segments;

  let drawable = segments;
  if (segments.length * 2 > max) {
    const room = Math.max(1, Math.floor(max / 2));
    const keep = new Set(
      [...segments.keys()].sort((a, b) => segments[b]!.length - segments[a]!.length).slice(0, room),
    );
    drawable = segments.filter((_, i) => keep.has(i));
    console.warn(`worldmap gpx: drew ${drawable.length} of ${segments.length} segments (point ceiling)`);
  }

  const kept = drawable.reduce((n, seg) => n + seg.length, 0);
  const rate = kept <= max ? 1 : max / kept;
  const out: [number, number][][] = [];
  let credit = 0;
  for (const seg of drawable) {
    const thinned: [number, number][] = [seg[0]!];
    for (let i = 1; i < seg.length - 1; i++) {
      credit += rate;
      if (credit >= 1) {
        credit -= 1;
        thinned.push(seg[i]!);
      }
    }
    // Always close the segment, or the trace stops short of where the ride did.
    if (seg.length > 1) thinned.push(seg[seg.length - 1]!);
    out.push(thinned);
  }
  return out;
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
  if (!resp.ok) {
    await resp.body?.cancel();
    throw new Error(`${resp.status} ${url}`);
  }

  const declared = Number(resp.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_GPX_BYTES) {
    // Release the socket rather than leaving the body dangling behind the throw.
    await resp.body?.cancel();
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
    // Decode before the cap check so a truncated multi-byte sequence is flushed by
    // the final stream-less decode rather than lost.
    text += decoder.decode(value, { stream: true });
    if (bytes > MAX_GPX_BYTES) {
      // The scanner recovers a usable prefix, which is why truncating beats rejecting.
      await reader.cancel();
      break;
    }
  }
  return text + decoder.decode();
}
