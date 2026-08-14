import type { PagesEnv } from './types';
import { resolveCanonical } from './shortlink';

/**
 * Link previews for episode sheets — the iMessage/Slack treatment.
 *
 * The social platforms only emit their Open Graph tags to a crawler UA, and their
 * og:image lives on a third-party CDN. Both problems are solved server-side: the
 * worker crawls, then inlines the image as a data URI so the page never reaches
 * off-origin (the mainland-China invariant, README.md).
 *
 * This route takes a caller-supplied URL, so it is an SSRF surface. Every hop is
 * re-checked against the allowlist (the seeded links are all redirectors, so
 * redirects can't be refused outright), image hosts have their own allowlist, and
 * both reads are capped while streaming rather than after buffering.
 *
 * Coverage is uneven by design — TikTok and Instagram answer, Douyin and Facebook
 * serve a wall. Callers pass several candidate URLs and take the first that works.
 */
const ALLOWED_HOSTS: RegExp[] = [
  /(^|\.)tiktok\.com$/,
  /(^|\.)douyin\.com$/,
  /(^|\.)iesdouyin\.com$/,
  /(^|\.)instagram\.com$/,
  /(^|\.)facebook\.com$/,
  /(^|\.)fb\.watch$/,
];

/** Where those platforms actually serve their og:image from. */
const ALLOWED_IMAGE_HOSTS: RegExp[] = [
  ...ALLOWED_HOSTS,
  /(^|\.)tiktokcdn(-[a-z]+)?\.com$/,
  /(^|\.)cdninstagram\.com$/,
  /(^|\.)fbcdn\.net$/,
  /(^|\.)douyinpic\.com$/,
  /(^|\.)pstatp\.com$/,
  /(^|\.)ibyteimg\.com$/,
];

const SAFE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

const CRAWLER_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
/** Douyin serves the crawler UA a wall; it answers a mobile browser, which is the
 *  UA the shortlink resolver already uses successfully. */
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const MAX_HTML_BYTES = 300_000;
const MAX_IMAGE_BYTES = 250_000;
const MAX_HOPS = 4;
const EDGE_TTL = 21_600; // 6h — a published post's card doesn't move.
const MAX_CANDIDATES = 4;

declare const caches: {
  default: { match(r: Request): Promise<Response | undefined>; put(r: Request, resp: Response): Promise<void> };
};

export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

type Reason = 'no_candidates' | 'fetch_failed' | 'no_tags';

interface Preview {
  ok: true;
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site: string | null;
}

function permitted(raw: string, list: RegExp[]): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return list.some((re) => re.test(url.hostname)) ? url : null;
  } catch {
    return null;
  }
}

/**
 * Follows redirects by hand so every hop can be re-checked — `redirect: 'follow'`
 * would let an allowlisted host bounce us anywhere.
 */
async function fetchChecked(
  start: URL,
  list: RegExp[],
  headers: Record<string, string>,
): Promise<{ resp: Response; url: URL } | null> {
  let url = start;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let resp: Response;
    try {
      resp = await fetch(url.toString(), { redirect: 'manual', headers });
    } catch {
      return null;
    }
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location');
      if (!location) return null;
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        return null;
      }
      const checked = permitted(next.toString(), list);
      if (!checked) return null;
      url = checked;
      continue;
    }
    return resp.ok ? { resp, url } : null;
  }
  return null;
}

/**
 * Reads at most `max` bytes, capping mid-stream rather than buffering first.
 * `truncate` keeps the prefix (HTML — Instagram ships well over 300KB and the OG
 * tags are in the head); without it an oversized body is refused outright, which
 * is what we want for an image that would be useless half-read.
 */
async function readCapped(resp: Response, max: number, truncate = false): Promise<Uint8Array | null> {
  const declared = Number(resp.headers.get('content-length') ?? '');
  if (!truncate && Number.isFinite(declared) && declared > max) return null;

  const reader = resp.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.byteLength > max) {
      if (truncate) {
        chunks.push(value.subarray(0, max - total));
        total = max;
      }
      await reader.cancel().catch(() => {});
      if (!truncate) return null;
      break;
    }
    total += value.byteLength;
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

function decodeEntities(value: string): string {
  const codePoint = (raw: string, radix: number) => {
    try {
      const n = parseInt(raw, radix);
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    } catch {
      return '';
    }
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(hex, 16))
    .replace(/&#(\d+);/g, (_, dec) => codePoint(dec, 10))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Collects the head's meta tags once.
 *
 * Earlier versions regexed the whole document per property. A non-greedy
 * `content=(["'])([\s\S]*?)\1` that finds no match backtracks across the entire
 * body at every start position — on Facebook's wall page that blew the worker's
 * CPU limit (error 1102). Scanning bounded `<meta …>` tags and reading their
 * attributes is linear and can't backtrack.
 */
function attr(tag: string, name: string): string | null {
  const hit = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  if (!hit) return null;
  return hit[2] ?? hit[3] ?? hit[4] ?? null;
}

function collectMeta(html: string): Map<string, string> {
  const end = html.indexOf('</head>');
  const head = end > 0 ? html.slice(0, end) : html;
  const out = new Map<string, string>();
  for (const match of head.matchAll(/<meta\b[^>]{0,3000}>/gi)) {
    const tag = match[0];
    const key = (attr(tag, 'property') ?? attr(tag, 'name'))?.toLowerCase();
    const content = attr(tag, 'content');
    if (key && content != null && !out.has(key)) out.set(key, decodeEntities(content).trim());
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function inlineImage(src: string): Promise<string | null> {
  const url = permitted(src, ALLOWED_IMAGE_HOSTS);
  if (!url) return null;
  const hit = await fetchChecked(url, ALLOWED_IMAGE_HOSTS, { 'User-Agent': CRAWLER_UA, Accept: 'image/*' });
  if (!hit) return null;
  const declared = (hit.resp.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const type = SAFE_IMAGE_TYPES.has(declared) ? declared : null;
  if (!type) return null;
  const bytes = await readCapped(hit.resp, MAX_IMAGE_BYTES).catch(() => null);
  return bytes ? `data:${type};base64,${toBase64(bytes)}` : null;
}

/**
 * TikTok's og:title is just "TikTok · <author>"; its public oEmbed carries the real
 * caption. No key required — this is the same endpoint embed widgets use.
 */
async function tiktokOembed(url: URL): Promise<{ title?: string; thumbnail_url?: string } | null> {
  try {
    const resp = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url.toString())}`, {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) return null;
    return (await resp.json()) as { title?: string; thumbnail_url?: string };
  } catch {
    return null;
  }
}

/** Douyin share/redirector pages carry no Open Graph tags; the canonical
    `www.douyin.com/video/{id}` is the page worth crawling. Uses the same resolver
    the forum's native-embed component reaches through /api/resolve/shortlink. */
const DOUYIN_HOST = /(^|\.)(douyin|iesdouyin)\.com$/;

async function previewOne(target: URL, trace: string[]): Promise<Preview | null> {
  const douyin = DOUYIN_HOST.test(target.hostname);
  const hit = await fetchChecked(target, ALLOWED_HOSTS, {
    'User-Agent': douyin ? MOBILE_UA : CRAWLER_UA,
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Language': douyin ? 'zh-CN,zh;q=0.9' : 'en,zh;q=0.8',
  });
  if (!hit) {
    trace.push(`${target.hostname}=unreachable`);
    return null;
  }

  const bytes = await readCapped(hit.resp, MAX_HTML_BYTES, true).catch(() => null);
  if (!bytes) {
    trace.push(`${hit.url.hostname}=unreadable`);
    return null;
  }
  const html = new TextDecoder().decode(bytes);
  const tags = collectMeta(html);
  const pick = (...keys: string[]) => keys.map((k) => tags.get(k)).find((v) => !!v) ?? null;

  let title = pick('og:title', 'twitter:title');
  let image = pick('og:image', 'twitter:image');
  let description = pick('og:description', 'twitter:description');
  const site = pick('og:site_name');

  if (/(^|\.)tiktok\.com$/.test(hit.url.hostname)) {
    const oembed = await tiktokOembed(hit.url);
    if (oembed?.title) {
      description = title && title !== oembed.title ? title : description;
      title = oembed.title;
    }
    if (!image && oembed?.thumbnail_url) image = oembed.thumbnail_url;
  }

  if (douyin) {
    // The canonical page is a JS shell with no OG tags; its cover still appears as
    // a CDN URL in the server-rendered payload. Bounded patterns only.
    if (!image) {
      const cover = html.match(/https:(?:\\?\/){2}[^"'\\\s]{0,200}?(?:douyinpic|byteimg)\.com\/[^"'\\\s]{0,300}/);
      if (cover) image = cover[0].replace(/\\\//g, '/');
    }
    if (!title) title = html.match(/<title[^>]{0,200}>([^<]{1,300})<\/title>/i)?.[1]?.trim() ?? null;
    // Outside China the worker only gets a shell: site boilerplate for a title and
    // no cover. A card saying "record beautiful life on Douyin" is worse than none,
    // so fall through and let the slide show the brand mark instead.
    if (!image && (!title || /抖音\s*$|^在抖音记录美好生活/.test(title))) {
      trace.push(`${hit.url.hostname}=shell`);
      return null;
    }
  }

  trace.push(`${hit.url.hostname}=${bytes.length}b${title ? '+t' : ''}${image ? '+i' : ''}`);
  if (!title && !image) return null;

  return {
    ok: true,
    url: hit.url.toString(),
    title,
    description,
    image: image ? await inlineImage(image) : null,
    site,
  };
}

export async function handleOgPreview(request: Request, _env: PagesEnv, ctx: WaitUntil): Promise<Response> {
  const cached = await caches.default.match(request).catch(() => undefined);
  if (cached) return cached;

  const candidates = new URL(request.url).searchParams
    .getAll('u')
    .slice(0, MAX_CANDIDATES)
    .map((u) => permitted(u, ALLOWED_HOSTS))
    .filter((u): u is URL => !!u);

  const trace: string[] = [];
  let preview: Preview | null = null;

  for (const candidate of candidates) {
    // A Douyin share link renders server-side; its canonical /video/{id} form is a
    // JS shell. Try the share page first, then the canonical from the shared
    // resolver (the one /api/resolve/shortlink exposes to native-embed).
    const targets: URL[] = [candidate];
    if (DOUYIN_HOST.test(candidate.hostname)) {
      const canonical = await resolveCanonical(candidate).catch(() => null);
      const checked = canonical ? permitted(canonical, ALLOWED_HOSTS) : null;
      if (checked && checked.href !== candidate.href) targets.push(checked);
    }
    for (const target of targets) {
      try {
        preview = await previewOne(target, trace);
      } catch (err) {
        console.error('ogPreview:threw', { err: String(err), host: target.hostname });
        trace.push(`${target.hostname}=threw`);
        preview = null;
      }
      if (preview) break;
    }
    if (preview) break;
  }

  const body = preview ?? { ok: false, reason: (candidates.length ? 'no_tags' : 'no_candidates') as Reason, trace };
  const response = new Response(JSON.stringify(body), {
    // Negative results are cached too, briefly — a walled platform stays walled.
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': preview ? `public, max-age=600, s-maxage=${EDGE_TTL}` : 'public, max-age=120, s-maxage=600',
    },
  });
  ctx.waitUntil(caches.default.put(request, response.clone()).catch(() => {}));
  return response;
}
