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

/**
 * One card per kind, drawn from the map's own marker glyph in that kind's colour,
 * so a share unfurls looking like the pin it came from. No words on them: WeChat
 * shows the title and description as live text beside a small square thumbnail, so
 * text baked into the picture is text rendered twice — and rendering CJK at the
 * edge would mean shipping a font we cannot afford to ship.
 *
 * Baked offline (see `public/share/`), served as static assets. Zero runtime cost.
 */
export const KIND_CARDS = ['track', 'route', 'shop', 'challenge', 'rider'] as const;
export type KindCard = (typeof KIND_CARDS)[number];

export function kindCardURL(kind: KindCard, requestURL: string): string {
  try {
    return new URL(`/share/card-${kind}.png`, requestURL).toString();
  } catch {
    return `https://www.dirtbikex.com/share/card-${kind}.png`;
  }
}
