import { renderShareLanding } from '../../_lib/render';
import type { InviteResponse, PagesContext, ShareLandingProps } from '../../_lib/types';

/**
 * Mirrors the placeholder in `src/config.ts`. Functions are bundled separately
 * from the Astro app and can't import `src/`. Replace both copies when the real
 * App Store ID lands; alternatively promote to a `APP_STORE_URL` Pages env var.
 */
const APP_STORE_URL = 'https://apps.apple.com/app/id0000000000';

const COPY = {
  en: {
    ctaLabel: 'Get DirtBikeX',
    returnTap: 'Already installed? Tap the link again to open it in the app.',
    validApp: (inviter: string) => `${inviter} invited you to DirtBikeX`,
    validGroup: (inviter: string, group: string) =>
      `${inviter} invited you to join the ${group} group on DirtBikeX`,
    expiredTitle: 'This invite has expired',
    expiredSubtitle: 'Get the app to join DirtBikeX.',
    notFoundTitle: 'Invite not found',
    notFoundSubtitle: "This link doesn't exist. Get DirtBikeX to start riding.",
    fallbackTitle: 'Get DirtBikeX',
  },
  zh: {
    ctaLabel: '下载 DirtBikeX',
    returnTap: '已经安装了？再次点击链接即可在应用内打开。',
    validApp: (inviter: string) => `${inviter} 邀请你加入 DirtBikeX`,
    validGroup: (inviter: string, group: string) =>
      `${inviter} 邀请你加入 DirtBikeX 的 ${group} 群组`,
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

/**
 * One of four terminal results, mapped from LANDING_PLAN.md §3 status table.
 * `'unreachable'` covers 5xx and network/timeout — never block on Discourse.
 */
type FetchResult =
  | { status: 'valid'; invite: InviteResponse }
  | { status: 'expired' }
  | { status: 'not_found' }
  | { status: 'unreachable' };

async function fetchInvite(forumBase: string, key: string): Promise<FetchResult> {
  let resp: Response;
  try {
    resp = await fetch(`${forumBase}/invites/${encodeURIComponent(key)}`, {
      headers: { Accept: 'application/json' },
      // Cloudflare edge cache: cache successful upstream responses for 5min.
      // `cf` is a Cloudflare-only extension to RequestInit; cast avoids needing
      // `@cloudflare/workers-types`.
      ...({ cf: { cacheTtl: 300, cacheEverything: true } } as RequestInit),
    });
  } catch {
    return { status: 'unreachable' };
  }

  if (resp.status === 404) return { status: 'not_found' };
  if (resp.status !== 200) return { status: 'unreachable' };

  let invite: InviteResponse;
  try {
    invite = (await resp.json()) as InviteResponse;
  } catch {
    return { status: 'unreachable' };
  }

  // Strip email before any downstream code can read it (LP §3 + PLAN.md §4.A).
  delete (invite as Record<string, unknown>).email;

  const isExpired =
    invite.expired === true ||
    (invite.max_redemptions_allowed != null &&
      invite.redemption_count != null &&
      invite.redemption_count >= invite.max_redemptions_allowed);

  if (isExpired) return { status: 'expired' };
  return { status: 'valid', invite };
}

function buildProps(result: FetchResult, copy: Copy, locale: 'en' | 'zh'): {
  props: ShareLandingProps;
  cacheControl?: string;
} {
  const primaryCTA = { label: copy.ctaLabel, url: APP_STORE_URL };
  const returnTapCopy = copy.returnTap;
  const base = { kind: 'i' as const, primaryCTA, returnTapCopy, locale };

  switch (result.status) {
    case 'valid': {
      const inviter =
        result.invite.invited_by?.name?.trim() ||
        result.invite.invited_by?.username ||
        'Someone';
      const firstGroup = result.invite.groups?.[0];
      const groupName = firstGroup?.full_name?.trim() || firstGroup?.name;
      const title = groupName
        ? copy.validGroup(inviter, groupName)
        : copy.validApp(inviter);
      return { props: { ...base, title } };
    }
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

export const onRequest = async (
  context: PagesContext<{ key: string }>
): Promise<Response> => {
  const { request, params, env } = context;
  if (!params.key) {
    return new Response('Not found', { status: 404 });
  }

  const locale = pickLocale(request.headers.get('accept-language'));
  const copy = COPY[locale];

  if (!env.FORUM_BASE) {
    // Misconfigured Pages project — serve generic fallback rather than 500.
    const { props } = buildProps({ status: 'unreachable' }, copy, locale);
    return renderShareLanding(props, request.url, { cacheControl: 'no-cache' });
  }

  const result = await fetchInvite(env.FORUM_BASE, params.key);
  const { props, cacheControl } = buildProps(result, copy, locale);
  return renderShareLanding(props, request.url, cacheControl ? { cacheControl } : {});
};
