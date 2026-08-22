import { wgsToGcj } from './geo';
import type { UploadReason, UploadResult } from './upload';
import type {
  SeriesEntry,
  Strings,
  TrackProps,
  Trail,
} from './types';

/** Brand marks in their own colours. `uid` keeps gradient ids unique per render. */
const TIKTOK_NOTE =
  'M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 1 1-1.86-2.48V9.77a5.68 5.68 0 1 0 4.95 5.63V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3a4.29 4.29 0 0 1-3.24-1.48Z';

const PLATFORM_ICONS: Record<string, (uid: string) => string> = {
  tiktok: () =>
    `<path d="${TIKTOK_NOTE}" fill="#25F4EE" transform="translate(-1.1 .9)"/>` +
    `<path d="${TIKTOK_NOTE}" fill="#FE2C55" transform="translate(1.1 -.9)"/>` +
    `<path d="${TIKTOK_NOTE}" fill="currentColor"/>`,
  douyin: () =>
    `<path d="${TIKTOK_NOTE}" fill="#FE2C55" transform="translate(-1.1 .9)"/>` +
    `<path d="${TIKTOK_NOTE}" fill="#25F4EE" transform="translate(1.1 -.9)"/>` +
    `<path d="${TIKTOK_NOTE}" fill="currentColor"/>`,
  facebook: () =>
    '<circle cx="12" cy="12" r="10" fill="#1877F2"/>' +
    '<path fill="#fff" d="M14.9 12.9h2.2l.35-2.28h-2.55V9.14c0-.62.31-1.23 1.29-1.23h1V6.02s-.9-.15-1.77-.15c-1.8 0-2.98 1.09-2.98 3.07v1.68H10.1v2.28h2.34v5.5h2.46v-5.5Z"/>',
  instagram: (uid) =>
    `<defs><linearGradient id="ig-${uid}" x1="2" y1="22" x2="22" y2="2">` +
    '<stop offset="0" stop-color="#FEDA75"/><stop offset=".35" stop-color="#FA7E1E"/>' +
    '<stop offset=".6" stop-color="#D62976"/><stop offset=".85" stop-color="#962FBF"/>' +
    '<stop offset="1" stop-color="#4F5BD5"/></linearGradient></defs>' +
    `<rect x="2.6" y="2.6" width="18.8" height="18.8" rx="5.4" fill="none" stroke="url(#ig-${uid})" stroke-width="2"/>` +
    `<circle cx="12" cy="12" r="4.2" fill="none" stroke="url(#ig-${uid})" stroke-width="2"/>` +
    `<circle cx="17.3" cy="6.7" r="1.25" fill="url(#ig-${uid})"/>`,
};

const CHEVRON = (dir: 'prev' | 'next') =>
  `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2"` +
  ` stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${
    dir === 'prev' ? 'M14.5 5.5 8 12l6.5 6.5' : 'M9.5 5.5 16 12l-6.5 6.5'
  }"/></svg>`;

/** Trail marks live in the same row as the platform marks, drawn in the panel's ink. */
const TRAIL_ICONS: Record<string, string> = {
  rider:
    '<circle cx="12" cy="8" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
    '<path d="M4.8 20.2a7.2 7.2 0 0 1 14.4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  thread:
    '<path d="M20.4 13.2a6.6 6.6 0 0 1-6.6 6.6H8.2L3.6 22.2l1.1-3.6a6.6 6.6 0 0 1-1.1-3.6V9.6A6.6 6.6 0 0 1 10.2 3h3.6a6.6 6.6 0 0 1 6.6 6.6Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  route:
    '<path d="M6 20c0-3.2 3-3.6 6-4.4S18 13.2 18 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
    '<circle cx="6" cy="20" r="2.2" fill="currentColor"/><circle cx="18" cy="6.6" r="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/>',
};

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: 'TikTok',
  douyin: '抖音',
  facebook: 'Facebook',
  instagram: 'Instagram',
};

/** Douyin stands in for TikTok where TikTok isn't the platform people use. */
const platformsFor = (lang: string) =>
  lang === 'zh-CN' ? ['douyin', 'instagram', 'facebook'] : ['tiktok', 'instagram', 'facebook'];

/** The two short-video platforms carry the same clip, so they're offered together. */
const SHORT_VIDEO = ['tiktok', 'douyin'] as const;
const recommendedShortVideo = (lang: string) => (lang === 'zh-CN' ? 'douyin' : 'tiktok');

export interface PanelDeps {
  root: HTMLElement;
  strings: Strings;
  lang: string;
  socials: Partial<Record<string, string>>;
  contactUrl: string;
  forumBase: string;
  onClose(): void;
  /** Hands the island a Turnstile token to send with the next upload. */
  setTurnstileToken(token: string): void;
  /** Bottom-trailing arrows: -1 = previous episode, +1 = next. */
  onStep(delta: number): void;
  /** Episode sheet -> venue sheet, pushed onto the view stack. */
  onVenue?(track: TrackProps): void;
  /**
   * Whether we vouch for this place ourselves. Deliberately NOT the catalog's tier:
   * that records how the row was sourced (a directory scrape vs. a curated import),
   * which is our bookkeeping and says nothing a rider should read as an endorsement.
   * `hasTopic` is the one signal the sheet learns late, so it is asked twice: once as
   * the sheet is built, and again when the owner lookup lands.
   */
  isVerified(slug: string, hasTopic: boolean): boolean;
}

/** Picks the viewer's locale out of a {locale: text} block, falling back to en. */
function localized(block: Record<string, string> | null | undefined, lang: string): string | null {
  if (!block) return null;
  return block[lang] ?? block[lang.split('-')[0]!] ?? block.en ?? null;
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * lucide `square-arrow-out-up-right` — the same glyph the sheets use for anything
 * that leaves this surface, so "share" and "open elsewhere" read as one family.
 */
const SHARE_SVG =
  '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"' +
  ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/>' +
  '<path d="m21 3-9 9"/><path d="M15 3h6v6"/></svg>';

/** lucide `messages-square` — the forum thread this thing is discussed in. */
const THREAD_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"' +
  ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>' +
  '<path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"/></svg>';

/** lucide `info` — the trail's own details, one step out to gpx.studio. */
const INFO_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"' +
  ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';

/**
 * The sheet's title, with a share control on the trailing edge.
 *
 * Every sheet has a shareable twin at `/s/<kind>/<key>` — the worker-rendered
 * card, which is what carries the OG unfurl and the app CTA. Sharing the map URL
 * instead would unfurl as "DirtBikeX" and land a recipient on a viewport, so the
 * button always shares the card and lets the card offer the map.
 *
 * `navigator.share` where it exists (every phone this matters on), clipboard
 * everywhere else, and the button says so rather than silently doing nothing.
 */
function titleRow(
  host: HTMLElement,
  text: string,
  share:
    | { kind: 'route' | 'track' | 'shop' | 'challenge'; key: string }
    // An explicit URL, for a sheet whose shareable thing is not a /share/ card — an
    // unlisted trail has only its secret link, and it belongs in the same corner every
    // other sheet puts its share button.
    | { url: string; pulse?: boolean }
    | null,
  strings: Record<string, string>,
  /** Sits before the title — the visibility mark, on the sheets that have one. */
  lead?: HTMLElement | null,
): void {
  const row = el('div', 'wm-panel__titlerow');
  if (lead) row.appendChild(lead);
  row.appendChild(el('h2', 'wm-panel__title', text));

  const target = share && ('url' in share ? share.url : share.key ? `${location.origin}/share/${share.kind}/${encodeURIComponent(share.key)}` : '');
  if (target) {
    const label = strings['map.panel.share'] ?? 'Share';
    // `pulse` is for the one sheet where this button is the only way to keep something:
    // it beats gently every five seconds instead of shouting once.
    const pulse = !!share && 'pulse' in share && share.pulse;
    const button = el('button', `wm-panel__share${pulse ? ' wm-panel__share--pulse' : ''}`) as HTMLButtonElement;
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', `${label} · ${text}`);
    button.innerHTML =
      SHARE_SVG;

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const url = target;
      const data = { title: text, url };
      if (navigator.share) {
        void navigator.share(data).catch(() => {});
        return;
      }
      void navigator.clipboard
        ?.writeText(url)
        .then(() => {
          button.classList.add('is-copied');
          button.title = strings['map.panel.shareCopied'] ?? 'Link copied';
          setTimeout(() => {
            button.classList.remove('is-copied');
            button.title = label;
          }, 1600);
        })
        .catch(() => {});
    });
    row.appendChild(button);
  }

  host.appendChild(row);
}

/**
 * Three map fragments, each with a ride across it, cross-fading every five seconds.
 *
 * The roads are deliberately unlabelled and unplaceable: this says "your trail will look
 * like this", not "your trail will be here". Drawn rather than screenshotted so it inherits
 * the page's own colours in both themes and weighs nothing.
 */
function uploadPeek(): HTMLElement {
  const wrap = el('div', 'wm-peek');
  wrap.setAttribute('aria-hidden', 'true');

  // Each scene: background streets, then one trace. Coordinates are hand-placed on a
  // 320x150 canvas; the shapes are meant to read as somewhere, not as anywhere real.
  // Each scene: a block of built-up ground, a couple of main roads, a scatter of minor
  // ones, then the ride. Irregular on purpose — a regular grid reads as a chart, which is
  // what the first version of this looked like.
  const scenes = [
    {
      blocks: ['M0 0 H126 V58 H0 Z', 'M196 92 H320 V150 H196 Z'],
      major: ['M-10 66 C60 62 96 78 150 76 214 74 260 58 330 62', 'M118 -10 C124 40 108 74 116 108 122 134 116 148 118 160'],
      minor: ['M-10 30 H132', 'M150 -10 V60', 'M186 26 H330', 'M40 96 H330', 'M62 60 V160', 'M244 -10 V72', 'M-10 122 H160', 'M282 62 V160'],
      trail: 'M34 128 C58 112 52 92 74 84 96 76 108 92 128 86 152 79 158 56 182 52 208 48 214 66 240 60 262 55 268 36 292 32',
    },
    {
      blocks: ['M0 96 C60 90 120 112 190 108 250 105 300 118 320 114 V150 H0 Z'],
      major: ['M-10 28 C60 32 120 58 190 56 260 54 300 38 330 42', 'M-10 100 C70 94 130 116 200 112 270 108 310 122 330 118'],
      minor: ['M46 -10 V150', 'M232 -10 V150', 'M96 12 L140 92', 'M270 20 L246 130', 'M-10 62 H120', 'M170 70 H330'],
      trail: 'M56 22 C72 54 54 78 74 100 92 120 124 130 152 118 174 108 176 78 200 70 226 62 244 84 262 106 272 118 280 126 288 132',
    },
    {
      blocks: ['M148 0 L320 44 V0 Z', 'M0 118 L112 84 L0 150 Z'],
      major: ['M-10 60 L118 18 L232 64 L330 24', 'M-10 120 L108 82 L242 128 L330 94'],
      minor: ['M118 18 V160', 'M232 64 V160', 'M60 -10 L74 150', 'M290 -10 L276 150', 'M-10 90 H330'],
      trail: 'M40 104 C74 100 84 66 116 54 144 44 168 60 188 82 208 104 236 116 268 100 280 94 288 88 296 82',
    },
  ];

  const svgNS = 'http://www.w3.org/2000/svg';
  const frames = scenes.map((scene, i) => {
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 320 150');
    svg.setAttribute('class', `wm-peek__frame${i === 0 ? ' is-on' : ''}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    for (const d of scene.blocks) {
      const block = document.createElementNS(svgNS, 'path');
      block.setAttribute('d', d);
      block.setAttribute('class', 'wm-peek__block');
      svg.appendChild(block);
    }
    for (const [cls, list] of [['wm-peek__road', scene.minor], ['wm-peek__road wm-peek__road--major', scene.major]] as const) {
      for (const d of list) {
        const road = document.createElementNS(svgNS, 'path');
        road.setAttribute('d', d);
        road.setAttribute('class', cls);
        svg.appendChild(road);
      }
    }
    const trail = document.createElementNS(svgNS, 'path');
    trail.setAttribute('d', scene.trail);
    trail.setAttribute('class', 'wm-peek__trail');
    svg.appendChild(trail);
    wrap.appendChild(svg);
    return svg;
  });

  // Reduced motion keeps the first frame and never swaps: the point is made by one.
  if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    let at = 0;
    const timer = window.setInterval(() => {
      frames[at]!.classList.remove('is-on');
      at = (at + 1) % frames.length;
      frames[at]!.classList.add('is-on');
      // The sheet is rebuilt on every open, so the old interval has to die with its DOM
      // or they accumulate one per visit to this sheet.
      if (!wrap.isConnected) window.clearInterval(timer);
    }, 5000);
  }
  return wrap;
}

const PENCIL_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>';

const EYE_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';

const EYE_OFF_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>';

/**
 * Loads Turnstile on demand and resolves with its token.
 *
 * On demand, and only when a site key exists, because the script comes from
 * challenges.cloudflare.com — a third-party host on a site whose no-external-assets rule
 * has its own CI test, and one whose reachability from mainland China is not something
 * this codebase can assume. With no key configured nothing is fetched at all.
 */
function renderTurnstile(host: HTMLElement, siteKey: string): Promise<string> {
  interface TurnstileApi {
    render(el: HTMLElement, opts: Record<string, unknown>): void;
  }
  const api = () => (window as unknown as { turnstile?: TurnstileApi }).turnstile;

  const script = (): Promise<void> => {
    if (api()) return Promise.resolve();
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile]');
    if (existing) {
      return new Promise((done, fail) => {
        existing.addEventListener('load', () => done(), { once: true });
        existing.addEventListener('error', () => fail(new Error('turnstile')), { once: true });
      });
    }
    return new Promise((done, fail) => {
      const tag = document.createElement('script');
      tag.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      tag.async = true;
      tag.defer = true;
      tag.dataset.turnstile = 'true';
      tag.addEventListener('load', () => done(), { once: true });
      tag.addEventListener('error', () => fail(new Error('turnstile')), { once: true });
      document.head.appendChild(tag);
    });
  };

  return script().then(
    () =>
      new Promise<string>((done, fail) => {
        const turnstile = api();
        if (!turnstile) return fail(new Error('turnstile'));
        host.textContent = '';
        turnstile.render(host, {
          sitekey: siteKey,
          callback: (token: string) => done(token),
          'error-callback': () => fail(new Error('turnstile')),
          'timeout-callback': () => fail(new Error('turnstile')),
        });
      }),
  );
}

/**
 * Lifts the sheet clear of the on-screen keyboard while a field is focused.
 *
 * iOS does not reflow the layout viewport for the keyboard — it shrinks the VISUAL
 * viewport and leaves everything else where it was, so a bottom-anchored sheet ends up
 * underneath it. `visualViewport` is the only thing that reports the difference. Without
 * this, renaming opened a keyboard over the field being renamed.
 */
function liftForKeyboard(root: HTMLElement): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const apply = () => {
    const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--wm-keyboard', `${Math.round(hidden)}px`);
  };
  apply();
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  root.dataset.keyboardWatch = 'on';
  (root as unknown as { _wmKeyboardOff?: () => void })._wmKeyboardOff = () => {
    vv.removeEventListener('resize', apply);
    vv.removeEventListener('scroll', apply);
  };
}

/**
 * Snaps the page back to 1x after an input closes.
 *
 * iOS leaves the page wherever the keyboard left it, and there is no API to set zoom. The
 * one lever that works is the viewport meta: clamping maximum-scale forces a reset, and
 * restoring it immediately keeps pinch-zoom available. Ugly, and the only thing that does
 * it — a rider should not have to pinch their way back to a centred map after typing a name.
 */
function resetZoom(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  const was = meta.content;
  meta.content = 'width=device-width, initial-scale=1, maximum-scale=1';
  window.setTimeout(() => {
    meta.content = was;
  }, 250);
}

function dropAfterKeyboard(root: HTMLElement): void {
  (root as unknown as { _wmKeyboardOff?: () => void })._wmKeyboardOff?.();
  delete root.dataset.keyboardWatch;
  root.style.removeProperty('--wm-keyboard');
}

const CLOCK_FADING_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a10 10 0 0 1 7.38 16.75"/><path d="M12 6v6l4 2"/><path d="M2.5 8.875a10 10 0 0 0-.5 3"/><path d="M2.83 16a10 10 0 0 0 2.43 3.4"/><path d="M4.636 5.235a10 10 0 0 1 .891-.857"/><path d="M8.644 21.42a10 10 0 0 0 7.631-.38"/></svg>';

/**
 * When this trail stops existing, as a chip rather than a sentence.
 *
 * Dashed and dimmer than the chips beside it on purpose: the others state what the ride
 * IS, and this one states what is about to happen to it. It reads as provisional because
 * it is, and it disappears the moment somebody claims the trail.
 */
function expiryChip(hours: number, strings: Record<string, string>): HTMLElement {
  const chip = el('span', 'wm-chip wm-chip--pending');
  const icon = el('span', 'wm-chip__icon');
  icon.innerHTML = CLOCK_FADING_SVG;
  chip.append(icon, document.createTextNode(
    (strings['map.upload.expiresChip'] ?? 'Expires in {n} h').replace('{n}', String(hours)),
  ));
  return chip;
}

/**
 * The rider who has not signed for this trail yet.
 *
 * Same geometry as a real byline and deliberately not a link — it is the shape of the
 * missing person, not a person. Used on any trail with no author: the anonymous sheet a
 * link opens, and the rider's own sheet the moment after they upload.
 */
function anonBlock(strings: Record<string, string>): HTMLElement {
  const by = el('div', 'wm-by wm-by--empty');
  by.appendChild(el('span', 'wm-by__avatar', '?'));
  const idBlock = el('span', 'wm-by__id');
  idBlock.append(
    el('span', 'wm-by__name', strings['map.trail.anonymous'] ?? 'Anonymous'),
    el('span', 'wm-by__meta', strings['map.trail.anonymousMeta'] ?? 'nobody has claimed this ride'),
  );
  by.appendChild(idBlock);
  return by;
}

/**
 * Whether this trail is on the public map, said once, in the byline where the rest of its
 * provenance lives. An eye that is open or shut is the whole message; the text is the
 * tooltip, because a sheet that has to explain its own icon has the wrong icon.
 */
function visibilityMark(onMap: boolean, strings: Record<string, string>): HTMLElement {
  // A statement, not a control. It used to open an explanation; the sheet now says the
  // same thing in prose under the title, and two places saying it was one too many.
  const mark = el('span', `wm-eye${onMap ? ' wm-eye--on' : ''}`);
  const label = onMap
    ? strings['map.trail.visibleOnMap'] ?? 'On the public map'
    : strings['map.trail.hiddenFromMap'] ?? 'Not on the map — link only';
  mark.title = label;
  mark.setAttribute('role', 'img');
  mark.setAttribute('aria-label', label);
  mark.innerHTML = onMap ? EYE_SVG : EYE_OFF_SVG;
  return mark;
}

function markSvg(platform: string, uid: string, size = 20): string {
  const body = PLATFORM_ICONS[platform]?.(uid) ?? TRAIL_ICONS[platform] ?? '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
}

export function createPanel(deps: PanelDeps) {
  const { root, strings, lang, socials, contactUrl } = deps;
  // Guards against a slow preview landing in a sheet the visitor already left.
  let generation = 0;
  const body = root.querySelector<HTMLElement>('[data-panel-body]')!;
  const closeBtn = root.querySelector<HTMLButtonElement>('[data-panel-close]')!;
  const backBtn = root.querySelector<HTMLButtonElement>('[data-panel-back]')!;
  /** What this sheet is, centred in the control line: `01 / 100`, RIDER TRAIL, TRACK INFO. */
  const slot = root.querySelector<HTMLElement>('[data-panel-slot]')!;
  /** A navigation stack, so an episode can lead to the place it was filmed at and still
      come back — the same push/pop a native app would give you. Sheets are stored as
      their build functions, so going back re-renders rather than caching stale DOM. */
  const views: Array<(host: HTMLElement) => void> = [];
  /** Set by the push* entry points; consumed by the next open() call. */
  let pushNext = false;
  /**
   * A sheet that owns the screen until it is dismissed on purpose.
   *
   * Exactly one sheet needs this: the one showing a trail link and a claim code that are
   * displayed once and cannot be recovered. Losing them to a stray tap on the map loses
   * the trail, so while it is up, map interaction cannot close it or replace it — only
   * the close button can.
   */
  let sticky = false;
  /** Set by a sheet whose content cannot be recovered. Returns false to refuse the close. */
  let guardClose: (() => boolean) | null = null;

  closeBtn.setAttribute('aria-label', strings['map.panel.close'] ?? 'Close');
  closeBtn.addEventListener('click', () => {
    // Clicking the X is the deliberate dismissal — but on a sheet holding something shown
    // once, "deliberate" and "intended" are not the same thing, so it asks.
    if (guardClose && !guardClose()) return;
    guardClose = null;
    sticky = false;
    deps.onClose();
  });
  backBtn.setAttribute('aria-label', strings['map.panel.back'] ?? 'Back');
  backBtn.addEventListener('click', () => {
    if (views.length < 2) return;
    views.pop();
    paint();
  });

  /** Puts this sheet's identity in the control line. `counter` gets the accent. */
  function kicker(text: string, counter = false) {
    slot.textContent = text;
    slot.classList.toggle('is-counter', counter);
  }

  function paint() {
    const build = views[views.length - 1];
    if (!build) return;
    generation++;
    slot.replaceChildren();
    slot.classList.remove('is-counter');
    body.replaceChildren();
    build(body);
    backBtn.hidden = views.length < 2;
    root.hidden = false;
    root.classList.add('is-open');
    body.scrollTop = 0;
  }

  function open(build: (host: HTMLElement) => void, opts: { sticky?: boolean } = {}) {
    if (sticky && !opts.sticky) return;
    sticky = !!opts.sticky;
    guardClose = null;
    if (pushNext) pushNext = false;
    else views.length = 0;
    views.push(build);
    paint();
  }

  function close() {
    if (sticky) return;
    generation++;
    views.length = 0;
    pushNext = false;
    backBtn.hidden = true;
    slot.replaceChildren();
    root.classList.remove('is-open');
    root.hidden = true;
    body.replaceChildren();
  }

  /**
   * One slide per platform the episode is on, each fetching its own Open Graph card
   * only once it is swiped into view. Platforms that serve a wall (Douyin, Facebook)
   * keep their slide but fall back to the brand mark.
   */
  function carousel(entry: SeriesEntry, host: HTMLElement) {
    const slides = platformsFor(lang)
      .map((platform) => ({ platform, href: entry.links?.[platform] || null }))
      .filter((s): s is { platform: string; href: string } => !!s.href);
    if (!slides.length) return;

    const mine = generation;
    const wrap = el('div', 'wm-carousel');
    const track = el('div', 'wm-carousel__track');
    const dots = el('div', 'wm-carousel__dots');

    slides.forEach(({ platform, href }, index) => {
      // Douyin gives a worker outside China only a shell, so its slide previews
      // the same clip's TikTok card.
      const previewHref = platform === 'douyin' ? entry.links?.tiktok || href : href;
      const slide = el('a', 'wm-slide is-pending') as HTMLAnchorElement;
      slide.href = href;
      slide.target = '_blank';
      slide.rel = 'noopener';
      slide.dataset.platform = platform;
      slide.dataset.preview = previewHref;
      if (
        (SHORT_VIDEO as readonly string[]).includes(platform) &&
        SHORT_VIDEO.every((pf) => !!(entry.links?.[pf] || socials[pf]))
      ) {
        slide.addEventListener('click', (ev) => {
          ev.preventDefault();
          openChooser(entry);
        });
      }
      slide.setAttribute(
        'aria-label',
        `${strings['map.panel.watch'] ?? 'Watch'} · ${PLATFORM_LABELS[platform] ?? platform}`,
      );
      slide.innerHTML =
        `<span class="wm-slide__shimmer"></span>` +
        `<span class="wm-slide__badge">${markSvg(platform, `${platform}-${index}-${generation}`, 16)}</span>`;
      track.appendChild(slide);

      const dot = el('button', 'wm-carousel__dot') as HTMLButtonElement;
      dot.type = 'button';
      dot.title = PLATFORM_LABELS[platform] ?? platform;
      dot.addEventListener('click', () => slide.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }));
      dots.appendChild(dot);
    });

    wrap.append(track, dots);
    host.appendChild(wrap);
    if (slides.length < 2) dots.remove();

    // Swiping is not discoverable on a desktop pointer, and the dots are a jump target
    // rather than a step. Chevrons step one platform at a time.
    if (slides.length > 1) {
      const step = (delta: number) => {
        const cells = [...track.children] as HTMLElement[];
        const mid = track.scrollLeft + track.clientWidth / 2;
        const current = Math.max(
          0,
          cells.findIndex((cell) => cell.offsetLeft + cell.offsetWidth > mid),
        );
        const next = cells[Math.min(cells.length - 1, Math.max(0, current + delta))];
        if (next) track.scrollTo({ left: next.offsetLeft, behavior: 'smooth' });
      };
      for (const dir of ['prev', 'next'] as const) {
        const nav = el('button', `wm-carousel__nav wm-carousel__nav--${dir}`) as HTMLButtonElement;
        nav.type = 'button';
        const label = strings[dir === 'prev' ? 'map.panel.prev' : 'map.panel.next'] ?? dir;
        nav.title = label;
        nav.setAttribute('aria-label', label);
        nav.innerHTML = CHEVRON(dir);
        nav.addEventListener('click', () => step(dir === 'prev' ? -1 : 1));
        wrap.appendChild(nav);
      }
      const syncNav = () => {
        const atStart = track.scrollLeft < 8;
        const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 8;
        wrap.querySelector('.wm-carousel__nav--prev')?.toggleAttribute('disabled', atStart);
        wrap.querySelector('.wm-carousel__nav--next')?.toggleAttribute('disabled', atEnd);
      };
      track.addEventListener('scroll', syncNav, { passive: true });
      // The first sync would otherwise run before layout and latch both chevrons off;
      // the lazily-loaded OG images change the scroll width again afterwards.
      new ResizeObserver(syncNav).observe(track);
    }

    const syncDots = () => {
      const mid = track.scrollLeft + track.clientWidth / 2;
      let active = 0;
      [...track.children].forEach((child, i) => {
        const node = child as HTMLElement;
        if (node.offsetLeft <= mid && node.offsetLeft + node.offsetWidth > mid) active = i;
      });
      [...dots.children].forEach((d, i) => d.classList.toggle('is-active', i === active));
    };
    track.addEventListener('scroll', syncDots, { passive: true });
    syncDots();

    const load = (slide: HTMLElement) => {
      if (slide.dataset.loaded) return;
      slide.dataset.loaded = '1';
      const href = slide.dataset.preview || (slide as HTMLAnchorElement).href;
      fetch(`/api/map/og?u=${encodeURIComponent(href)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('og'))))
        .then((og: { ok?: boolean; title?: string; image?: string }) => {
          if (mine !== generation) return;
          slide.classList.remove('is-pending');
          if (!og?.ok || (!og.image && !og.title)) {
            slide.classList.add('is-bare');
            slide.querySelector('.wm-slide__shimmer')?.remove();
            slide.appendChild(el('span', 'wm-slide__caption', PLATFORM_LABELS[slide.dataset.platform ?? ''] ?? ''));
            return;
          }
          const shimmer = slide.querySelector('.wm-slide__shimmer');
          shimmer?.remove();
          if (og.image) {
            const img = document.createElement('img');
            img.className = 'wm-slide__img';
            img.src = og.image;
            img.alt = '';
            slide.insertBefore(img, slide.firstChild);
          }
          if (og.title) {
            const cap = el('span', 'wm-slide__caption', og.title);
            slide.appendChild(cap);
          }
        })
        .catch(() => {
          if (mine !== generation) return;
          slide.classList.remove('is-pending');
          slide.classList.add('is-bare');
          slide.querySelector('.wm-slide__shimmer')?.remove();
          slide.appendChild(el('span', 'wm-slide__caption', PLATFORM_LABELS[slide.dataset.platform ?? ''] ?? ''));
        });
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) load(e.target as HTMLElement);
      },
      { root: track, threshold: 0.4 },
    );
    for (const slide of track.children) io.observe(slide);
  }

  /**
   * Direct jumps. Until an episode carries a per-platform link the button falls back
   * to our profile there, and to /contact for platforms we have no profile for.
   */
  function platformRow(entry: SeriesEntry): HTMLElement {
    const row = el('div', 'wm-panel__socials');
    for (const platform of platformsFor(lang)) {
      const label = PLATFORM_LABELS[platform] ?? platform;
      const mark = markSvg(platform, `${platform}-row-${generation}`);
      const bothShortVideo =
        (SHORT_VIDEO as readonly string[]).includes(platform) &&
        SHORT_VIDEO.every((p) => !!(entry.links?.[p] || socials[p]));

      if (bothShortVideo) {
        const button = el('button', 'wm-social') as HTMLButtonElement;
        button.type = 'button';
        button.title = `${strings['map.panel.watchOn'] ?? 'Watch on'} ${label}`;
        button.setAttribute('aria-label', strings['map.panel.watchOn'] ?? 'Watch on');
        button.innerHTML = mark;
        button.addEventListener('click', () => openChooser(entry));
        row.appendChild(button);
        continue;
      }

      const href = entry.links?.[platform] || socials[platform] || contactUrl;
      const a = el('a', 'wm-social') as HTMLAnchorElement;
      a.href = href;
      a.title = label;
      a.setAttribute('aria-label', `${strings['map.panel.watch'] ?? 'Watch'} · ${label}`);
      if (/^https?:/.test(href)) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
      a.innerHTML = mark;
      row.appendChild(a);
    }
    return row;
  }

  /**
   * Hands the place off to whichever map app the visitor actually has. Confirmed
   * through an overlay rather than jumping straight out, because a surprise app
   * switch from a map is disorienting.
   *
   * Mainland rows are converted WGS-84 -> GCJ-02 first: Apple, Google and Amap all
   * take GCJ display coordinates inside China, so passing our stored coordinates
   * would land the rider about 500 m away.
   */
  function openDirections(track: TrackProps) {
    const host = root.closest('.wm') ?? document.body;
    host.querySelector('.wm-chooser')?.remove();

    const cn = track.country_code === 'CN';
    const [lat, lng] = cn ? wgsToGcj(track.lat!, track.lng!) : [track.lat!, track.lng!];
    const at = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    const name = encodeURIComponent(track.name_local || track.name);
    const apple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const touch = navigator.maxTouchPoints > 0;

    // On a phone the web URI is a detour: try the installed app's own scheme first and
    // fall back to the web page only if nothing took the navigation. `pagehide` firing
    // means the app opened, so the fallback is cancelled.
    const openVia = (scheme: string | null, web: string) => (ev: MouseEvent) => {
      dismiss();
      if (!scheme || !touch) return;
      ev.preventDefault();
      let left = false;
      const gone = () => { left = true; };
      addEventListener('pagehide', gone, { once: true });
      addEventListener('blur', gone, { once: true });
      location.href = scheme;
      setTimeout(() => {
        removeEventListener('pagehide', gone);
        removeEventListener('blur', gone);
        if (!left && !document.hidden) window.open(web, '_blank', 'noopener');
      }, 1400);
    };

    const apps = [
      cn
        ? {
            id: 'amap',
            name: '高德地图',
            href: `https://uri.amap.com/marker?position=${lng.toFixed(6)},${lat.toFixed(6)}&name=${name}&src=dirtbikex&coordinate=gaode&callnative=1`,
            scheme: `${ios ? 'iosamap' : 'androidamap'}://viewMap?sourceApplication=DirtBikeX&poiname=${name}&lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}&dev=0`,
          }
        : null,
      {
        id: 'apple',
        name: 'Apple Maps',
        href: `https://maps.apple.com/?daddr=${at}&dirflg=d`,
        scheme: ios ? `maps://?daddr=${at}&dirflg=d` : null,
      },
      {
        id: 'google',
        name: 'Google Maps',
        href: `https://www.google.com/maps/dir/?api=1&destination=${at}`,
        scheme: `comgooglemaps://?daddr=${at}&directionsmode=driving`,
      },
      // Android hands geo: to whatever the visitor installed; it is inert on desktop.
      !apple && navigator.maxTouchPoints > 0
        ? { id: 'system', name: strings['map.panel.systemMaps'] ?? 'Default map app', href: `geo:${at}?q=${at}(${name})` }
        : null,
    ].filter(Boolean) as { id: string; name: string; href: string; scheme?: string | null }[];

    const preferred = cn ? 'amap' : apple ? 'apple' : 'google';
    apps.sort((a, b) => (a.id === preferred ? -1 : b.id === preferred ? 1 : 0));

    const wrap = el('div', 'wm-chooser');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    const backdrop = el('div', 'wm-chooser__backdrop');
    const card = el('div', 'wm-chooser__card');
    card.appendChild(el('p', 'wm-chooser__title', strings['map.panel.openIn'] ?? 'Open in'));

    const dismiss = () => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
    };
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        dismiss();
      }
    }

    for (const app of apps) {
      const opt = el('a', `wm-chooser__opt${app.id === preferred ? ' is-recommended' : ''}`) as HTMLAnchorElement;
      opt.href = app.href;
      if (/^https?:/.test(app.href)) {
        opt.target = '_blank';
        opt.rel = 'noopener';
      }
      opt.appendChild(el('span', 'wm-chooser__name', app.name));
      if (app.id === preferred) {
        opt.appendChild(el('span', 'wm-chooser__chip', strings['map.panel.recommended'] ?? 'Recommended'));
      }
      opt.addEventListener('click', openVia(app.scheme ?? null, app.href));
      card.appendChild(opt);
    }

    backdrop.addEventListener('click', dismiss);
    document.addEventListener('keydown', onKey);
    wrap.append(backdrop, card);
    host.appendChild(wrap);
  }

  /**
   * TikTok and Douyin host the same clip, so the short-video button asks which one
   * rather than guessing; the locale's platform is recommended and listed first.
   */
  function openChooser(entry: SeriesEntry) {
    const host = root.closest('.wm') ?? document.body;
    host.querySelector('.wm-chooser')?.remove();

    const recommended = recommendedShortVideo(lang);
    const options = [...SHORT_VIDEO]
      .sort((a, b) => (a === recommended ? -1 : b === recommended ? 1 : 0))
      .map((platform) => ({ platform, href: entry.links?.[platform] || socials[platform] || contactUrl }));

    const wrap = el('div', 'wm-chooser');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    const backdrop = el('div', 'wm-chooser__backdrop');
    const card = el('div', 'wm-chooser__card');
    card.appendChild(el('p', 'wm-chooser__title', strings['map.panel.watchOn'] ?? 'Watch on'));

    for (const { platform, href } of options) {
      const opt = el('a', `wm-chooser__opt${platform === recommended ? ' is-recommended' : ''}`) as HTMLAnchorElement;
      opt.href = href;
      if (/^https?:/.test(href)) {
        opt.target = '_blank';
        opt.rel = 'noopener';
      }
      opt.innerHTML =
        `<span class="wm-chooser__mark">${markSvg(platform, `${platform}-pick-${generation}`, 22)}</span>` +
        `<span class="wm-chooser__name">${PLATFORM_LABELS[platform] ?? platform}</span>` +
        (platform === recommended
          ? `<span class="wm-chooser__chip">${strings['map.panel.recommended'] ?? 'Recommended'}</span>`
          : '');
      opt.addEventListener('click', () => close());
      card.appendChild(opt);
    }

    const dismiss = () => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
    };
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        dismiss();
      }
    }
    backdrop.addEventListener('click', dismiss);
    document.addEventListener('keydown', onKey);

    wrap.append(backdrop, card);
    host.appendChild(wrap);
    card.querySelector<HTMLElement>('.wm-chooser__opt')?.focus();
  }

  function stepper(canPrev: boolean, canNext: boolean): HTMLElement {
    const nav = el('div', 'wm-panel__nav');
    for (const [delta, glyph, key] of [
      [-1, 'M9 2 3.5 8 9 14', 'map.panel.prev'],
      [1, 'M4 2 9.5 8 4 14', 'map.panel.next'],
    ] as const) {
      const btn = el('button', 'wm-step') as HTMLButtonElement;
      btn.type = 'button';
      btn.disabled = delta < 0 ? !canPrev : !canNext;
      btn.setAttribute('aria-label', strings[key] ?? (delta < 0 ? 'Previous episode' : 'Next episode'));
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 13 16" fill="none" aria-hidden="true"><path d="${glyph}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      btn.addEventListener('click', () => deps.onStep(delta));
      nav.appendChild(btn);
    }
    return nav;
  }

  function directionsButton(track: TrackProps): HTMLButtonElement | null {
    if (!Number.isFinite(track.lng) || !Number.isFinite(track.lat)) return null;
    const go = el('button', 'wm-panel__go') as HTMLButtonElement;
    go.type = 'button';
    const label = strings['map.panel.directions'] ?? 'Directions';
    go.title = label;
    go.setAttribute('aria-label', label);
    go.innerHTML =
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"' +
      ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 21s7-6.4 7-11.4A7 7 0 0 0 5 9.6C5 14.6 12 21 12 21Z"/>' +
      '<circle cx="12" cy="9.6" r="2.6"/></svg>';
    go.addEventListener('click', () => openDirections(track));
    return go;
  }

  const verifiedChip = () =>
    el('span', 'wm-chip wm-chip--verified', strings['map.panel.verified'] ?? 'Verified');

  /** The mark, once a forum topic turns up. Idempotent: the sheet may already carry it. */
  function markVerified(host: HTMLElement) {
    const chips = host.querySelector('.wm-panel__chips');
    if (!chips || chips.querySelector('.wm-chip--verified')) return;
    chips.insertBefore(verifiedChip(), chips.children[1] ?? null);
  }

  /** The name to lead with, or null when the romanised one is all there is. */
  function preferLocal(track: TrackProps): string | null {
    if (!track.name_local || track.name_local === track.name) return null;
    return lang.startsWith('zh') || lang.startsWith('ja') || lang.startsWith('ko')
      ? track.name_local
      : null;
  }

  function trackInfo(host: HTMLElement, track: TrackProps) {
    // "Track info" moved into the control line, so the body opens on the content
    // rather than on a label. Directions rides the address line it belongs to —
    // it acts on that address — instead of floating alone at the foot of the sheet.
    const meta = el('p', 'wm-panel__meta');
    const bits = [track.locality, track.country_code].filter(Boolean) as string[];
    // Whichever name the title did NOT take goes here, so both are always on the sheet and
    // neither is printed twice.
    const titled = preferLocal(track) ?? track.name;
    const other = titled === track.name ? track.name_local : track.name;
    meta.textContent = [other && other !== titled ? other : null, ...bits]
      .filter(Boolean)
      .join(' · ');
    const go = directionsButton(track);
    if (go) {
      const row = el('div', 'wm-panel__metarow');
      row.append(meta, go);
      host.appendChild(row);
    } else {
      host.appendChild(meta);
    }

    const chips = el('div', 'wm-panel__chips');
    chips.appendChild(el('span', 'wm-chip', strings[`map.cat.${track.category}`] ?? track.category));
    if (deps.isVerified(track.slug, false)) chips.appendChild(verifiedChip());
    if (track.claimed) {
      chips.appendChild(el('span', 'wm-chip wm-chip--claimed', strings['map.panel.claimed'] ?? 'Claimed'));
    }
    if (track.precision === 'centroid') {
      chips.appendChild(el('span', 'wm-chip', strings['map.panel.approxArea'] ?? 'Approximate area'));
    }
    host.appendChild(chips);

    if (track.website) {
      const site = el('a', 'wm-panel__link', strings['map.panel.website'] ?? 'Website') as HTMLAnchorElement;
      site.href = track.website;
      site.target = '_blank';
      site.rel = 'noopener nofollow';
      host.appendChild(site);
    }
  }

  /**
   * "Who built this track" — appended after the sheet is already on screen, so a
   * slow or absent lineage endpoint never delays the venue card. Contributors
   * come from the same anonymous projection the résumé page renders, and an
   * unclaimed one stays a placeholder here too.
   */
  /**
   * The `/s/u/` identity block quoted at byline scale. One builder, so a trail's
   * rider and a track's owner cannot drift into two different-looking people.
   * The initial sits under the image, so a failed avatar reveals a letter rather
   * than a broken-image glyph.
   */
  function personBlock(username: string, name: string, avatar: string | null, role?: string): HTMLElement {
    const by = el('a', 'wm-by') as HTMLAnchorElement;
    by.href = `/s/u/${encodeURIComponent(username)}`;
    const named = name.trim() || null;
    const face = el('span', 'wm-by__avatar', (Array.from((named ?? username).trim())[0] ?? '?').toUpperCase());
    if (avatar) {
      const img = document.createElement('img');
      img.src = deps.forumBase + avatar.replace('{size}', '72');
      img.alt = '';
      img.width = 36;
      img.height = 36;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', () => img.remove(), { once: true });
      face.appendChild(img);
    }
    const idBlock = el('span', 'wm-by__id');
    const meta = role ? (named ? `${role} · @${username}` : role) : `@${username}`;
    idBlock.append(el('span', 'wm-by__name', named ?? `@${username}`), el('span', 'wm-by__meta', meta));
    by.append(face, idBlock);
    return by;
  }

  /**
   * Everything a trail says about itself between its title and its byline: the summary,
   * the two big numbers, and the provenance chips.
   *
   * Shared, because the sheet a visitor sees the moment they finish uploading has to be
   * the same object as the one everybody else sees afterwards. If it were built twice they
   * would drift, and the upload sheet is exactly where a rider decides whether this thing
   * is worth claiming — showing them a lesser version of their own ride is the wrong
   * moment to economise.
   */
  function trailFacts(host: HTMLElement, trail: Trail, extraChip?: HTMLElement | null) {
    const st = trail.stats ?? null;
      const summary = localized(trail.summary, lang);
      if (summary) host.appendChild(el('p', 'wm-panel__meta', summary));

      // style:'unit' also places the unit correctly in RTL, unlike a " km" suffix.
      const unit = (v: number, u: string, extra: Intl.NumberFormatOptions = {}) =>
        new Intl.NumberFormat(lang, { style: 'unit', unit: u, unitDisplay: 'short', ...extra }).format(v);

      // Fixed order; a missing stat is dropped rather than dashed.
      const slots: [string, string][] = [];
      if (trail.distance_km) {
        slots.push([
          strings['map.trail.distance'] ?? 'Distance',
          unit(trail.distance_km, 'kilometer', { maximumFractionDigits: trail.distance_km >= 100 ? 0 : 1 }),
        ]);
      }
      const moving = st?.time?.moving_s ?? 0;
      if (moving >= 60) {
        const mins = Math.round(moving / 60);
        // Two unit strings, not Intl.DurationFormat: that mixes Latin unit letters
        // into non-Latin digits.
        const value =
          mins < 60
            ? unit(mins, 'minute', { maximumFractionDigits: 0 })
            : [
                unit(Math.floor(mins / 60), 'hour', { maximumFractionDigits: 0 }),
                mins % 60 ? unit(mins % 60, 'minute', { maximumFractionDigits: 0 }) : null,
              ]
                .filter(Boolean)
                .join(' ');
        slots.push([strings['map.trail.rideTime'] ?? 'Ride time', value]);
      }
      const climb = st?.ele?.ascent_m;
      if (climb != null && climb >= 1) {
        slots.push([
          strings['map.trail.climb'] ?? 'Climb',
          unit(climb, 'meter', { maximumFractionDigits: 0, signDisplay: 'always' }),
        ]);
      }
      if (slots.length) {
        const dl = el('dl', 'wm-stats');
        for (const [label, value] of slots) {
          const cell = el('div', 'wm-stat');
          cell.append(el('dt', 'wm-stat__label', label), el('dd', 'wm-stat__value', value));
          dl.appendChild(cell);
        }
        host.appendChild(dl);
      }

      const chips = el('div', 'wm-panel__chips');
      // Provenance leads: it explains why the ride-time slot may be missing.
      if (st?.time?.source === 'trkpt' && st.time.recorded_at) {
        const when = new Date(st.time.recorded_at);
        if (!Number.isNaN(when.valueOf())) {
          chips.appendChild(
            el(
              'span',
              'wm-chip',
              (strings['map.trail.recordedOn'] ?? 'Recorded {date}').replace(
                '{date}',
                when.toLocaleDateString(lang, { year: 'numeric', month: 'short', day: 'numeric' }),
              ),
            ),
          );
        }
      }
      // There is deliberately no "Plotted route" chip for the other case. Both paths onto
      // this map refuse a file containing <rtept> — the importer and the upload
      // pre-flight independently — so no trail here IS a plotted route, and the chip was
      // rendering that claim for every file that merely lacked timestamps. Uploaded
      // trails lacked them by construction until the rich scan landed, so every single
      // one was mislabelled. Absence of a "Recorded" chip already says what is unknown.
      // `map.trail.plotted` is now unused; kept in the locale files rather than pruned
      // across 21 of them for a string that may return with a real meaning.
      if (st?.shape === 'loop') {
        chips.appendChild(el('span', 'wm-chip', strings['map.trail.loop'] ?? 'Loop'));
      } else if (st?.shape === 'point_to_point') {
        chips.appendChild(el('span', 'wm-chip', strings['map.trail.pointToPoint'] ?? 'Point to point'));
      }
      if ((st?.segments ?? 1) > 1) {
        chips.appendChild(
          el(
            'span',
            'wm-chip',
            (strings['map.trail.sections'] ?? '{n} sections').replace(
              '{n}',
              new Intl.NumberFormat(lang).format(st!.segments),
            ),
          ),
        );
      }
      if (extraChip) chips.appendChild(extraChip);
      if (chips.childElementCount) host.appendChild(chips);
  }

  /**
   * A track's owner and its write-up, when it has them. Both are optional on the
   * catalog row and most rows have neither, so this renders nothing rather than
   * an empty byline — and it runs AFTER the sheet is open, because
   * the baked catalog cannot know who claimed a track this morning.
   */
  async function trackOwner(host: HTMLElement, track: TrackProps) {
    let row: { owner?: { username?: string; name?: string; avatar_template?: string }; topic_id?: number } | null;
    try {
      row = (await fetch(`/api/map/track.json?slug=${encodeURIComponent(track.slug)}`).then((r) =>
        r.ok ? r.json() : null,
      ).then((d) => (d as { track?: unknown } | null)?.track ?? null)) as typeof row;
    } catch {
      return;
    }
    const owner = row?.owner;
    const topicId = row?.topic_id;
    if ((!owner?.username && !topicId) || !host.isConnected) return;
    // A written-up place is normally one we stand behind, so the topic doubles as the
    // vouch — unless the operator has already said otherwise about this venue.
    if (topicId && deps.isVerified(track.slug, true)) markVerified(host);

    const byline = el('div', 'wm-panel__byline');
    if (owner?.username) {
      host.appendChild(el('h3', 'wm-panel__section', strings['map.track.owner'] ?? 'Owner'));
      byline.appendChild(
        personBlock(owner.username, owner.name || owner.username, owner.avatar_template ?? null),
      );
    }
    if (topicId && deps.forumBase) {
      const links = el('div', 'wm-panel__socials');
      const a = el('a', 'wm-social') as HTMLAnchorElement;
      a.href = `${deps.forumBase}/t/${topicId}`;
      const label = strings['map.trail.thread'] ?? 'Forum thread';
      a.title = label;
      a.setAttribute('aria-label', label);
      a.target = '_blank';
      a.rel = 'noopener';
      a.innerHTML = THREAD_SVG;
      links.appendChild(a);
      byline.appendChild(links);
    }
    host.appendChild(byline);
  }

  return {
    close,
    isOpen: () => !root.hidden,

    /** True while a sheet refuses to be closed or replaced by anything but its own X. */
    isSticky: () => sticky,

    /** Lifts the guard. Only for a deliberate dismissal — Escape, and nothing else. */
    allowClose() {
      if (guardClose && !guardClose()) return;
      guardClose = null;
      sticky = false;
    },

    /** The door is shut. Said plainly, and with the one reassurance that matters: whatever
     *  they already shared still works. */
    showUploadOff() {
      open((host) => {
        kicker(strings['map.upload.kicker'] ?? 'Your trail');
        titleRow(host, strings['map.upload.unavailable'] ?? 'Trail upload is switched off right now', null, strings);
        host.appendChild(
          el('p', 'wm-panel__meta', strings['map.upload.unavailableBody']
            ?? 'Uploading is paused on this site. Nothing you have already shared is affected — your links still work.'),
        );
      });
    },

    /** What the visitor is agreeing to before they hand over a trace of where they ride. */
    showUploadIntro(
      pick: () => void,
      recent: { id: string; title: string; claim: string }[] = [],
      acts?: { open: (id: string) => void; remove: (id: string) => void },
    ) {
      open((host) => {
        kicker(strings['map.upload.kicker'] ?? 'Your trail');
        titleRow(host, strings['map.upload.title'] ?? 'Put your ride on the map', null, strings);
        host.appendChild(uploadPeek());
        host.appendChild(
          el('p', 'wm-panel__meta', strings['map.upload.body']
            ?? 'Drop a .gpx file and we will draw it. It stays private to you until you decide to make it public.'),
        );
        const button = el('button', 'wm-panel__cta') as HTMLButtonElement;
        button.type = 'button';
        button.textContent = strings['map.upload.pick'] ?? 'Choose a .gpx file';
        button.addEventListener('click', pick);
        host.appendChild(button);

        // The way back to a link a closed sheet took away. This device only — it fixes
        // the accident, and honestly not the case where the tab was on another phone.
        if (recent.length && acts) {
          host.appendChild(el('h3', 'wm-panel__section', strings['map.upload.yours'] ?? 'Your recent uploads'));
          const list = el('div', 'wm-recent');
          for (const row of recent) {
            const item = el('div', 'wm-recent__item');

            const name = el('button', 'wm-recent__name') as HTMLButtonElement;
            name.type = 'button';
            name.textContent = row.title;
            name.title = strings['map.upload.reopen'] ?? 'Open';
            name.addEventListener('click', () => acts.open(row.id));

            // The claim URL carries the code, so it is never printed — it only ever
            // becomes an href on a tab the rider opened themselves.
            const claim = el('a', 'wm-recent__act') as HTMLAnchorElement;
            claim.href = row.claim;
            claim.target = '_blank';
            claim.rel = 'noopener';
            claim.textContent = strings['map.upload.claimShort'] ?? 'Claim';

            const drop = el('button', 'wm-recent__act wm-recent__act--drop') as HTMLButtonElement;
            drop.type = 'button';
            drop.textContent = strings['map.upload.delete'] ?? 'Delete';
            drop.addEventListener('click', () => {
              if (window.confirm(strings['map.upload.confirmDelete']
                ?? 'Delete this trail? Anyone holding the link loses it too, and this cannot be undone.')) {
                acts.remove(row.id);
              }
            });

            item.append(name, claim, drop);
            list.appendChild(item);
          }
          host.appendChild(list);
        }
      });
    },

    /**
     * The file is chosen and measured; nothing has left the browser yet.
     *
     * This step exists for the name. A recorder writes files called
     * "2026-05-17_08-00-00.gpx", and that string used to become the trail's name with no
     * chance to change it — so the sheet leads with the name, editable in place, and the
     * upload does not start until somebody says so.
     *
     * The confirm button is where the Turnstile challenge fires, if one is configured.
     */
    showUploadReady(opts: {
      name: string;
      facts: string;
      turnstileSiteKey: string | null;
      onRename: (name: string) => void;
      onConfirm: () => void;
      onRepick: () => void;
    }) {
      open((host) => {
        let name = opts.name;
        kicker(strings['map.upload.ready'] ?? 'Ready to upload');

        const row = el('div', 'wm-panel__titlerow');
        const heading = el('h2', 'wm-panel__title', name);
        // NOT also .wm-panel__title: two elements answering to the sheet's title selector
        // is ambiguous for anything reading the DOM, tests included. It borrows the type
        // in CSS instead.
        const field = el('input', 'wm-panel__title-input') as HTMLInputElement;
        field.type = 'text';
        field.maxLength = 120;
        field.hidden = true;

        const commit = () => {
          const next = field.value.trim().slice(0, 120);
          // An empty name is worse than a bad one — keep the last good value.
          if (next) {
            name = next;
            opts.onRename(name);
          }
          heading.textContent = name;
          field.hidden = true;
          heading.hidden = false;
        };
        const edit = () => {
          field.value = name;
          heading.hidden = true;
          field.hidden = false;
          // The 16px floor in the CSS is what stops iOS zooming; preventScroll was
          // belt-and-braces and it cost more than it saved — the keyboard then covered
          // the field it had just opened. Normal focus, and the sheet lifts itself.
          field.focus();
          field.select();
          liftForKeyboard(root);
        };
        field.addEventListener('blur', () => {
          commit();
          dropAfterKeyboard(root);
          resetZoom();
        });
        field.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            field.blur();
          } else if (e.key === 'Escape') {
            field.value = name;
            field.blur();
          }
        });

        const pencil = el('button', 'wm-panel__share') as HTMLButtonElement;
        pencil.type = 'button';
        const renameLabel = strings['map.upload.rename'] ?? 'Rename';
        pencil.title = renameLabel;
        pencil.setAttribute('aria-label', renameLabel);
        pencil.innerHTML = PENCIL_SVG;
        pencil.addEventListener('click', edit);

        row.append(heading, field, pencil);
        host.appendChild(row);
        host.appendChild(el('p', 'wm-panel__meta', opts.facts));

        // Turnstile mounts here when a site key is configured. With none, the container
        // stays empty and confirm works immediately — the feature is off, not broken.
        const gate = el('div', 'wm-panel__gate');
        host.appendChild(gate);

        const actions = el('div', 'wm-panel__actions wm-panel__actions--end');
        const again = el('button', 'wm-panel__link') as HTMLButtonElement;
        again.type = 'button';
        again.textContent = strings['map.upload.chooseAnother'] ?? 'Choose a different file';
        again.addEventListener('click', opts.onRepick);

        const confirm = el('button', 'wm-panel__claim') as HTMLButtonElement;
        confirm.type = 'button';
        confirm.textContent = strings['map.upload.confirm'] ?? 'Confirm';
        confirm.addEventListener('click', () => {
          // Commit an open rename first, or the edit is silently discarded by the upload.
          if (!field.hidden) commit();
          if (!opts.turnstileSiteKey) {
            opts.onConfirm();
            return;
          }
          confirm.disabled = true;
          gate.textContent = strings['map.upload.verifying'] ?? 'Checking you are human…';
          void renderTurnstile(gate, opts.turnstileSiteKey)
            .then((token) => {
              deps.setTurnstileToken(token);
              opts.onConfirm();
            })
            .catch(() => {
              gate.textContent = strings['map.upload.errFailed'] ?? 'That did not go through. Try again.';
              confirm.disabled = false;
            });
        });

        actions.append(again, confirm);
        host.appendChild(actions);
      });
    },

    /**
     * Returns its own updater rather than being re-called per tick: repainting the sheet
     * would rebuild the DOM under the visitor sixty times a second.
     *
     * Only one of the four phases can honestly show a number — see uploadTrail(). The
     * rest run the bar in its indeterminate state, which says "working" without claiming
     * to know how far along it is.
     */
    showUploadBusy(): (phase: string, ratio: number | null) => void {
      let fill: HTMLElement | null = null;
      let bar: HTMLElement | null = null;
      let note: HTMLElement | null = null;
      const label = (phase: string) =>
        strings[`map.upload.phase.${phase}`] ??
        ({
          reading: 'Reading your file\u2026',
          measuring: 'Measuring the ride\u2026',
          sending: 'Sending it\u2026',
          finishing: 'Almost there\u2026',
        }[phase] ?? '');

      open((host) => {
        kicker(strings['map.upload.kicker'] ?? 'Your trail');
        titleRow(host, strings['map.upload.working'] ?? 'Uploading\u2026', null, strings);
        note = el('p', 'wm-panel__meta', label('reading'));
        host.appendChild(note);
        bar = el('div', 'wm-panel__progress is-indeterminate');
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
        fill = el('span', 'wm-panel__progress-fill');
        bar.appendChild(fill);
        host.appendChild(bar);
      });

      return (phase, ratio) => {
        if (note) note.textContent = label(phase);
        if (!bar || !fill) return;
        const known = typeof ratio === 'number' && Number.isFinite(ratio);
        bar.classList.toggle('is-indeterminate', !known);
        if (known) {
          const pct = Math.max(0, Math.min(1, ratio));
          fill.style.width = `${(pct * 100).toFixed(1)}%`;
          bar.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
        } else {
          fill.style.width = '';
          bar.removeAttribute('aria-valuenow');
        }
      };
    },

    /**
     * The same sheet the trail will have once it is somebody's — with one section missing,
     * and that missing section IS the call to action.
     *
     * A rider who has just uploaded is looking at a receipt or at their ride. Building it
     * from `trailFacts`, exactly as the finished sheet does, makes it the second thing: the
     * numbers, the chips and the shape are already theirs, and the only blank left is the
     * face beside "uploaded by". That is a better argument for claiming than any sentence.
     *
     * The claim link is the ONE artifact. There is no code on this sheet: nothing in this
     * product accepts a typed claim code — not the web, not the forum, not the app — so a
     * copy button for one would put a string on the clipboard that cannot be pasted
     * anywhere. The trail link is here too, but as something to share rather than to keep.
     */
    showUploadDone(result: UploadResult, trail: Trail, opts: { guardClose?: boolean } = {}) {
      open((host) => {
        const url = `${location.origin}/share/route/${encodeURIComponent(result.id)}`;
        kicker(strings['map.upload.kicker'] ?? 'Your trail');
        // The trail's own name leads, because by now it has one — the ready sheet made
        // sure of that. The share button sits where every other sheet keeps it, and what
        // it hands over is the secret link, the only address this trail has.
        titleRow(
          host,
          localized(trail.title, lang) ?? result.id,
          { url, pulse: true },
          strings,
          visibilityMark(false, strings),
        );

        // Straight under the title, in the accent, because this is the sentence the whole
        // sheet exists to deliver — not a footnote after the facts.
        host.appendChild(
          el('p', 'wm-panel__nudge', strings['map.upload.callToClaim']
            ?? 'You did it! Share it with anyone you like. One more step to make it yours — right now nobody knows who uploaded it.'),
        );

        trailFacts(host, trail, expiryChip(result.expires_in_hours, strings));

        host.appendChild(el('h3', 'wm-panel__section', strings['map.trail.uploadedBy'] ?? 'Uploaded by'));

        // The byline and the action share one row, exactly as a finished trail's byline
        // shares its row with the links out. The blank rider IS the prompt; the button
        // beside it is what fills it in.
        const row = el('div', 'wm-panel__byline');
        const by = el('div', 'wm-by wm-by--empty');
        by.appendChild(el('span', 'wm-by__avatar', '?'));
        const idBlock = el('span', 'wm-by__id');
        idBlock.append(
          el('span', 'wm-by__name', strings['map.upload.you'] ?? 'You'),
          el('span', 'wm-by__meta', strings['map.upload.yourNameHere'] ?? 'your name here'),
        );
        by.appendChild(idBlock);

        const claim = el('a', 'wm-panel__claim') as HTMLAnchorElement;
        claim.href = result.claim_url;
        // A new tab, deliberately. This sheet is the only place the link exists, so
        // navigating away from it to claim would destroy the thing the claim is for.
        claim.target = '_blank';
        claim.rel = 'noopener';
        claim.textContent = strings['map.upload.claimShort'] ?? 'Claim';
        row.append(by, claim);
        host.appendChild(row);
        // Only on the first showing. Reopened from the device's own list, closing cannot
        // lose anything that is not already lost — it came from the list it falls back to.
        if (opts.guardClose !== false) {
          guardClose = () => window.confirm(strings['map.upload.confirmClose']
            ?? 'Kept on this device only. Close without sharing or claiming?');
        }
      }, { sticky: true });
    },

    /**
     * One message per thing the visitor can do about it. The three parse failures collapse
     * into one: from where they stand, a file with route points, a file with only waypoints
     * and a file that never moved are all \u201cthis is not a recorded ride\u201d.
     */
    showUploadError(reason: UploadReason) {
      open((host) => {
        kicker(strings['map.upload.kicker'] ?? 'Your trail');
        const text =
          reason === 'too_large'
            ? strings['map.upload.errTooBig'] ?? 'That file is larger than 10 MB.'
            : reason === 'rate_limited'
              ? strings['map.upload.errBusy'] ?? 'Too many uploads from here just now. Try again in a few minutes.'
              : reason === 'failed'
                ? strings['map.upload.errFailed'] ?? 'That did not go through. Try again.'
                : strings['map.upload.errNoTrack']
                  ?? 'That file has no recorded track in it \u2014 only a planned route, or waypoints, or a trace that never moved.';
        titleRow(host, strings['map.upload.failed'] ?? 'That file could not be added', null, strings);
        host.appendChild(el('p', 'wm-panel__meta', text));
      });
    },

    /**
     * A secret link that resolved to nothing. Deliberately one message for both "no such
     * trail" and "it expired": the secret is the whole access control, so the sheet must
     * not confirm which ids ever existed.
     */
    showMissingTrail() {
      open((host) => {
        kicker(strings['map.trail.kicker'] ?? 'Rider trail');
        titleRow(host, strings['map.trail.goneTitle'] ?? 'This trail is no longer here', null, strings);
        host.appendChild(
          el('p', 'wm-panel__meta', strings['map.trail.goneBody']
            ?? 'A shared trail lives for a few days unless its rider claims it. This link has expired, or never pointed anywhere.'),
        );
      });
    },

    /**
     * Removing a claimed trail from this device's list.
     *
     * The server refuses to delete it — a claimed trail belongs to a forum post now, and
     * the anonymous secret is no longer the authority over it. That refusal used to reach
     * the rider as a failed delete and a row that could never be cleared, which is exactly
     * backwards: the row is the one thing here that CAN go, and losing it loses nothing.
     */
    showUploadClaimed(postUrl: string | null) {
      open((host) => {
        kicker(strings['map.trail.kicker'] ?? 'Rider trail');
        titleRow(host, strings['map.upload.claimedTitle'] ?? 'This one is yours now', null, strings);
        host.appendChild(
          el('p', 'wm-panel__meta', strings['map.upload.claimedBody']
            ?? 'It is signed, so it no longer needs this list to survive — your message on the forum holds the file and decides whether it shows on the map. Removed from this device.'),
        );
        if (postUrl) {
          const link = el('a', 'wm-panel__link', strings['map.trail.thread'] ?? 'Forum thread') as HTMLAnchorElement;
          link.href = postUrl;
          link.target = '_blank';
          link.rel = 'noopener';
          host.appendChild(link);
        }
      });
    },

    /**
     * A ride somebody recorded. The trace is the subject: its numbers sit under the
     * title, the file's provenance reads as chips, and the rider is a byline — an
     * avatar at attribution scale, not a profile header.
     */
    showTrail(trail: Trail) {
      open((host) => {
        kicker(strings['map.trail.kicker'] ?? 'Rider trail');
        // /share/route/<id> reads the public map document, which a link-only trail is
        // deliberately not in. Sharing one means passing on its secret link, which the
        // upload sheet hands over explicitly — so this card simply has no share button.
        // Every trail sheet can be shared; what differs is WHAT gets shared. A public
        // trail has a /share/ card that reads the map document. A link-only one has no
        // card and never will — so it shares the only address it has, which is the link
        // the visitor is already holding. Suppressing the button here left an anonymous
        // trail with no way to pass it on at all.
        // ALWAYS the /share/ card, even for a link-only trail: the worker resolves an
        // unknown route id out of D1, so an unlisted trail unfurls with a real title and
        // picture in a chat app instead of arriving as a bare URL. The secret is in the
        // path either way — it is the same secret the visitor is already holding.
        const onMap = !trail.visibility || trail.visibility === 'public';
        titleRow(
          host,
          localized(trail.title, lang) ?? trail.id,
          { kind: 'route', key: trail.id },
          strings,
          trail.visibility ? visibilityMark(onMap, strings) : null,
        );

        trailFacts(host, trail);

        // An uploaded trail has no author until somebody claims it — but the section still
        // renders. Dropping it left the sheet ending mid-thought after the chips, which
        // reads as broken rather than as anonymous. The placeholder says the true thing:
        // somebody rode this and has not put their name to it.
        const by = trail.author_username
          ? personBlock(
              trail.author_username,
              trail.author_name ?? '',
              trail.author_avatar ?? null,
              strings['map.trail.rider'] ?? 'Rider',
            )
          : anonBlock(strings);
        // A face and a name with nothing said about them read as the subject of the
        // sheet. The label is what makes them the author of it.
        host.appendChild(el('h3', 'wm-panel__section', strings['map.trail.uploadedBy'] ?? 'Uploaded by'));

        // The two ways out of this trail sit on the uploader's row rather than in a
        // strip of their own: one line of who and where-next, not two of each.
        const row = el('div', 'wm-panel__socials');
        const byline = el('div', 'wm-panel__byline');
        byline.append(by);
        byline.append(row);
        host.appendChild(byline);
        const mark = (icon: string | null, href: string, label: string, svg?: string) => {
          const a = el('a', 'wm-social') as HTMLAnchorElement;
          a.href = href;
          a.title = label;
          a.setAttribute('aria-label', label);
          if (/^https?:/.test(href)) {
            a.target = '_blank';
            a.rel = 'noopener';
          }
          a.innerHTML = svg ?? markSvg(icon!, `trail-${icon}-${generation}`);
          row.appendChild(a);
        };
        // gpx.studio is where the trace's own detail lives, so it takes the info
        // glyph rather than a second route mark beside the trail's own.
        if (trail.gpx_url) {
          const files = encodeURIComponent(JSON.stringify([trail.gpx_url]));
          mark(
            null,
            `https://gpx.studio/app?files=${files}`,
            strings['map.trail.studio'] ?? 'Open in gpx.studio',
            INFO_SVG,
          );
        }
        if (trail.post_url) {
          mark(null, trail.post_url, strings['map.trail.thread'] ?? 'Forum thread', THREAD_SVG);
        }
      });
    },


    pushTrack(track: TrackProps) {
      pushNext = true;
      this.showTrack(track);
    },

    pushTrail(trail: Trail) {
      pushNext = true;
      this.showTrail(trail);
    },

    showTrack(track: TrackProps) {
      open((host) => {
        // A shop rides the same catalog row as a track, so the share kind follows
        // the row's own kind rather than the sheet it happens to be rendered in.
        kicker(strings['map.panel.trackInfo'] ?? 'Track info');
        // `name` is the romanised form the catalog is keyed on; `name_local` is what the
        // place is actually called. In a Chinese locale the transliteration is nobody's
        // name for anything — "Tong Lu 73 Hao Yue Ye Zhu Ti Le Yuan" is a slug read aloud —
        // so the local name leads and the romanisation falls back to the meta line.
        titleRow(
          host,
          preferLocal(track) ?? track.name,
          { kind: track.kind === 'shop' ? 'shop' : 'track', key: track.slug },
          strings,
        );
        trackInfo(host, track);
        void trackOwner(host, track);
      });
    },

    /** Episode-first card; `track` is the catalog row when the venue is one. */
    showEntry(
      entry: SeriesEntry,
      track: TrackProps | null,
      target: number,
      steps: { prev: boolean; next: boolean } = { prev: false, next: false },
    ) {
      open((host) => {
        kicker(entry.kind === 'episode' ? `${entry.label} / ${target}` : String(entry.label), true);
        titleRow(
          host,
          localized(entry.title, lang) ?? track?.name ?? entry.label,
          { kind: 'challenge', key: String(entry.label) },
          strings,
        );

        // An episode is filmed AT somewhere. Rather than bury that place's details at the
        // bottom of this sheet, the venue line is the way in to its own sheet, and back
        // returns here.
        const venue = localized(entry.venue, lang) ?? track?.name ?? null;
        if (venue && track && deps.onVenue) {
          const row = el('button', 'wm-panel__venue') as HTMLButtonElement;
          row.type = 'button';
          row.setAttribute('aria-label', `${strings['map.panel.venue'] ?? 'About this place'} · ${venue}`);
          const go = el('span', 'wm-panel__venue-go');
          go.innerHTML =
            '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"' +
            ' stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M9.5 5.5 16 12l-6.5 6.5"/></svg>';
          row.append(el('span', 'wm-panel__venue-name', venue), go);
          row.addEventListener('click', () => deps.onVenue!(track));
          host.appendChild(row);
        } else if (venue) {
          host.appendChild(el('p', 'wm-panel__meta', venue));
        }

        carousel(entry, host);

        // "In production" is about whether there is anything to watch yet, not about
        // whether the ride happened — a live episode with no links is still unpublished.
        const published = !!entry.links && Object.values(entry.links).some(Boolean);
        if (!published) {
          host.appendChild(
            el('p', 'wm-panel__status', strings['map.panel.inProduction'] ?? 'Episode in production'),
          );
        }
        // Platform jumps lead, episode arrows trail — one row.
        const actions = el('div', 'wm-panel__actions');
        actions.append(platformRow(entry), stepper(steps.prev, steps.next));
        host.appendChild(actions);

      });
    },
  };
}

export type Panel = ReturnType<typeof createPanel>;
