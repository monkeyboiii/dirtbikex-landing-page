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
  share: { kind: 'route' | 'track' | 'shop' | 'challenge'; key: string } | null,
  strings: Record<string, string>,
): void {
  const row = el('div', 'wm-panel__titlerow');
  row.appendChild(el('h2', 'wm-panel__title', text));

  if (share?.key) {
    const label = strings['map.panel.share'] ?? 'Share';
    const button = el('button', 'wm-panel__share') as HTMLButtonElement;
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', `${label} · ${text}`);
    button.innerHTML =
      SHARE_SVG;

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const url = `${location.origin}/share/${share.kind}/${encodeURIComponent(share.key)}`;
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

  closeBtn.setAttribute('aria-label', strings['map.panel.close'] ?? 'Close');
  closeBtn.addEventListener('click', () => deps.onClose());
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

  function open(build: (host: HTMLElement) => void) {
    if (pushNext) pushNext = false;
    else views.length = 0;
    views.push(build);
    paint();
  }

  function close() {
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

  function trackInfo(host: HTMLElement, track: TrackProps) {
    // "Track info" moved into the control line, so the body opens on the content
    // rather than on a label. Directions rides the address line it belongs to —
    // it acts on that address — instead of floating alone at the foot of the sheet.
    const meta = el('p', 'wm-panel__meta');
    const bits = [track.locality, track.country_code].filter(Boolean) as string[];
    meta.textContent = bits.join(' · ');
    if (track.name_local && track.name_local !== track.name) {
      meta.textContent = [track.name_local, ...bits].join(' · ');
    }
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

    /** What the visitor is agreeing to before they hand over a trace of where they ride. */
    showUploadIntro(pick: () => void) {
      open((host) => {
        kicker(strings['map.upload.kicker'] ?? 'Your trail');
        titleRow(host, strings['map.upload.title'] ?? 'Put your ride on the map', null, strings);
        host.appendChild(
          el('p', 'wm-panel__meta', strings['map.upload.body']
            ?? 'Drop a .gpx file and we will draw it. Nobody else sees it: you get a private link and a code, and the trail is deleted in 72 hours unless you claim it on the forum.'),
        );
        const button = el('button', 'wm-panel__cta') as HTMLButtonElement;
        button.type = 'button';
        button.textContent = strings['map.upload.pick'] ?? 'Choose a .gpx file';
        button.addEventListener('click', pick);
        host.appendChild(button);
      });
    },

    showUploadBusy() {
      open((host) => {
        kicker(strings['map.upload.kicker'] ?? 'Your trail');
        titleRow(host, strings['map.upload.working'] ?? 'Uploading\u2026', null, strings);
      });
    },

    /**
     * The link and the code are shown ONCE and never again \u2014 nothing a visitor can ask
     * for will repeat them. So they are copyable, and the sheet says plainly that losing
     * them loses the trail.
     */
    showUploadDone(result: UploadResult) {
      open((host) => {
        kicker(strings['map.upload.kicker'] ?? 'Your trail');
        titleRow(host, strings['map.upload.doneTitle'] ?? 'Your trail is on the map', null, strings);
        host.appendChild(
          el('p', 'wm-panel__meta', strings['map.upload.doneBody']
            ?? 'Keep both of these. The link is the only way back to this trail, and the code is the only way to make it yours \u2014 we cannot show them to you again.'),
        );
        host.appendChild(
          el('p', 'wm-panel__meta', (strings['map.upload.expires'] ?? 'It is deleted in {n} hours unless you claim it.')
            .replace('{n}', String(result.expires_in_hours))),
        );

        const copyRow = (label: string, value: string) => {
          const row = el('div', 'wm-panel__copy');
          row.appendChild(el('span', 'wm-panel__copy-label', label));
          const field = el('code', 'wm-panel__copy-value', value);
          const button = el('button', 'wm-panel__copy-btn') as HTMLButtonElement;
          button.type = 'button';
          button.textContent = strings['map.upload.copy'] ?? 'Copy';
          button.addEventListener('click', () => {
            void navigator.clipboard?.writeText(value).then(() => {
              button.textContent = strings['map.upload.copied'] ?? 'Copied';
            });
          });
          row.append(field, button);
          host.appendChild(row);
        };
        copyRow(strings['map.upload.link'] ?? 'Trail link', `${location.origin}${result.map_url}`);
        copyRow(strings['map.upload.code'] ?? 'Claim code', result.claim_code);

        const claim = el('a', 'wm-panel__cta') as HTMLAnchorElement;
        claim.href = result.claim_url;
        claim.textContent = strings['map.upload.claim'] ?? 'Claim this trail';
        host.appendChild(claim);
      });
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
     * A ride somebody recorded. The trace is the subject: its numbers sit under the
     * title, the file's provenance reads as chips, and the rider is a byline — an
     * avatar at attribution scale, not a profile header.
     */
    showTrail(trail: Trail) {
      open((host) => {
        const st = trail.stats ?? null;
        kicker(strings['map.trail.kicker'] ?? 'Rider trail');
        // /share/route/<id> reads the public map document, which a link-only trail is
        // deliberately not in. Sharing one means passing on its secret link, which the
        // upload sheet hands over explicitly — so this card simply has no share button.
        const shareable = !trail.visibility || trail.visibility === 'public';
        titleRow(
          host,
          localized(trail.title, lang) ?? trail.id,
          shareable ? { kind: 'route', key: trail.id } : null,
          strings,
        );

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
        } else if (st) {
          chips.appendChild(el('span', 'wm-chip', strings['map.trail.plotted'] ?? 'Plotted route'));
        }
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
        if (chips.childElementCount) host.appendChild(chips);

        // An uploaded trail has no author until somebody claims it. Rendering an empty
        // face there would invent a person; rendering the service account would name the
        // wrong one. So an unclaimed trail simply has no byline, and its links stand alone.
        const by = trail.author_username
          ? personBlock(
              trail.author_username,
              trail.author_name ?? '',
              trail.author_avatar ?? null,
              strings['map.trail.rider'] ?? 'Rider',
            )
          : null;
        // A face and a name with nothing said about them read as the subject of the
        // sheet. The label is what makes them the author of it.
        if (by) host.appendChild(el('h3', 'wm-panel__section', strings['map.trail.uploadedBy'] ?? 'Uploaded by'));

        // The two ways out of this trail sit on the uploader's row rather than in a
        // strip of their own: one line of who and where-next, not two of each.
        const row = el('div', 'wm-panel__socials');
        const byline = el('div', 'wm-panel__byline');
        if (by) byline.append(by);
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
        titleRow(host, track.name, { kind: track.kind === 'shop' ? 'shop' : 'track', key: track.slug }, strings);
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
