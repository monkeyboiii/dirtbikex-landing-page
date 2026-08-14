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
import { createPanel, type Panel } from './panel';
import { createHud, type Hud } from './hud';
import type {
  EntryPlacement,
  MapConfig,
  SeriesDoc,
  SeriesEntry,
  Strings,
  TrackProps,
  Trail,
  TrailsDoc,
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
/** Pins of one kind drawn at once. A dense region has to stay readable, and this
    also bounds the work MapLibre redoes on every pan. Scales with the viewport. */
const RENDER_CELL_PX = 116;
/** Desktop and phone get their own ceilings. One shared area formula floored the phone
    at 50 pins in a quarter of the area — roughly 4x desktop's density — which is the
    surface least able to carry the bigger blips. */
function renderBudget(map: MapLibreMap): number {
  const c = map.getCanvas();
  const cells = (c.clientWidth * c.clientHeight) / (RENDER_CELL_PX * RENDER_CELL_PX);
  const [floor, ceil] = isNarrow() ? [14, 30] : [40, 120];
  return Math.max(floor, Math.min(ceil, Math.round(cells * 0.55)));
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** A row in the operator-published shops doc — see MAP_LAYERS_PLAN.md §4. */
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
const LAYERS = {
  tracks: ['tracks-halo', 'tracks-glow', 'tracks-dot', 'tracks-glyph', 'tracks-seal', 'tracks-label'],
  shops: ['shops-glow', 'shops-blip', 'shops-label'],
  trails: ['trails-line', 'trails-cap'],
  ride: ['journey-line'],
} as const;
type LayerId = keyof typeof LAYERS;
const LAYER_IDS = Object.keys(LAYERS) as LayerId[];
const LAYER_STORE = 'dbx-map-layers';
/** Catalog kinds drawn from the shared `tracks` source, one per toggle. */
const KIND_OF: Partial<Record<LayerId, string>> = { tracks: 'track', shops: 'shop' };

/** Trails start off: their data is fetched on first enable, not at boot. */
const LAYER_DEFAULTS: Record<LayerId, boolean> = { tracks: true, shops: true, trails: false, ride: true };

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
  if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: 2 });
}

/** Blips are rasterised at 2x their largest drawn size so they stay crisp on a
    retina phone; 48px upscaled to 35 CSS px is what made the old glyphs mushy. */
const BLIP_PX = 96;

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

function opacityExpr(factor: number): unknown {
  // A verified row is a dot until its blip fades in, then hands over completely —
  // drawing both is what made the old glyph look like grit on top of a dot. Breadth
  // rows stay dots at every zoom, which is what keeps a dense country readable.
  const tier = (verified: number, breadth: number) => [
    'case',
    ['==', ['get', 'tier'], 'verified'],
    verified * factor,
    breadth * factor,
  ];
  return [
    'interpolate', ['linear'], ['zoom'],
    1, tier(0.78, 0.48),
    5, tier(0.9, 0.62),
    8.4, tier(0.9, 0.7),
    9.4, tier(0, 0.75),
  ];
}

/** A little bloom at world zoom so overlapping pins read as density, not dust. */
function blurExpr(): unknown {
  return ['interpolate', ['linear'], ['zoom'], 1, 0.7, 6, 0];
}

/** Flies the camera back to the episode the map opened on. */
class RecenterControl {
  constructor(
    private readonly onPress: () => void,
    private readonly label: string,
  ) {}

  onAdd(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'maplibregl-ctrl maplibregl-ctrl-group wm-ctrl-recenter';
    const button = document.createElement('button');
    button.type = 'button';
    button.title = this.label;
    button.setAttribute('aria-label', this.label);
    button.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="4.5" fill="currentColor"/>' +
      '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6"/>' +
      '<path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      '</svg>';
    button.addEventListener('click', () => this.onPress());
    group.appendChild(button);
    return group;
  }

  onRemove() {}
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
  private episodeMarkers: HTMLElement[] = [];
  private visible = initialLayers();
  private trails: Trail[] | null = null;
  private current: SeriesEntry | null = null;
  private tracksBySlug = new Map<string, TrackProps>();
  private opening: SeriesEntry | null = null;

  constructor(
    private root: HTMLElement,
    private cfg: MapConfig,
    private series: SeriesDoc,
    private tracks: GeoJSON.FeatureCollection,
  ) {}

  private get styleUrl() {
    return this.dark ? this.cfg.styleDarkUrl : this.cfg.styleLightUrl;
  }

  async start(canvas: HTMLElement, strings: Strings) {
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
    // Bottom-right stacks upward in insertion order: info button, then recenter, then zoom.
    this.map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    this.map.addControl(
      new RecenterControl(
        () => this.recenter(),
        strings['map.control.recenter'] ?? 'Back to the latest episode',
      ),
      'bottom-right',
    );
    this.map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');

    this.map.on('error', (e) => console.warn('worldmap', e?.error?.message ?? e));

    await new Promise<void>((resolve) => this.map.on('load', () => resolve()));

    this.applyProjection();
    await this.addLayers();
    this.renderVisible();
    this.addEpisodeMarkers();
    this.applyLayers();
    if (this.visible.trails) void this.loadTrails();
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
      if (dark !== this.dark) void this.applyTheme(dark);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  private async applyTheme(dark: boolean) {
    this.dark = dark;
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
    this.setHalo(this.selected);
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
    const c = palette(this.dark);
    // Starts empty; renderVisible() fills it from what's actually on screen.
    map.addSource('tracks', { type: 'geojson', data: EMPTY, promoteId: 'slug' });

    await Promise.all([
      ...GLYPHS.flatMap((name) => [
        addGlyph(map, `cat-${name}-off`, `${this.cfg.markersBase}${name}.svg`, c.glyph),
        addGlyph(map, `cat-${name}-on`, `${this.cfg.markersBase}${name}.svg`, c.glyphOnClaimed),
      ]),
      addGlyph(map, 'claim-seal', `${this.cfg.markersBase}seal.svg`, ACCENT),
      addGlyph(map, 'blip-track', `${this.cfg.markersBase}track.svg`, c.track, BLIP_PX, c.labelHalo),
      addGlyph(map, 'blip-trail', `${this.cfg.markersBase}trails.svg`, c.trail, BLIP_PX, c.labelHalo),
      addGlyph(map, 'blip-shop', `${this.cfg.markersBase}shop.svg`, c.shop, BLIP_PX, c.labelHalo),
    ]).catch((err) => console.warn('worldmap glyphs', err));

    map.addLayer({
      id: 'tracks-halo',
      type: 'circle',
      source: 'tracks',
      filter: ['==', ['get', 'slug'], ''],
      paint: {
        'circle-radius': ['case', ['==', ['get', 'precision'], 'centroid'], 26, 16],
        'circle-color': ACCENT,
        'circle-opacity': 0.12,
        'circle-stroke-color': ACCENT,
        'circle-stroke-width': 1,
        'circle-stroke-opacity': 0.5,
      },
    });

    // Soft coloured bloom under each blip. A circle layer with circle-blur is the only
    // glow MapLibre draws cheaply — icon-halo-* is SDF-only, and an SDF icon cannot
    // carry a white glyph on a coloured disc at the same time.
    map.addLayer({
      id: 'tracks-glow',
      type: 'circle',
      source: 'tracks',
      minzoom: 8,
      filter: ['all', ['!=', ['get', 'tier'], 'breadth'], ['!=', ['get', 'kind'], 'shop']],
      paint: {
        'circle-color': c.track,
        'circle-blur': 0.85,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8.4, 12, 10, 21, 14, 27] as never,
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 8.4, 0, 9.6, 0.32] as never,
      },
    });

    map.addLayer({
      id: 'tracks-dot',
      type: 'circle',
      source: 'tracks',
      filter: ['!=', ['get', 'kind'], 'shop'],
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
        'circle-stroke-opacity': 0.7,
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
      minzoom: 8,
      filter: ['all', ['!=', ['get', 'tier'], 'breadth'], ['!=', ['get', 'kind'], 'shop']],
      layout: {
        'icon-image': 'blip-track',
        // 48 layout px at 2x; 0.44-0.78 puts it between 21 and 37 CSS px, against the
        // 8.2 CSS px the old category glyph actually rendered at.
        'icon-size': ['interpolate', ['linear'], ['zoom'], 8.4, 0.5, 10, 0.72, 14, 0.9] as never,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 8.4, 0, 9.4, 1] as never },
    });

    map.addLayer({
      id: 'tracks-seal',
      type: 'symbol',
      source: 'tracks',
      minzoom: 7.5,
      filter: ['==', ['get', 'claimed'], true],
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
      filter: ['all', ['!=', ['get', 'tier'], 'breadth'], ['!=', ['get', 'kind'], 'shop']],
      layout: {
        'text-field': ['coalesce', ['get', 'name'], ''] as never,
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
      minzoom: 8,
      filter: shopFilter,
      paint: {
        'circle-color': c.shop,
        'circle-blur': 0.85,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8.4, 12, 10, 21, 14, 27] as never,
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 8.4, 0, 9.6, 0.32] as never,
      },
    });
    map.addLayer({
      id: 'shops-blip',
      type: 'symbol',
      source: 'tracks',
      minzoom: 8,
      filter: shopFilter,
      layout: {
        'icon-image': 'blip-shop',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 8.4, 0.5, 10, 0.72, 14, 0.9] as never,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 8.4, 0, 9.4, 1] as never },
    });
    map.addLayer({
      id: 'shops-label',
      type: 'symbol',
      source: 'tracks',
      minzoom: 9.6,
      filter: shopFilter,
      layout: {
        'text-field': ['coalesce', ['get', 'name'], ''] as never,
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

  /** Trails are few and small, so they draw whole — no viewport culling. */
  private addTrailLayers() {
    const map = this.map;
    const trails = this.trails ?? [];
    if (!trails.length || map.getSource('trails')) return;
    const c = palette(this.dark);

    map.addSource('trails', {
      type: 'geojson',
      promoteId: 'id',
      data: {
        type: 'FeatureCollection',
        features: trails.map((trail) => ({
          type: 'Feature' as const,
          properties: { id: trail.id },
          geometry: { type: 'MultiLineString' as const, coordinates: trail.lines },
        })),
      },
    });

    // A wide transparent line under the visible one: a 2 px trace is not a tap target.
    map.addLayer({
      id: 'trails-cap',
      type: 'line',
      source: 'trails',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c.trail, 'line-width': 14, 'line-opacity': 0.01 },
    });
    map.addLayer({
      id: 'trails-line',
      type: 'line',
      source: 'trails',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': c.trail,
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 11, 2.6, 14, 4] as never,
        'line-opacity': 0.85,
      },
    });
  }

  /** Fetched on first enable, not at boot — the layer is off for most visits. */
  private async loadTrails(): Promise<boolean> {
    if (this.trails) return true;
    try {
      const doc = (await fetchJson(this.cfg.trailsUrl).catch(() =>
        fetchJson('/map/trails.seed.json'),
      )) as TrailsDoc;
      this.trails = Array.isArray(doc?.trails) ? doc.trails.filter((t) => t.lines?.length) : [];
    } catch (err) {
      console.warn('worldmap trails', err);
      return false;
    }
    this.addTrailLayers();
    this.applyLayers();
    return this.trails.length > 0;
  }

  /**
   * Draws only what is in view, capped per kind and spread over a grid so a dense
   * country doesn't collapse into a blob. Runs on every settled move, so panning
   * fills in incrementally rather than shipping the whole world at once.
   *
   * The selected pin and every episode venue are always kept — culling the one the
   * panel is describing would strand the halo and the sheet.
   */
  private renderVisible() {
    if (!this.map.getSource('tracks')) return;
    const map = this.map;
    const bounds = map.getBounds();
    const budget = renderBudget(map);
    const canvas = map.getCanvas();
    const cols = Math.max(1, Math.ceil(canvas.clientWidth / RENDER_CELL_PX));
    const rows = Math.max(1, Math.ceil(canvas.clientHeight / RENDER_CELL_PX));

    const pinned = new Set<string>();
    if (this.selected) pinned.add(this.selected);
    for (const entry of this.series.entries) if (entry.track_slug) pinned.add(entry.track_slug);

    const rank = (p: TrackProps) => (p.claimed ? 3 : p.tier === 'verified' ? 2 : 1);
    const kept: GeoJSON.Feature[] = [];
    const candidates = new Map<string, { feature: GeoJSON.Feature; cell: number; rank: number }[]>();

    for (const feature of this.tracks.features) {
      const props = feature.properties as TrackProps | null;
      if (!props?.slug) continue;
      if (pinned.has(props.slug)) {
        kept.push(feature);
        continue;
      }
      if (feature.geometry.type !== 'Point') continue;
      const [lng, lat] = feature.geometry.coordinates as [number, number];
      if (!bounds.contains([lng, lat])) continue;
      const at = map.project([lng, lat]);
      const cx = Math.min(cols - 1, Math.max(0, Math.floor(at.x / RENDER_CELL_PX)));
      const cy = Math.min(rows - 1, Math.max(0, Math.floor(at.y / RENDER_CELL_PX)));
      const kind = props.kind ?? 'track';
      // Each toggle owns one kind: turning tracks off must not also blank the shops.
      const owner = LAYER_IDS.find((l) => KIND_OF[l] === kind);
      if (owner && !this.visible[owner]) continue;
      const bucket = candidates.get(kind) ?? [];
      bucket.push({ feature, cell: cy * cols + cx, rank: rank(props) });
      if (bucket.length === 1) candidates.set(kind, bucket);
    }

    for (const bucket of candidates.values()) {
      // Best pin per grid cell first — that is what spreads them — then fill any
      // remaining budget with the next best wherever they fall.
      bucket.sort((a, b) => b.rank - a.rank);
      const taken = new Set<number>();
      const leftovers: GeoJSON.Feature[] = [];
      let used = 0;
      for (const c of bucket) {
        if (used >= budget) break;
        if (taken.has(c.cell)) {
          leftovers.push(c.feature);
          continue;
        }
        taken.add(c.cell);
        kept.push(c.feature);
        used++;
      }
      for (const feature of leftovers) {
        if (used >= budget) break;
        kept.push(feature);
        used++;
      }
    }

    (map.getSource('tracks') as { setData(d: GeoJSON.FeatureCollection): void }).setData({
      type: 'FeatureCollection',
      features: kept,
    });
  }

  private addEpisodeMarkers() {
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
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.selectEntry(entry, { fly: true });
      });
      new Marker({ element: el, anchor: 'center' }).setLngLat(placement.lngLat).addTo(this.map);
      this.episodeMarkers.push(el);
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
      return (
        found.find((f) => f.layer.id === 'tracks-dot' || f.layer.id === 'shops-blip') ?? found[0]
      );
    };
    /** Only layers that exist and are on — querying a missing layer throws. */
    const hit = () =>
      ['tracks-dot', 'shops-blip', 'trails-cap'].filter((id) => {
        const owner = LAYER_IDS.find((l) => (LAYERS[l] as readonly string[]).includes(id));
        return map.getLayer(id) && (!owner || this.visible[owner]);
      });

    map.on('mousemove', (e) => {
      map.getCanvas().style.cursor = pick(e.point) ? 'pointer' : '';
    });

    // Settled move only — mid-gesture re-renders would fight the pan.
    map.on('moveend', () => this.renderVisible());

    map.on('click', (e) => {
      const feature = pick(e.point);
      const trail = feature?.layer.id === 'trails-cap'
        ? this.trails?.find((t) => t.id === feature.properties?.id)
        : null;
      if (trail) {
        this.clearSelection();
        this.selectedTrail = trail.id;
        this.panel.showTrail(trail);
      } else if ((feature?.properties as TrackProps | undefined)?.slug) {
        this.selectTrack((feature!.properties as TrackProps).slug, { fly: true });
      } else {
        this.clearSelection();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.selected || this.selectedTrail) this.clearSelection();
      else if (this.seriesMode) this.setSeriesMode(false);
    });
  }

  /**
   * Applies layer visibility to everything a layer owns. Re-run after every
   * addLayers(), including the theme restyle — setStyle drops the style layers and
   * they come back visible by default.
   */
  private applyLayers() {
    for (const id of LAYER_IDS) {
      const on = this.visible[id];
      for (const layerId of LAYERS[id]) {
        if (this.map.getLayer(layerId)) {
          this.map.setLayoutProperty(layerId, 'visibility', on ? 'visible' : 'none');
        }
      }
    }
    for (const el of this.episodeMarkers) el.style.display = this.visible.ride ? '' : 'none';
    this.root.classList.toggle('is-ride-off', !this.visible.ride);
    this.root.classList.toggle('is-tracks-off', !this.visible.tracks);
  }

  async setLayer(id: LayerId, on: boolean): Promise<void> {
    if (this.visible[id] === on) return;
    if (id === 'trails' && on && !(await this.loadTrails())) return;
    this.visible[id] = on;
    // A hidden layer must not keep a sheet open about one of its features.
    if (!on && id === 'trails' && this.selectedTrail) this.clearSelection();
    // Episodes ride on catalog pins, so "is this an episode?" is a slug lookup.
    if (!on && this.selected) {
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

  private setDimmed(on: boolean) {
    const factor = on ? DIM : 1;
    this.map.setPaintProperty('tracks-dot', 'circle-opacity', opacityExpr(factor) as never);
    this.map.setPaintProperty('tracks-glyph', 'icon-opacity', on ? DIM : 1);
    this.map.setPaintProperty('tracks-glow', 'circle-opacity', on ? 0.06 : 0.32);
    this.map.setPaintProperty('tracks-label', 'text-opacity', on ? 0 : 1);
    this.root.classList.toggle('is-dimmed', on);
  }

  private setHalo(slug: string | null) {
    this.map.setFilter('tracks-halo', ['==', ['get', 'slug'], slug ?? '']);
  }

  selectTrack(slug: string, opts: { fly?: boolean } = {}) {
    const track = this.tracksBySlug.get(slug);
    if (!track) return;
    const entry = [...this.placements.keys()]
      .filter((e) => e.track_slug === slug)
      .sort(entryOrder)
      .pop();
    this.selected = slug;
    this.renderVisible();
    this.setHalo(slug);
    this.setDimmed(true);
    this.hud.highlight(entry ?? null);
    if (entry) this.showEntrySheet(entry, track);
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
    });
  }

  /** Panel-opening selection of a journey entry (marker tap). */
  selectEntry(entry: SeriesEntry, opts: { fly?: boolean } = {}) {
    const track = entry.track_slug ? this.tracksBySlug.get(entry.track_slug) ?? null : null;
    this.selected = entry.track_slug ?? entry.label;
    this.renderVisible();
    this.setHalo(entry.track_slug ?? null);
    this.setDimmed(true);
    this.hud.highlight(entry);
    this.showEntrySheet(entry, track);
    const at = this.placements.get(entry)?.lngLat;
    if (opts.fly && at) {
      this.map.easeTo({
        center: at,
        zoom: Math.max(this.map.getZoom(), cityZoom()),
        duration: reducedMotion() ? 0 : 900,
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

  clearSelection() {
    this.selected = null;
    this.selectedTrail = null;
    this.current = null;
    this.setHalo(null);
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
    if (slug && this.tracksBySlug.has(slug)) {
      this.selectTrack(slug, { fly: true });
      return;
    }
    if (ep) {
      const entry = [...this.placements.keys()].find((e) => e.label === ep);
      if (entry) this.selectEntry(entry, { fly: true });
    }
  }

  attach(panel: Panel, hud: Hud) {
    this.panel = panel;
    this.hud = hud;
  }

  get openingStop() {
    return this.opening;
  }

  get placementIndex() {
    return this.placements;
  }
}

function wireRail(root: HTMLElement, world: WorldMap) {
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
    const [series, tracks, shops] = await Promise.all([
      // The worker route is the live projection; the committed seed keeps `astro dev`
      // (no worker) and any R2 outage on a working page.
      fetchJson(cfg.seriesUrl).catch(() => fetchJson('/map/series.seed.json')),
      fetchJson(cfg.tracksUrl),
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

    const world = new WorldMap(root, cfg, series as SeriesDoc, catalog);
    const panel = createPanel({
      root: root.querySelector<HTMLElement>('[data-panel]')!,
      strings,
      lang: cfg.lang,
      socials: cfg.socials,
      contactUrl: cfg.contactUrl,
      onClose: () => world.clearSelection(),
      onStep: (delta) => world.stepEntry(delta),
    });
    await world.start(canvas, strings);
    const hud = createHud(
      {
        root: root.querySelector<HTMLElement>('[data-hud]')!,
        strings,
        lang: cfg.lang,
        onFocus: (placement) => world.focusEntry(placement),
        onOpen: (placement) => world.openEntry(placement),
        onToggleSeries: () => world.toggleSeriesMode(),
        opening: world.openingStop,
      },
      series as SeriesDoc,
      world.placementIndex,
    );
    world.attach(panel, hud);
    wireRail(root, world);
    world.applyDeepLink();
    gate.dataset.state = 'done';
  } catch (err) {
    console.warn('worldmap boot', err);
    root.classList.add('is-unavailable');
    gate.dataset.state = 'unavailable';
  }
}
