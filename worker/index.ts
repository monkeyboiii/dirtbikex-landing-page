import { lookupInvite, type LookupResult } from './_lib/inviteLookup';
import { renderShareLanding } from './_lib/render';
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/s\/i\/([^/]+)\/?$/);
    if (m && request.method === 'GET') {
      return handleInvite(request, env, m[1]);
    }
    return env.ASSETS.fetch(request);
  },
};
