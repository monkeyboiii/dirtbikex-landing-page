import { wgsToGcj } from './geo';
import type { SeriesEntry, Strings, TrackProps, Trail } from './types';

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
  onClose(): void;
  /** Bottom-trailing arrows: -1 = previous episode, +1 = next. */
  onStep(delta: number): void;
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

  function paint() {
    const build = views[views.length - 1];
    if (!build) return;
    generation++;
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

  function trackInfo(host: HTMLElement, track: TrackProps) {
    const head = el('div', 'wm-panel__sectionrow');
    head.appendChild(el('h3', 'wm-panel__section', strings['map.panel.trackInfo'] ?? 'Track info'));
    if (Number.isFinite(track.lng) && Number.isFinite(track.lat)) {
      const go = el('button', 'wm-panel__go') as HTMLButtonElement;
      go.type = 'button';
      const label = strings['map.panel.directions'] ?? 'Directions';
      go.title = label;
      go.setAttribute('aria-label', label);
      go.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"' +
        ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M12 21s7-6.4 7-11.4A7 7 0 0 0 5 9.6C5 14.6 12 21 12 21Z"/>' +
        '<circle cx="12" cy="9.6" r="2.6"/></svg>';
      go.addEventListener('click', () => openDirections(track));
      head.appendChild(go);
    }
    host.appendChild(head);

    const meta = el('p', 'wm-panel__meta');
    const bits = [track.locality, track.country_code].filter(Boolean) as string[];
    meta.textContent = bits.join(' · ');
    if (track.name_local && track.name_local !== track.name) {
      meta.textContent = [track.name_local, ...bits].join(' · ');
    }
    host.appendChild(meta);

    const chips = el('div', 'wm-panel__chips');
    chips.appendChild(el('span', 'wm-chip', strings[`map.cat.${track.category}`] ?? track.category));
    chips.appendChild(
      el(
        'span',
        `wm-chip ${track.tier === 'verified' ? 'wm-chip--verified' : ''}`,
        track.tier === 'verified'
          ? strings['map.panel.verified'] ?? 'Verified'
          : strings['map.panel.unverified'] ?? 'Unverified',
      ),
    );
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

  return {
    close,
    isOpen: () => !root.hidden,

    /**
     * A ride somebody recorded. The trace is the subject: its numbers sit under the
     * title, the file's provenance reads as chips, and the rider is a byline — an
     * avatar at attribution scale, not a profile header.
     */
    showTrail(trail: Trail) {
      open((host) => {
        const st = trail.stats ?? null;
        host.appendChild(el('span', 'wm-panel__kicker', strings['map.trail.kicker'] ?? 'Rider trail'));
        host.appendChild(el('h2', 'wm-panel__title', localized(trail.title, lang) ?? trail.id));

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

        // Attribution: the /s/u/ identity block quoted at byline scale.
        const named = trail.author_name?.trim() || null;
        const riderLabel = strings['map.trail.rider'] ?? 'Rider';
        const by = el('a', 'wm-by') as HTMLAnchorElement;
        by.href = `/s/u/${encodeURIComponent(trail.author_username)}`;
        // The initial sits under the image, so a failed avatar reveals a letter
        // rather than a broken-image glyph.
        const face = el(
          'span',
          'wm-by__avatar',
          (Array.from((named ?? trail.author_username).trim())[0] ?? '?').toUpperCase(),
        );
        if (trail.author_avatar) {
          const img = document.createElement('img');
          img.src = deps.forumBase + trail.author_avatar.replace('{size}', '72');
          img.alt = '';
          img.width = 36;
          img.height = 36;
          img.loading = 'lazy';
          img.decoding = 'async';
          img.addEventListener('error', () => img.remove(), { once: true });
          face.appendChild(img);
        }
        const idBlock = el('span', 'wm-by__id');
        idBlock.append(
          el('span', 'wm-by__name', named ?? `@${trail.author_username}`),
          el('span', 'wm-by__meta', named ? `${riderLabel} · @${trail.author_username}` : riderLabel),
        );
        by.append(face, idBlock);
        host.appendChild(by);

        // Plain links only — no gpx.studio preview card in this round.
        const row = el('div', 'wm-panel__socials');
        const mark = (icon: string, href: string, label: string) => {
          const a = el('a', 'wm-social') as HTMLAnchorElement;
          a.href = href;
          a.title = label;
          a.setAttribute('aria-label', label);
          if (/^https?:/.test(href)) {
            a.target = '_blank';
            a.rel = 'noopener';
          }
          a.innerHTML = markSvg(icon, `trail-${icon}-${generation}`);
          row.appendChild(a);
        };
        if (trail.post_url) mark('thread', trail.post_url, strings['map.trail.thread'] ?? 'Forum thread');
        if (trail.gpx_url) {
          const files = encodeURIComponent(JSON.stringify([trail.gpx_url]));
          mark('route', `https://gpx.studio/app?files=${files}`, strings['map.trail.studio'] ?? 'Open in gpx.studio');
        }
        if (row.childElementCount) host.appendChild(row);
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
        host.appendChild(el('h2', 'wm-panel__title', track.name));
        trackInfo(host, track);
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
        const counter = entry.kind === 'episode' ? `${entry.label} / ${target}` : entry.label;
        host.appendChild(el('span', 'wm-panel__counter', counter));
        host.appendChild(el('h2', 'wm-panel__title', localized(entry.title, lang) ?? track?.name ?? entry.label));

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
