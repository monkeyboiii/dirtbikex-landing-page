import { lookupInvite, type LookupResult } from './_lib/inviteLookup';
import { renderShareLanding } from './_lib/render';
import { fetchForumMetrics } from './_lib/forumMetrics';
import { fetchForumFeatured } from './_lib/forumFeatured';
import { fetchSponsors, fetchLeaderboard } from './_lib/sponsorProxy';
import { forwardAdmin } from './_lib/adminProxy';
import { handleFinalizePresign, handleFinalizeComplete } from './_lib/finalize';
import { handleClaimLookup, handleClaimCommit } from './_lib/grantClaim';
import { handleLogtoSms } from './_lib/logtoSms';
import type { Lang, PagesEnv, ShareLandingProps } from './_lib/types';

interface Env extends PagesEnv {
  /** Static-assets binding (serves files from `dist/`). Minimal inline shape — */
  /** matches the existing `PagesEnv` convention of avoiding @cloudflare/workers-types. */
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

/**
 * Mirrors the placeholder in `src/config.ts`. The worker is bundled separately
 * from the Astro app and can't import `src/`. Replace both copies when the real
 * App Store ID lands; alternatively promote to an `APP_STORE_URL` env var.
 */
const APP_STORE_URL = 'https://apps.apple.com/app/id0000000000';

interface Copy {
  ctaLabel: string;
  returnTap: string;
  expiredTitle: string;
  expiredSubtitle: string;
  notFoundTitle: string;
  notFoundSubtitle: string;
  fallbackTitle: string;
}

// Locales not present here fall back to `en` via `getCopy()`. Add more
// translations in-place; the translation pipeline that fans out
// `src/i18n/locales/*.json` doesn't currently cover this worker-side copy.
const COPY: Partial<Record<Lang, Copy>> = {
  en: {
    ctaLabel: 'Get DirtBikeX',
    returnTap: 'Already installed? Tap the link again to open it in the app.',
    expiredTitle: 'This invite has expired',
    expiredSubtitle: 'Get the app to join DirtBikeX.',
    notFoundTitle: 'Invite not found',
    notFoundSubtitle: "This link doesn't exist. Get DirtBikeX to start riding.",
    fallbackTitle: 'Get DirtBikeX',
  },
  'zh-CN': {
    ctaLabel: '下载 DirtBikeX',
    returnTap: '已经安装了？再次点击链接即可在应用内打开。',
    expiredTitle: '邀请已过期',
    expiredSubtitle: '下载应用，加入 DirtBikeX。',
    notFoundTitle: '邀请不存在',
    notFoundSubtitle: '该链接无效。下载 DirtBikeX 开始骑行。',
    fallbackTitle: '下载 DirtBikeX',
  },
};

function getCopy(locale: Lang): Copy {
  return COPY[locale] ?? COPY.en!;
}

const LOCALES: readonly Lang[] = [
  'en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'it', 'fr', 'es', 'ar',
  'da', 'el', 'fa-IR', 'fi', 'id', 'nl', 'pt', 'tr-TR', 'th', 'vi',
];

/**
 * Resolve a locale for `/s/i/<key>` (and any future `/s/<kind>/<token>` page).
 * `?lang=` wins so a shared URL like `/s/i/<key>?lang=zh-CN` renders
 * deterministically — and the URL pattern stays under `/s/*` (path unchanged),
 * preserving the AASA universal-link contract.
 */
function pickLocale(url: URL, acceptLanguage: string | null): Lang {
  const qs = url.searchParams.get('lang');
  if (qs && (LOCALES as readonly string[]).includes(qs)) return qs as Lang;

  if (!acceptLanguage) return 'en';
  const tags = acceptLanguage
    .split(',')
    .map((t) => t.trim().split(';')[0]!.trim())
    .filter(Boolean);
  for (const raw of tags) {
    const tag = raw.toLowerCase();
    const exact = LOCALES.find((l) => l.toLowerCase() === tag);
    if (exact) return exact;
    const base = tag.split('-')[0]!;
    if (base === 'zh') {
      const want: Lang = /hant|tw|hk|mo/.test(tag) ? 'zh-TW' : 'zh-CN';
      if (LOCALES.includes(want)) return want;
    }
    const byBase = LOCALES.find((l) => l.toLowerCase().split('-')[0] === base);
    if (byBase) return byBase;
  }
  return 'en';
}

function buildProps(
  result: LookupResult,
  copy: Copy,
  locale: Lang,
  forumBase: string,
): { props: ShareLandingProps; cacheControl?: string } {
  const base: Pick<ShareLandingProps, 'kind' | 'locale' | 'primaryCTA' | 'returnTapCopy' | 'forumBase'> = {
    kind: 'i',
    locale,
    primaryCTA: { label: copy.ctaLabel, url: APP_STORE_URL },
    returnTapCopy: copy.returnTap,
    forumBase,
  };

  switch (result.status) {
    case 'valid':
      return { props: { ...base, invite: result.invite } };
    case 'expired':
      return {
        props: { ...base, title: copy.expiredTitle, subtitle: copy.expiredSubtitle },
        cacheControl: 'no-cache',
      };
    case 'not_found':
      return {
        props: { ...base, title: copy.notFoundTitle, subtitle: copy.notFoundSubtitle },
        cacheControl: 'no-cache',
      };
    case 'unreachable':
      return {
        props: { ...base, title: copy.fallbackTitle },
        cacheControl: 'no-cache',
      };
  }
}

async function handleInvite(request: Request, env: Env, key: string): Promise<Response> {
  const url = new URL(request.url);
  const locale = pickLocale(url, request.headers.get('accept-language'));
  const copy = getCopy(locale);
  const forumBase = env.FORUM_BASE ?? '';

  const result = await lookupInvite(env, key);
  const { props, cacheControl } = buildProps(result, copy, locale, forumBase);
  return renderShareLanding(props, request.url, cacheControl ? { cacheControl } : {});
}

const FORUM_API_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400';

async function handleForumMetrics(env: Env): Promise<Response> {
  const result = await fetchForumMetrics(env);
  if (result.status !== 'ok') {
    return new Response(JSON.stringify({ error: 'unreachable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    });
  }
  return new Response(JSON.stringify(result.payload), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': FORUM_API_CACHE_CONTROL },
  });
}

async function handleForumFeatured(env: Env): Promise<Response> {
  const result = await fetchForumFeatured(env);
  if (result.status !== 'ok') {
    return new Response(JSON.stringify({ error: 'unreachable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    });
  }
  return new Response(JSON.stringify(result.payload), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': FORUM_API_CACHE_CONTROL },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/s\/i\/([^/]+)\/?$/);
    if (m && request.method === 'GET') {
      return handleInvite(request, env, m[1]);
    }
    if (request.method === 'GET') {
      if (url.pathname === '/api/forum/metrics.json') return handleForumMetrics(env);
      if (url.pathname === '/api/forum/featured.json') return handleForumFeatured(env);
      if (url.pathname === '/api/proxy/sponsors') return fetchSponsors(env);
      const lb = url.pathname.match(/^\/api\/proxy\/leaderboard\/([a-z_]+)\.json$/);
      if (lb) return fetchLeaderboard(env, lb[1]!);
    }

    // /admin/uploads/* — CF-Access-gated. The HTML page is a static asset
    // (served via ASSETS); only the api/ subpaths proxy to sponsorhub.
    // Path mapping:
    //   GET  /admin/uploads/api/queue                → GET  /admin/uploads
    //   POST /admin/uploads/api/:slotId/approve      → POST /admin/uploads/:slotId/approve
    //   POST /admin/uploads/api/:slotId/reject       → POST /admin/uploads/:slotId/reject
    if (url.pathname === '/admin/uploads/api/queue' && request.method === 'GET') {
      return forwardAdmin(request, env, '/admin/uploads');
    }
    const modOp = url.pathname.match(/^\/admin\/uploads\/api\/([0-9a-fA-F-]+)\/(approve|reject)$/);
    if (modOp && request.method === 'POST') {
      return forwardAdmin(request, env, `/admin/uploads/${modOp[1]}/${modOp[2]}`);
    }

    // /sponsors/finalize?token=<>  — magic-link upload (PLAN_2 §4.2).
    // Page is static; Worker handles the two API steps.
    if (url.pathname === '/sponsors/finalize/api/presign' && request.method === 'POST') {
      return handleFinalizePresign(request, env, url.searchParams.get('token') ?? '');
    }
    if (url.pathname === '/sponsors/finalize/api/complete' && request.method === 'POST') {
      return handleFinalizeComplete(request, env, url.searchParams.get('token') ?? '');
    }

    // /s/g/<token> grant claim (PLAN_2 §4.3). The API subpaths proxy to
    // sponsorhub; the bare GET serves the static template at /s/g/__token__/.
    const claimLookup = url.pathname.match(/^\/s\/g\/([^/]+)\/api\/lookup$/);
    if (claimLookup && request.method === 'GET') {
      return handleClaimLookup(request, env, claimLookup[1]!);
    }
    const claimCommit = url.pathname.match(/^\/s\/g\/([^/]+)\/api\/claim$/);
    if (claimCommit && request.method === 'POST') {
      return handleClaimCommit(request, env, claimCommit[1]!);
    }
    // /api/logto/sms — Logto HTTP SMS connector. See docs/sms-gateway.md.
    if (url.pathname === '/api/logto/sms' && request.method === 'POST') {
      return handleLogtoSms(request, env);
    }

    const claimPage = url.pathname.match(/^\/s\/g\/([^/]+)\/?$/);
    if (claimPage && request.method === 'GET') {
      // Rewrite to the static template; the page's JS reads the real token
      // from the original URL via location.pathname.
      const rewritten = new URL(request.url);
      rewritten.pathname = '/s/g/__token__/';
      // Never edge-cache a per-token URL: the static asset carries s-maxage=86400,
      // which otherwise pins a transient 404 (e.g. a request racing a deploy) for
      // 24h per CF PoP. Claim state is resolved client-side via the no-store lookup.
      const res = await env.ASSETS.fetch(new Request(rewritten.toString(), request));
      const out = new Response(res.body, res);
      out.headers.set('Cache-Control', 'no-store');
      return out;
    }

    return env.ASSETS.fetch(request);
  },
};
