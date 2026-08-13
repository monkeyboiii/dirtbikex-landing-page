import type { EntryPlacement, SeriesDoc, SeriesEntry, Strings } from './types';

/** Empty balls trailing the journey — runway, not a 100-ball bar. */
const RUNWAY = 3;
/** Filled/side balls kept in the visible window; older ones collapse behind a "⋯" chip. */
const WINDOW = 5;

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
  const counterEl = root.querySelector<HTMLElement>('[data-hud-counter]')!;
  const titleBtn = root.querySelector<HTMLButtonElement>('[data-hud-title]')!;
  const tip = root.querySelector<HTMLElement>('[data-hud-tip]')!;

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

  titleBtn.addEventListener('click', () => deps.onToggleSeries());

  function showTip(anchor: HTMLElement, entry: SeriesEntry) {
    const title = localized(entry.title, lang) ?? localized(entry.venue, lang) ?? entry.label;
    const status =
      entry.status === 'live'
        ? strings['map.panel.watch'] ?? 'Watch'
        : strings['map.panel.inProduction'] ?? 'Episode in production';
    const date = entry.published_on ?? entry.visited_on ?? '';
    tip.replaceChildren();
    const label = document.createElement('strong');
    label.textContent = entry.label;
    const line = document.createElement('span');
    line.textContent = title;
    const foot = document.createElement('em');
    foot.textContent = date ? `${status} · ${date}` : status;
    tip.append(label, line, foot);
    tip.hidden = false;
    // Position over the ball, clamped inside the HUD.
    const barBox = bar.getBoundingClientRect();
    const box = anchor.getBoundingClientRect();
    tip.style.left = `${Math.max(0, box.left - barBox.left + box.width / 2)}px`;
  }

  function hideTip() {
    tip.hidden = true;
  }

  function render() {
    bar.replaceChildren();
    const overflow = shown.length - WINDOW;
    const visible = overflow > 0 ? shown.slice(overflow) : shown;

    if (overflow > 0) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'wm-ball wm-ball--more';
      more.textContent = '⋯';
      more.title = `+${overflow}`;
      more.addEventListener('click', () => {
        const first = shown[0]!;
        deps.onPick(placements.get(first) ?? { entry: first, lngLat: null });
      });
      bar.appendChild(more);
    }

    for (const entry of visible) {
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
      ball.setAttribute(
        'aria-label',
        `${entry.label} — ${localized(entry.title, lang) ?? localized(entry.venue, lang) ?? ''}`.trim(),
      );
      const pick = () => deps.onPick(placements.get(entry) ?? { entry, lngLat: null });
      ball.addEventListener('click', pick);
      ball.addEventListener('mouseenter', () => showTip(ball, entry));
      ball.addEventListener('focus', () => showTip(ball, entry));
      ball.addEventListener('mouseleave', hideTip);
      ball.addEventListener('blur', hideTip);
      bar.appendChild(ball);
    }

    // Runway: inert by design — there is no committed target list to reveal.
    for (let i = 0; i < RUNWAY; i++) {
      const ball = document.createElement('span');
      ball.className = 'wm-ball wm-ball--empty';
      ball.setAttribute('aria-hidden', 'true');
      bar.appendChild(ball);
    }
    const ellipsis = document.createElement('span');
    ellipsis.className = 'wm-ball__tail';
    ellipsis.setAttribute('aria-hidden', 'true');
    ellipsis.textContent = '⋯';
    bar.appendChild(ellipsis);
  }

  render();

  return {
    setSeriesMode(on: boolean) {
      root.classList.toggle('is-series', on);
      titleBtn.setAttribute('aria-pressed', String(on));
      titleBtn.title = on
        ? strings['map.hud.worldMode'] ?? 'Back to the world'
        : strings['map.hud.seriesMode'] ?? 'Series mode';
    },
    highlight(entry: SeriesEntry | null) {
      for (const ball of bar.querySelectorAll<HTMLElement>('.wm-ball')) {
        ball.classList.toggle('is-active', !!entry && ball.dataset.label === entry.label);
      }
    },
  };
}

export type Hud = ReturnType<typeof createHud>;
