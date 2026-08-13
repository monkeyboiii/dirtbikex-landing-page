import type { SeriesEntry, Strings, TrackProps } from './types';

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

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: 'TikTok',
  douyin: '抖音',
  facebook: 'Facebook',
  instagram: 'Instagram',
};

/** Douyin stands in for TikTok where TikTok isn't the platform people use. */
const platformsFor = (lang: string) => [lang === 'zh-CN' ? 'douyin' : 'tiktok', 'facebook', 'instagram'];

export interface PanelDeps {
  root: HTMLElement;
  strings: Strings;
  lang: string;
  socials: Partial<Record<string, string>>;
  contactUrl: string;
  onClose(): void;
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

export function createPanel(deps: PanelDeps) {
  const { root, strings, lang, socials, contactUrl } = deps;
  // Guards against a slow preview landing in a sheet the visitor already left.
  let generation = 0;
  const body = root.querySelector<HTMLElement>('[data-panel-body]')!;
  const closeBtn = root.querySelector<HTMLButtonElement>('[data-panel-close]')!;

  closeBtn.setAttribute('aria-label', strings['map.panel.close'] ?? 'Close');
  closeBtn.addEventListener('click', () => deps.onClose());

  function open(build: (host: HTMLElement) => void) {
    generation++;
    body.replaceChildren();
    build(body);
    root.hidden = false;
    root.classList.add('is-open');
    closeBtn.focus({ preventScroll: true });
  }

  /**
   * Jump straight to this episode on each platform. Until an episode carries its
   * per-platform link the button falls back to our profile there, and to /contact
   * for platforms we have no profile URL for.
   */
  function platformRow(entry: SeriesEntry): HTMLElement {
    const row = el('div', 'wm-panel__socials');
    for (const platform of platformsFor(lang)) {
      const href = entry.links?.[platform] || socials[platform] || contactUrl;
      const external = /^https?:/.test(href);
      const a = el('a', 'wm-social') as HTMLAnchorElement;
      a.href = href;
      a.title = PLATFORM_LABELS[platform] ?? platform;
      a.setAttribute('aria-label', `${strings['map.panel.watch'] ?? 'Watch'} · ${PLATFORM_LABELS[platform] ?? platform}`);
      if (external) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
      const uid = `${platform}-${generation}`;
      a.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${PLATFORM_ICONS[platform]?.(uid) ?? ''}</svg>`;
      row.appendChild(a);
    }
    return row;
  }

  function close() {
    root.classList.remove('is-open');
    root.hidden = true;
    body.replaceChildren();
  }

  function trackInfo(host: HTMLElement, track: TrackProps) {
    host.appendChild(el('h3', 'wm-panel__section', strings['map.panel.trackInfo'] ?? 'Track info'));

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

  function attachPreview(entry: SeriesEntry, host: HTMLElement, tagline: HTMLElement | null) {
    const candidates = platformsFor(lang)
      .concat(Object.keys(entry.links ?? {}))
      .map((platform) => entry.links?.[platform])
      .filter((href, i, all): href is string => !!href && all.indexOf(href) === i)
      .slice(0, 4);
    if (!candidates.length) return;

    const mine = generation;
    const card = el('a', 'wm-preview is-loading') as HTMLAnchorElement;
    card.href = candidates[0]!;
    card.target = '_blank';
    card.rel = 'noopener';
    host.appendChild(card);

    const query = candidates.map((u) => `u=${encodeURIComponent(u)}`).join('&');
    fetch(`/api/map/og?${query}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('og'))))
      .then((og: { ok?: boolean; url?: string; title?: string; description?: string; image?: string }) => {
        if (mine !== generation) return;
        if (!og?.ok) {
          card.remove();
          return;
        }
        if (og.url) card.href = og.url;
        card.classList.remove('is-loading');
        card.replaceChildren();
        if (og.image) {
          const img = document.createElement('img');
          img.className = 'wm-preview__img';
          img.src = og.image;
          img.alt = '';
          img.loading = 'lazy';
          card.appendChild(img);
        }
        const meta = el('span', 'wm-preview__meta');
        if (og.title) meta.appendChild(el('strong', 'wm-preview__title', og.title));
        if (og.description) meta.appendChild(el('span', 'wm-preview__desc', og.description));
        try {
          meta.appendChild(el('span', 'wm-preview__host', new URL(card.href).hostname.replace(/^www\.|^v\./, '')));
        } catch {
          /* href is always absolute here, but never let a bad URL kill the card */
        }
        card.appendChild(meta);
        // The platform's own copy supersedes ours — no need to say it twice.
        tagline?.remove();
      })
      .catch(() => {
        if (mine === generation) card.remove();
      });
  }

  return {
    close,
    isOpen: () => !root.hidden,

    showTrack(track: TrackProps) {
      open((host) => {
        host.appendChild(el('h2', 'wm-panel__title', track.name));
        trackInfo(host, track);
      });
    },

    /** Episode-first card; `track` is the catalog row when the venue is one. */
    showEntry(entry: SeriesEntry, track: TrackProps | null, target: number) {
      open((host) => {
        const counter = entry.kind === 'episode' ? `${entry.label} / ${target}` : entry.label;
        host.appendChild(el('span', 'wm-panel__counter', counter));
        host.appendChild(el('h2', 'wm-panel__title', localized(entry.title, lang) ?? track?.name ?? entry.label));

        const venue = localized(entry.venue, lang) ?? track?.name ?? null;
        if (venue) host.appendChild(el('p', 'wm-panel__meta', venue));

        if (entry.thumb) {
          const img = document.createElement('img');
          img.className = 'wm-panel__thumb';
          img.src = entry.thumb;
          img.alt = '';
          img.loading = 'lazy';
          host.appendChild(img);
        }

        const taglineText = localized(entry.tagline, lang);
        const taglineEl = taglineText ? el('p', 'wm-panel__tagline', taglineText) : null;
        if (taglineEl) host.appendChild(taglineEl);
        attachPreview(entry, host, taglineEl);

        if (entry.status !== 'live') {
          host.appendChild(
            el('p', 'wm-panel__status', strings['map.panel.inProduction'] ?? 'Episode in production'),
          );
        }
        host.appendChild(platformRow(entry));

        if (track) trackInfo(host, track);
      });
    },
  };
}

export type Panel = ReturnType<typeof createPanel>;
