import type { PagesEnv } from './types';

// Resolves Douyin (v.douyin.com) and Bilibili (b23.tv) short links to their canonical
// www.douyin.com/video/{id} / www.bilibili.com/video/{id} URLs. Those short links 302
// with no Access-Control-Allow-Origin header, so a browser can't follow them — the
// forum's embed theme component (discourse-multi-native-embed) calls this server-side
// hop, then runs its normal canonical-URL embed path on the returned `url`.

const ALLOWED_INPUT_HOSTS = new Set(['v.douyin.com', 'b23.tv']);

// Hosts we'll follow a redirect *to* while chasing the canonical URL — keeps this
// from being usable as an open redirect / SSRF proxy.
const FOLLOW_HOSTS = new Set([
  'v.douyin.com',
  'b23.tv',
  'www.iesdouyin.com',
  'iesdouyin.com',
  'www.douyin.com',
  'douyin.com',
  'www.bilibili.com',
  'bilibili.com',
  'm.bilibili.com',
]);

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function extractCanonical(href: string): string | null {
  if (/douyin/.test(href)) {
    const dy = href.match(/\/(?:share\/)?video\/(\d{6,})/);
    if (dy) return `https://www.douyin.com/video/${dy[1]}`;
  }
  if (/bilibili/.test(href)) {
    const bili = href.match(/\/video\/(BV[0-9A-Za-z]+|av\d+)/i);
    if (bili) return `https://www.bilibili.com/video/${bili[1]}`;
  }
  return null;
}

export async function handleShortlinkResolve(request: Request, env: PagesEnv): Promise<Response> {
  const cors = { 'Access-Control-Allow-Origin': env.FORUM_BASE ?? '*', Vary: 'Origin' };
  const json = (status: number, body: unknown, cache: string) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': cache, ...cors },
    });

  const u = new URL(request.url).searchParams.get('u');
  if (!u) return json(400, { error: 'missing_u' }, 'no-store');

  let target: URL;
  try {
    target = new URL(u);
  } catch {
    return json(400, { error: 'bad_url' }, 'no-store');
  }
  if (target.protocol !== 'https:' || !ALLOWED_INPUT_HOSTS.has(target.hostname.toLowerCase())) {
    return json(400, { error: 'host_not_allowed' }, 'no-store');
  }

  let current = target.href;
  for (let hop = 0; hop < 5; hop++) {
    const found = extractCanonical(current);
    if (found) return json(200, { url: found }, 'public, max-age=86400');

    let resp: Response;
    try {
      resp = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': UA, Accept: 'text/html' },
      });
    } catch {
      return json(502, { error: 'fetch_failed' }, 'no-store');
    }

    if (resp.status < 300 || resp.status >= 400) break;
    const loc = resp.headers.get('location');
    if (!loc) break;

    let next: URL;
    try {
      next = new URL(loc, current);
    } catch {
      break;
    }
    const fromLoc = extractCanonical(next.href);
    if (fromLoc) return json(200, { url: fromLoc }, 'public, max-age=86400');
    if (!FOLLOW_HOSTS.has(next.hostname.toLowerCase())) break;
    current = next.href;
  }

  return json(404, { error: 'unresolved' }, 'no-store');
}
