// App Store URL for the app (App Store numeric ID 6765577701). Link is dormant
// (404 / "not available") until the app is publicly released, then lights up.
export const APP_STORE_URL = 'https://apps.apple.com/app/id6765577701';

// Forum origin, derived from the SITE_URL build var so prod and preview builds link
// to the matching forum apex (forum.dirtbikex.com / forum.dirtbikechina.com).
// Build-time only — read via process.env (see astro.config.mjs); never import this
// into a client <script>, pass it in via frontmatter instead.
const apex = new URL(process.env.SITE_URL ?? 'https://www.dirtbikex.com').hostname.replace(/^www\./, '');
export const FORUM_BASE = `https://forum.${apex}`;

// Public social profiles + contact channels, shared by the founder page, footer, and contact page.
export const SOCIALS = {
  facebook: 'https://www.facebook.com/people/Dirt-Bike-X/61592048966883/',
  instagram: 'https://www.instagram.com/teamdirtbikex/',
  x: 'https://x.com/teamdirtbikex',
  tiktok: 'https://www.tiktok.com/@dirtbikex?_r=1&_t=ZT-98sP0fdJcPl',
  douyin: 'https://v.douyin.com/H3LjmKZt8_c/',
} as const;
// Founder (Calvin) personal Facebook — founders page only.
export const FOUNDER_FACEBOOK = 'https://www.facebook.com/profile.php?id=61590664892188';
export const SUPPORT_EMAIL = 'support@dirtbikex.com';

// The operator's own verdict on a place, which overrides everything else. A slug that
// is absent here is decided by the signals: a stop in the 100 challenge, or a bound
// forum topic. Never the catalog's CRM tier, which says how the row was sourced rather
// than whether we stand behind it.
//
// `false` matters as much as `true`: we ride venues that then decline to come onto the
// platform, and a stop on the map is not a claim that its owner is with us.
export const MAP_VERIFIED: Record<string, boolean> = {
  // Episode 02. Ridden, filmed, and not joining.
  'cn-qiu-long-ke-ji-hang-zhou-yue-ye-ji-di': false,
};
