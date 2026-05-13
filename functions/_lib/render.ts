import type { ShareLandingProps } from './types';

/**
 * Render a share-link landing page response. Inline styles; no Astro layout
 * reach (Pages Functions are bundled separately from the Astro app).
 *
 * Cache-Control is intentionally left off success responses so `public/_headers`
 * (`/s/*` → `max-age=60`) is the single source of truth. Pass `init.cacheControl`
 * to override on error paths (Phase 3.3 uses `no-cache`).
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

function buildHTML(props: ShareLandingProps, requestURL: string): string {
  const { title, subtitle, primaryCTA, returnTapCopy, locale } = props;
  const t = esc(title);
  const sub = subtitle ? esc(subtitle) : '';
  const url = esc(requestURL);

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t} · DirtBikeX</title>
<meta property="og:title" content="${t}">
${sub ? `<meta property="og:description" content="${sub}">` : ''}
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 2rem; max-width: 480px; margin-inline: auto; color: #1a1a1a; }
  h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
  p { margin: 0 0 1rem; line-height: 1.5; color: #555; }
  .cta { display: inline-block; padding: .75rem 1.25rem; background: #1a1a1a; color: #fff; text-decoration: none; border-radius: .5rem; font-weight: 600; }
  .return-tap { margin-top: 1.5rem; font-size: .875rem; color: #888; }
  @media (prefers-color-scheme: dark) {
    body { background: #0a0a0a; color: #f0f0f0; }
    p { color: #aaa; }
    .cta { background: #f0f0f0; color: #0a0a0a; }
    .return-tap { color: #777; }
  }
</style>
</head>
<body>
<h1>${t}</h1>
${sub ? `<p>${sub}</p>` : ''}
<a class="cta" href="${esc(primaryCTA.url)}">${esc(primaryCTA.label)}</a>
<p class="return-tap">${esc(returnTapCopy)}</p>
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
