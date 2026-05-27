// App Store URL — placeholder until the real id is assigned by App Store Connect.
// Replace the numeric id below with the real one when known.
export const APP_STORE_URL = 'https://apps.apple.com/app/id0000000000';

// Forum origin, derived from the SITE_URL build var so prod and preview builds link
// to the matching forum apex (forum.dirtbikex.com / forum.dirtbikechina.com).
// Build-time only — read via process.env (see astro.config.mjs); never import this
// into a client <script>, pass it in via frontmatter instead.
const apex = new URL(process.env.SITE_URL ?? 'https://www.dirtbikex.com').hostname.replace(/^www\./, '');
export const FORUM_BASE = `https://forum.${apex}`;
