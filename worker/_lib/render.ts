import type { InviteRow, Lang, ShareLandingProps } from './types';

/**
 * Render a share-link landing page response. Inline styles; no Astro layout
 * reach (Pages Functions are bundled separately from the Astro app).
 *
 * Cache-Control is intentionally left off success responses so `public/_headers`
 * (`/s/*` → `max-age=60`) is the single source of truth. Pass `init.cacheControl`
 * to override on error paths.
 */
export function renderShareLanding(
  props: ShareLandingProps,
  requestURL: string,
  init: { status?: number; cacheControl?: string } = {}
): Response {
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
  if (init.cacheControl) headers.set('Cache-Control', init.cacheControl);
  return new Response(buildHTML(props, requestURL), {
    status: init.status ?? 200,
    headers,
  });
}

/* ============================================================
   Locale-aware copy specific to the hero card. Error-state copy
   lives at the route level (functions/s/i/[key].ts).
   ============================================================ */

interface HeroCopy {
  appInvite: (inviter: string) => string;
  groupInvite: (inviter: string, groups: string) => string;
  andMore: (n: number) => string;
  topicPrefix: string;
  expiresBadge: (relative: string) => string;
  spotsBadge: (n: number) => string;
}

// Locales not present here fall back to `en` via `getHeroCopy()`. Add more
// translations in-place.
const HERO_COPY: Partial<Record<Lang, HeroCopy>> = {
  en: {
    appInvite: (i) => `${i} invited you to DirtBikeX`,
    groupInvite: (i, g) => `${i} invited you to join ${g}`,
    andMore: (n) => `+${n} more`,
    topicPrefix: '📍',
    expiresBadge: (r) => `Expires ${r}`,
    spotsBadge: (n) => `${n} ${n === 1 ? 'spot' : 'spots'} left`,
  },
  'zh-CN': {
    appInvite: (i) => `${i} 邀请你加入 DirtBikeX`,
    groupInvite: (i, g) => `${i} 邀请你加入 ${g}`,
    andMore: (n) => `等 ${n} 个`,
    topicPrefix: '📍',
    expiresBadge: (r) => `${r}过期`,
    spotsBadge: (n) => `还剩 ${n} 个名额`,
  },
};

function getHeroCopy(locale: Lang): HeroCopy {
  return HERO_COPY[locale] ?? HERO_COPY.en!;
}

/* ============================================================
   HTML
   ============================================================ */

function buildHTML(props: ShareLandingProps, requestURL: string): string {
  const { locale } = props;
  const url = esc(requestURL);
  const ogImage = buildOgImage(props);

  const head = (titleText: string, description: string | null) => `
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>${esc(titleText)} · DirtBikeX</title>
<meta property="og:title" content="${esc(titleText)}">
${description ? `<meta property="og:description" content="${esc(description)}">` : ''}
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="288">
<meta property="og:image:height" content="288">
<meta name="twitter:card" content="summary">
<meta name="twitter:image" content="${esc(ogImage)}">` : ''}
<style>${CSS}</style>`;

  const body = props.invite
    ? heroCardBody(props.invite, props, locale)
    : errorBody(props);

  const ogTitle = props.invite
    ? buildHeadline(props.invite, locale)
    : (props.title ?? 'DirtBikeX');
  const ogDescription = props.invite?.description ?? props.subtitle ?? null;

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>${head(ogTitle, ogDescription)}</head>
<body>${body}</body>
</html>`;
}

function errorBody(props: ShareLandingProps): string {
  const { title, subtitle, primaryCTA, returnTapCopy } = props;
  return `
<main class="card">
  <h1 class="headline">${esc(title ?? 'DirtBikeX')}</h1>
  ${subtitle ? `<p class="subtitle">${esc(subtitle)}</p>` : ''}
  <a class="cta" href="${esc(primaryCTA.url)}">${esc(primaryCTA.label)}</a>
  <p class="return-tap">${esc(returnTapCopy)}</p>
</main>`;
}

function heroCardBody(invite: InviteRow, props: ShareLandingProps, locale: Lang): string {
  const { primaryCTA, returnTapCopy, forumBase } = props;
  const copy = getHeroCopy(locale);
  const { invited_by, description, groups, topics, expires_at, max_redemptions_allowed, redemption_count } = invite;

  const displayName = invited_by.name?.trim() || invited_by.username;
  const showHandle = invited_by.name?.trim() && invited_by.name.trim() !== invited_by.username;

  const avatarHTML = renderAvatar(forumBase, invited_by.avatar_template, displayName, invited_by.username);
  const titlePillHTML = invited_by.title
    ? `<span class="inviter-title">${esc(invited_by.title)}</span>`
    : '';
  const handleHTML = showHandle
    ? `<div class="inviter-handle">@${esc(invited_by.username)}</div>`
    : '';

  const headline = buildHeadline(invite, locale);

  const topicHTML = topics.length > 0
    ? `<p class="topic">${copy.topicPrefix} ${esc(topics[0].fancy_title || topics[0].title)}</p>`
    : '';

  const messageHTML = description?.trim()
    ? `<blockquote class="message">${esc(description.trim())}</blockquote>`
    : '';

  const chipsHTML = groups.length > 0
    ? `<div class="group-chips">${groups
        .map((g) => `<span class="chip">${esc(g.full_name?.trim() || g.name)}</span>`)
        .join('')}</div>`
    : '';

  const badges: string[] = [];
  if (expires_at) {
    const relative = formatRelativeFuture(expires_at, locale);
    if (relative) badges.push(`<span class="badge">${esc(copy.expiresBadge(relative))}</span>`);
  }
  if (max_redemptions_allowed != null) {
    const remaining = max_redemptions_allowed - redemption_count;
    if (remaining > 0) badges.push(`<span class="badge">${esc(copy.spotsBadge(remaining))}</span>`);
  }
  const statusHTML = badges.length > 0 ? `<div class="status-row">${badges.join('')}</div>` : '';

  return `
<main class="card">
  ${avatarHTML}
  <div class="inviter">
    <div class="inviter-name">${esc(displayName)}</div>
    ${handleHTML}
    ${titlePillHTML}
  </div>
  <h1 class="headline">${esc(headline)}</h1>
  ${topicHTML}
  ${messageHTML}
  ${chipsHTML}
  ${statusHTML}
  <a class="cta" href="${esc(primaryCTA.url)}">${esc(primaryCTA.label)}</a>
  <p class="return-tap">${esc(returnTapCopy)}</p>
</main>`;
}

/* ============================================================
   Headline + helpers
   ============================================================ */

/**
 * Returns the absolute Discourse avatar URL to advertise as `og:image`, or null
 * if the inviter has no uploaded avatar (template stays null in that case — see
 * `buildAvatarTemplate` in inviteLookup.ts). 288px is Discourse's largest
 * pre-rendered size and matches the in-page hero card.
 */
function buildOgImage(props: ShareLandingProps): string | null {
  const template = props.invite?.invited_by.avatar_template;
  if (!template) return null;
  return `${props.forumBase}${template.replace('{size}', '288')}`;
}

function buildHeadline(invite: InviteRow, locale: Lang): string {
  const copy = getHeroCopy(locale);
  const inviter = invite.invited_by.name?.trim() || invite.invited_by.username;
  if (invite.groups.length === 0) return copy.appInvite(inviter);

  const names = invite.groups.map((g) => g.full_name?.trim() || g.name);
  const maxNames = 3;
  const overflow = names.length - maxNames;
  const shown = overflow > 0 ? names.slice(0, maxNames) : names;
  const list = formatList(shown, locale);
  const tail = overflow > 0 ? ` ${copy.andMore(overflow)}` : '';
  return copy.groupInvite(inviter, list + tail);
}

function formatList(items: string[], locale: Lang): string {
  if (typeof Intl !== 'undefined' && typeof Intl.ListFormat === 'function') {
    // BCP-47 tags pass through to Intl directly; unsupported locales degrade
    // gracefully to a sensible fallback.
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items);
  }
  if (items.length <= 1) return items[0] ?? '';
  const isZh = locale === 'zh-CN' || locale === 'zh-TW';
  const sep = isZh ? '、' : ', ';
  return items.slice(0, -1).join(sep) + (isZh ? ' 和 ' : ' and ') + items[items.length - 1];
}

function formatRelativeFuture(iso: string, locale: Lang): string | null {
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return null;
  const diffMs = target - Date.now();
  if (diffMs <= 0) return null;

  const minutes = Math.round(diffMs / 60000);
  const hours = Math.round(diffMs / 3600000);
  const days = Math.round(diffMs / 86400000);
  const months = Math.round(diffMs / (86400000 * 30));

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (minutes < 60) return rtf.format(minutes, 'minute');
  if (hours < 24) return rtf.format(hours, 'hour');
  if (days < 30) return rtf.format(days, 'day');
  return rtf.format(months, 'month');
}

/* ============================================================
   Avatar
   ============================================================ */

function renderAvatar(
  forumBase: string,
  avatarTemplate: string | null,
  displayName: string,
  username: string,
): string {
  // SVG letter avatar is always present underneath; the <img> overlays it.
  // If the img 404s, `this.remove()` strips it and reveals the SVG below.
  // Avoids JS-in-HTML-in-JS double escaping.
  const initial = firstGrapheme(displayName || username);
  const svg = letterAvatarSVG(initial);
  if (!avatarTemplate) return `<div class="avatar">${svg}</div>`;
  const path = avatarTemplate.replace('{size}', '144');
  const src = esc(`${forumBase}${path}`);
  return `<div class="avatar">${svg}<img src="${src}" alt="${esc(displayName)}" onerror="this.remove()"></div>`;
}

function letterAvatarSVG(letter: string): string {
  const safe = esc(letter.toUpperCase());
  return `<svg viewBox="0 0 88 88" width="88" height="88" xmlns="http://www.w3.org/2000/svg"><circle cx="44" cy="44" r="44" fill="#f3760b"/><text x="44" y="44" dy="0.36em" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="40" font-weight="700" fill="#fff">${safe}</text></svg>`;
}

function firstGrapheme(s: string): string {
  // Array.from splits on code points (not graphemes), good enough for first
  // letter of name/username — handles ZH and emoji correctly.
  return Array.from(s.trim())[0] ?? '?';
}

/* ============================================================
   HTML escape
   ============================================================ */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ============================================================
   CSS — palette pulled from tailwind.config.mjs (`dirt-*`, `clay-*`)
   ============================================================ */

const CSS = `
:root {
  --dirt-50:  #fff8eb;
  --dirt-100: #feeac7;
  --dirt-200: #fcd28a;
  --dirt-400: #fa9824;
  --dirt-500: #f3760b;
  --dirt-600: #d75606;
  --dirt-700: #b23a09;
  --clay-50:  #f7f6f4;
  --clay-100: #e9e6e1;
  --clay-200: #d3cdc3;
  --clay-500: #847665;
  --clay-600: #6d6052;
  --clay-700: #594e44;
  --clay-800: #4a423b;
  --clay-900: #3f3934;
  --clay-950: #231f1c;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Noto Sans SC', system-ui, sans-serif;
  color: #1a1a1a;
  background: linear-gradient(135deg, var(--dirt-50) 0%, var(--dirt-100) 50%, var(--dirt-200) 100%);
  background-attachment: fixed;
}
.card {
  background: #ffffff;
  border-radius: 1.25rem;
  padding: 2rem 1.5rem;
  max-width: 420px;
  width: 100%;
  box-shadow: 0 20px 60px -20px rgba(243,118,11,0.25), 0 4px 12px rgba(0,0,0,0.08);
  text-align: center;
}
.avatar {
  width: 88px;
  height: 88px;
  margin: 0 auto 1rem;
  position: relative;
  border-radius: 50%;
  overflow: hidden;
}
.avatar > svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.avatar > img { position: relative; z-index: 1; width: 100%; height: 100%; object-fit: cover; display: block; }
.inviter { margin-bottom: 0.75rem; }
.inviter-name {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1a1a1a;
  line-height: 1.3;
}
.inviter-handle {
  font-size: 0.875rem;
  color: var(--clay-500);
  margin-top: 0.125rem;
}
.inviter-title {
  display: inline-block;
  margin-top: 0.5rem;
  padding: 0.125rem 0.625rem;
  background: var(--clay-100);
  color: var(--clay-700);
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 500;
}
.headline {
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.25;
  margin: 1rem 0 0;
  color: #1a1a1a;
}
.subtitle {
  font-size: 1rem;
  color: var(--clay-600);
  margin: 0.75rem 0 0;
  line-height: 1.5;
}
.topic {
  font-size: 0.875rem;
  color: var(--clay-600);
  margin: 0.75rem 0 0;
}
.message {
  font-style: italic;
  color: var(--clay-800);
  border-left: 3px solid var(--dirt-400);
  padding: 0.25rem 0 0.25rem 0.75rem;
  margin: 1rem 0 0;
  text-align: left;
  line-height: 1.5;
  font-size: 0.9375rem;
}
.group-chips {
  margin-top: 1rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  justify-content: center;
}
.chip {
  display: inline-block;
  padding: 0.25rem 0.625rem;
  background: var(--dirt-50);
  color: var(--dirt-700);
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 500;
}
.status-row {
  margin-top: 1rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  justify-content: center;
}
.badge {
  display: inline-block;
  padding: 0.25rem 0.625rem;
  background: var(--clay-100);
  color: var(--clay-700);
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 500;
}
.cta {
  display: block;
  margin-top: 1.5rem;
  padding: 0.875rem 1.25rem;
  background: var(--dirt-500);
  color: #ffffff;
  text-decoration: none;
  border-radius: 0.625rem;
  font-weight: 600;
  font-size: 1rem;
  transition: background-color 0.15s ease;
}
.cta:hover, .cta:active { background: var(--dirt-600); }
.return-tap {
  margin-top: 1rem;
  font-size: 0.8125rem;
  color: var(--clay-500);
  line-height: 1.4;
}

@media (prefers-color-scheme: dark) {
  body {
    background: linear-gradient(135deg, var(--clay-950) 0%, var(--clay-900) 50%, var(--clay-800) 100%);
    color: var(--clay-50);
  }
  .card {
    background: #1a1614;
    box-shadow: 0 20px 60px -20px rgba(0,0,0,0.6), 0 4px 12px rgba(0,0,0,0.4);
  }
  .inviter-name, .headline { color: var(--clay-50); }
  .inviter-handle { color: var(--clay-200); }
  .inviter-title { background: var(--clay-800); color: var(--clay-100); }
  .topic, .subtitle { color: var(--clay-200); }
  .message { color: var(--clay-100); }
  .chip { background: rgba(243,118,11,0.15); color: var(--dirt-200); }
  .badge { background: var(--clay-800); color: var(--clay-100); }
  .return-tap { color: var(--clay-200); }
}
`;
