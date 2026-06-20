import type { EventRow, InviteRow, Lang, ShareLandingProps, UserRow } from './types';

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
  'zh-TW': {
    appInvite: (i) => `${i} 邀請你加入 DirtBikeX`,
    groupInvite: (i, g) => `${i} 邀請你加入 ${g}`,
    andMore: (n) => `等 ${n} 個`,
    topicPrefix: '📍',
    expiresBadge: (r) => `${r}過期`,
    spotsBadge: (n) => `還剩 ${n} 個名額`,
  },
  ja: {
    appInvite: (i) => `${i}さんがあなたを DirtBikeX に招待しました`,
    groupInvite: (i, g) => `${i}さんがあなたを ${g} に招待しました`,
    andMore: (n) => `他 ${n} 件`,
    topicPrefix: '📍',
    expiresBadge: (r) => `${r}に期限切れ`,
    spotsBadge: (n) => `残り ${n} 枠`,
  },
  ko: {
    appInvite: (i) => `${i}님이 DirtBikeX에 초대했습니다`,
    groupInvite: (i, g) => `${i}님이 ${g}에 초대했습니다`,
    andMore: (n) => `외 ${n}개`,
    topicPrefix: '📍',
    expiresBadge: (r) => `${r} 만료`,
    spotsBadge: (n) => `${n}자리 남음`,
  },
  de: {
    appInvite: (i) => `${i} hat dich zu DirtBikeX eingeladen`,
    groupInvite: (i, g) => `${i} hat dich zu ${g} eingeladen`,
    andMore: (n) => `+${n} weitere`,
    topicPrefix: '📍',
    expiresBadge: (r) => `Läuft ${r} ab`,
    spotsBadge: (n) => `Noch ${n} ${n === 1 ? 'Platz' : 'Plätze'} frei`,
  },
  it: {
    appInvite: (i) => `${i} ti ha invitato su DirtBikeX`,
    groupInvite: (i, g) => `${i} ti ha invitato a unirti a ${g}`,
    andMore: (n) => `+${n} altri`,
    topicPrefix: '📍',
    expiresBadge: (r) => `Scade ${r}`,
    spotsBadge: (n) => `${n} ${n === 1 ? 'posto rimasto' : 'posti rimasti'}`,
  },
  fr: {
    appInvite: (i) => `${i} vous a invité sur DirtBikeX`,
    groupInvite: (i, g) => `${i} vous a invité à rejoindre ${g}`,
    andMore: (n) => `+${n} autres`,
    topicPrefix: '📍',
    expiresBadge: (r) => `Expire ${r}`,
    spotsBadge: (n) => `${n} ${n === 1 ? 'place restante' : 'places restantes'}`,
  },
  es: {
    appInvite: (i) => `${i} te ha invitado a DirtBikeX`,
    groupInvite: (i, g) => `${i} te ha invitado a unirte a ${g}`,
    andMore: (n) => `+${n} más`,
    topicPrefix: '📍',
    expiresBadge: (r) => `Caduca ${r}`,
    spotsBadge: (n) => `${n} ${n === 1 ? 'lugar disponible' : 'lugares disponibles'}`,
  },
  ar: {
    appInvite: (i) => `دعاك ${i} للانضمام إلى DirtBikeX`,
    groupInvite: (i, g) => `دعاك ${i} للانضمام إلى ${g}`,
    andMore: (n) => `+${n} أخرى`,
    topicPrefix: '📍',
    expiresBadge: (r) => `تنتهي ${r}`,
    spotsBadge: (n) => `أماكن متبقية: ${n}`,
  },
  da: {
    appInvite: (i) => `${i} har inviteret dig til DirtBikeX`,
    groupInvite: (i, g) => `${i} har inviteret dig til at deltage i ${g}`,
    andMore: (n) => `+${n} flere`,
    topicPrefix: '📍',
    expiresBadge: (r) => `Udløber ${r}`,
    spotsBadge: (n) => `${n} ${n === 1 ? 'plads' : 'pladser'} tilbage`,
  },
  el: {
    appInvite: (i) => `Ο/Η ${i} σε προσκάλεσε στο DirtBikeX`,
    groupInvite: (i, g) => `Ο/Η ${i} σε προσκάλεσε να μπεις στο ${g}`,
    andMore: (n) => `+${n} ακόμη`,
    topicPrefix: '📍',
    expiresBadge: (r) => `Λήγει ${r}`,
    spotsBadge: (n) => `${n === 1 ? 'Απομένει' : 'Απομένουν'} ${n} ${n === 1 ? 'θέση' : 'θέσεις'}`,
  },
  'fa-IR': {
    appInvite: (i) => `${i} شما را به DirtBikeX دعوت کرد`,
    groupInvite: (i, g) => `${i} شما را به پیوستن به ${g} دعوت کرد`,
    andMore: (n) => `+${n} مورد دیگر`,
    topicPrefix: '📍',
    expiresBadge: (r) => `${r} منقضی می‌شود`,
    spotsBadge: (n) => `${n} جای باقی‌مانده`,
  },
  fi: {
    appInvite: (i) => `${i} kutsui sinut DirtBikeX-yhteisöön`,
    groupInvite: (i, g) => `${i} kutsui sinut ryhmään ${g}`,
    andMore: (n) => `+${n} muuta`,
    topicPrefix: '📍',
    expiresBadge: (r) => `Vanhenee ${r}`,
    spotsBadge: (n) => `${n} ${n === 1 ? 'paikka' : 'paikkaa'} jäljellä`,
  },
  id: {
    appInvite: (i) => `${i} mengundang kamu ke DirtBikeX`,
    groupInvite: (i, g) => `${i} mengundang kamu untuk bergabung dengan ${g}`,
    andMore: (n) => `+${n} lainnya`,
    topicPrefix: '📍',
    expiresBadge: (r) => `Kedaluwarsa ${r}`,
    spotsBadge: (n) => `${n} tempat tersisa`,
  },
  nl: {
    appInvite: (i) => `${i} heeft je uitgenodigd voor DirtBikeX`,
    groupInvite: (i, g) => `${i} heeft je uitgenodigd om lid te worden van ${g}`,
    andMore: (n) => `+${n} meer`,
    topicPrefix: '📍',
    expiresBadge: (r) => `Verloopt ${r}`,
    spotsBadge: (n) => `Nog ${n} ${n === 1 ? 'plek' : 'plekken'}`,
  },
  pt: {
    appInvite: (i) => `${i} convidou você para o DirtBikeX`,
    groupInvite: (i, g) => `${i} convidou você para entrar em ${g}`,
    andMore: (n) => `+${n} mais`,
    topicPrefix: '📍',
    expiresBadge: (r) => `Expira ${r}`,
    spotsBadge: (n) => `${n} ${n === 1 ? 'vaga restante' : 'vagas restantes'}`,
  },
  'tr-TR': {
    appInvite: (i) => `${i} seni DirtBikeX'e davet etti`,
    groupInvite: (i, g) => `${i} seni ${g} grubuna davet etti`,
    andMore: (n) => `+${n} tane daha`,
    topicPrefix: '📍',
    expiresBadge: (r) => `${r} sona erer`,
    spotsBadge: (n) => `${n} yer kaldı`,
  },
  th: {
    appInvite: (i) => `${i} เชิญคุณเข้าร่วม DirtBikeX`,
    groupInvite: (i, g) => `${i} เชิญคุณเข้าร่วม ${g}`,
    andMore: (n) => `และอีก ${n} รายการ`,
    topicPrefix: '📍',
    expiresBadge: (r) => `หมดอายุ ${r}`,
    spotsBadge: (n) => `เหลือ ${n} ที่`,
  },
  vi: {
    appInvite: (i) => `${i} đã mời bạn tham gia DirtBikeX`,
    groupInvite: (i, g) => `${i} đã mời bạn tham gia ${g}`,
    andMore: (n) => `+${n} khác`,
    topicPrefix: '📍',
    expiresBadge: (r) => `Hết hạn ${r}`,
    spotsBadge: (n) => `Còn ${n} chỗ`,
  },
  sv: {
    appInvite: (i) => `${i} har bjudit in dig till DirtBikeX`,
    groupInvite: (i, g) => `${i} har bjudit in dig till ${g}`,
    andMore: (n) => `+${n} till`,
    topicPrefix: '📍',
    expiresBadge: (r) => `Går ut ${r}`,
    spotsBadge: (n) => `${n} ${n === 1 ? 'plats' : 'platser'} kvar`,
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
  // Strip `?lang=` (the iOS link carries `lang=auto`) so crawlers canonicalize
  // every locale of a share to one `og:url`, not a per-language variant.
  const url = esc(canonicalURL(requestURL));
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
    : props.user
      ? userCardBody(props.user, props, locale)
      : props.event
        ? eventCardBody(props.event, props, locale)
        : errorBody(props);

  const ogTitle = props.invite
    ? buildHeadline(props.invite, locale)
    : props.user
      ? userHeadline(props.user)
      : props.event
        ? props.event.name
        : (props.title ?? 'DirtBikeX');
  const ogDescription = props.invite?.description
    ?? props.user?.bio_excerpt
    ?? (props.user ? `View ${props.user.name?.trim() || props.user.username}'s profile on DirtBikeX` : null)
    ?? props.event?.description
    ?? (props.event ? eventOgDescription(props.event, locale) : null)
    ?? props.subtitle
    ?? null;

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${isRTL(locale) ? 'rtl' : 'ltr'}">
<head>${head(ogTitle, ogDescription)}</head>
<body>${body}</body>
</html>`;
}

/** Arabic + Persian render right-to-left. */
function isRTL(locale: Lang): boolean {
  return locale === 'ar' || locale === 'fa-IR';
}

/** DirtBikeX X mark, pinned top-right of every card for brand consistency. */
const CARD_LOGO = `<img class="card-logo" src="/brand/logo-mark.svg" alt="DirtBikeX">`;

function errorBody(props: ShareLandingProps): string {
  const { title, subtitle, primaryCTA } = props;
  // No inviter on error states — the avatar slot carries the app logo instead.
  // No "open in the app" path here: there's no valid invite key to funnel.
  return `
<main class="card">
  ${CARD_LOGO}
  <div class="avatar"><img src="/icon-512.png" alt="DirtBikeX"></div>
  <h1 class="headline">${esc(title ?? 'DirtBikeX')}</h1>
  ${subtitle ? `<p class="subtitle">${esc(subtitle)}</p>` : ''}
  <a class="cta" href="${esc(primaryCTA.url)}">${esc(primaryCTA.label)}</a>
</main>`;
}

function heroCardBody(invite: InviteRow, props: ShareLandingProps, locale: Lang): string {
  const { primaryCTA, appCTA, returnTapCopy, forumBase } = props;
  const copy = getHeroCopy(locale);
  const { invited_by, description, topics, expires_at, max_redemptions_allowed, redemption_count } = invite;

  // Inviter name/handle are intentionally not rendered as a separate line: the
  // headline ("<name> invited you to …") already carries the inviter, so a
  // name/@handle block would just repeat it. `displayName` survives only for
  // the avatar (alt text + letter fallback). The title pill stays — it's the
  // one identity bit the headline doesn't carry.
  const displayName = invited_by.name?.trim() || invited_by.username;

  const avatarHTML = renderAvatar(forumBase, invited_by.avatar_template, displayName, invited_by.username);
  const titlePillHTML = invited_by.title
    ? `<span class="inviter-title">${esc(invited_by.title)}</span>`
    : '';

  const headline = buildHeadline(invite, locale);

  const topicHTML = topics.length > 0
    ? `<p class="topic">${copy.topicPrefix} ${esc(topics[0].fancy_title || topics[0].title)}</p>`
    : '';

  const messageHTML = description?.trim()
    ? `<blockquote class="message">${esc(description.trim())}</blockquote>`
    : '';

  // No group chips: the headline ("… invited you to join <groups>") already
  // names the destination, so chips would duplicate it (3-name cap + "+N more"
  // overflow handled in buildHeadline).

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
  ${CARD_LOGO}
  ${avatarHTML}
  ${titlePillHTML ? `<div class="inviter">${titlePillHTML}</div>` : ''}
  <h1 class="headline">${esc(headline)}</h1>
  ${topicHTML}
  ${messageHTML}
  ${statusHTML}
  <a class="cta" href="${esc(primaryCTA.url)}">${esc(primaryCTA.label)}</a>
  ${appCTA ? `<a class="cta cta-secondary" href="${esc(appCTA.url)}">${esc(appCTA.label)}</a>` : ''}
  ${appCTA ? `<p class="return-tap">${esc(returnTapCopy)}</p>` : ''}
</main>`;
}

/* ============================================================
   Profile card (`/s/u/<username>`)
   ============================================================ */

type DurationUnit = 'year' | 'month' | 'week' | 'day';

interface UserCopy {
  followers: (n: number) => string;
  following: (n: number) => string;
  /** "Cheers" is a brand/gamification term — kept verbatim, matching the iOS app. */
  cheers: (n: number) => string;
  /** Wraps the platform-localized short duration, e.g. "10mo on DirtBikeX". */
  tenureChip: (short: string) => string;
  privateProfile: string;
}

// All 21 supported locales. `getUserCopy()` falls back to `en` for any gap.
const USER_COPY: Partial<Record<Lang, UserCopy>> = {
  en: {
    followers: (n) => `${n} ${n === 1 ? 'Follower' : 'Followers'}`,
    following: (n) => `${n} Following`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `${s} on DirtBikeX`,
    privateProfile: 'This profile is private',
  },
  'zh-CN': {
    followers: (n) => `${n} 粉丝`,
    following: (n) => `${n} 关注`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `已加入 ${s}`,
    privateProfile: '该主页已设为私密',
  },
  'zh-TW': {
    followers: (n) => `${n} 粉絲`,
    following: (n) => `${n} 追蹤中`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `已加入 ${s}`,
    privateProfile: '此主頁已設為私密',
  },
  ja: {
    followers: (n) => `${n} フォロワー`,
    following: (n) => `${n} フォロー中`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `DirtBikeX歴 ${s}`,
    privateProfile: 'このプロフィールは非公開です',
  },
  ko: {
    followers: (n) => `${n} 팔로워`,
    following: (n) => `${n} 팔로잉`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `가입 ${s}`,
    privateProfile: '비공개 프로필입니다',
  },
  de: {
    followers: (n) => `${n} Follower`,
    following: (n) => `${n} Folgt`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `${s} bei DirtBikeX`,
    privateProfile: 'Dieses Profil ist privat',
  },
  it: {
    followers: (n) => `${n} Follower`,
    following: (n) => `${n} Seguiti`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `${s} su DirtBikeX`,
    privateProfile: 'Questo profilo è privato',
  },
  fr: {
    followers: (n) => `${n} Abonnés`,
    following: (n) => `${n} Abonnements`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `${s} sur DirtBikeX`,
    privateProfile: 'Ce profil est privé',
  },
  es: {
    followers: (n) => `${n} Seguidores`,
    following: (n) => `${n} Siguiendo`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `${s} en DirtBikeX`,
    privateProfile: 'Este perfil es privado',
  },
  ar: {
    followers: (n) => `${n} متابع`,
    following: (n) => `${n} يتابع`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `${s} في DirtBikeX`,
    privateProfile: 'هذا الملف الشخصي خاص',
  },
  da: {
    followers: (n) => `${n} Følgere`,
    following: (n) => `${n} Følger`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `${s} på DirtBikeX`,
    privateProfile: 'Denne profil er privat',
  },
  el: {
    followers: (n) => `${n} Ακόλουθοι`,
    following: (n) => `${n} Ακολουθεί`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `${s} στο DirtBikeX`,
    privateProfile: 'Αυτό το προφίλ είναι ιδιωτικό',
  },
  'fa-IR': {
    followers: (n) => `${n} دنبال‌کننده`,
    following: (n) => `${n} دنبال‌شده`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `${s} در DirtBikeX`,
    privateProfile: 'این نمایه خصوصی است',
  },
  fi: {
    followers: (n) => `${n} seuraajaa`,
    following: (n) => `${n} seurattua`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `${s} DirtBikeXissä`,
    privateProfile: 'Tämä profiili on yksityinen',
  },
  id: {
    followers: (n) => `${n} Pengikut`,
    following: (n) => `${n} Mengikuti`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `${s} di DirtBikeX`,
    privateProfile: 'Profil ini bersifat pribadi',
  },
  nl: {
    followers: (n) => `${n} Volgers`,
    following: (n) => `${n} Volgend`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `${s} op DirtBikeX`,
    privateProfile: 'Dit profiel is privé',
  },
  pt: {
    followers: (n) => `${n} Seguidores`,
    following: (n) => `${n} Seguindo`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `${s} no DirtBikeX`,
    privateProfile: 'Este perfil é privado',
  },
  'tr-TR': {
    followers: (n) => `${n} Takipçi`,
    following: (n) => `${n} Takip`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `DirtBikeX'te ${s}`,
    privateProfile: 'Bu profil gizli',
  },
  th: {
    followers: (n) => `${n} ผู้ติดตาม`,
    following: (n) => `${n} กำลังติดตาม`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `${s} บน DirtBikeX`,
    privateProfile: 'โปรไฟล์นี้เป็นแบบส่วนตัว',
  },
  vi: {
    followers: (n) => `${n} Người theo dõi`,
    following: (n) => `${n} Đang theo dõi`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `${s} trên DirtBikeX`,
    privateProfile: 'Hồ sơ này ở chế độ riêng tư',
  },
  sv: {
    followers: (n) => `${n} Följare`,
    following: (n) => `${n} Följer`,
    cheers: (n) => `${n} Cheers`,
    tenureChip: (s) => `${s} på DirtBikeX`,
    privateProfile: 'Den här profilen är privat',
  },
};

function getUserCopy(locale: Lang): UserCopy {
  return USER_COPY[locale] ?? USER_COPY.en!;
}

/** `<name> (@username)` — `og:title` and screen-reader headline. */
function userHeadline(user: UserRow): string {
  const displayName = user.name?.trim() || user.username;
  return displayName === user.username ? `@${user.username}` : `${displayName} (@${user.username})`;
}

/** Wrap the leading numeric token in `<b>` (e.g. "2 Followers" → "<b>2</b> Followers"). */
function boldLead(s: string): string {
  const i = s.indexOf(' ');
  if (i < 0) return esc(s);
  return `<b>${esc(s.slice(0, i))}</b> ${esc(s.slice(i + 1))}`;
}

function userCardBody(user: UserRow, props: ShareLandingProps, locale: Lang): string {
  const { primaryCTA, appCTA, forumBase } = props;
  const copy = getUserCopy(locale);
  const displayName = user.name?.trim() || user.username;
  // Single identity line: the name, or @handle when no name is set.
  const nameLine = user.name?.trim() ? esc(displayName) : `@${esc(user.username)}`;

  const avatarHTML = renderAvatar(forumBase, user.avatar_template, displayName, user.username, 288, 'avatar-profile');

  // No "return-tap" helper on profile cards — there's nothing to "finish joining".
  const ctas = `
  <a class="cta" href="${esc(primaryCTA.url)}">${esc(primaryCTA.label)}</a>
  ${appCTA ? `<a class="cta cta-secondary" href="${esc(appCTA.url)}">${esc(appCTA.label)}</a>` : ''}`;

  if (user.hidden) {
    return `
<main class="card profile-card">
  ${CARD_LOGO}
  ${avatarHTML}
  <h1 class="headline">${nameLine}</h1>
  <p class="subtitle">${esc(copy.privateProfile)}</p>
  ${ctas}
</main>`;
  }

  // Staff shield + status emoji sit inline with the name. The status text is
  // hidden — it surfaces as a hover tooltip on the emoji (title attribute).
  const shieldHTML = user.admin
    ? shieldSVG('shield-admin')
    : user.moderator
      ? shieldSVG('shield-mod')
      : '';
  const statusInlineHTML = user.status
    ? `<img class="status-emoji status-inline" src="/emojis/${esc(user.status.emoji)}.png" title="${esc(user.status.description)}" alt="${esc(user.status.description)}" onerror="this.remove()">`
    : '';
  const nameRowHTML = `<div class="name-row"><h1 class="headline">${nameLine}</h1>${shieldHTML}${statusInlineHTML}</div>`;

  const roleHTML = user.title?.trim()
    ? `<p class="role">${esc(user.title.trim())}</p>`
    : '';

  const bioHTML = user.bio_excerpt?.trim()
    ? `<p class="bio">${esc(user.bio_excerpt.trim())}</p>`
    : '';

  const metaItems: string[] = [];
  if (user.location) metaItems.push(`<span class="meta-item">📍 ${esc(user.location)}</span>`);
  if (user.website) {
    const label = user.website_name?.trim() || user.website;
    metaItems.push(`<a class="meta-item" href="${esc(user.website)}" rel="nofollow noopener" target="_blank">🌐 ${esc(label)}</a>`);
  }
  const tenure = user.created_at ? formatDurationSince(user.created_at, locale) : null;
  if (tenure) metaItems.push(`<span class="meta-item meta-tenure">🏁 ${esc(copy.tenureChip(tenure))}</span>`);
  const metaHTML = metaItems.length > 0 ? `<div class="meta">${metaItems.join('')}</div>` : '';

  const stats: string[] = [];
  if (user.total_followers != null) stats.push(`<span>${boldLead(copy.followers(user.total_followers))}</span>`);
  if (user.total_following != null) stats.push(`<span>${boldLead(copy.following(user.total_following))}</span>`);
  if (user.gamification_score != null) stats.push(`<span>${boldLead(copy.cheers(user.gamification_score))}</span>`);
  const statsHTML = stats.length > 0
    ? `<div class="stats">${stats.join('<span class="dot">·</span>')}</div>`
    : '';

  return `
<main class="card profile-card">
  ${CARD_LOGO}
  ${avatarHTML}
  ${nameRowHTML}
  ${roleHTML}
  ${bioHTML}
  ${metaHTML}
  ${statsHTML}
  ${ctas}
</main>`;
}

/**
 * Hero-on-top event card (web parity with the iOS QR card): full-width hero image
 * with status badge + wordmark, then title / organizer / date·location chips /
 * description / attendance / tags / CTAs. Grows vertically.
 */
function eventCardBody(event: EventRow, props: ShareLandingProps, locale: Lang): string {
  const { primaryCTA, appCTA, forumBase } = props;
  const orgName = event.organizer.name?.trim() || event.organizer.username;

  const heroClass = event.image_url ? 'event-hero' : 'event-hero event-hero-empty';
  // On image 404, drop the <img> and reveal the gradient/glyph placeholder.
  const heroImg = event.image_url
    ? `<img src="${esc(event.image_url)}" alt="${esc(event.name)}" onerror="this.parentElement.classList.add('event-hero-empty');this.remove()">`
    : '';

  const organizerHTML = orgName
    ? `<div class="event-organizer">${renderAvatar(forumBase, event.organizer.avatar_template, orgName, event.organizer.username, 48, 'event-organizer-avatar')}<span>${esc(orgName)}</span></div>`
    : '';

  const metaItems: string[] = [];
  const when = formatEventWhen(event, locale);
  if (when) metaItems.push(`<span class="meta-item">📅 ${esc(when)}</span>`);
  if (event.location?.trim()) metaItems.push(`<span class="meta-item">📍 ${esc(event.location.trim())}</span>`);
  const metaHTML = metaItems.length > 0 ? `<div class="meta">${metaItems.join('')}</div>` : '';

  const bioHTML = event.description?.trim() ? `<p class="bio">${esc(event.description.trim())}</p>` : '';

  const inviteesHTML = renderEventInvitees(event, forumBase);

  const tagsHTML = event.tags.length > 0
    ? `<div class="event-tags">${event.tags.slice(0, 3).map((t) => `<span class="event-tag">#${esc(t)}</span>`).join('')}</div>`
    : '';

  const ctas = `
  <a class="cta" href="${esc(primaryCTA.url)}">${esc(primaryCTA.label)}</a>
  ${appCTA ? `<a class="cta cta-secondary" href="${esc(appCTA.url)}">${esc(appCTA.label)}</a>` : ''}`;

  return `
<main class="card event-card">
  <div class="${heroClass}">
    ${heroImg}
    <div class="event-hero-scrim"></div>
    ${eventStatusBadge(event)}
  </div>
  <div class="event-body">
    <div class="event-title-row">
      <h1 class="headline">${esc(event.name)}</h1>
      ${CARD_LOGO}
    </div>
    ${organizerHTML}
    ${metaHTML}
    ${bioHTML}
    ${inviteesHTML}
    ${tagsHTML}
    ${ctas}
  </div>
</main>`;
}

/**
 * Invitee row — sample avatars, each with an RSVP-status badge on the
 * bottom-trailing edge, then a `+N` overflow for the rest invited. Mirrors the
 * iOS card's invitee row.
 */
function renderEventInvitees(event: EventRow, forumBase: string): string {
  if (event.invitees.length === 0) return '';
  const badge = (status: string | null): string => {
    const map: Record<string, { cls: string; glyph: string }> = {
      going: { cls: 'going', glyph: '✓' },
      interested: { cls: 'interested', glyph: '★' },
      not_going: { cls: 'notgoing', glyph: '✕' },
    };
    const b = status ? map[status] : undefined;
    return b ? `<span class="event-invitee-badge event-invitee-badge-${b.cls}">${b.glyph}</span>` : '';
  };
  const avatars = event.invitees
    .map((inv) => {
      const initial = esc(firstGrapheme(inv.name || '?'));
      const svg = letterAvatarSVG(initial);
      const img = inv.avatar_template
        ? `<img src="${esc(`${forumBase}${inv.avatar_template.replace('{size}', '48')}`)}" alt="${esc(inv.name ?? '')}" onerror="this.remove()">`
        : '';
      return `<span class="event-invitee">${svg}${img}${badge(inv.status)}</span>`;
    })
    .join('');
  const overflow = Math.max(0, (event.stats?.invited ?? 0) - event.invitees.length);
  const overflowHTML = overflow > 0 ? `<span class="event-overflow">+${overflow}</span>` : '';
  return `<div class="event-invitees">${avatars}${overflowHTML}</div>`;
}

/** Lifecycle badge — mirrors iOS `EventStatusBadge` (English labels, like iOS). */
function eventStatusBadge(event: EventRow): string {
  const [kind, label] = event.is_ongoing
    ? ['live', 'LIVE']
    : event.is_expired
      ? ['ended', 'ENDED']
      : event.is_closed
        ? ['closed', 'CLOSED']
        : ['upcoming', 'UPCOMING'];
  return `<span class="event-badge event-badge-${kind}">${label}</span>`;
}

/**
 * Localized "when" in the event's own timezone: a single date (all-day), a
 * `start → end` range across days, else `date · start–end` for a timed event.
 */
function formatEventWhen(event: EventRow, locale: Lang): string | null {
  const startMs = Date.parse(event.starts_at);
  if (Number.isNaN(startMs)) return null;
  const tz = event.timezone || undefined;
  try {
    const dfmt = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', ...(tz ? { timeZone: tz } : {}) });
    let endMs = event.ends_at ? Date.parse(event.ends_at) : NaN;
    // All-day end is an exclusive next-midnight — step back so one day isn't a span.
    if (!Number.isNaN(endMs) && event.all_day) endMs -= 1000;

    const start = new Date(startMs);
    const datePart = dfmt.format(start);
    if (!Number.isNaN(endMs)) {
      const end = new Date(endMs);
      if (dfmt.format(end) !== datePart) return `${datePart} → ${dfmt.format(end)}`;
    }
    if (event.all_day) return datePart;
    const tfmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
    if (!Number.isNaN(endMs)) return `${datePart} · ${tfmt.format(start)}–${tfmt.format(new Date(endMs))}`;
    return `${datePart} · ${tfmt.format(start)}`;
  } catch {
    return event.starts_at.slice(0, 10) || null;
  }
}

/** OG description fallback when an event has no description: when · location. */
function eventOgDescription(event: EventRow, locale: Lang): string | null {
  const parts = [formatEventWhen(event, locale), event.location?.trim() || null].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Inline FontAwesome shield-halved; color comes from the CSS class (currentColor). */
function shieldSVG(className: string): string {
  return `<svg class="shield ${className}" viewBox="0 0 512 512" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M256 0c4.6 0 9.2 1 13.4 2.9L457.7 82.8c22 9.3 38.4 31 38.3 57.2c-.5 99.2-41.3 280.7-213.6 363.2c-16.7 8-36.1 8-52.8 0C57.3 420.7 16.5 239.2 16 140c-.1-26.2 16.3-47.9 38.3-57.2L242.7 2.9C246.8 1 251.4 0 256 0zm0 66.8l0 378V66.8L432 141.4c-.9 88.7-38 236.6-176 303.4V66.8z"/></svg>`;
}

/**
 * Platform-localized compact membership length (largest unit) from an ISO
 * creation timestamp — e.g. "10mo" (en), "10个月" (zh), "10 Mon." (de). Uses
 * `Intl.NumberFormat` narrow units so all 21 locales render correctly without
 * a hand-translated abbreviation table.
 */
function formatDurationSince(iso: string, locale: Lang): string | null {
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return null;
  const diffMs = Date.now() - target;
  if (diffMs <= 0) return null;

  const days = Math.floor(diffMs / 86400000);
  const years = Math.floor(days / 365);
  const months = Math.floor(days / 30);
  const weeks = Math.floor(days / 7);
  const [n, unit]: [number, DurationUnit] =
    years >= 1 ? [years, 'year']
    : months >= 1 ? [months, 'month']
    : weeks >= 1 ? [weeks, 'week']
    : [Math.max(days, 1), 'day'];

  try {
    return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' }).format(n);
  } catch {
    return `${n} ${unit}${n === 1 ? '' : 's'}`;
  }
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
  // Event hero is an absolute CDN URL — use it directly (not forumBase-prefixed).
  if (props.event?.image_url) return props.event.image_url;
  const template =
    props.invite?.invited_by.avatar_template ??
    props.user?.avatar_template ??
    props.event?.organizer.avatar_template ??
    null;
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
  size = 144,
  extraClass = '',
): string {
  // SVG letter avatar is always present underneath; the <img> overlays it.
  // If the img 404s, `this.remove()` strips it and reveals the SVG below.
  // Avoids JS-in-HTML-in-JS double escaping.
  const cls = extraClass ? `avatar ${extraClass}` : 'avatar';
  const initial = firstGrapheme(displayName || username);
  const svg = letterAvatarSVG(initial);
  if (!avatarTemplate) return `<div class="${cls}">${svg}</div>`;
  const path = avatarTemplate.replace('{size}', String(size));
  const src = esc(`${forumBase}${path}`);
  return `<div class="${cls}">${svg}<img src="${src}" alt="${esc(displayName)}" onerror="this.remove()"></div>`;
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

/** Drop the `lang` query param so `og:url` is the locale-agnostic canonical. */
function canonicalURL(requestURL: string): string {
  try {
    const u = new URL(requestURL);
    u.searchParams.delete('lang');
    return u.toString();
  } catch {
    return requestURL;
  }
}

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
  position: relative;
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
  border-inline-start: 3px solid var(--dirt-400);
  padding-block: 0.25rem;
  padding-inline-start: 0.75rem;
  margin: 1rem 0 0;
  text-align: start;
  line-height: 1.5;
  font-size: 0.9375rem;
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
.cta-secondary {
  margin-top: 0.625rem;
  background: transparent;
  color: var(--dirt-600);
  border: 1.5px solid var(--dirt-500);
}
.cta-secondary:hover, .cta-secondary:active { background: var(--dirt-50); }
.return-tap {
  margin-top: 1rem;
  font-size: 0.8125rem;
  color: var(--clay-500);
  line-height: 1.4;
}

/* Profile card (/s/u/<username>) — left-aligned, founder-inspired */
.profile-card { text-align: left; position: relative; }
.profile-card .cta { text-align: center; }
.card-logo { position: absolute; top: 1.1rem; right: 1.1rem; width: 34px; height: auto; opacity: 0.95; }
.profile-card .avatar.avatar-profile { width: 104px; height: 104px; margin: 0 0 1rem; }
.profile-card .headline { margin: 0; font-size: 1.6rem; }
.profile-card .subtitle { text-align: start; margin-top: 0.5rem; }
.role {
  margin: 0.4rem 0 0;
  color: var(--dirt-600);
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.name-row { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
.name-row .headline { margin: 0; }
.shield { flex: none; }
.shield-admin { color: #f5b400; }
.shield-mod { color: var(--clay-500); }
.status-emoji { width: 18px; height: 18px; flex: none; }
.status-inline { width: 22px; height: 22px; cursor: default; }
.bio {
  margin: 0.75rem 0 0;
  color: var(--clay-700);
  line-height: 1.5;
  font-size: 0.9375rem;
}
.meta {
  margin: 0.875rem 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  max-width: 100%;
  padding: 0.25rem 0.625rem;
  background: var(--clay-100);
  color: var(--clay-700);
  border-radius: 999px;
  font-size: 0.8125rem;
  font-weight: 500;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
a.meta-item:hover, a.meta-item:active { background: var(--clay-200); }
.stats {
  margin: 1rem 0 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  color: var(--clay-600);
  font-size: 0.9375rem;
}
.stats b { color: #1a1a1a; font-weight: 700; }
.stats .dot { color: var(--clay-500); }

/* Event card (/s/e/<id>) — hero image on top, structured body */
.event-card { text-align: left; padding: 0; overflow: hidden; }
.event-hero { position: relative; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; background: linear-gradient(135deg, var(--dirt-400), var(--clay-700)); }
.event-hero > img { width: 100%; height: 100%; object-fit: cover; display: block; }
.event-hero-empty::after { content: '📅'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 3rem; opacity: 0.9; }
.event-hero-scrim { position: absolute; inset: 0 0 50% 0; background: linear-gradient(to bottom, rgba(0,0,0,0.55), transparent); pointer-events: none; }
.event-badge { position: absolute; top: 0.85rem; left: 0.85rem; padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em; color: #fff; white-space: nowrap; }
.event-badge-upcoming { background: rgba(10,122,255,0.92); }
.event-badge-live { background: rgba(52,199,89,0.92); }
.event-badge-ended { background: rgba(120,120,128,0.92); }
.event-badge-closed { background: rgba(255,59,48,0.92); }
.event-card .card-logo { position: static; top: auto; right: auto; width: auto; height: 26px; margin-top: 0.15rem; flex: none; opacity: 1; }
.event-body { padding: 1.25rem 1.5rem 1.5rem; }
.event-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.6rem; }
.event-title-row .headline { margin: 0; font-size: 1.5rem; }
.event-card .cta { text-align: center; }
.event-organizer { margin: 0.5rem 0 0; display: flex; align-items: center; gap: 0.5rem; color: var(--clay-600); font-size: 0.9rem; }
.event-organizer-avatar { width: 24px; height: 24px; margin: 0; flex: none; }
.event-invitees { margin: 0.875rem 0 0; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.event-invitee { position: relative; width: 34px; height: 34px; flex: none; }
.event-invitee > svg, .event-invitee > img { position: absolute; inset: 0; width: 34px; height: 34px; border-radius: 50%; object-fit: cover; }
.event-invitee > img { z-index: 1; }
.event-invitee-badge { position: absolute; right: -3px; bottom: -3px; z-index: 2; width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9px; line-height: 1; color: #fff; box-shadow: 0 0 0 2px #ffffff; }
.event-invitee-badge-going { background: #34c759; }
.event-invitee-badge-interested { background: #f5b400; }
.event-invitee-badge-notgoing { background: #ff3b30; }
.event-overflow { color: var(--clay-600); font-size: 0.85rem; font-weight: 600; }
.event-tags { margin: 0.75rem 0 0; display: flex; flex-wrap: wrap; gap: 0.4rem; }
.event-tag { padding: 0.15rem 0.5rem; background: var(--clay-100); color: var(--clay-600); border-radius: 6px; font-size: 0.75rem; }

@media (prefers-color-scheme: dark) {
  body {
    background: linear-gradient(135deg, var(--clay-950) 0%, var(--clay-900) 50%, var(--clay-800) 100%);
    color: var(--clay-50);
  }
  .card {
    background: #1a1614;
    box-shadow: 0 20px 60px -20px rgba(0,0,0,0.6), 0 4px 12px rgba(0,0,0,0.4);
  }
  .headline { color: var(--clay-50); }
  .cta-secondary { color: var(--dirt-200); border-color: var(--dirt-400); }
  .cta-secondary:hover, .cta-secondary:active { background: rgba(243,118,11,0.12); }
  .inviter-title { background: var(--clay-800); color: var(--clay-100); }
  .topic, .subtitle { color: var(--clay-200); }
  .message { color: var(--clay-100); }
  .badge { background: var(--clay-800); color: var(--clay-100); }
  .return-tap { color: var(--clay-200); }
  .role { color: var(--dirt-200); }
  .bio { color: var(--clay-100); }
  .shield-mod { color: var(--clay-200); }
  .meta-item { background: var(--clay-800); color: var(--clay-100); }
  a.meta-item:hover, a.meta-item:active { background: var(--clay-700); }
  .stats { color: var(--clay-200); }
  .stats b { color: var(--clay-50); }
}
`;
