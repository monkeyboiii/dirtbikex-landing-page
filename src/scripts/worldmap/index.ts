import {
  MapLibreMap,
  Marker,
  AttributionControl,
  NavigationControl,
  LngLatBounds,
  setWorkerUrl,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// v6 derives its worker URL from `import.meta.url` at runtime, which Vite can't
// statically analyse — the chunk is never emitted and the map dies on a 404.
// `?worker&url` makes Vite bundle it (it pulls in a shared chunk) and hand back
// the hashed, same-origin URL.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { fetchGpx, parseGpx } from './gpx';
import { preflight, uploadTrail, type Preflight } from './upload';
import { createPanel, type Panel } from './panel';
import { wireSearch } from './search';
import { createHud, type Hud } from './hud';
import { LAYER_DEFAULTS, LAYER_IDS, type LayerId } from './types';
import type {
  EntryPlacement,
  MapConfig,
  SeriesDoc,
  SeriesEntry,
  Strings,
  TrackProps,
  Trail,
  TrailsDoc,
  RiderPin,
  RidersDoc,
} from './types';

const GLYPHS = ['motocross', 'trail_area', 'riding_park', 'ebike_park', 'other'] as const;
const CATEGORY_TO_GLYPH: Record<string, string> = {
  motocross: 'motocross',
  trail_area: 'trail_area',
  riding_park: 'riding_park',
  ebike_park: 'ebike_park',
  club: 'other',
  other: 'other',
};

const ACCENT = '#ed6b00';

/** Pin colours track the basemap: light discs on the dark map, dark discs on the light one. */
function palette(dark: boolean) {
  return dark
    ? {
        breadth: '#6e6c69',
        verified: '#a9a49b',
        glyph: '#0d0c09',
        glyphOnClaimed: '#ffffff',
        pinStroke: '#0d0c09',
        label: '#d8d4cd',
        labelHalo: '#0d0c09',
        // One saturated hue per entity kind, NFSU2-style. Orange stays reserved for
        // the journey and for claimed pins, so a claimed track still reads as special.
        track: '#8b5cf6',
        trail: '#22c55e',
        shop: '#3b82f6',
      }
    : {
        breadth: '#aea291',
        verified: '#57544f',
        glyph: '#faf8f4',
        glyphOnClaimed: '#ffffff',
        pinStroke: '#faf8f4',
        label: '#3c3b3a',
        labelHalo: '#faf8f4',
        track: '#6d28d9',
        trail: '#15803d',
        shop: '#1d4ed8',
      };
}

const DIM = 0.22;
/**
 * Screen space one pin needs at the current zoom, in CSS px.
 *
 * Artwork scales with zoom, so the spacing that keeps two pins from touching has to scale
 * with it. A single fixed number cannot do both jobs: at street zoom it thins the map out
 * for no reason, and pulled back it is the reason a province shows four pins.
 */
function pinPitch(map: MapLibreMap): number {
  const z = map.getZoom();
  let k = BLIP_RAMP[0]![1];
  for (let i = 1; i < BLIP_RAMP.length; i++) {
    const [z0, k0] = BLIP_RAMP[i - 1]!;
    const [z1, k1] = BLIP_RAMP[i]!;
    if (z <= z0) break;
    k = z >= z1 ? k1 : k0 + ((k1 - k0) * (z - z0)) / (z1 - z0);
  }
  // 1.35 of the artwork box, not 1.0: pins that merely fail to overlap still read as a
  // clump. At street zoom this lands on 117 px, which is what the old fixed grid used —
  // the change is that it now shrinks with the artwork instead of staying there.
  return Math.max(44, BLIP_PX * k * 1.35);
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** A row in the operator-published shops doc — see docs/MAP_MODULE.md. */
interface ShopDoc {
  slug: string;
  name: string;
  name_local?: string | null;
  country_code?: string;
  locality?: string | null;
  website?: string | null;
  lng: number;
  lat: number;
}

/** Toggleable map layers. `styleLayers` are MapLibre ids rebuilt by addLayers(); the
    rest of each layer's surface (DOM markers, the HUD) is toggled alongside them. */
const LAYERS: Record<LayerId, readonly string[]> = {
  tracks: ['tracks-glow', 'tracks-dot', 'tracks-glyph', 'tracks-seal', 'tracks-label'],
  shops: ['shops-glow', 'shops-blip', 'shops-label'],
  trails: ['trails-line', 'trails-glow', 'trails-blip', 'trails-label'],
  ride: ['journey-line'],
  // DOM markers, not style layers: a Marker survives setStyle, so this layer
  // never has to be replayed through addLayers() the way the others are.
  riders: [],
};
const LAYER_STORE = 'dbx-map-layers';
/** Uploads this browser made, so a closed sheet is not the end of the link. */
const UPLOAD_STORE = 'dbx-map-uploads';
/** Catalog kinds drawn from the shared `tracks` source, one per toggle. */
const KIND_OF: Partial<Record<LayerId, string>> = { tracks: 'track', shops: 'shop', trails: 'trail' };
/** Baked catalog rows carry no `kind` at all, so this coalesces rather than compares.
    Written positively on purpose: negating each new kind in turn is what let shops,
    and then trails, leak into the track layers. */
const IS_TRACK = ['==', ['coalesce', ['get', 'kind'], 'track'], 'track'] as never;

/** URL wins (shareable), then the visitor's last choice, then the defaults. */
function initialLayers(): Record<LayerId, boolean> {
  const on = { ...LAYER_DEFAULTS };
  const fromUrl = new URLSearchParams(location.search).get('layers');
  const raw = fromUrl ?? (() => {
    try {
      return localStorage.getItem(LAYER_STORE);
    } catch {
      return null;
    }
  })();
  if (raw == null) return on;
  const wanted = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  for (const id of LAYER_IDS) on[id] = wanted.has(id);
  return on;
}
const WORLD_VIEW = { center: [14, 34] as [number, number], zoom: 2.1 };
/** The journey opens at city level — "show me Hangzhou", not "show me Asia". */
const CITY_ZOOM = 10.4;
const CITY_ZOOM_NARROW = 9.8;

setWorkerUrl(maplibreWorkerUrl);

function readJson<T>(id: string): T | null {
  const node = document.getElementById(id);
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent) as T;
  } catch {
    return null;
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const resp = await fetch(url, { headers: { accept: 'application/json' } });
  if (!resp.ok) throw new Error(`${url} → ${resp.status}`);
  return resp.json();
}

/**
 * Same as fetchJson, but reports real byte progress. Used only for the catalog,
 * which is the one boot phase that yields a smooth signal — everything else
 * (tiles, glyph decodes) was measured landing as a single step at the end of its
 * band, so the bar treats those as checkpoints rather than progress sources.
 */
async function fetchJsonProgress(url: string, onBytes: (frac: number) => void): Promise<unknown> {
  const resp = await fetch(url, { headers: { accept: 'application/json' } });
  if (!resp.ok) throw new Error(`${url} → ${resp.status}`);
  const total = Number(resp.headers.get('content-length'));
  if (!resp.body || !Number.isFinite(total) || total <= 0) return resp.json();

  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    seen += value.byteLength;
    onBytes(Math.min(1, seen / total));
  }
  return JSON.parse(new TextDecoder().decode(await new Blob(chunks).arrayBuffer()));
}

/**
 * Boot progress. Weights come from measured cold loads: the catalog download and
 * the basemap's first tile ring dominate, and the basemap band is both the longest
 * and the least observable — so it creeps on a decaying curve toward its own ceiling
 * and only completes on a real event. Nothing can park at 90%: every band has a
 * ceiling below its successor's floor, and the reveal sets 100 unconditionally.
 */
function bootProgress(root: HTMLElement) {
  const bar = root.querySelector<HTMLElement>('[data-gate-bar]');
  const fill = root.querySelector<HTMLElement>('[data-gate-fill]');
  const BANDS = { boot: [0, 8], catalog: [8, 42], style: [42, 52], basemap: [52, 97] } as const;
  let shown = 0;
  let creep: ReturnType<typeof setInterval> | undefined;

  const paint = (value: number) => {
    // Monotonic: a late-arriving signal must never walk the bar backwards.
    shown = Math.max(shown, Math.min(100, value));
    if (fill) fill.style.width = `${shown}%`;
    bar?.setAttribute('aria-valuenow', String(Math.round(shown)));
  };

  const at = (band: keyof typeof BANDS, frac = 1) => {
    const [from, to] = BANDS[band];
    paint(from + (to - from) * Math.min(1, Math.max(0, frac)));
  };

  return {
    at,
    /** Eases toward the band's ceiling without ever reaching it, so a long
        unobservable phase keeps moving instead of freezing mid-bar. */
    creepTo(band: keyof typeof BANDS, seconds: number) {
      clearInterval(creep);
      const [from, to] = BANDS[band];
      const started = performance.now();
      creep = setInterval(() => {
        const t = (performance.now() - started) / (seconds * 1000);
        paint(from + (to - from) * (1 - Math.exp(-t * 1.9)));
      }, 90);
    },
    done() {
      clearInterval(creep);
      paint(100);
    },
  };
}

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isNarrow = () => window.matchMedia('(max-width: 767px)').matches;
const isDarkTheme = () => document.documentElement.classList.contains('dark');
const cityZoom = () => (isNarrow() ? CITY_ZOOM_NARROW : CITY_ZOOM);

/** Picks the best available translation from an operator-authored block. */
function localizedName(block: Record<string, string> | null | undefined, lang: string): string | null {
  if (!block) return null;
  return block[lang] ?? block[lang.split('-')[0]!] ?? block.en ?? null;
}

function entryOrder(a: SeriesEntry, b: SeriesEntry) {
  return a.main - b.main || a.sub - b.sub;
}

/** The map opens on the biggest WHOLE-NUMBER live episode: a side stop (2.5) is a detour,
    not where the journey has got to. Falls back to visited, then to any stop at all. */
function openingEntry(series: SeriesDoc): SeriesEntry | null {
  const ranked = [...series.entries].sort(entryOrder).reverse();
  // `upcoming` is announced, not reached — it shows on the rail but never takes the camera.
  const whole = (e: SeriesEntry) => e.kind === 'episode' && e.sub === 0;
  return (
    ranked.find((e) => whole(e) && e.status === 'live') ??
    ranked.find((e) => whole(e) && e.status === 'visited') ??
    ranked.find((e) => e.status === 'live') ??
    ranked.find((e) => e.status === 'visited') ??
    null
  );
}

/** Recolors a currentColor glyph and registers it with the map at 2× for crisp text-size icons. */
async function addGlyph(
  map: MapLibreMap,
  id: string,
  url: string,
  color: string,
  px = 48,
  halo?: string,
) {
  const source = await fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(url))));
  // A 2px line icon disappears over cased roads and label text. Repeating the artwork
  // underneath at a wider stroke gives it a contour without a background plate.
  const withHalo = halo
    ? source.replace(
        /(<svg[^>]*>)/,
        `$1<g stroke="${halo}" stroke-width="5" stroke-opacity="0.5" stroke-linecap="round" stroke-linejoin="round">${
          source.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '')
        }</g>`,
      )
    : source;
  const painted = withHalo
    .replace(/currentColor/g, color)
    .replace(/\swidth="[^"]*"/, ` width="${px}"`)
    .replace(/\sheight="[^"]*"/, ` height="${px}"`);
  const img = new Image(px, px);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(painted)}`;
  await img.decode();
  // Runtime images do NOT die with setStyle the way sources and layers do, so skipping
  // an id that already exists left every blip painted in the theme it was born in —
  // dark contours on the light map and back again. Replace, always.
  if (map.hasImage(id)) map.removeImage(id);
  map.addImage(id, img, { pixelRatio: 2 });
}

/** Blips are rasterised at 2x their largest drawn size so they stay crisp on a
    retina phone; 48px upscaled to 35 CSS px is what made the old glyphs mushy. */
/** Trail pins, minus the one whose trace is on the map: the line IS that trail, and a
    pin over it hides the very shape the visitor asked to see. */
/**
 * What a pin is called on the map, for this page's language.
 *
 * The catalog carries both a romanised `name` — which is what it is keyed and searched on
 * — and the `name_local` that is actually written on the gate. Labelling every pin with
 * the romanised one left a Chinese map reading "Tong Lu 73 Hao Yue Ye Zhu Ti Le Yuan",
 * which is not what anybody calls it and not what any sign says.
 *
 * Only for scripts where the romanisation is a transliteration rather than the name: a
 * German reader is better served by the form they can actually pronounce and search for.
 */
function labelField(lang: string): unknown {
  const local = /^(zh|ja|ko)/.test(lang);
  return local
    ? ['coalesce', ['get', 'name_local'], ['get', 'name'], '']
    : ['coalesce', ['get', 'name'], ''];
}

/**
 * The basemaps a visitor can choose between.
 *
 * `auto` is the pair this map has always shipped — a light and a dark style built here, so
 * the ground follows the page's theme. The others are single styles and therefore ignore
 * the theme, which is the honest behaviour: a topographic map has one look, and pretending
 * otherwise by tinting it would misrepresent terrain shading.
 *
 * Liberty comes from tiles.openfreemap.org, which already serves every tile on this map, so
 * it costs no new dependency.
 *
 * Topo is OpenTopoMap raster, and it is NOT gpx.studio's Liberty Topo — that style, and
 * every host it pulls from, serves no `access-control-allow-origin`, so a browser on this
 * origin cannot fetch it at all. Their embed works because it runs on their origin. The
 * free global DEMs that would let us build the same look ourselves are no better: AWS
 * terrarium has no CORS either, and MapLibre's demo terrain covers one square of the Alps.
 * OpenTopoMap sends `*`, is global, and is the same contours-and-hillshade picture — at
 * the cost of being raster, so it carries its own baked labels and its own zoom ceiling.
 */
const BASEMAPS = ['auto', 'topo', 'liberty'] as const;
type Basemap = (typeof BASEMAPS)[number];
const BASEMAP_URL: Record<Exclude<Basemap, 'auto'>, string> = {
  topo: '/map/style-topo.json',
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
};
const BASEMAP_STORE = 'dbx-map-basemap';
const LAYERS_SVG =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/></svg>';

function storedBasemap(): Basemap {
  try {
    const saved = localStorage.getItem(BASEMAP_STORE);
    if (saved && (BASEMAPS as readonly string[]).includes(saved)) return saved as Basemap;
  } catch {
    /* private mode */
  }
  return 'auto';
}

function trailPinFilter(drawn: string | null): unknown {
  const isTrail = ['==', ['get', 'kind'], 'trail'];
  return drawn ? ['all', isTrail, ['!=', ['get', 'slug'], drawn]] : isTrail;
}

const BLIP_PX = 96;
/** Blip artwork scale by zoom, and the step up the selection takes. With no bloom
    behind it the pin itself has to say which one the sheet is about. */
const BLIP_RAMP: [number, number][] = [
  [3, 0.3],
  [6, 0.38],
  [8.4, 0.5],
  [10, 0.72],
  [14, 0.9],
];
/** Icons are drawn from world zoom now, so they fade in rather than appearing at 8.4.
    Below that the pin is smaller, not absent — a continent with nothing on it was the
    whole complaint. */
const BLIP_FADE = ['interpolate', ['linear'], ['zoom'], 3, 0.82, 6, 0.92, 9.4, 1] as never;
/** The bloom is a street-zoom flourish; at world zoom it would smear the pins together. */
const GLOW_FADE = ['interpolate', ['linear'], ['zoom'], 6, 0, 8.4, 0.12, 9.6, 0.32] as never;
/** Only the winners of the declutter carry artwork. Everything else in view stays a dot. */
const TOP = ['==', ['get', 'top'], 1];
const withTop = (base: unknown): never => ['all', base, TOP] as never;
const SELECTED_SCALE = 1.3;
function blipSize(selected: string | null): unknown {
  const ramp = (k: number) => [
    'interpolate',
    ['linear'],
    ['zoom'],
    ...BLIP_RAMP.flatMap(([zoom, size]) => [zoom, size * k]),
  ];
  if (!selected) return ramp(1);
  return ['case', ['==', ['get', 'slug'], selected], ramp(SELECTED_SCALE), ramp(1)];
}
/** Zoom at which venue icons have fully faded in; below it a pin is only a dot. */
const BLIP_IN = 9.4;

/** Reuses a font stack the loaded style already ships glyphs for. */
function styleFont(map: MapLibreMap): string[] {
  const style = map.getStyle() as StyleSpecification;
  for (const layer of style.layers ?? []) {
    if (layer.type === 'symbol') {
      const font = (layer.layout as Record<string, unknown> | undefined)?.['text-font'];
      if (Array.isArray(font) && typeof font[0] === 'string') return font as string[];
    }
  }
  return ['Noto Sans Regular'];
}

function radiusExpr(): unknown {
  const pick = (verified: number, breadth: number) => [
    'case',
    ['==', ['get', 'tier'], 'verified'],
    verified,
    breadth,
  ];
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    1, pick(1.7, 1.1),
    4, pick(3.1, 2.0),
    7, pick(4.8, 2.9),
    10, pick(6.6, 4.1),
    14, pick(9.0, 6.0),
  ];
}

/**
 * Dot opacity: the declutter's losers, at every zoom.
 *
 * A pin that won a slot is drawn as artwork and its dot is suppressed, so the two never
 * stack. One that lost stays a dot — that is the density texture, and dropping it was what
 * made a pulled-back map read as empty.
 *
 * **`zoom` has to be the OUTERMOST expression.** MapLibre rejects an interpolate-by-zoom
 * nested inside a `case`, and rejects it by refusing to add the layer at all — so the first
 * shape of this, which wrapped the ramp in a top/dot case, silently deleted every dot on
 * the map and left only the flags. The ramp stays on the outside; every per-feature
 * decision happens in its stop outputs, where data expressions are allowed.
 */
function opacityExpr(factor: number, selected: string | null = null): unknown {
  const stop = (verified: number, breadth: number) => {
    const tier = (k: number) => [
      'case',
      ['==', ['get', 'tier'], 'verified'],
      verified * k,
      breadth * k,
    ];
    // The sheet's own pin is never dimmed — its halo is what the sheet is pointing at.
    if (factor === 1 || !selected) return ['case', TOP, 0, tier(factor)];
    return ['case', TOP, 0, ['==', ['get', 'slug'], selected], tier(1), tier(factor)];
  };
  return [
    'interpolate', ['linear'], ['zoom'],
    1, stop(0.78, 0.48),
    5, stop(0.9, 0.62),
    8.4, stop(0.9, 0.7),
    12, stop(0.7, 0.5),
  ];
}

/** A little bloom at world zoom so overlapping pins read as density, not dust. */
function blurExpr(): unknown {
  return ['interpolate', ['linear'], ['zoom'], 1, 0.7, 6, 0];
}

class WorldMap {
  private map!: MapLibreMap;
  private panel!: Panel;
  private hud!: Hud;
  private seriesMode = false;
  private selected: string | null = null;
  /** A trail sheet is a selection too — Escape and the layer toggle must see it. */
  private selectedTrail: string | null = null;
  private dark = isDarkTheme();
  private placements = new Map<SeriesEntry, EntryPlacement>();
  private ordered: SeriesEntry[] = [];
  private episodeMarkers: { el: HTMLElement; entry: SeriesEntry; at: [number, number] }[] = [];
  private riderMarkers: { el: HTMLElement }[] = [];
  private riders: RiderPin[] | null = null;
  private ridersLoad: Promise<boolean> | null = null;
  private visible = initialLayers();
  private trails: Trail[] | null = null;
  private trailsById = new Map<string, Trail>();
  /** Parsed geometry, kept so re-opening a trail is instant. Only the open trail is
      ever drawn, which is what bounds this as the catalog grows. */
  private trailGeometry = new Map<string, [number, number][][]>();
  private trailFetch: AbortController | null = null;
  private trailFetchId: string | null = null;
  /** Memoised as a promise, not a result: two concurrent callers would otherwise both
      push a full copy of every trail into the shared source. */
  private trailsLoad: Promise<boolean> | null = null;
  private trailsAt = 0;
  /** Last render's artwork winners, and the zoom they were chosen at. See renderVisible. */
  private stickyTop = new Set<string>();
  private stickyZoom = Number.NaN;
  /** A deep-linked episode whose venue had not loaded yet when the link was applied. */
  private pendingEntry: SeriesEntry | null = null;
  private current: SeriesEntry | null = null;
  private tracksBySlug = new Map<string, TrackProps>();
  private opening: SeriesEntry | null = null;

  constructor(
    private root: HTMLElement,
    private cfg: MapConfig,
    private series: SeriesDoc,
    private tracks: GeoJSON.FeatureCollection,
    /** In flight since boot, so the ingest below normally costs no wait at all. */
    private trailsDoc: Promise<unknown>,
  ) {}

  private basemap: Basemap = storedBasemap();

  private get styleUrl() {
    if (this.basemap !== 'auto') return BASEMAP_URL[this.basemap];
    return this.dark ? this.cfg.styleDarkUrl : this.cfg.styleLightUrl;
  }

  /** Pins are coloured for the ground they sit on, which is only the page's theme while
      the basemap is following it. Both chosen styles are light sheets. */
  private get groundIsDark() {
    return this.basemap === 'auto' && this.dark;
  }

  /** Kept from start(), so sheets the island builds itself can be localised too. */
  private strings: Strings = {};

  async start(
    canvas: HTMLElement,
    strings: Strings,
    hooks: { onStyle?: () => void; onBasemap?: (seconds: number) => void; onReveal?: () => void } = {},
  ) {
    this.strings = strings;
    for (const feature of this.tracks.features) {
      const props = feature.properties as TrackProps | null;
      if (!props?.slug) continue;
      if (this.cfg.claimed.includes(props.slug)) props.claimed = true;
      if (feature.geometry.type === 'Point') {
        const [lng, lat] = feature.geometry.coordinates as [number, number];
        props.lng = lng;
        props.lat = lat;
      }
      this.tracksBySlug.set(props.slug, props);
    }
    this.resolvePlacements();
    this.ordered = [...this.series.entries].sort(entryOrder);

    this.opening = openingEntry(this.series);
    const openingAt = this.opening ? this.placements.get(this.opening)?.lngLat : null;
    const zoom = openingAt ? cityZoom() : WORLD_VIEW.zoom;

    this.map = new MapLibreMap({
      container: canvas,
      style: this.styleUrl,
      center: openingAt ?? WORLD_VIEW.center,
      zoom: reducedMotion() ? zoom : Math.max(1.4, zoom - 1.6),
      minZoom: 1,
      maxZoom: 14,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchZoomRotate: true,
      fadeDuration: 120,
    });
    this.map.touchZoomRotate.disableRotation();
    // Bottom-right stacks upward in insertion order: info button, then zoom.
    this.map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    // Recenter is not a map control any more: it lives at the foot of the layer
    // rail, with the other things you press to change what you are looking at.
    // Leaving it stacked with zoom put a navigation action in among the chrome.
    this.map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');

    this.map.on('error', (e) => console.warn('worldmap', e?.error?.message ?? e));

    // The basemap band is the long one and it reports nothing until the whole first
    // ring lands at once, so the bar creeps across it on a measured time constant:
    // about 3s desktop, and slower on a narrow viewport, which is a decent proxy for
    // a phone on a phone network.
    this.map.once('styledata', () => hooks.onStyle?.());
    hooks.onBasemap?.(isNarrow() ? 7 : 3);
    await new Promise<void>((resolve) => this.map.on('load', () => resolve()));

    this.applyProjection();
    // Reveal here. 'load' fires once the first tile ring is actually painted, and
    // everything after this point — glyph decodes, pins, markers — was measured at
    // 42-54% of the wait behind a gate that was already covering a finished basemap.
    hooks.onReveal?.();

    await this.addLayers();
    this.renderVisible();
    this.addEpisodeMarkers();
    this.applyLayers();
    this.syncEpisodeChrome();
    // Still NOT awaited — blocking the reveal on this 1 KB document cost ~1.0 s desktop
    // and ~2.0 s phone, because /api/map/trails.json is a worker route and a cold visitor
    // takes the cache MISS. But the request now leaves with the catalog at boot rather
    // than after the map loads, so by here it has almost always landed and this resolves
    // on the same tick: the blips are present at first paint instead of popping in. On a
    // slow link it degrades to arriving late, which is the old behaviour, never a block.
    void this.loadTrails().then(() => {
      this.resolvePlacements();
      this.addEpisodeMarkers();
      this.applyLayers();
      this.syncEpisodeChrome();
      // A deep link whose venue lived in this catalog was parked; run it now.
      const parked = this.pendingEntry;
      if (parked) {
        this.pendingEntry = null;
        this.selectEntry(parked, { fly: true });
      }
    });
    this.wireInteractions();
    this.watchTheme();
    this.root.classList.add('is-live');

    if (!reducedMotion()) {
      this.map.easeTo({ zoom, duration: 2200, essential: false });
    }
  }

  private applyProjection() {
    try {
      this.map.setProjection({ type: 'globe' });
    } catch {
      /* mercator is an acceptable fallback */
    }
  }

  /** The site theme toggle only flips a class on <html>; mirror it onto the map. */
  private watchTheme() {
    new MutationObserver(() => {
      const dark = isDarkTheme();
      // A chosen basemap is a chosen basemap. Only `auto` tracks the page, and reloading a
      // single-look style on every theme flip would throw the visitor's view away to
      // arrive at the same tiles.
      if (dark === this.dark) return;
      this.dark = dark;
      if (this.basemap === 'auto') void this.restyle();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  /** Switches the ground under everything, keeping what the visitor was looking at. */
  async setBasemap(next: Basemap) {
    if (next === this.basemap) return;
    this.basemap = next;
    try {
      localStorage.setItem(BASEMAP_STORE, next);
    } catch {
      /* private mode */
    }
    await this.restyle();
  }

  get currentBasemap(): Basemap {
    return this.basemap;
  }

  private async restyle() {
    await new Promise<void>((resolve) => {
      this.map.once('style.load', () => resolve());
      this.map.setStyle(this.styleUrl);
    });
    // setStyle drops every source, layer and runtime image — rebuild ours, then
    // put the interaction state back the way the visitor left it.
    this.applyProjection();
    await this.addLayers();
    this.renderVisible();
    this.applyLayers();
    this.setSelected(this.selected);
    this.setDimmed(this.seriesMode || !!this.selected);
    this.map.setPaintProperty('journey-line', 'line-opacity', this.seriesMode ? 0.55 : 0);
  }

  private resolvePlacements() {
    for (const entry of this.series.entries) {
      let lngLat: [number, number] | null = null;
      if (entry.coords) {
        lngLat = [entry.coords.lng, entry.coords.lat];
      } else if (entry.track_slug) {
        const feature = this.tracks.features.find(
          (f) => (f.properties as TrackProps | null)?.slug === entry.track_slug,
        );
        const geom = feature?.geometry;
        if (geom?.type === 'Point') lngLat = [geom.coordinates[0]!, geom.coordinates[1]!];
      }
      this.placements.set(entry, { entry, lngLat });
    }
  }

  private async addLayers() {
    const map = this.map;
    const c = palette(this.groundIsDark);
    // Starts empty; renderVisible() fills it from what's actually on screen.
    map.addSource('tracks', { type: 'geojson', data: EMPTY, promoteId: 'slug' });

    await Promise.all([
      ...GLYPHS.flatMap((name) => [
        addGlyph(map, `cat-${name}-off`, `${this.cfg.markersBase}${name}.svg`, c.glyph),
        addGlyph(map, `cat-${name}-on`, `${this.cfg.markersBase}${name}.svg`, c.glyphOnClaimed),
      ]),
      addGlyph(map, 'claim-seal', `${this.cfg.markersBase}seal.svg`, ACCENT),
      addGlyph(map, 'blip-track', `${this.cfg.markersBase}flag.svg`, c.track, BLIP_PX, c.labelHalo),
      addGlyph(map, 'blip-trail', `${this.cfg.markersBase}trails.svg`, c.trail, BLIP_PX, c.labelHalo),
      addGlyph(map, 'blip-shop', `${this.cfg.markersBase}shop.svg`, c.shop, BLIP_PX, c.labelHalo),
    ]).catch((err) => console.warn('worldmap glyphs', err));

    // Soft coloured bloom under each blip. A circle layer with circle-blur is the only
    // glow MapLibre draws cheaply — icon-halo-* is SDF-only, and an SDF icon cannot
    // carry a white glyph on a coloured disc at the same time.
    map.addLayer({
      id: 'tracks-glow',
      type: 'circle',
      source: 'tracks',
      minzoom: 6,
      filter: withTop(IS_TRACK),
      paint: {
        'circle-color': c.track,
        'circle-blur': 0.85,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 7, 8.4, 12, 10, 21, 14, 27] as never,
        'circle-opacity': GLOW_FADE,
      },
    });

    map.addLayer({
      id: 'tracks-dot',
      type: 'circle',
      source: 'tracks',
      filter: IS_TRACK,
      paint: {
        'circle-radius': radiusExpr() as never,
        'circle-color': [
          'case',
          ['==', ['get', 'claimed'], true],
          ACCENT,
          ['==', ['get', 'tier'], 'verified'],
          c.verified,
          c.breadth,
        ] as never,
        'circle-opacity': opacityExpr(1) as never,
        'circle-blur': blurExpr() as never,
        'circle-stroke-color': c.pinStroke,
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 0, 9, 1] as never,
        // The outline is NOT covered by circle-opacity — MapLibre paints it from its own
        // property — so fading the fill alone left a ring under every blip. It rides the
        // same ramp, scaled to the 0.7 it used to sit at.
        'circle-stroke-opacity': opacityExpr(0.7) as never,
      },
    });

    const glyphFor = [
      'match',
      ['get', 'category'],
      ...Object.entries(CATEGORY_TO_GLYPH).flatMap(([cat, glyph]) => [cat, glyph]),
      'other',
    ];

    map.addLayer({
      id: 'tracks-glyph',
      type: 'symbol',
      source: 'tracks',
      filter: withTop(IS_TRACK),
      layout: {
        'icon-image': 'blip-track',
        'icon-size': blipSize(this.selected) as never,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': BLIP_FADE },
    });

    map.addLayer({
      id: 'tracks-seal',
      type: 'symbol',
      source: 'tracks',
      minzoom: 7.5,
      filter: withTop(['==', ['get', 'claimed'], true]),
      layout: {
        'icon-image': 'claim-seal',
        'icon-size': 0.28,
        'icon-offset': [22, 22],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });

    map.addLayer({
      id: 'tracks-label',
      type: 'symbol',
      source: 'tracks',
      minzoom: 9,
      filter: withTop(IS_TRACK),
      layout: {
        'text-field': labelField(this.cfg.lang) as never,
        'text-font': styleFont(map),
        'text-size': 11,
        'text-anchor': 'top',
        'text-offset': [0, 0.9],
        'text-optional': true,
        'text-max-width': 9,
      },
      paint: {
        'text-color': c.label,
        'text-halo-color': c.labelHalo,
        'text-halo-width': 1.3,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0, 10, 1] as never,
      },
    });

    const line: GeoJSON.Feature<GeoJSON.LineString> = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [...this.series.entries]
          .sort(entryOrder)
          .map((e) => this.placements.get(e)?.lngLat)
          .filter((c): c is [number, number] => !!c),
      },
    };
    const shopFilter = ['==', ['get', 'kind'], 'shop'] as never;
    map.addLayer({
      id: 'shops-glow',
      type: 'circle',
      source: 'tracks',
      minzoom: 6,
      filter: withTop(shopFilter),
      paint: {
        'circle-color': c.shop,
        'circle-blur': 0.85,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 7, 8.4, 12, 10, 21, 14, 27] as never,
        'circle-opacity': GLOW_FADE,
      },
    });
    map.addLayer({
      id: 'shops-blip',
      type: 'symbol',
      source: 'tracks',
      filter: withTop(shopFilter),
      layout: {
        'icon-image': 'blip-shop',
        'icon-size': blipSize(this.selected) as never,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': BLIP_FADE },
    });
    map.addLayer({
      id: 'shops-label',
      type: 'symbol',
      source: 'tracks',
      minzoom: 9.6,
      filter: withTop(shopFilter),
      layout: {
        'text-field': labelField(this.cfg.lang) as never,
        'text-font': styleFont(map),
        'text-size': 11,
        'text-anchor': 'top',
        'text-offset': [0, 1.5],
        'text-optional': true,
        'text-max-width': 9,
      },
      paint: {
        'text-color': c.label,
        'text-halo-color': c.labelHalo,
        'text-halo-width': 1.3,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 9.6, 0, 10.4, 1] as never,
      },
    });

    this.addTrailLayers();

    map.addSource('journey', { type: 'geojson', data: line });
    map.addLayer({
      id: 'journey-line',
      type: 'line',
      source: 'journey',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ACCENT,
        'line-width': 1.5,
        'line-opacity': 0,
        'line-dasharray': [2, 2.5],
      },
    });
  }

  /**
   * Trails are catalog entities like tracks: a blip you can see, and geometry that is
   * only fetched when you ask for it. The line lives in its own source so it can be
   * inserted beneath the pins, and it holds one trail at a time.
   */
  private addTrailLayers() {
    const map = this.map;
    if (map.getSource('trail-lines')) return;
    const c = palette(this.groundIsDark);

    // A ride that has been measured but not sent. Its own source and its own layer so it
    // can never be mistaken for a trace that exists, and so clearing it is one call.
    map.addSource('trail-pending', { type: 'geojson', data: EMPTY });
    map.addSource('trail-lines', { type: 'geojson', data: EMPTY });
    map.addLayer(
      {
        id: 'trails-line',
        type: 'line',
        source: 'trail-lines',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': c.trail,
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.6, 11, 3.2, 14, 5] as never,
          'line-opacity': 0.9,
        },
      },
      // Under the pins: a drawn trace is ground truth, not something to obscure them.
      map.getLayer('tracks-glow') ? 'tracks-glow' : undefined,
    );

    map.addLayer({
      id: 'trails-pending',
      type: 'line',
      source: 'trail-pending',
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': c.trail,
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.8, 11, 3.4, 14, 5.2] as never,
        'line-opacity': 0.95,
        'line-dasharray': [0, 4, 3] as never,
      },
    });

    const trailFilter = trailPinFilter(this.tracedTrail) as never;
    map.addLayer({
      id: 'trails-glow',
      type: 'circle',
      source: 'tracks',
      minzoom: 6,
      filter: withTop(trailFilter),
      paint: {
        'circle-color': c.trail,
        'circle-blur': 0.85,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 7, 8.4, 12, 10, 21, 14, 27] as never,
        'circle-opacity': GLOW_FADE,
      },
    });
    map.addLayer({
      id: 'trails-blip',
      type: 'symbol',
      source: 'tracks',
      filter: withTop(trailFilter),
      layout: {
        'icon-image': 'blip-trail',
        'icon-size': blipSize(this.selected) as never,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': BLIP_FADE },
    });
    map.addLayer({
      id: 'trails-label',
      type: 'symbol',
      source: 'tracks',
      minzoom: 9.6,
      filter: withTop(trailFilter),
      layout: {
        'text-field': labelField(this.cfg.lang) as never,
        'text-font': styleFont(map),
        'text-size': 11,
        'text-anchor': 'top',
        'text-offset': [0, 1.5],
        'text-optional': true,
        'text-max-width': 9,
      },
      paint: {
        'text-color': c.label,
        'text-halo-color': c.labelHalo,
        'text-halo-width': 1.3,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 9.6, 0, 10.4, 1] as never,
      },
    });

    // setStyle drops sources, so the open trail is redrawn from the JS-side cache.
    this.drawTrail(this.selectedTrail);
  }

  /** The trail currently drawn as a line, which is not the same as the selected one:
      selection happens on tap, the trace only once its file has arrived. */
  private tracedTrail: string | null = null;

  /** Puts one trail's geometry on the map, or clears it. */
  private drawTrail(id: string | null) {
    const source = this.map.getSource('trail-lines') as
      | { setData(d: GeoJSON.FeatureCollection): void }
      | undefined;
    if (!source) return;
    const lines = id ? this.trailGeometry.get(id) : null;
    this.tracedTrail = lines?.length ? id : null;
    for (const layer of ['trails-glow', 'trails-blip', 'trails-label'] as const) {
      if (this.map.getLayer(layer)) {
        this.map.setFilter(layer, withTop(trailPinFilter(this.tracedTrail)));
      }
    }
    source.setData(
      lines?.length
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { id },
                geometry: { type: 'MultiLineString', coordinates: lines },
              },
            ],
          }
        : EMPTY,
    );
    // tracedTrail just changed, and it is half of what decides whether the line shows.
    this.syncTrailLine();
  }

  /**
   * Tap-to-draw. The blip is metadata only; the GPX is fetched from the forum's own
   * uploads CDN the first time a visitor opens that trail, then cached. One trail is
   * in flight at a time — opening another aborts the previous fetch.
   */
  private async openTrail(id: string) {
    const trail = this.trailsById.get(id);
    if (!trail) return;
    this.clearSelection();
    this.selected = id;
    this.selectedTrail = id;
    this.setSelected(id);
    this.setDimmed(true);
    this.renderVisible();
    this.panel.showTrail(trail);

    await this.traceTrail(trail);
    // The visitor may have moved on while the file was in flight.
    if (this.selectedTrail === id && this.selected === id) {
      this.drawTrail(id);
      const lines = this.trailGeometry.get(id);
      if (lines?.length) this.fitTrail(lines);
    }
  }

  /** Fetches and caches one trail's geometry, at most one download at a time. */
  private async traceTrail(trail: Trail): Promise<void> {
    const id = trail.id;
    this.selectedTrail = id;
    if (!this.trailGeometry.has(id) && trail.gpx_url && this.trailFetchId !== id) {
      this.trailFetch?.abort();
      const run = new AbortController();
      this.trailFetch = run;
      this.trailFetchId = id;
      this.root.classList.add('is-tracing');
      try {
        const gpx = await fetchGpx(trail.gpx_url, run.signal);
        this.trailGeometry.set(id, parseGpx(gpx));
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        console.warn('worldmap gpx', err);
        // Remember the failure too, so a second tap does not re-download a file that
        // is broken or gone. An empty entry means "known to have no trace".
        this.trailGeometry.set(id, []);
      } finally {
        if (this.trailFetch === run) {
          this.trailFetch = null;
          this.trailFetchId = null;
          this.root.classList.remove('is-tracing');
        }
      }
    }
  }

  /**
   * Pushes the place behind an episode onto the sheet stack. A trail venue also draws
   * its trace, which is the only way to see it while the challenge overlay owns the pin.
   */
  async openVenue(track: TrackProps) {
    if (track.kind !== 'trail') {
      this.panel.pushTrack(track);
      return;
    }
    const trail = this.trailsById.get(track.slug);
    if (!trail) return;
    this.panel.pushTrail(trail);
    await this.traceTrail(trail);
    if (this.selectedTrail === trail.id) this.drawTrail(trail.id);
  }

  /** Frames the whole trace once it arrives, so a tap reveals the shape of the ride. */
  private fitTrail(lines: [number, number][][]) {
    const bounds = new LngLatBounds();
    for (const seg of lines) for (const point of seg) bounds.extend(point);
    if (bounds.isEmpty()) return;
    const cover = this.sheetCover();
    this.map.fitBounds(bounds, {
      padding: { top: 90, bottom: 120 + cover.bottom, left: 60, right: 60 + cover.right },
      maxZoom: 15,
      duration: reducedMotion() ? 0 : 900,
    });
  }

  private loadRiders(): Promise<boolean> {
    this.ridersLoad ??= this.fetchRiders();
    return this.ridersLoad;
  }

  /** The endpoint is gated server-side and 404s when the layer is off, which is
      indistinguishable here from "nobody is on the map" — both mean no layer. */
  private async fetchRiders(): Promise<boolean> {
    try {
      const doc = (await fetchJson(this.cfg.ridersUrl)) as RidersDoc | null;
      this.riders = Array.isArray(doc?.riders) ? doc.riders : [];
    } catch {
      this.riders = [];
    }
    this.addRiderMarkers();
    return this.riders.length > 0;
  }

  private addRiderMarkers() {
    for (const { el } of this.riderMarkers) el.remove();
    this.riderMarkers = [];
    for (const rider of this.riders ?? []) {
      // An anchor, not a click handler: the destination IS the résumé page, so
      // there is no sheet to keep in sync and nothing to clear on toggle-off.
      const el = document.createElement('a');
      el.className = 'wm-rider';
      el.href = `/lineage/${rider.username ? '@' + rider.username : rider.slug}`;
      el.setAttribute('aria-label', rider.name ?? rider.slug);
      // Discourse hands back a root-relative avatar path, so it needs the forum
      // origin the way the trail byline does — otherwise it resolves against
      // the marketing host and renders as a broken image.
      const avatarSrc = rider.avatar_template
        ? (rider.avatar_template.startsWith('http')
            ? rider.avatar_template
            : this.cfg.forumBase + rider.avatar_template
          ).replace('{size}', '48')
        : null;
      el.innerHTML = avatarSrc
        ? `<img class="wm-rider__avatar" src="${avatarSrc}" alt="" loading="lazy">`
        : `<span class="wm-rider__avatar wm-rider__avatar--letter">${(rider.name ?? '\u00b7').slice(0, 1)}</span>`;
      el.style.display = this.visible.riders ? '' : 'none';
      new Marker({ element: el, anchor: 'center' }).setLngLat([rider.lon, rider.lat]).addTo(this.map);
      this.riderMarkers.push({ el });
    }
  }

  /** Memoised: the boot path and the rail toggle share one fetch and one ingest. */
  private loadTrails(): Promise<boolean> {
    this.trailsLoad ??= this.fetchTrails();
    return this.trailsLoad;
  }

  /**
   * Same document, fetched again if this copy has gone stale.
   *
   * Publishing a trail happens on the forum, in another tab, and the map's copy of
   * trails.json is a page-load-lifetime memo — so a rider who published and came back to
   * search for their own ride could not find it until a hard reload. Sixty seconds is the
   * document's own browser max-age: past that a refetch is going to the network anyway.
   */
  private refreshTrails(): Promise<boolean> {
    if (Date.now() - this.trailsAt < 60_000) return this.loadTrails();
    this.trailsLoad = this.fetchTrails(true);
    return this.trailsLoad;
  }

  private async fetchTrails(bustCache = false): Promise<boolean> {
    this.trailsAt = Date.now();
    try {
      const url = bustCache
        ? `${this.cfg.trailsUrl}${this.cfg.trailsUrl.includes('?') ? '&' : '?'}r=${Date.now()}`
        : this.cfg.trailsUrl;
      const doc = (await fetchJson(url).catch(() =>
        fetchJson('/map/trails.seed.json'),
      )) as TrailsDoc;
      this.trails = Array.isArray(doc?.trails) ? doc.trails.filter((t) => t.stats?.centre) : [];
    } catch (err) {
      console.warn('worldmap trails', err);
      return false;
    }
    // Trails join the catalog as points, so the viewport cull and the per-kind budget
    // apply to them exactly as they do to tracks and shops.
    for (const trail of this.trails) {
      this.trailsById.set(trail.id, trail);
      const [lng, lat] = trail.stats!.centre;
      const props: TrackProps = {
        slug: trail.id,
        kind: 'trail',
        name: localizedName(trail.title, this.cfg.lang) ?? trail.id,
        name_local: null,
        country_code: '',
        locality: null,
        category: 'trail',
        tier: 'verified',
        website: null,
        precision: 'exact',
        lng,
        lat,
      };
      // Idempotent: a refetch re-ingests the whole document, and pushing a second feature
      // for a trail already in the catalog would double its pin and its search row.
      const seen = this.tracksBySlug.get(trail.id);
      this.tracksBySlug.set(trail.id, props);
      if (seen) {
        const feature = this.tracks.features.find(
          (f) => (f.properties as TrackProps | null)?.slug === trail.id,
        );
        if (feature) {
          feature.geometry = { type: 'Point', coordinates: [lng, lat] };
          feature.properties = props;
          continue;
        }
      }
      this.tracks.features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: props,
      });
    }
    this.addTrailLayers();
    this.applyLayers();
    this.renderVisible();
    return this.trails.length > 0;
  }

  /**
   * Decides what the current viewport can show without pins landing on each other.
   *
   * Two things changed here and they belong together. Nothing is dropped from the source
   * any more — a pin that loses a slot ships anyway with `top: 0` and draws as a dot, so
   * pulling the map back thins the artwork out instead of emptying the country. And the
   * grid that decides the winners is sized to the artwork at the current zoom rather than
   * to a fixed 116 px, which is what "as many as this area can actually show" means.
   *
   * Order is priority: challenge badges, then the pins the interface has already promised
   * (the open sheet's subject, every episode venue), then a guaranteed share for each
   * layer that is switched on, then whatever else fits. The per-layer share is not a
   * nicety — one shared grid without it lets three and a half thousand tracks take every
   * cell in the country and leaves the rider trails with none, which renders a layer you
   * deliberately switched on as nothing at all.
   */
  private renderVisible() {
    if (!this.map.getSource('tracks')) return;
    const map = this.map;
    const bounds = map.getBounds();
    const canvas = map.getCanvas();
    const pitch = pinPitch(map);
    const cols = Math.max(1, Math.ceil(canvas.clientWidth / pitch));
    const rows = Math.max(1, Math.ceil(canvas.clientHeight / pitch));
    // The grid is the real ceiling; this is a drawing budget on top of it, not a design
    // opinion about how full a map should look.
    const cap = Math.min(cols * rows, isNarrow() ? 90 : 240);
    const stride = cols + 3;

    const taken = new Set<number>();
    let used = 0;

    /** Grid cell for a screen point, or null if it is too far outside to compete. One
        pitch of margin, so a pin just off the edge does not pop in mid-pan. */
    const cellAt = (lng: number, lat: number): number | null => {
      const at = map.project([lng, lat]);
      if (
        at.x < -pitch ||
        at.y < -pitch ||
        at.x > canvas.clientWidth + pitch ||
        at.y > canvas.clientHeight + pitch
      ) {
        return null;
      }
      return (Math.floor(at.y / pitch) + 1) * stride + Math.floor(at.x / pitch) + 1;
    };

    // Challenge badges are DOM markers: they sit outside the source and outside
    // MapLibre's symbol placer, so nothing at all was keeping two of them apart. Pull the
    // viewport back far enough and two episodes in the same province drew on top of each
    // other. They go first because a badge is the headline of whatever it is pinned to.
    for (const marker of this.episodeMarkers) {
      const cell = this.visible.ride ? cellAt(marker.at[0], marker.at[1]) : null;
      const crowded = cell != null && taken.has(cell);
      if (cell != null && !crowded) taken.add(cell);
      marker.el.classList.toggle('is-crowded', crowded);
    }

    const pinned = new Set<string>();
    if (this.selected) pinned.add(this.selected);
    for (const entry of this.series.entries) if (entry.track_slug) pinned.add(entry.track_slug);

    // Panning must not reshuffle the map. A grid recomputed from scratch on every settled
    // move gives a different set of winners each time, so icons blink out from under the
    // cursor while the visitor is still reading them — the map churns as you cross it.
    //
    // So last render's winners are re-placed FIRST and keep their cells; newcomers only
    // ever fill what is left. Zoom is the one thing that clears that memory, because zoom
    // is when the answer genuinely changes: pins that were crowded out deserve their turn
    // at the closer spacing, and the visitor asked for a different view rather than the
    // same one from a step sideways.
    const zoomNow = Math.round(map.getZoom() * 100) / 100;
    if (zoomNow !== this.stickyZoom) {
      this.stickyTop.clear();
      this.stickyZoom = zoomNow;
    }

    const rank = (p: TrackProps) => (p.claimed ? 3 : p.tier === 'verified' ? 2 : 1);
    type Candidate = { feature: GeoJSON.Feature; slug: string; cell: number; rank: number };
    const inView: GeoJSON.Feature[] = [];
    const top = new Set<string>();
    const byKind = new Map<string, Candidate[]>();

    for (const feature of this.tracks.features) {
      const props = feature.properties as TrackProps | null;
      if (!props?.slug) continue;
      const kind = props.kind ?? 'track';
      // Each toggle owns one kind: turning tracks off must not also blank the shops.
      const owner = LAYER_IDS.find((l) => KIND_OF[l] === kind);
      if (owner && !this.visible[owner]) continue;

      const point = feature.geometry.type === 'Point';
      const cell = point ? cellAt(...(feature.geometry.coordinates as [number, number])) : null;

      if (pinned.has(props.slug)) {
        if (cell != null && !taken.has(cell)) {
          taken.add(cell);
          used++;
        }
        top.add(props.slug);
        inView.push(feature);
        continue;
      }
      if (!point || cell == null) continue;
      if (!bounds.contains(feature.geometry.coordinates as [number, number])) {
        // Outside the viewport but inside the margin: eligible for a cell so the pan is
        // smooth, but it must not be the reason a visible pin loses one.
        inView.push(feature);
        continue;
      }
      const candidate: Candidate = { feature, slug: props.slug, cell, rank: rank(props) };
      const bucket = byKind.get(kind);
      if (bucket) bucket.push(candidate);
      else byKind.set(kind, [candidate]);
      inView.push(feature);
    }

    const place = (c: Candidate): boolean => {
      if (used >= cap || taken.has(c.cell)) return false;
      taken.add(c.cell);
      used++;
      top.add(c.slug);
      return true;
    };

    // Held over from the last render at this zoom: whatever is still in view keeps drawing.
    for (const bucket of byKind.values()) {
      for (const c of bucket) if (this.stickyTop.has(c.slug)) place(c);
    }

    const share = Math.max(4, Math.round(cap * 0.12));
    const rest: Candidate[] = [];
    for (const bucket of byKind.values()) {
      bucket.sort((a, b) => b.rank - a.rank);
      let mine = 0;
      for (const c of bucket) {
        if (top.has(c.slug)) {
          mine++;
          continue;
        }
        if (mine < share && place(c)) mine++;
        else rest.push(c);
      }
    }
    rest.sort((a, b) => b.rank - a.rank);
    for (const c of rest) place(c);

    this.stickyTop = top;

    (map.getSource('tracks') as { setData(d: GeoJSON.FeatureCollection): void }).setData({
      type: 'FeatureCollection',
      // Copied rather than mutated: `properties` is the same object the catalog and the
      // search index hold, and stamping a render decision onto it would leak into both.
      features: inView.map((f) => ({
        ...f,
        properties: { ...(f.properties as object), top: top.has((f.properties as TrackProps).slug) ? 1 : 0 },
      })),
    });
  }

  private addEpisodeMarkers() {
    for (const { el } of this.episodeMarkers) el.remove();
    this.episodeMarkers = [];
    for (const [entry, placement] of this.placements) {
      if (!placement.lngLat) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = [
        'wm-ep',
        entry.status === 'live' ? 'is-live' : 'is-visited',
        entry.kind === 'side' ? 'wm-ep--side' : '',
      ]
        .filter(Boolean)
        .join(' ');
      el.innerHTML = `<span class="wm-ep__num">${entry.label}</span>`;
      el.setAttribute('aria-label', entry.label);
      // The bloom is the challenge's, so it carries the episode's tone rather than the
      // venue's kind colour — the venue already states its own colour through its icon.
      el.dataset.tone = this.toneOf(entry);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.selectEntry(entry, { fly: true });
      });
      new Marker({ element: el, anchor: 'center' }).setLngLat(placement.lngLat).addTo(this.map);
      this.episodeMarkers.push({ el, entry, at: placement.lngLat });
    }
  }

  private wireInteractions() {
    const map = this.map;
    /** A pin is a few pixels wide; a finger is not. Query a padded box, and let a pin
        beat a passing trace so a nearby line can't steal a deliberate tap on a place. */
    const HIT_PAD = 14;
    const pick = (pt: { x: number; y: number }) => {
      const box = [
        [pt.x - HIT_PAD, pt.y - HIT_PAD],
        [pt.x + HIT_PAD, pt.y + HIT_PAD],
      ] as [[number, number], [number, number]];
      const found = map.queryRenderedFeatures(box as never, { layers: hit() });
      // Explicit order: a blip beats the line it belongs to, and a small pin beats a
      // large one drawn over it, so nothing becomes unselectable by being underneath.
      for (const id of ['trails-blip', 'shops-blip', 'tracks-dot', 'trails-line']) {
        const found_ = found.find((f) => f.layer.id === id);
        if (found_) return found_;
      }
      return found[0];
    };
    /** Only layers that exist and are on — querying a missing layer throws. */
    const hit = () =>
      ['trails-blip', 'shops-blip', 'tracks-dot', 'trails-line'].filter((id) => {
        if (!map.getLayer(id)) return false;
        // The trace follows its own visibility rule, so it follows it here too — a line
        // the visitor can see must be a line they can tap.
        if (id === 'trails-line') return this.trailLineOn();
        const owner = LAYER_IDS.find((l) => (LAYERS[l] as readonly string[]).includes(id));
        return !owner || this.visible[owner];
      });

    map.on('mousemove', (e) => {
      map.getCanvas().style.cursor = pick(e.point) ? 'pointer' : '';
    });

    // Settled move only — mid-gesture re-renders would fight the pan.
    map.on('moveend', () => {
      this.renderVisible();
      this.syncEpisodeChrome();
      this.syncControls();
    });

    map.on('click', (e) => {
      const feature = pick(e.point);
      const props = feature?.properties as TrackProps | undefined;
      if (feature?.layer.id === 'trails-line') {
        const id = (feature.properties as { id?: string } | undefined)?.id;
        if (id) void this.openTrail(id);
      } else if (props?.kind === 'trail' && props.slug) {
        void this.openTrail(props.slug);
      } else if (props?.slug) {
        this.selectTrack(props.slug, { fly: true });
      } else {
        this.clearSelection();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      // Escape is a deliberate dismissal, so it may close a sticky sheet. A tap on the
      // map is not, and does not.
      this.panel.allowClose();
      if (this.selected || this.selectedTrail) this.clearSelection();
      else if (this.seriesMode) this.setSeriesMode(false);
    });
  }

  /**
   * Applies layer visibility to everything a layer owns. Re-run after every
   * addLayers(), including the theme restyle — setStyle drops the style layers and
   * they come back visible by default.
   */
  /**
   * The trace is not part of the trails CATALOG, and the rail only governs the catalog.
   *
   * `trails-line` is listed under LAYERS.trails so that hit-testing and the restyle replay
   * still know who owns it, but its visibility is decided here instead: a drawn trace is
   * the one thing the visitor explicitly asked for, by tapping a pin or by opening a
   * ?trail= link. Gating it behind the toggle meant a private link rendered an empty map
   * for anyone whose trails layer happened to be off — with nothing on screen to say why.
   */
  private trailLineOn(): boolean {
    return this.visible.trails || !!this.tracedTrail;
  }

  /**
   * Draws a ride that has been measured but not uploaded, as a marching dashed line.
   *
   * The dash marches because MapLibre has no animated dash: the pattern is stepped through
   * a short cycle on a timer, which is the standard way and costs one setPaintProperty a
   * frame-ish. It says "this is not on the map yet" without a word of copy.
   */
  showPendingTrail(lines: [number, number][][]) {
    const source = this.map.getSource('trail-pending') as
      | { setData(d: GeoJSON.FeatureCollection): void }
      | undefined;
    if (!source) return;
    source.setData(
      lines.length
        ? {
            type: 'FeatureCollection',
            features: [
              { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } },
            ],
          }
        : EMPTY,
    );
    if (!lines.length || this.pendingTimer !== null) return;
    const steps = [
      [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1],
      [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5],
      [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
    ];
    let at = 0;
    this.pendingTimer = window.setInterval(() => {
      if (!this.map.getLayer('trails-pending')) return;
      at = (at + 1) % steps.length;
      this.map.setPaintProperty('trails-pending', 'line-dasharray', steps[at] as never);
    }, 90);
  }

  clearPendingTrail() {
    if (this.pendingTimer !== null) {
      window.clearInterval(this.pendingTimer);
      this.pendingTimer = null;
    }
    const source = this.map.getSource('trail-pending') as
      | { setData(d: GeoJSON.FeatureCollection): void }
      | undefined;
    source?.setData(EMPTY);
  }

  private syncTrailLine() {
    if (!this.map.getLayer('trails-line')) return;
    this.map.setLayoutProperty('trails-line', 'visibility', this.trailLineOn() ? 'visible' : 'none');
  }

  private applyLayers() {
    for (const id of LAYER_IDS) {
      const on = this.visible[id];
      for (const layerId of LAYERS[id]) {
        if (this.map.getLayer(layerId)) {
          this.map.setLayoutProperty(layerId, 'visibility', on ? 'visible' : 'none');
        }
      }
    }
    // After the loop, so it wins over LAYERS.trails having just hidden it.
    this.syncTrailLine();
    for (const { el } of this.episodeMarkers) el.style.display = this.visible.ride ? '' : 'none';
    for (const { el } of this.riderMarkers) el.style.display = this.visible.riders ? '' : 'none';
    this.syncEpisodeChrome();
    this.root.classList.toggle('is-ride-off', !this.visible.ride);
    this.root.classList.toggle('is-tracks-off', !this.visible.tracks);
  }

  async setLayer(id: LayerId, on: boolean): Promise<void> {
    if (this.visible[id] === on) return;
    if (id === 'trails' && on && !(await this.loadTrails())) return;
    if (id === 'riders' && on && !(await this.loadRiders())) return;
    this.visible[id] = on;
    // A hidden layer must not keep a sheet open about one of its features.
    if (!on && id === 'trails' && this.selectedTrail) this.clearSelection();
    // Episodes ride on catalog pins, so "is this an episode?" is a slug lookup.
    if (!on && this.selected && !this.selectedTrail) {
      const isEpisode = [...this.placements.keys()].some((e) => e.track_slug === this.selected);
      if (id === 'tracks' ? !isEpisode || !this.visible.ride : isEpisode) this.clearSelection();
    }
    if (id === 'ride' && !on && this.seriesMode) this.setSeriesMode(false);
    this.applyLayers();
    // Both directions: hiding a kind has to leave the source too, or it lingers until
    // the next settled move.
    if (KIND_OF[id]) this.renderVisible();
    const enabled = LAYER_IDS.filter((l) => this.visible[l]);
    try {
      localStorage.setItem(LAYER_STORE, enabled.join(','));
    } catch {
      /* private mode — the toggle still works for this visit */
    }
    const url = new URL(location.href);
    url.searchParams.set('layers', enabled.join(','));
    history.replaceState(null, '', url);
  }

  layerState(id: LayerId) {
    return this.visible[id];
  }

  /**
   * A challenge badge is an annotation on a venue, so it only makes sense pinned to
   * the rim of one. When nothing is drawn underneath — the episode has no catalog
   * venue, its venue's layer is switched off, or the camera is zoomed out past the
   * point where venue icons appear — the badge becomes the marker instead of floating
   * over empty map.
   */
  /**
   * The two camera controls tell you whether they have anywhere to take you. Orange is
   * "you are already there", which is the difference between a button worth pressing
   * and one that would do nothing.
   */
  /** Anything that means "the visitor is looking at the map now", which is when a folded
      control should get out of the way. */
  onMapInteraction(fn: () => void) {
    for (const ev of ['dragstart', 'zoomstart', 'click'] as const) this.map.on(ev, fn);
  }

  syncControls() {
    const mark = (selector: string, on: boolean) => {
      const button = this.root.querySelector<HTMLElement>(selector);
      if (!button) return;
      if (button.dataset.state === 'denied' || button.dataset.state === 'busy') return;
      if (on) button.dataset.state = 'active';
      else if (button.dataset.state === 'active') delete button.dataset.state;
    };
    mark('[data-recenter]', this.atOpening);

    const locate = this.root.querySelector<HTMLElement>('[data-locate]');
    if (locate && locate.dataset.state !== 'denied' && locate.dataset.state !== 'busy') {
      locate.dataset.state = this.atHere ? 'active' : this.here ? 'ready' : locate.dataset.state ?? 'idle';
    }
  }

  private syncEpisodeChrome() {
    const zoomed = this.map.getZoom() >= BLIP_IN;
    for (const { el, entry } of this.episodeMarkers) {
      const venue = entry.track_slug ? this.tracksBySlug.get(entry.track_slug) : null;
      const owner = venue?.kind === 'shop' ? 'shops' : 'tracks';
      const anchored = !!venue && this.visible[owner] && zoomed;
      el.classList.toggle('is-solo', !anchored);
      if (anchored) el.dataset.venue = venue!.kind ?? 'track';
      else delete el.dataset.venue;
    }
  }

  private setDimmed(on: boolean) {
    // The dim is for everything the sheet is NOT about, so the selected row is held
    // out of it — including its label, which is the one worth reading.
    const held = (dim: unknown, full: unknown): unknown =>
      on && this.selected ? ['case', ['==', ['get', 'slug'], this.selected], full, dim] : dim;
    const factor = on ? DIM : 1;
    // NOT wrapped in held(): the dot ramp is a zoom interpolate and cannot go inside a
    // case, so it takes the selection itself and folds the hold into its own stops.
    const dotSelected = on ? this.selected : null;
    this.map.setPaintProperty('tracks-dot', 'circle-opacity', opacityExpr(factor, dotSelected) as never);
    this.map.setPaintProperty(
      'tracks-dot',
      'circle-stroke-opacity',
      opacityExpr(0.7 * factor, dotSelected) as never,
    );
    this.map.setPaintProperty('tracks-glyph', 'icon-opacity', held(on ? DIM : 1, 1) as never);
    this.map.setPaintProperty('tracks-glow', 'circle-opacity', held(on ? 0.06 : 0.32, 0.32) as never);
    for (const id of ['shops-glow', 'trails-glow'] as const) {
      if (this.map.getLayer(id)) {
        this.map.setPaintProperty(id, 'circle-opacity', held(on ? 0.06 : 0.32, 0.32) as never);
      }
    }
    for (const id of ['shops-blip', 'trails-blip'] as const) {
      if (this.map.getLayer(id)) this.map.setPaintProperty(id, 'icon-opacity', held(on ? DIM : 1, 1) as never);
    }
    for (const id of ['shops-label', 'trails-label'] as const) {
      if (this.map.getLayer(id)) this.map.setPaintProperty(id, 'text-opacity', held(on ? 0 : 1, 1) as never);
    }
    this.map.setPaintProperty('tracks-label', 'text-opacity', held(on ? 0 : 1, 1) as never);
    this.root.classList.toggle('is-dimmed', on);
  }

  /**
   * Selection lives on the pin: it holds full opacity while the rest dims, and steps
   * up a size. Dimming the very row the sheet is describing read as the tap having
   * deselected something, and the bloom that used to mark it drew a second, softer
   * pin beside the real one.
   */
  /**
   * How much canvas the open sheet is sitting on, in pixels: a bottom band on a
   * phone, a right-hand column on a wide screen. A sheet that covers the pin it
   * describes is no better than not opening it.
   */
  private sheetCover(): { right: number; bottom: number } {
    const panel = this.root.querySelector<HTMLElement>('[data-panel]');
    if (!panel || panel.hidden) return { right: 0, bottom: 0 };
    const sheet = panel.getBoundingClientRect();
    const canvas = this.map.getCanvas().getBoundingClientRect();
    if (!sheet.width || !sheet.height) return { right: 0, bottom: 0 };
    return sheet.width >= canvas.width - 8
      ? { right: 0, bottom: Math.min(sheet.height, canvas.height * 0.6) }
      : { right: Math.min(sheet.width + 40, canvas.width * 0.55), bottom: 0 };
  }

  /**
   * Is the camera parked on this point? Not "is it on screen" — at world zoom half the
   * planet is on screen — but "is this what you are looking at": near the middle of the
   * map you can actually see, and close enough in that the answer means something.
   */
  private lookingAt(at: [number, number] | null | undefined): boolean {
    if (!at || this.map.getZoom() < cityZoom() - 1.5) return false;
    const canvas = this.map.getCanvas();
    const [dx, dy] = this.sheetOffset();
    const point = this.map.project(at);
    return (
      Math.abs(point.x - (canvas.clientWidth / 2 + dx)) < canvas.clientWidth * 0.22 &&
      Math.abs(point.y - (canvas.clientHeight / 2 + dy)) < canvas.clientHeight * 0.22
    );
  }

  /** Where the visitor is, once they have told us. */
  private here: [number, number] | null = null;

  /**
   * Ask the browser where the visitor is, and go there. Permission is theirs to give,
   * so this only ever runs from their tap, and a refusal is remembered in the control
   * rather than re-asked — a browser will not prompt twice, and pretending otherwise
   * leaves a button that silently does nothing.
   */
  async locate(): Promise<'ready' | 'denied' | 'idle'> {
    if (!navigator.geolocation) return 'denied';
    try {
      const fix = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12_000,
          maximumAge: 30_000,
        });
      });
      this.here = [fix.coords.longitude, fix.coords.latitude];
      this.showHere(this.here);
      this.map.easeTo({
        center: this.here,
        zoom: Math.max(this.map.getZoom(), cityZoom()),
        duration: reducedMotion() ? 0 : 900,
        offset: this.sheetOffset(),
      });
      return 'ready';
    } catch (err) {
      // PERMISSION_DENIED is a decision. A timeout or a failed fix is not.
      return (err as GeolocationPositionError)?.code === 1 ? 'denied' : 'idle';
    }
  }

  private hereMarker: Marker | null = null;

  /**
   * The blue dot, at every zoom. It is a Marker rather than a layer because it is not a
   * place in the catalog and must not be culled with them — and because a Marker is the
   * one thing that survives the light/dark restyle without being replayed.
   */
  private showHere(at: [number, number]) {
    if (this.hereMarker) {
      this.hereMarker.setLngLat(at);
      return;
    }
    const el = document.createElement('span');
    el.className = 'wm-here';
    el.setAttribute('aria-hidden', 'true');
    this.hereMarker = new Marker({ element: el, anchor: 'center' }).setLngLat(at).addTo(this.map);
  }

  /** Showing the visitor their own position. */
  get atHere(): boolean {
    return this.lookingAt(this.here);
  }

  /** Already parked on the stop recenter would take you to. */
  get atOpening(): boolean {
    return this.lookingAt(this.opening ? this.placements.get(this.opening)?.lngLat : null);
  }

  /** Camera offset that lands the target in what is still map. */
  private sheetOffset(): [number, number] {
    const { right, bottom } = this.sheetCover();
    return [-right / 2, -bottom / 2];
  }

  private setSelected(slug: string | null) {
    for (const id of ['tracks-glyph', 'shops-blip', 'trails-blip'] as const) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'icon-size', blipSize(slug) as never);
    }
  }

  selectTrack(slug: string, opts: { fly?: boolean } = {}) {
    const track = this.tracksBySlug.get(slug);
    if (!track) return;
    // Trails share the slug keyspace; they get their own card, never a track one.
    if (track.kind === 'trail') {
      void this.openTrail(slug);
      return;
    }
    this.clearTrail();
    const entry = [...this.placements.keys()]
      .filter((e) => e.track_slug === slug)
      .sort(entryOrder)
      .pop();
    this.selected = slug;
    this.renderVisible();
    this.setSelected(slug);
    this.setDimmed(true);
    // Switching the challenge off is a request to stop being shown episodes, so a
    // stop we have ridden opens as the place it is rather than as its film.
    const asEpisode = entry && this.visible.ride ? entry : null;
    this.hud.highlight(asEpisode);
    if (asEpisode) this.showEntrySheet(asEpisode, track);
    else this.panel.showTrack(track);
    if (opts.fly) this.flyToSlug(slug);
  }

  private flyToSlug(slug: string) {
    const feature = this.tracks.features.find((f) => (f.properties as TrackProps | null)?.slug === slug);
    if (feature?.geometry.type !== 'Point') return;
    const [lng, lat] = feature.geometry.coordinates as [number, number];
    this.map.easeTo({
      center: [lng, lat],
      zoom: Math.max(this.map.getZoom(), cityZoom()),
      duration: reducedMotion() ? 0 : 900,
      offset: this.sheetOffset(),
    });
  }

  /**
   * Takes a file the visitor picked or dropped: measure it here, send it, then show the
   * trace and the two secrets. The trail is drawn from the file we already hold rather
   * than fetched back, so nothing rides on the upload being readable yet.
   */
  /** Null until the status lands. Absent is treated as ON, matching the worker. */
  private uploadsOn: boolean | null = null;
  private pendingTimer: number | null = null;
  /** Both null unless the operator configured Turnstile; see /api/map/upload.json. */
  private turnstileSiteKey: string | null = null;
  private turnstileToken: string | null = null;

  setTurnstileToken(token: string) {
    this.turnstileToken = token;
  }

  /**
   * The uploads this browser has made, newest first.
   *
   * The link to an unclaimed trail exists in exactly one place — the sheet — and a stray
   * close used to destroy it. This is the second place: local to the device, so it fixes
   * the accident (closed the sheet, reopened the map) and honestly not the other case
   * (a different phone). Kept small and dropped once a row is past its window.
   */
  private recentUploads(): { id: string; title: string; claim: string; at: number }[] {
    try {
      const raw = localStorage.getItem(UPLOAD_STORE);
      const rows = raw ? (JSON.parse(raw) as { id: string; title: string; claim: string; at: number }[]) : [];
      const cutoff = Date.now() - 72 * 3600_000;
      return rows.filter((r) => r && typeof r.id === 'string' && r.at > cutoff).slice(0, 8);
    } catch {
      return [];
    }
  }

  private rememberUpload(row: { id: string; title: string; claim: string }) {
    try {
      const rows = [{ ...row, at: Date.now() }, ...this.recentUploads().filter((r) => r.id !== row.id)];
      localStorage.setItem(UPLOAD_STORE, JSON.stringify(rows.slice(0, 8)));
    } catch {
      /* private mode — the sheet still works for this visit */
    }
    this.syncUploadBadge();
  }

  syncUploadBadge() {
    const button = this.root.querySelector<HTMLElement>('[data-upload]');
    if (!button) return;
    const n = this.recentUploads().length;
    button.dataset.count = n ? String(n) : '';
  }

  /**
   * Asks the worker whether the door is open. Fire-and-forget at boot: the answer only
   * changes how a control LOOKS, and the worker refuses regardless, so nothing waits on it.
   */
  async checkUploads(button: HTMLElement): Promise<void> {
    try {
      const res = (await fetch('/api/map/upload.json', { cache: 'no-store' }).then((r) =>
        r.ok ? r.json() : null,
      )) as { enabled?: boolean; turnstile_site_key?: string | null } | null;
      this.uploadsOn = res?.enabled !== false;
      this.turnstileSiteKey = res?.turnstile_site_key || null;
    } catch {
      // A failed probe must not grey out a working button.
      this.uploadsOn = true;
    }
    button.dataset.state = this.uploadsOn ? 'idle' : 'off';
  }

  uploadsClosed(): boolean {
    return this.uploadsOn === false;
  }

  openUploadIntro(pick: () => void): void {
    if (this.uploadsOn === false) {
      this.panel.showUploadOff();
      return;
    }
    this.panel.showUploadIntro(pick, this.recentUploads(), {
      open: (id) => void this.reopenUpload(id),
      remove: (id) => void this.deleteUpload(id),
    });
  }

  /**
   * Reopens an upload from this device's own list, as the sheet it had when it finished.
   *
   * Same sheet, minus the close guard: the first showing warns because the link is new and
   * unshared, and this one cannot lose anything that is not already lost — it came FROM
   * the list it would fall back to.
   */
  private async reopenUpload(id: string): Promise<void> {
    const saved = this.recentUploads().find((r) => r.id === id);
    let trail: Trail | null = null;
    try {
      const doc = (await fetch(`/api/map/trail/${encodeURIComponent(id)}.json`).then((r) =>
        r.ok ? r.json() : null,
      )) as { trail?: Trail } | null;
      trail = doc?.trail ?? null;
    } catch {
      trail = null;
    }
    if (!trail?.stats?.centre || !saved) {
      // Gone from the server: expired, claimed elsewhere, or deleted. Drop it here too
      // rather than leaving a row that opens nothing.
      this.forgetUpload(id);
      this.panel.showMissingTrail();
      return;
    }

    this.trailsById.set(trail.id, trail);
    this.clearSelection();
    this.selected = trail.id;
    this.selectedTrail = trail.id;
    this.setSelected(trail.id);
    this.setDimmed(true);
    this.renderVisible();
    await this.traceTrail(trail);
    if (this.selectedTrail === trail.id) {
      this.drawTrail(trail.id);
      const lines = this.trailGeometry.get(trail.id);
      if (lines?.length) this.fitTrail(lines);
    }
    // Once it has a rider it is not an upload receipt any more — it is their trail, and
    // showing "You / your name here" over a trail that now has a name is a small lie.
    if (trail.author_username) {
      this.panel.showTrail(trail);
      return;
    }
    const left = Math.max(0, 72 - Math.floor((Date.now() - saved.at) / 3600_000));
    this.panel.showUploadDone(
      { id, secret: id, claim_code: '', expires_in_hours: left, map_url: `/?trail=${id}`, claim_url: saved.claim },
      trail,
      { guardClose: false },
    );
  }

  private async deleteUpload(id: string): Promise<void> {
    let ok = false;
    let claimed = false;
    try {
      const res = await fetch(`/api/map/trail/${encodeURIComponent(id)}`, { method: 'DELETE' });
      // A 404 means it is already gone, which is the outcome asked for.
      ok = res.ok || res.status === 404;
      // A 409 means somebody signed it, and the server is right to refuse: the secret is
      // no longer the authority over a trail that belongs to a forum post. What was wrong
      // was reporting that refusal as a failed delete, which left a row on this device
      // that could never be cleared. The row goes; the trail stays where it now lives.
      claimed = res.status === 409;
    } catch {
      ok = false;
    }
    if (claimed) {
      const post = await this.postUrlFor(id);
      this.forgetUpload(id);
      if (this.selectedTrail === id) this.clearPendingTrail();
      this.panel.allowClose();
      this.clearSelection();
      this.panel.showUploadClaimed(post);
      return;
    }
    if (!ok) {
      this.panel.showUploadError('failed');
      return;
    }
    this.forgetUpload(id);
    if (this.selectedTrail === id) this.clearPendingTrail();
    this.panel.allowClose();
    this.clearSelection();
    this.openUploadIntro(() => this.root.querySelector<HTMLInputElement>('[data-upload-input]')?.click());
  }

  /** Where a claimed trail went. `/p/<id>` is Discourse's own post permalink, which
      resolves inside a personal message as well as a public topic. */
  private async postUrlFor(id: string): Promise<string | null> {
    try {
      const doc = (await fetch(`/api/map/trail/${encodeURIComponent(id)}.json`).then((r) =>
        r.ok ? r.json() : null,
      )) as { trail?: Trail } | null;
      const postId = doc?.trail?.post_id;
      return postId && this.cfg.forumBase ? `${this.cfg.forumBase}/p/${postId}` : null;
    } catch {
      return null;
    }
  }

  private forgetUpload(id: string) {
    try {
      localStorage.setItem(UPLOAD_STORE, JSON.stringify(this.recentUploads().filter((r) => r.id !== id)));
    } catch {
      /* private mode */
    }
    this.syncUploadBadge();
  }

  /**
   * A file was chosen. Measure it, then STOP and show what we found.
   *
   * The upload used to start here. It does not any more, for one reason: a recorder writes
   * files called "2026-05-17_08-00-00.gpx" and that string became the trail's name with no
   * chance to change it. Now the name is the first thing on screen and editable, and
   * nothing leaves the browser until somebody presses confirm.
   */
  async offerUpload(file: File, repick: () => void): Promise<void> {
    const progress = this.panel.showUploadBusy();
    let text: string;
    try {
      text = await file.text();
    } catch {
      this.panel.showUploadError('failed');
      return;
    }
    // The parse blocks the main thread, so the label has to reach the screen before it
    // starts — otherwise the sheet still says "reading" for the whole measuring phase.
    progress('measuring', null);
    await new Promise((done) => requestAnimationFrame(() => done(null)));
    const pre = preflight(file, text);
    if (typeof pre === 'string') {
      this.panel.showUploadError(pre);
      return;
    }

    // Draw it before asking. The rider sees their own ride marching on the map while they
    // check the name, which is a better answer to "will this work?" than any wording.
    const lines = parseGpx(text);
    this.clearSelection();
    this.showPendingTrail(lines);
    if (lines.length) this.fitTrail(lines);

    const ready = { ...pre };
    this.panel.showUploadReady({
      name: ready.title || file.name.replace(/\.gpx$/i, ''),
      facts: this.uploadFacts(ready),
      turnstileSiteKey: this.turnstileSiteKey,
      onRename: (name) => {
        ready.title = name;
      },
      onRepick: () => {
        this.clearPendingTrail();
        repick();
      },
      onConfirm: () => void this.sendUpload(file, text, ready),
    });
  }

  /** Distance, shape and date in one line — enough to recognise the right file. */
  private uploadFacts(pre: Preflight): string {
    const unit = (v: number, u: string, extra: Intl.NumberFormatOptions = {}) =>
      new Intl.NumberFormat(this.cfg.lang, { style: 'unit', unit: u, unitDisplay: 'short', ...extra }).format(v);
    const bits: string[] = [];
    if (pre.distance_km) bits.push(unit(pre.distance_km, 'kilometer', { maximumFractionDigits: 1 }));
    const shape = pre.stats.shape;
    if (shape === 'loop') bits.push(this.strings['map.trail.loop'] ?? 'Loop');
    else if (shape === 'point_to_point') bits.push(this.strings['map.trail.pointToPoint'] ?? 'Point to point');
    const when = pre.stats.time?.recorded_at;
    if (when) {
      const at = new Date(when);
      if (!Number.isNaN(at.valueOf())) {
        bits.push(at.toLocaleDateString(this.cfg.lang, { year: 'numeric', month: 'short', day: 'numeric' }));
      }
    }
    return bits.join(' · ');
  }

  private async sendUpload(file: File, text: string, pre: Preflight): Promise<void> {
    const progress = this.panel.showUploadBusy();
    progress('sending', 0);
    const result = await uploadTrail(file, pre, progress, this.turnstileToken);
    if (result === 'uploads_disabled') {
      this.clearPendingTrail();
      this.uploadsOn = false;
      const button = this.root.querySelector<HTMLElement>('[data-upload]');
      if (button) button.dataset.state = 'off';
      this.panel.showUploadOff();
      return;
    }
    if (typeof result === 'string') {
      this.clearPendingTrail();
      this.panel.showUploadError(result);
      return;
    }

    const trail: Trail = {
      id: result.id,
      title: pre.title ? { en: pre.title } : null,
      visibility: 'unlisted',
      distance_km: pre.distance_km,
      stats: pre.stats,
      gpx_url: `/api/map/trail/${result.secret}.gpx`,
    };
    this.clearPendingTrail();
    this.trailsById.set(trail.id, trail);
    this.trailGeometry.set(trail.id, parseGpx(text));
    this.clearSelection();
    this.selected = trail.id;
    this.selectedTrail = trail.id;
    this.setSelected(trail.id);
    this.setDimmed(true);
    this.renderVisible();
    this.drawTrail(trail.id);
    const lines = this.trailGeometry.get(trail.id);
    if (lines?.length) this.fitTrail(lines);
    this.rememberUpload({
      id: result.id,
      title: localizedName(trail.title, this.cfg.lang) ?? result.id,
      claim: result.claim_url,
    });
    // Last, so the claim is what is left on screen.
    this.panel.showUploadDone(result, trail);
  }

  /**
   * Resolves one trail from its secret and shows it. Deliberately NOT added to
   * `this.trails` or the shared source: it is not part of the catalog, must not appear in
   * search, and must vanish when the visitor leaves.
   */
  private async openSecretTrail(secret: string): Promise<void> {
    let trail: Trail | null = null;
    try {
      const doc = (await fetch(`/api/map/trail/${encodeURIComponent(secret)}.json`).then((r) =>
        r.ok ? r.json() : null,
      )) as { trail?: Trail } | null;
      trail = doc?.trail ?? null;
    } catch {
      trail = null;
    }
    // A miss and an expiry are the same answer by design — say the honest thing.
    if (!trail?.stats?.centre) {
      this.panel.showMissingTrail();
      return;
    }
    this.trailsById.set(trail.id, trail);
    this.clearSelection();
    this.selected = trail.id;
    this.selectedTrail = trail.id;
    this.setSelected(trail.id);
    this.setDimmed(true);
    this.renderVisible();
    this.panel.showTrail(trail);

    await this.traceTrail(trail);
    if (this.selectedTrail !== trail.id || this.selected !== trail.id) return;
    this.drawTrail(trail.id);
    const lines = this.trailGeometry.get(trail.id);
    // Framing the trace is the arrival; the centre is only the fallback for a file that
    // would not load, so the visitor is not left staring at the whole country.
    if (lines?.length) this.fitTrail(lines);
    else
      this.map.easeTo({
        center: trail.stats.centre as [number, number],
        zoom: Math.max(this.map.getZoom(), cityZoom()),
        duration: reducedMotion() ? 0 : 900,
        offset: this.sheetOffset(),
      });
  }

  /** Panel-opening selection of a journey entry (marker tap). */
  selectEntry(entry: SeriesEntry, opts: { fly?: boolean } = {}) {
    this.clearTrail();
    const track = entry.track_slug ? this.tracksBySlug.get(entry.track_slug) ?? null : null;
    this.selected = entry.track_slug ?? entry.label;
    this.renderVisible();
    this.setSelected(entry.track_slug ?? null);
    this.setDimmed(true);
    this.hud.highlight(entry);
    this.showEntrySheet(entry, track);
    const at = this.placements.get(entry)?.lngLat;
    if (opts.fly && at) {
      this.map.easeTo({
        center: at,
        zoom: Math.max(this.map.getZoom(), cityZoom()),
        duration: reducedMotion() ? 0 : 900,
        offset: this.sheetOffset(),
      });
    }
  }

  private showEntrySheet(entry: SeriesEntry, track: TrackProps | null) {
    this.current = entry;
    const index = this.ordered.indexOf(entry);
    this.panel.showEntry(entry, track, this.series.target, {
      prev: index > 0,
      next: index >= 0 && index < this.ordered.length - 1,
    });
  }

  /** HUD scrub: camera only. An already-open sheet follows along; a closed one stays shut. */
  focusEntry(placement: EntryPlacement) {
    const entry = placement.entry;
    if (placement.lngLat) {
      this.map.easeTo({
        center: placement.lngLat,
        zoom: Math.max(this.map.getZoom(), cityZoom()),
        duration: reducedMotion() ? 0 : 900,
      });
    }
    if (this.panel.isOpen()) {
      const track = entry.track_slug ? this.tracksBySlug.get(entry.track_slug) ?? null : null;
      this.showEntrySheet(entry, track);
    }
  }

  /** HUD commit: open the sheet for this stop. */
  openEntry(placement: EntryPlacement) {
    this.selectEntry(placement.entry, { fly: !!placement.lngLat });
  }

  /** Sheet arrows: walk the journey without going back to the map. */
  stepEntry(delta: number) {
    const from = this.current ? this.ordered.indexOf(this.current) : -1;
    const next = this.ordered[from + delta];
    if (next) this.selectEntry(next, { fly: true });
  }

  /** Map control: back to the episode the map opened on. */
  recenter() {
    const at = this.opening ? this.placements.get(this.opening)?.lngLat : null;
    if (!at) {
      this.map.easeTo({ ...WORLD_VIEW, duration: reducedMotion() ? 0 : 900 });
      return;
    }
    this.hud.highlight(this.opening);
    this.map.easeTo({ center: at, zoom: cityZoom(), duration: reducedMotion() ? 0 : 1100 });
  }

  /** Everything the open trail owns: the fetch, the drawn trace and the loading cue.
      Selecting a track or an episode has to run this too, or the trace is orphaned and
      a late-arriving download flies the camera away from what the visitor is reading. */
  private clearTrail() {
    if (!this.selectedTrail && !this.trailFetch) return;
    this.selectedTrail = null;
    this.trailFetchId = null;
    this.trailFetch?.abort();
    this.trailFetch = null;
    this.root.classList.remove('is-tracing');
    this.drawTrail(null);
  }

  clearSelection() {
    // A sheet showing something unrepeatable holds the screen. Every incidental path into
    // here — a tap on empty ground, a pin, a layer toggle — routes through this one guard.
    if (this.panel.isSticky()) return;
    // Walking away from the ready sheet abandons the upload, so the marching line goes too.
    this.clearPendingTrail();
    this.selected = null;
    this.clearTrail();
    this.current = null;
    this.setSelected(null);
    this.setDimmed(this.seriesMode);
    this.panel.close();
    this.hud.highlight(null);
  }

  setSeriesMode(on: boolean) {
    this.seriesMode = on;
    this.hud.setSeriesMode(on);
    this.setDimmed(on || !!this.selected);
    this.map.setPaintProperty('journey-line', 'line-opacity', on ? 0.55 : 0);
    if (on) this.fitJourney();
  }

  toggleSeriesMode() {
    this.setSeriesMode(!this.seriesMode);
  }

  private fitJourney() {
    const points = [...this.placements.values()].map((p) => p.lngLat).filter((c): c is [number, number] => !!c);
    if (points.length === 0) return;
    if (points.length === 1) {
      this.map.easeTo({ center: points[0]!, zoom: cityZoom(), duration: reducedMotion() ? 0 : 900 });
      return;
    }
    const bounds = points.reduce((acc, c) => acc.extend(c), new LngLatBounds(points[0]!, points[0]!));
    this.map.fitBounds(bounds, { padding: 96, maxZoom: cityZoom(), duration: reducedMotion() ? 0 : 1100 });
  }

  /** Runs only after attach() — selection needs both the panel and the HUD. */
  applyDeepLink() {
    const params = new URLSearchParams(location.search);
    const slug = params.get('t');
    const ep = params.get('ep');
    const secret = params.get('trail');
    // A link-only trail is never in the map document — it is fetched by its secret and
    // drawn once, for this visit. Losing the link is losing the trail, which is the whole
    // contract; so it also never joins the layer, the search index or the cull.
    if (secret) {
      void this.openSecretTrail(secret);
      return;
    }
    // A trail link is only resolvable once its catalog has loaded, which the rail
    // otherwise defers until the layer is switched on.
    if (slug && !this.tracksBySlug.has(slug) && this.visible.trails) {
      void this.loadTrails().then(() => {
        if (this.tracksBySlug.has(slug)) this.selectTrack(slug, { fly: true });
      });
      return;
    }
    if (slug && this.tracksBySlug.has(slug)) {
      this.selectTrack(slug, { fly: true });
      return;
    }
    if (ep) {
      const entry = [...this.placements.keys()].find((e) => e.label === ep);
      if (!entry) return;
      // An episode bound to a trail has no coordinates until that catalog lands, and
      // selecting it early silently falls back to the opening stop. Park it instead.
      if (this.placements.get(entry)?.lngLat) this.selectEntry(entry, { fly: true });
      else this.pendingEntry = entry;
    }
  }

  attach(panel: Panel, hud: Hud) {
    this.panel = panel;
    this.hud = hud;
  }

  get openingStop() {
    return this.opening;
  }

  /**
   * Do we stand behind this place? The series document's `verified` block decides
   * outright — including a `false` for a venue we rode and filmed that then declined
   * to join. It lives in published data rather than in the bundle so a venue changing
   * its mind is an R2 push. Absent from it, the signals speak: a stop in the challenge,
   * or a bound forum topic (which only the per-track lookup knows, so callers pass it in).
   */
  verdict(slug: string, hasTopic = false): boolean {
    const called = this.series.verified?.[slug];
    if (typeof called === 'boolean') return called;
    return this.stops.has(slug) || hasTopic;
  }

  private stopSlugs?: Set<string>;
  private get stops(): Set<string> {
    this.stopSlugs ??= new Set(
      this.series.entries.map((e) => e.track_slug).filter(Boolean) as string[],
    );
    return this.stopSlugs;
  }

  /**
   * The colour a stop wears on the rail and under its pin. It is the verdict, not a
   * field somebody has to remember to set: green where we stand behind the venue,
   * muted where we rode it and it is not with us. Upcoming stops have no venue to
   * judge yet and keep their own colour.
   */
  toneOf(entry: SeriesEntry): string {
    if (entry.status === 'upcoming') return 'upcoming';
    return this.verdict(entry.track_slug ?? '') ? 'success' : 'partial';
  }

  /** Everything the search box can match on: tracks, shops, and any loaded trails. */
  get catalogRows(): TrackProps[] {
    return [...this.tracksBySlug.values()];
  }

  /** Trails sit behind their rail toggle; search wants them in regardless. */
  ensureTrails(): Promise<unknown> {
    return this.refreshTrails();
  }

  get placementIndex() {
    return this.placements;
  }
}

/**
 * Writes the pressed state onto the rail. The markup ships with LAYER_DEFAULTS baked in
 * because the page is static and the server cannot see localStorage, so a returning
 * visitor's own choices have to be painted on as soon as the island evaluates — not
 * after the map finishes booting, which left the rail advertising layers that were
 * about to switch off.
 */
function paintRail(root: HTMLElement, state: Record<LayerId, boolean>) {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-layer]')) {
    const id = button.dataset.layer as LayerId;
    if (id in state) button.setAttribute('aria-pressed', String(state[id]));
  }
  paintLayerCount(root, state);
}

/** The number on the folded button. Blank at zero — an empty map says that by itself. */
function paintLayerCount(root: HTMLElement, state: Record<LayerId, boolean>) {
  const badge = root.querySelector<HTMLElement>('[data-layer-count]');
  if (!badge) return;
  const on = LAYER_IDS.filter((id) => state[id]).length;
  badge.textContent = on ? String(on) : '';
}

function wireRail(root: HTMLElement, world: WorldMap, strings: Strings) {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-layer]')) {
    const id = button.dataset.layer as LayerId;
    const sync = () => button.setAttribute('aria-pressed', String(world.layerState(id)));
    sync();
    let hint: ReturnType<typeof setTimeout>;
    button.addEventListener('click', async () => {
      button.disabled = true;
      await world.setLayer(id, !world.layerState(id));
      button.disabled = false;
      sync();
      // Touch has no hover, so flash the label as confirmation of what moved.
      button.dataset.hint = '';
      clearTimeout(hint);
      hint = setTimeout(() => delete button.dataset.hint, 1600);
    });
  }

  // Recenter is in the rail rather than the zoom stack: everything in this rail
  // changes what you are looking at, and recentring is that, not chrome. It is
  // the one rail button with no pressed state — it acts and does not toggle.
  const recenter = root.querySelector<HTMLButtonElement>('[data-recenter]');
  recenter?.addEventListener('click', () => world.recenter());

  const locate = root.querySelector<HTMLButtonElement>('[data-locate]');
  if (locate) {
    // The permission may already have been answered on a previous visit. Reading it
    // does NOT prompt, so the control can start out honest instead of always faint.
    void navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        const settle = () => {
          if (locate.dataset.state === 'busy') return;
          locate.dataset.state = status.state === 'denied' ? 'denied' : status.state === 'granted' ? 'ready' : 'idle';
          world.syncControls();
        };
        settle();
        status.addEventListener('change', settle);
      })
      .catch(() => undefined);

    // Only `busy` refuses a tap. `denied` used to as well, and that made the slashed
    // state a dead end: whatever put it there — a mis-tap on the prompt, a permission
    // changed in settings since, a browser that only denied for the session — the control
    // that would fix it had switched itself off. Asking again costs one call and
    // sometimes works; refusing to ask never does.
    locate.addEventListener('click', async () => {
      if (locate.dataset.state === 'busy') return;
      locate.dataset.state = 'busy';
      locate.dataset.state = await world.locate();
      world.syncControls();
    });
  }

  // The fold. Open shows the five kind toggles and stands the button down, so the column
  // is the same length either way — which is the point: nine buttons in one rail ran most
  // of the height of a phone.
  const group = root.querySelector<HTMLElement>('[data-layer-group]');
  const fold = root.querySelector<HTMLButtonElement>('[data-layers-toggle]');
  if (group && fold) {
    const setOpen = (open: boolean) => {
      group.classList.toggle('is-open', open);
      fold.setAttribute('aria-expanded', String(open));
    };
    fold.addEventListener('click', (ev) => {
      ev.stopPropagation();
      setOpen(true);
      // Focus moves to the first toggle, or the fold button vanishing takes the focus
      // ring with it and a keyboard visitor is left nowhere.
      group.querySelector<HTMLButtonElement>('.wm-rail__btn--layer')?.focus();
    });
    // Folding back is "look away": tapping the map, or anywhere off the group. There is
    // no close button because the five toggles ARE the six-button budget.
    document.addEventListener('click', (ev) => {
      if (!group.contains(ev.target as Node)) setOpen(false);
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') setOpen(false);
    });
    world.onMapInteraction(() => setOpen(false));
  }

  // Which ground the map draws on. A menu rather than a cycling button: three named looks
  // with different reasons to want them is a choice, and a button that silently advances
  // through them makes the visitor hunt for the one they had.
  const basemapBtn = root.querySelector<HTMLButtonElement>('[data-basemap]');
  if (basemapBtn) {
    let menu: HTMLElement | null = null;
    const close = () => {
      menu?.remove();
      menu = null;
      basemapBtn.setAttribute('aria-expanded', 'false');
    };
    const open = () => {
      menu = document.createElement('div');
      menu.className = 'wm-basemaps';
      menu.setAttribute('role', 'radiogroup');
      menu.setAttribute('aria-label', strings['map.basemap.title'] ?? 'Map style');
      for (const id of BASEMAPS) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'wm-basemaps__row';
        row.setAttribute('role', 'radio');
        row.setAttribute('aria-checked', String(id === world.currentBasemap));
        const name = document.createElement('span');
        name.className = 'wm-basemaps__name';
        name.textContent = strings[`map.basemap.${id}`] ?? id;
        const note = document.createElement('span');
        note.className = 'wm-basemaps__note';
        note.textContent = strings[`map.basemap.${id}Note`] ?? '';
        row.append(name, note);
        row.addEventListener('click', () => {
          close();
          void world.setBasemap(id);
        });
        menu.appendChild(row);
      }
      basemapBtn.setAttribute('aria-expanded', 'true');
      basemapBtn.insertAdjacentElement('afterend', menu);
    };
    basemapBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (menu) close();
      else open();
    });
    document.addEventListener('click', (ev) => {
      if (menu && !menu.contains(ev.target as Node)) close();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && menu) close();
    });
  }

  // A file picker and a drop target for the same one action. The picker is what a phone
  // has; the drop target is what a desktop reaches for first, and it is invisible until
  // a file is actually over the map.
  const upload = root.querySelector<HTMLButtonElement>('[data-upload]');
  const picker = root.querySelector<HTMLInputElement>('[data-upload-input]');
  const drop = root.querySelector<HTMLElement>('[data-drop]');
  if (upload && picker) {
    void world.checkUploads(upload);
    world.syncUploadBadge();
    upload.addEventListener('click', () => world.openUploadIntro(() => picker.click()));
    picker.addEventListener('change', () => {
      const file = picker.files?.[0];
      // Cleared before the await, or picking the same file twice fires no second change.
      picker.value = '';
      if (file) void world.offerUpload(file, () => picker.click());
    });
  }
  if (picker && drop) {
    let over = 0;
    const gpx = (e: DragEvent) => Array.from(e.dataTransfer?.items ?? []).some((i) => i.kind === 'file');
    root.addEventListener('dragenter', (e) => {
      if (!gpx(e)) return;
      e.preventDefault();
      over++;
      drop.hidden = false;
    });
    // dragover must be cancelled every time or the browser navigates to the file.
    root.addEventListener('dragover', (e) => {
      if (over) e.preventDefault();
    });
    root.addEventListener('dragleave', () => {
      over = Math.max(0, over - 1);
      if (!over) drop.hidden = true;
    });
    root.addEventListener('drop', (e) => {
      if (!over) return;
      e.preventDefault();
      over = 0;
      drop.hidden = true;
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (world.uploadsClosed()) {
        world.openUploadIntro(() => picker.click());
        return;
      }
      void world.offerUpload(file, () => picker.click());
    });
  }

  world.syncControls();
}

function wireDrawer(root: HTMLElement) {
  const drawer = root.querySelector<HTMLElement>('[data-drawer]');
  const toggle = root.querySelector<HTMLButtonElement>('[data-drawer-toggle]');
  if (!drawer || !toggle) return;
  const set = (open: boolean) => {
    drawer.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => set(!drawer.classList.contains('is-open')));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('is-open')) set(false);
  });
}

function wireStats(root: HTMLElement) {
  const host = root.querySelector<HTMLElement>('[data-stats]');
  if (!host) return;
  fetch('/api/forum/metrics.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('metrics'))))
    .then((data: Record<string, unknown>) => {
      for (const node of host.querySelectorAll<HTMLElement>('[data-stat]')) {
        const value = data[node.dataset.stat!];
        if (typeof value === 'number') node.textContent = value.toLocaleString();
      }
    })
    .catch(() => {});
}

export async function bootWorldMap() {
  const root = document.getElementById('worldmap');
  if (!root) return;

  wireDrawer(root);
  wireStats(root);

  const cfg = readJson<MapConfig>('worldmap-config');
  const strings = readJson<Strings>('worldmap-i18n') ?? {};
  if (!cfg) return;

  const gate = root.querySelector<HTMLElement>('[data-map-gate]')!;
  const canvas = root.querySelector<HTMLElement>('[data-map-canvas]')!;

  if (!hasWebGL2()) {
    root.classList.add('is-unavailable');
    gate.dataset.state = 'unavailable';
    return;
  }

  gate.dataset.state = 'loading';
  try {
    const progress = bootProgress(root);
    progress.at('boot');
    // Cheap and pure — resolves URL then localStorage then defaults. Done first so the
    // rail is truthful from the island's first tick rather than from the map's last.
    paintRail(root, initialLayers());
    // Deliberately outside the Promise.all: it must not gate the map, but there is no
    // reason for it to wait for the map either.
    const trailsDoc = fetchJson(cfg.trailsUrl)
      .catch(() => fetchJson('/map/trails.seed.json'))
      .catch(() => ({ trails: [] }));
    const [series, tracks, shops] = await Promise.all([
      // The worker route is the live projection; the committed seed keeps `astro dev`
      // (no worker) and any R2 outage on a working page.
      fetchJson(cfg.seriesUrl).catch(() => fetchJson('/map/series.seed.json')),
      fetchJsonProgress(cfg.tracksUrl, (frac) => progress.at('catalog', frac)),
      // Shops are operator-published like the series, so they arrive without a rebuild.
      // A missing doc must never cost us the map, so this one degrades to nothing.
      fetchJson(cfg.shopsUrl)
        .catch(() => fetchJson('/map/shops.seed.json'))
        .catch(() => ({ shops: [] })),
    ]);

    // A shop is a catalog entity with a different kind, so it rides the same source,
    // the same viewport cull and the same per-kind budget as a track.
    const catalog = tracks as GeoJSON.FeatureCollection;
    for (const shop of ((shops as { shops?: ShopDoc[] }).shops ?? [])) {
      if (!shop?.slug || !Number.isFinite(shop.lng) || !Number.isFinite(shop.lat)) continue;
      catalog.features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [shop.lng, shop.lat] },
        properties: {
          slug: shop.slug,
          kind: 'shop',
          name: shop.name,
          name_local: shop.name_local ?? null,
          country_code: shop.country_code ?? '',
          locality: shop.locality ?? null,
          category: 'shop',
          tier: 'verified',
          website: shop.website ?? null,
          precision: 'exact',
        } satisfies TrackProps,
      });
    }

    const world = new WorldMap(root, cfg, series as SeriesDoc, catalog, trailsDoc);
    const panel = createPanel({
      root: root.querySelector<HTMLElement>('[data-panel]')!,
      strings,
      lang: cfg.lang,
      socials: cfg.socials,
      contactUrl: cfg.contactUrl,
      forumBase: cfg.forumBase,
      isVerified: (slug, hasTopic) => world.verdict(slug, hasTopic),
      onClose: () => world.clearSelection(),
      setTurnstileToken: (token) => world.setTurnstileToken(token),
      onVenue: (track) => world.openVenue(track),
      onStep: (delta) => world.stepEntry(delta),
    });
    progress.at('catalog');
    await world.start(canvas, strings, {
      onStyle: () => progress.at('style'),
      onBasemap: (seconds) => progress.creepTo('basemap', seconds),
      onReveal: () => {
        progress.done();
        gate.dataset.state = 'done';
      },
    });
    const hud = createHud(
      {
        root: root.querySelector<HTMLElement>('[data-hud]')!,
        strings,
        lang: cfg.lang,
        onFocus: (placement) => world.focusEntry(placement),
        onOpen: (placement) => world.openEntry(placement),
        onToggleSeries: () => world.toggleSeriesMode(),
        opening: world.openingStop,
        tone: (entry) => world.toneOf(entry),
      },
      series as SeriesDoc,
      world.placementIndex,
    );
    world.attach(panel, hud);
    wireRail(root, world, strings);
    wireSearch(root, {
      strings,
      rows: () => world.catalogRows,
      ensure: () => world.ensureTrails().then(() => undefined),
      onPick: (slug) => world.selectTrack(slug, { fly: true }),
    });
    world.applyDeepLink();
  } catch (err) {
    console.warn('worldmap boot', err);
    root.classList.add('is-unavailable');
    gate.dataset.state = 'unavailable';
  }
}
