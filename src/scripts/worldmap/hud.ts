import type { EntryPlacement, SeriesDoc, SeriesEntry, Strings } from './types';

/** Stops drawn ahead of the journey. Deliberately short — the rail is a position
    indicator, not the whole route; the remainder is summed into a muted "+N". */
const RUNWAY = 6;
/** Phones get a shorter runway — the module has to stay clear of the map controls. */
const RUNWAY_NARROW = 2;
/** Longest label we'll put under the active stop before trimming. */
const LABEL_MAX = 18;
/** Idle time after a scroll before the centred stop is actually opened. */
const SETTLE_MS = 170;
/** Our own smooth-scrolls must not be read back as the visitor scrolling. */
const SELF_SCROLL_MS = 480;
/** Quiet time after the last scroll event before the rail springs back. Short enough
    to feel like release, long enough not to fight a slow drag. */
const SNAP_IDLE_MS = 150;

/** Android fires; iOS Safari has no web haptics, so this is a no-op there. */
function buzz() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  try {
    navigator.vibrate?.(6);
  } catch {
    /* vibrate is gated on some browsers; never let it break scrolling */
  }
}

export interface HudDeps {
  root: HTMLElement;
  strings: Strings;
  lang: string;
  /** Scrub: centre the stop and take the camera there. Never opens the sheet. */
  onFocus(placement: EntryPlacement): void;
  /** Commit: open the episode sheet. Only the centred stop or its label does this. */
  onOpen(placement: EntryPlacement): void;
  onToggleSeries(): void;
  /** The stop the map opened on — the island owns the rule, the rail follows it. */
  opening: SeriesEntry | null;
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

  /** The counter reads the stop you are looking at, so it follows the rail as you scrub.
      The number is the entry's own label, which is how a side stop reads as "2.5". */
  function setCounter(entry: SeriesEntry | null) {
    counterEl.textContent = (strings['map.hud.counter'] ?? '{done} / {total}')
      .replace('{done}', entry ? entry.label : String(done).padStart(2, '0'))
      .replace('{total}', String(series.target));
  }
  setCounter(null);

  toggleBtn.addEventListener('click', () => deps.onToggleSeries());

  function shortLabel(entry: SeriesEntry): string {
    const text = localized(entry.venue, lang) ?? localized(entry.title, lang) ?? entry.label;
    if (text.length <= LABEL_MAX) return text;
    return `${text.slice(0, LABEL_MAX - 1).replace(/[\s,;·、，]+$/, '')}…`;
  }

  /** Returns true only when it actually moved — arming the self-scroll guard for a
      zero-distance "centre" would swallow the visitor's next real scroll. */
  function centre(ball: HTMLElement, smooth = true): boolean {
    const box = ball.getBoundingClientRect();
    const mid = bar.getBoundingClientRect().left + bar.clientWidth / 2;
    if (Math.abs(box.left + box.width / 2 - mid) < 2) return false;
    ball.scrollIntoView({
      behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto',
      inline: 'center',
      block: 'nearest',
    });
    return true;
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
        entry.status === 'upcoming' ? 'is-upcoming' : '',
      ]
        .filter(Boolean)
        .join(' ');
      ball.dataset.label = entry.label;
      // Dot colour is operator-set per entry (series.json `tone`).
      if (entry.tone) ball.dataset.tone = entry.tone;
      ball.setAttribute('aria-label', `${entry.label} — ${shortLabel(entry)}`);
      ball.addEventListener('click', () => {
        const placement = placements.get(entry) ?? { entry, lngLat: null };
        // Tapping an off-centre stop only scrubs to it; the sheet needs a second
        // tap on the stop once it is centred (or on its label).
        if (entry.label === activeLabel) deps.onOpen(placement);
        else {
          setActive(entry);
          deps.onFocus(placement);
        }
      });
      rail.appendChild(ball);
    }

    // Upcoming stops are inert by design — there is no committed target list to reveal.
    const remaining = Math.max(0, series.target - done);
    const narrow = window.matchMedia('(max-width: 767px)').matches;
    const drawn = Math.min(narrow ? RUNWAY_NARROW : RUNWAY, remaining);
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

  let activeLabel: string | null = null;
  let selfScrollUntil = 0;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;

  function setActive(entry: SeriesEntry | null, smooth = true, scroll = true) {
    clearTimeout(settle);
    let hit: HTMLElement | null = null;
    for (const ball of rail.querySelectorAll<HTMLElement>('.wm-ball')) {
      const active = !!entry && ball.dataset.label === entry.label;
      ball.classList.toggle('is-active', active);
      if (active) hit = ball;
    }
    activeLabel = entry?.label ?? null;
    labelEl.textContent = entry ? shortLabel(entry) : '';
    setCounter(entry);
    if (hit && scroll && centre(hit, smooth)) {
      selfScrollUntil = Date.now() + SELF_SCROLL_MS;
    }
  }

  /** The stop closest to the middle of the rail — empties aren't selectable. */
  function centred(): SeriesEntry | null {
    const mid = bar.getBoundingClientRect().left + bar.clientWidth / 2;
    let best: SeriesEntry | null = null;
    let bestDist = Infinity;
    for (const ball of rail.querySelectorAll<HTMLElement>('.wm-ball.is-done')) {
      const box = ball.getBoundingClientRect();
      const dist = Math.abs(box.left + box.width / 2 - mid);
      if (dist < bestDist) {
        bestDist = dist;
        best = shown.find((e) => e.label === ball.dataset.label) ?? null;
      }
    }
    return best;
  }

  /**
   * The runway ahead is real scrollable content, so the journey can be dragged into
   * the stops that do not exist yet — but it is not a destination. When scrolling
   * stops, the nearest stop that DOES exist springs back to centre. This also tidies
   * up a proximity snap that came to rest between two stops.
   */
  function springBack() {
    // Never fight our own smooth scroll; wait it out instead.
    if (Date.now() < selfScrollUntil) {
      idle = setTimeout(springBack, SNAP_IDLE_MS);
      return;
    }
    // Re-centre the stop that is ALREADY active — never adopt a different one. The
    // scroll handler above owns changing the selection, on its own settle timer. When
    // this also adopted whatever happened to be nearest, a deep link's own smooth
    // scroll could be sampled mid-animation and silently swap the open episode.
    const entry = shown.find((e) => e.label === activeLabel) ?? centred();
    if (entry) setActive(entry);
  }

  // Scrolling the rail selects whatever lands in the middle: the label and dot
  // follow immediately (with a tick of haptics), the sheet once scrolling settles.
  bar.addEventListener('scrollend', () => {
    selfScrollUntil = 0;
  });

  bar.addEventListener(
    'scroll',
    () => {
      // Armed before the early returns: dragging over the empty runway never changes
      // the centred entry, so this is the only thing that would fire there.
      clearTimeout(idle);
      idle = setTimeout(springBack, SNAP_IDLE_MS);
      if (Date.now() < selfScrollUntil) return;
      const entry = centred();
      if (!entry || entry.label === activeLabel) return;
      setActive(entry, false, false);
      buzz();
      clearTimeout(settle);
      settle = setTimeout(() => deps.onFocus(placements.get(entry) ?? { entry, lngLat: null }), SETTLE_MS);
    },
    { passive: true },
  );

  // The label under the rail is the commit affordance for the centred stop.
  labelEl.addEventListener('click', () => {
    const entry = shown.find((e) => e.label === activeLabel);
    if (entry) deps.onOpen(placements.get(entry) ?? { entry, lngLat: null });
  });

  render();
  // The label and the camera must agree, so the rail opens on the island's choice.
  const opening =
    deps.opening && shown.includes(deps.opening)
      ? deps.opening
      : [...shown].reverse().find((e) => e.status === 'live' || e.status === 'visited') ?? null;
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
