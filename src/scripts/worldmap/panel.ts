import type { SeriesEntry, Strings, TrackProps } from './types';

const PLATFORM_LABELS: Record<string, string> = {
  douyin: '抖音 Douyin',
  bilibili: 'Bilibili',
  rednote: '小红书 RedNote',
  wechat: 'WeChat',
  tiktok: 'TikTok',
  ytshorts: 'YouTube',
  reels: 'Instagram',
};

const CN_FIRST = ['rednote', 'douyin', 'bilibili', 'wechat', 'tiktok', 'ytshorts', 'reels'];
const INTL_FIRST = ['tiktok', 'ytshorts', 'reels', 'douyin', 'bilibili', 'rednote', 'wechat'];

export interface PanelDeps {
  root: HTMLElement;
  strings: Strings;
  lang: string;
  joinUrl: string;
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
  const { root, strings, lang, joinUrl } = deps;
  const body = root.querySelector<HTMLElement>('[data-panel-body]')!;
  const closeBtn = root.querySelector<HTMLButtonElement>('[data-panel-close]')!;

  closeBtn.setAttribute('aria-label', strings['map.panel.close'] ?? 'Close');
  closeBtn.addEventListener('click', () => deps.onClose());

  function open(build: (host: HTMLElement) => void) {
    body.replaceChildren();
    build(body);
    const join = el('a', 'wm-panel__join', strings['map.panel.join'] ?? 'Join DirtBikeX') as HTMLAnchorElement;
    join.href = joinUrl;
    body.appendChild(join);
    root.hidden = false;
    root.classList.add('is-open');
    closeBtn.focus({ preventScroll: true });
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

        const watch = el('div', 'wm-panel__watch');
        if (entry.status === 'live' && entry.links) {
          const order = lang.startsWith('zh') ? CN_FIRST : INTL_FIRST;
          for (const platform of order) {
            const href = entry.links[platform];
            if (!href) continue;
            const a = el('a', 'wm-watch', `${strings['map.panel.watch'] ?? 'Watch'} · ${PLATFORM_LABELS[platform] ?? platform}`) as HTMLAnchorElement;
            a.href = href;
            a.target = '_blank';
            a.rel = 'noopener';
            watch.appendChild(a);
          }
        }
        // A live entry whose links aren't filled in yet still needs to say something.
        if (watch.childElementCount) {
          host.appendChild(watch);
        } else {
          host.appendChild(
            el('p', 'wm-panel__status', strings['map.panel.inProduction'] ?? 'Episode in production'),
          );
        }

        if (track) trackInfo(host, track);
      });
    },
  };
}

export type Panel = ReturnType<typeof createPanel>;
