/**
 * The mark a share falls back to when the thing being shared has no picture of
 * its own — a track, a route, a shop, a stop in the challenge.
 *
 * Square, and 512px, because WeChat is the strictest consumer: its crawler
 * refuses anything under 300px, crops what it gets to a square thumbnail, and
 * will not follow a redirect or send cookies to fetch it. A landscape site card
 * survives that crop only by luck. Served from our own origin, so there is no
 * hotlink rule, no auth and no third party in the path.
 */
export const BRAND_CARD = { path: '/icon-512.png', width: 512, height: 512 } as const;

/** Absolute URL for the mark, on whichever origin the request arrived at. */
export function brandCardURL(requestURL: string): string {
  try {
    return new URL(BRAND_CARD.path, requestURL).toString();
  } catch {
    return `https://www.dirtbikex.com${BRAND_CARD.path}`;
  }
}
