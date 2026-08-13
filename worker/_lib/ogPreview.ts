import type { PagesEnv } from './types';

/**
 * Link previews for episode sheets — the iMessage/Slack treatment.
 *
 * The social platforms only emit their Open Graph tags to a crawler UA, and their
 * og:image lives on a third-party CDN. Both problems are solved server-side: the
 * worker crawls, then inlines the image as a data URI so the page never reaches
 * off-origin (the mainland-China invariant, README.md).
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

const CRAWLER_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const MAX_HTML_BYTES = 300_000;
const MAX_IMAGE_BYTES = 250_000;
const EDGE_TTL = 21_600; // 6h — a published post's card doesn't move.
const MAX_CANDIDATES = 4;

declare const caches: {
  default: { match(r: Request): Promise<Response | undefined>; put(r: Request, resp: Response): Promise<void> };
};

export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

interface Preview {
  ok: true;
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site: string | null;
}

function allowed(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return ALLOWED_HOSTS.some((re) => re.test(url.hostname)) ? url : null;
  } catch {
    return null;
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Reads one og:/twitter: property, tolerating either attribute order. */
function meta(html: string, property: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`, 'i'),
  ];
  for (const re of patterns) {
    const hit = re.exec(html);
    if (hit?.[1]) return decodeEntities(hit[1]).trim();
  }
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function inlineImage(src: string): Promise<string | null> {
  try {
    const resp = await fetch(src, { headers: { 'User-Agent': CRAWLER_UA, Accept: 'image/*' } });
    if (!resp.ok) return null;
    const type = resp.headers.get('content-type') ?? 'image/jpeg';
    if (!type.startsWith('image/')) return null;
    const buffer = await resp.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) return null;
    return `data:${type};base64,${toBase64(new Uint8Array(buffer))}`;
  } catch {
    return null;
  }
}

async function previewOne(url: URL): Promise<Preview | null> {
  let html: string;
  try {
    const resp = await fetch(url.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent': CRAWLER_UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en,zh;q=0.8',
      },
    });
    if (!resp.ok) return null;
    html = (await resp.text()).slice(0, MAX_HTML_BYTES);
  } catch {
    return null;
  }

  const title = meta(html, 'og:title') ?? meta(html, 'twitter:title');
  const image = meta(html, 'og:image') ?? meta(html, 'twitter:image');
  if (!title && !image) return null;

  return {
    ok: true,
    url: url.toString(),
    title,
    description: meta(html, 'og:description') ?? meta(html, 'twitter:description'),
    image: image ? await inlineImage(image) : null,
    site: meta(html, 'og:site_name'),
  };
}

export async function handleOgPreview(request: Request, _env: PagesEnv, ctx: WaitUntil): Promise<Response> {
  const cached = await caches.default.match(request).catch(() => undefined);
  if (cached) return cached;

  const candidates = new URL(request.url).searchParams
    .getAll('u')
    .slice(0, MAX_CANDIDATES)
    .map(allowed)
    .filter((u): u is URL => !!u);

  let preview: Preview | null = null;
  for (const candidate of candidates) {
    preview = await previewOne(candidate);
    if (preview) break;
  }

  const body = preview ?? { ok: false };
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
