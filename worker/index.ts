import { lookupInvite, type LookupResult } from './_lib/inviteLookup';
import { renderShareLanding } from './_lib/render';
import { fetchForumMetrics } from './_lib/forumMetrics';
import { fetchForumFeatured } from './_lib/forumFeatured';
import { fetchSponsors, fetchLeaderboard } from './_lib/sponsorProxy';
import { forwardAdmin } from './_lib/adminProxy';
import { handleFinalizePresign, handleFinalizeComplete } from './_lib/finalize';
import { handleClaimLookup, handleClaimCommit } from './_lib/grantClaim';
import type { PagesEnv, ShareLandingProps } from './_lib/types';

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

const COPY = {
  en: {
    ctaLabel: 'Get DirtBikeX',
    returnTap: 'Already installed? Tap the link again to open it in the app.',
    expiredTitle: 'This invite has expired',
    expiredSubtitle: 'Get the app to join DirtBikeX.',
    notFoundTitle: 'Invite not found',
    notFoundSubtitle: "This link doesn't exist. Get DirtBikeX to start riding.",
    fallbackTitle: 'Get DirtBikeX',
  },
  zh: {
    ctaLabel: '下载 DirtBikeX',
    returnTap: '已经安装了？再次点击链接即可在应用内打开。',
    expiredTitle: '邀请已过期',
    expiredSubtitle: '下载应用，加入 DirtBikeX。',
    notFoundTitle: '邀请不存在',
    notFoundSubtitle: '该链接无效。下载 DirtBikeX 开始骑行。',
    fallbackTitle: '下载 DirtBikeX',
  },
} as const;

type Copy = typeof COPY['en' | 'zh'];

function pickLocale(acceptLanguage: string | null): 'en' | 'zh' {
  return acceptLanguage && /\bzh\b/i.test(acceptLanguage) ? 'zh' : 'en';
}

function buildProps(
  result: LookupResult,
  copy: Copy,
  locale: 'en' | 'zh',
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
  const locale = pickLocale(request.headers.get('accept-language'));
  const copy = COPY[locale];
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
    const claimPage = url.pathname.match(/^\/s\/g\/([^/]+)\/?$/);
    if (claimPage && request.method === 'GET') {
      // Rewrite to the static template; the page's JS reads the real token
      // from the original URL via location.pathname.
      const rewritten = new URL(request.url);
      rewritten.pathname = '/s/g/__token__/';
      return env.ASSETS.fetch(new Request(rewritten.toString(), request));
    }

    return env.ASSETS.fetch(request);
  },
};
