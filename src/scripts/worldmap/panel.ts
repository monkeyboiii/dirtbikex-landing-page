import type { SeriesEntry, Strings, TrackProps } from './types';

/** Monochrome marks — the map's only saturated colour is its data, not its chrome. */
const PLATFORM_ICONS: Record<string, string> = {
  tiktok:
    '<path fill="currentColor" d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 1 1-1.86-2.48V9.77a5.68 5.68 0 1 0 4.95 5.63V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3a4.29 4.29 0 0 1-3.24-1.48Z"/>',
  douyin:
    '<path fill="currentColor" d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 1 1-1.86-2.48V9.77a5.68 5.68 0 1 0 4.95 5.63V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3a4.29 4.29 0 0 1-3.24-1.48Z"/><path fill="currentColor" opacity=".55" d="M5.1 14.7a5.68 5.68 0 0 1 5.49-5.68v2.2a3.48 3.48 0 1 0 2.4 3.3v-.3h2.2v.3a5.68 5.68 0 1 1-10.09-3.6"/>',
  facebook:
    '<path fill="currentColor" d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.91 3.77-3.91 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.45 2.9h-2.33V22c4.78-.76 8.44-4.92 8.44-9.94Z"/>',
  instagram:
    '<path fill="currentColor" d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16Zm0 5.68a4.16 4.16 0 1 0 0 8.32 4.16 4.16 0 0 0 0-8.32Zm0 6.86a2.7 2.7 0 1 1 0-5.4 2.7 2.7 0 0 1 0 5.4Zm5.3-7.02a.97.97 0 1 1-1.94 0 .97.97 0 0 1 1.94 0Z"/>',
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
  const body = root.querySelector<HTMLElement>('[data-panel-body]')!;
  const closeBtn = root.querySelector<HTMLButtonElement>('[data-panel-close]')!;

  closeBtn.setAttribute('aria-label', strings['map.panel.close'] ?? 'Close');
  closeBtn.addEventListener('click', () => deps.onClose());

  function open(build: (host: HTMLElement) => void) {
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
      a.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${PLATFORM_ICONS[platform] ?? ''}</svg>`;
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

        const tagline = localized(entry.tagline, lang);
        if (tagline) host.appendChild(el('p', 'wm-panel__tagline', tagline));

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
