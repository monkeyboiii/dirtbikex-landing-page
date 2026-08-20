/**
 * Find a place by name instead of by panning. The catalog is already in memory —
 * the same rows the viewport cull draws from — so matching is a plain scan over a
 * few thousand objects and needs no index, no worker and no endpoint.
 *
 * The kind marks are cloned out of the layer rail rather than re-declared here, so
 * a pin, its rail toggle and its search row can never drift into three different
 * drawings of the same thing.
 */
import type { Strings, TrackProps } from './types';

/** Long enough that a fast typist runs one pass, short enough to feel live. */
const DEBOUNCE_MS = 180;
const MAX_ROWS = 24;

type Kind = 'tracks' | 'trails' | 'shops';
const KINDS: Kind[] = ['tracks', 'trails', 'shops'];

const kindOf = (p: TrackProps): Kind =>
  p.kind === 'trail' ? 'trails' : p.kind === 'shop' ? 'shops' : 'tracks';

export interface SearchDeps {
  strings: Strings;
  /** Every catalog row currently in memory: tracks, shops and any loaded trails. */
  rows(): TrackProps[];
  /** Trails load lazily behind their rail toggle; opening search pulls them in. */
  ensure(): Promise<void>;
  onPick(slug: string): void;
}

/**
 * A match is a prefix or a substring on any of the three things a rider would type:
 * the name we display, the local-language name, and the town. Prefix wins so that
 * typing "hu" puts Huzhou above a place with "hu" buried in the middle of its name.
 */
function score(p: TrackProps, q: string): number {
  let best = 0;
  for (const field of [p.name, p.name_local, p.locality]) {
    if (!field) continue;
    const hay = field.toLowerCase();
    if (hay.startsWith(q)) return 3;
    if (hay.includes(q)) best = 1;
  }
  return best;
}

export function wireSearch(root: HTMLElement, deps: SearchDeps) {
  const box = root.querySelector<HTMLElement>('[data-search]');
  const toggle = root.querySelector<HTMLButtonElement>('[data-search-toggle]');
  const input = root.querySelector<HTMLInputElement>('[data-search-input]');
  const list = root.querySelector<HTMLElement>('[data-search-results]');
  const filters = root.querySelector<HTMLElement>('[data-search-filters]');
  if (!box || !toggle || !input || !list || !filters) return;

  const { strings } = deps;
  let kind: Kind | 'all' = 'all';
  let timer = 0;
  let active = -1;

  /** The rail's own artwork for a layer, at result-row scale. */
  const railMark = (layer: Kind): SVGElement | null => {
    const svg = root.querySelector<SVGElement>(`[data-layer="${layer}"] .wm-rail__on svg`);
    return svg ? (svg.cloneNode(true) as SVGElement) : null;
  };

  for (const id of ['all', ...KINDS] as const) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'wm-search__filter';
    chip.dataset.kind = id;
    chip.setAttribute('aria-pressed', String(id === 'all'));
    if (id !== 'all') {
      const mark = railMark(id);
      if (mark) chip.appendChild(mark);
    }
    chip.appendChild(
      Object.assign(document.createElement('span'), {
        textContent:
          id === 'all' ? strings['map.search.all'] ?? 'All' : strings[`map.layer.${id}`] ?? id,
      }),
    );
    chip.addEventListener('click', () => {
      kind = id;
      for (const other of filters.querySelectorAll('.wm-search__filter')) {
        other.setAttribute('aria-pressed', String(other === chip));
      }
      render();
    });
    filters.appendChild(chip);
  }

  function render() {
    const q = input!.value.trim().toLowerCase();
    list!.textContent = '';
    active = -1;
    if (!q) return;

    const hits = deps
      .rows()
      .filter((p) => (kind === 'all' || kindOf(p) === kind) && score(p, q) > 0)
      .sort((a, b) => score(b, q) - score(a, q) || a.name.localeCompare(b.name))
      .slice(0, MAX_ROWS);

    if (!hits.length) {
      list!.appendChild(
        Object.assign(document.createElement('li'), {
          className: 'wm-search__empty',
          textContent: strings['map.search.empty'] ?? 'Nothing matched',
        }),
      );
      return;
    }

    for (const hit of hits) {
      const row = document.createElement('li');
      row.className = 'wm-search__row';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      const mark = railMark(kindOf(hit));
      if (mark) {
        const holder = document.createElement('span');
        holder.className = 'wm-search__mark';
        holder.appendChild(mark);
        row.appendChild(holder);
      }
      const text = document.createElement('span');
      text.className = 'wm-search__text';
      const title = document.createElement('b');
      title.textContent = hit.name_local && hit.name_local !== hit.name ? hit.name_local : hit.name;
      text.appendChild(title);
      const where = [hit.locality, hit.country_code].filter(Boolean).join(' · ');
      if (where) {
        text.appendChild(
          Object.assign(document.createElement('span'), { textContent: where }),
        );
      }
      row.appendChild(text);
      row.addEventListener('click', () => pick(hit.slug));
      list!.appendChild(row);
    }
  }

  function pick(slug: string) {
    close();
    deps.onPick(slug);
  }

  function highlight(delta: number) {
    const rows = [...list!.querySelectorAll<HTMLElement>('.wm-search__row')];
    if (!rows.length) return;
    active = (active + delta + rows.length + 1) % (rows.length + 1) - 1;
    rows.forEach((row, i) => row.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) rows[active]!.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    box!.hidden = false;
    root.classList.add('is-searching');
    toggle!.setAttribute('aria-expanded', 'true');
    // Trails are behind their rail toggle; a search that silently skipped them
    // would look like the trail simply isn't on the map.
    void deps.ensure().then(() => {
      if (!box!.hidden) render();
    });
    input!.focus();
  }

  function close() {
    box!.hidden = true;
    root.classList.remove('is-searching');
    toggle!.setAttribute('aria-expanded', 'false');
    input!.value = '';
    list!.textContent = '';
    active = -1;
  }

  toggle.addEventListener('click', () => (box.hidden ? open() : close()));
  root.querySelector('[data-search-close]')?.addEventListener('click', close);

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(render, DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      close();
      toggle.focus();
      return;
    }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      highlight(ev.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (ev.key === 'Enter') {
      const rows = [...list.querySelectorAll<HTMLElement>('.wm-search__row')];
      const row = rows[active >= 0 ? active : 0];
      if (row) {
        ev.preventDefault();
        row.click();
      }
    }
  });
}
