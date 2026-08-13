import type { EntryPlacement, SeriesDoc, SeriesEntry, Strings } from './types';

/** Stops drawn ahead of the journey. Deliberately short — the rail is a position
    indicator, not the whole route; the remainder is summed into a muted "+N". */
const RUNWAY = 6;
/** Longest label we'll put under the active stop before trimming. */
const LABEL_MAX = 18;

export interface HudDeps {
  root: HTMLElement;
  strings: Strings;
  lang: string;
  onPick(placement: EntryPlacement): void;
  onToggleSeries(): void;
}

function localized(block: Record<string, string> | null | undefined, lang: string): string | null {
  if (!block) return null;
  return block[lang] ?? block[lang.split('-')[0]!] ?? block.en ?? null;
}

export function createHud(deps: HudDeps, series: SeriesDoc, placements: Map<SeriesEntry, EntryPlacement>) {
  const { root, strings, lang } = deps;
  const bar = root.querySelector<HTMLElement>('[data-hud-bar]')!;
  // Inner rail, padded by half the viewport so any stop can sit dead centre.
  const rail = document.createElement('div');
  rail.className = 'wm-hud__rail';
  bar.appendChild(rail);
  const counterEl = root.querySelector<HTMLElement>('[data-hud-counter]')!;
  const toggleBtn = root.querySelector<HTMLButtonElement>('[data-hud-toggle]')!;
  const labelEl = root.querySelector<HTMLElement>('[data-hud-label]')!;

  // Shown entries: every episode, plus side entries the operator flagged `hud: "show"`.
  const shown = series.entries
    .filter((e) => e.kind === 'episode' || e.hud === 'show')
    .sort((a, b) => a.main - b.main || a.sub - b.sub);

  const done = series.entries.filter(
    (e) => e.kind === 'episode' && e.main >= 1 && (e.status === 'visited' || e.status === 'live'),
  ).length;

  counterEl.textContent = (strings['map.hud.counter'] ?? '{done} / {total}')
    .replace('{done}', String(done).padStart(2, '0'))
    .replace('{total}', String(series.target));

  toggleBtn.addEventListener('click', () => deps.onToggleSeries());

  function shortLabel(entry: SeriesEntry): string {
    const text = localized(entry.venue, lang) ?? localized(entry.title, lang) ?? entry.label;
    if (text.length <= LABEL_MAX) return text;
    return `${text.slice(0, LABEL_MAX - 1).replace(/[\s,;·、，]+$/, '')}…`;
  }

  function centre(ball: HTMLElement, smooth = true) {
    ball.scrollIntoView({
      behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto',
      inline: 'center',
      block: 'nearest',
    });
  }

  function render() {
    rail.replaceChildren();

    for (const entry of shown) {
      const ball = document.createElement('button');
      ball.type = 'button';
      ball.className = [
        'wm-ball',
        'is-done',
        entry.kind === 'side' ? 'wm-ball--side' : '',
        entry.status === 'live' ? 'is-live' : '',
      ]
        .filter(Boolean)
        .join(' ');
      ball.dataset.label = entry.label;
      ball.setAttribute('aria-label', `${entry.label} — ${shortLabel(entry)}`);
      ball.addEventListener('click', () => deps.onPick(placements.get(entry) ?? { entry, lngLat: null }));
      rail.appendChild(ball);
    }

    // Upcoming stops are inert by design — there is no committed target list to reveal.
    const remaining = Math.max(0, series.target - done);
    const drawn = Math.min(RUNWAY, remaining);
    for (let i = 0; i < drawn; i++) {
      const ball = document.createElement('span');
      ball.className = 'wm-ball wm-ball--empty';
      ball.setAttribute('aria-hidden', 'true');
      rail.appendChild(ball);
    }
    if (remaining > drawn) {
      const rest = document.createElement('span');
      rest.className = 'wm-ball__rest';
      rest.setAttribute('aria-hidden', 'true');
      rest.textContent = `+${remaining - drawn}`;
      rail.appendChild(rest);
    }
  }

  function setActive(entry: SeriesEntry | null, smooth = true) {
    let hit: HTMLElement | null = null;
    for (const ball of rail.querySelectorAll<HTMLElement>('.wm-ball')) {
      const active = !!entry && ball.dataset.label === entry.label;
      ball.classList.toggle('is-active', active);
      if (active) hit = ball;
    }
    labelEl.textContent = entry ? shortLabel(entry) : '';
    if (hit) centre(hit, smooth);
  }

  render();
  // Open on the newest completed stop so the label and the camera agree.
  const opening = [...shown].reverse().find((e) => e.status === 'live' || e.status === 'visited') ?? null;
  setActive(opening, false);

  return {
    setSeriesMode(on: boolean) {
      root.classList.toggle('is-series', on);
      toggleBtn.setAttribute('aria-pressed', String(on));
      toggleBtn.title = on
        ? strings['map.hud.worldMode'] ?? 'Back to the world'
        : strings['map.hud.seriesMode'] ?? 'Series mode';
    },
    highlight(entry: SeriesEntry | null) {
      setActive(entry ?? opening);
    },
  };
}

export type Hud = ReturnType<typeof createHud>;
