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
import type { EntryPlacement, MapConfig, SeriesDoc, SeriesEntry, Strings, TrackProps } from './types';

const GLYPHS = ['motocross', 'trail_area', 'riding_park', 'ebike_park', 'other'] as const;
const CATEGORY_TO_GLYPH: Record<string, string> = {
  motocross: 'motocross',
  trail_area: 'trail_area',
  riding_park: 'riding_park',
  ebike_park: 'ebike_park',
  club: 'other',
  other: 'other',
};

const COLOR = {
  breadth: '#6e6c69',
  verified: '#a9a49b',
  claimed: '#ed6b00',
  halo: '#ed6b00',
  label: '#d8d4cd',
  labelHalo: '#0d0c09',
};

const DIM = 0.22;
const WORLD_VIEW = { center: [14, 34] as [number, number], zoom: 2.1 };

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

function entryOrder(a: SeriesEntry, b: SeriesEntry) {
  return a.main - b.main || a.sub - b.sub;
}

/** Latest live episode wins the opening camera; falls back to latest visited. */
function openingEntry(series: SeriesDoc): SeriesEntry | null {
  const ranked = [...series.entries].sort(entryOrder).reverse();
  return ranked.find((e) => e.status === 'live') ?? ranked.find((e) => e.status === 'visited') ?? null;
}

/** Recolors a currentColor glyph and registers it with the map at 2× for crisp text-size icons. */
async function addGlyph(map: MapLibreMap, id: string, url: string, color: string) {
  const source = await fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(url))));
  const painted = source
    .replace(/currentColor/g, color)
    .replace(/\swidth="[^"]*"/, ' width="48"')
    .replace(/\sheight="[^"]*"/, ' height="48"');
  const img = new Image(48, 48);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(painted)}`;
  await img.decode();
  if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: 2 });
}

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

function radiusExpr(scale: number): unknown {
  const pick = (verified: number, breadth: number) => [
    'case',
    ['==', ['get', 'tier'], 'verified'],
    verified * scale,
    breadth * scale,
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
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    1, ['case', ['==', ['get', 'tier'], 'verified'], 0.78 * factor, 0.48 * factor],
    5, ['case', ['==', ['get', 'tier'], 'verified'], 0.9 * factor, 0.62 * factor],
    9, ['case', ['==', ['get', 'tier'], 'verified'], 1 * factor, 0.75 * factor],
  ];
}

/** A little bloom at world zoom so overlapping pins read as density, not dust. */
function blurExpr(): unknown {
  return ['interpolate', ['linear'], ['zoom'], 1, 0.7, 6, 0];
}

function colorExpr(): unknown {
  return [
    'case',
    ['==', ['get', 'claimed'], true],
    COLOR.claimed,
    ['==', ['get', 'tier'], 'verified'],
    COLOR.verified,
    COLOR.breadth,
  ];
}

class WorldMap {
  private map!: MapLibreMap;
  private panel!: Panel;
  private hud!: Hud;
  private seriesMode = false;
  private selected: string | null = null;
  private placements = new Map<SeriesEntry, EntryPlacement>();
  private tracksBySlug = new Map<string, TrackProps>();

  constructor(
    private root: HTMLElement,
    private cfg: MapConfig,
    private series: SeriesDoc,
    private tracks: GeoJSON.FeatureCollection,
  ) {}

  async start(canvas: HTMLElement) {
    for (const feature of this.tracks.features) {
      const props = feature.properties as TrackProps | null;
      if (!props?.slug) continue;
      if (this.cfg.claimed.includes(props.slug)) props.claimed = true;
      this.tracksBySlug.set(props.slug, props);
    }
    this.resolvePlacements();

    const opening = openingEntry(this.series);
    const openingAt = opening ? this.placements.get(opening)?.lngLat : null;
    const zoom = openingAt ? (isNarrow() ? 2.9 : 3.6) : WORLD_VIEW.zoom;

    this.map = new MapLibreMap({
      container: canvas,
      style: this.cfg.styleUrl,
      center: openingAt ?? WORLD_VIEW.center,
      zoom: reducedMotion() ? zoom : Math.max(1.4, zoom - 1.2),
      minZoom: 1,
      maxZoom: 14,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchZoomRotate: true,
      fadeDuration: 120,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    this.map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');

    this.map.on('error', (e) => console.warn('worldmap', e?.error?.message ?? e));

    await new Promise<void>((resolve) => this.map.on('load', () => resolve()));

    try {
      this.map.setProjection({ type: 'globe' });
    } catch {
      /* mercator is an acceptable fallback */
    }

    await this.addLayers();
    this.addEpisodeMarkers();
    this.wireInteractions();
    this.root.classList.add('is-live');

    if (!reducedMotion()) {
      this.map.easeTo({ zoom, duration: 2200, essential: false });
    }
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
    map.addSource('tracks', { type: 'geojson', data: this.tracks });

    await Promise.all([
      ...GLYPHS.flatMap((name) => [
        addGlyph(map, `cat-${name}-off`, `${this.cfg.markersBase}${name}.svg`, COLOR.labelHalo),
        addGlyph(map, `cat-${name}-on`, `${this.cfg.markersBase}${name}.svg`, '#ffffff'),
      ]),
      addGlyph(map, 'claim-seal', `${this.cfg.markersBase}seal.svg`, COLOR.claimed),
    ]).catch((err) => console.warn('worldmap glyphs', err));

    map.addLayer({
      id: 'tracks-halo',
      type: 'circle',
      source: 'tracks',
      filter: ['==', ['get', 'slug'], ''],
      paint: {
        'circle-radius': ['case', ['==', ['get', 'precision'], 'centroid'], 26, 16],
        'circle-color': COLOR.halo,
        'circle-opacity': 0.12,
        'circle-stroke-color': COLOR.halo,
        'circle-stroke-width': 1,
        'circle-stroke-opacity': 0.5,
      },
    });

    map.addLayer({
      id: 'tracks-dot',
      type: 'circle',
      source: 'tracks',
      paint: {
        'circle-radius': radiusExpr(1) as never,
        'circle-color': colorExpr() as never,
        'circle-opacity': opacityExpr(1) as never,
        'circle-blur': blurExpr() as never,
        'circle-stroke-color': '#0d0c09',
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
      minzoom: 7.5,
      filter: ['!=', ['get', 'tier'], 'breadth'],
      layout: {
        'icon-image': ['concat', 'cat-', glyphFor, ['case', ['==', ['get', 'claimed'], true], '-on', '-off']] as never,
        'icon-size': 0.34,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, 0, 8.5, 1] as never },
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
      filter: ['!=', ['get', 'tier'], 'breadth'],
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
        'text-color': COLOR.label,
        'text-halo-color': COLOR.labelHalo,
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
    map.addSource('journey', { type: 'geojson', data: line });
    map.addLayer({
      id: 'journey-line',
      type: 'line',
      source: 'journey',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': COLOR.claimed,
        'line-width': 1.5,
        'line-opacity': 0,
        'line-dasharray': [2, 2.5],
      },
    });
  }

  private addEpisodeMarkers() {
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
    }
  }

  private wireInteractions() {
    const map = this.map;
    const hit = ['tracks-dot'];

    map.on('mousemove', (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: hit });
      map.getCanvas().style.cursor = features.length ? 'pointer' : '';
    });

    map.on('click', (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: hit });
      const props = features[0]?.properties as TrackProps | undefined;
      if (props?.slug) {
        this.selectTrack(props.slug, { fly: true });
      } else {
        this.clearSelection();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.selected) this.clearSelection();
      else if (this.seriesMode) this.setSeriesMode(false);
    });
  }

  private setDimmed(on: boolean) {
    const factor = on ? DIM : 1;
    this.map.setPaintProperty('tracks-dot', 'circle-opacity', opacityExpr(factor) as never);
    this.map.setPaintProperty('tracks-glyph', 'icon-opacity', on ? DIM : 1);
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
    this.setHalo(slug);
    this.setDimmed(true);
    this.hud.highlight(entry ?? null);
    if (entry) this.panel.showEntry(entry, track, this.series.target);
    else this.panel.showTrack(track);
    if (opts.fly) this.flyToSlug(slug);
  }

  private flyToSlug(slug: string) {
    const feature = this.tracks.features.find((f) => (f.properties as TrackProps | null)?.slug === slug);
    if (feature?.geometry.type !== 'Point') return;
    const [lng, lat] = feature.geometry.coordinates as [number, number];
    this.map.easeTo({
      center: [lng, lat],
      zoom: Math.max(this.map.getZoom(), 8.5),
      duration: reducedMotion() ? 0 : 900,
    });
  }

  /** Panel-opening selection of a journey entry (marker tap). */
  selectEntry(entry: SeriesEntry, opts: { fly?: boolean } = {}) {
    const track = entry.track_slug ? this.tracksBySlug.get(entry.track_slug) ?? null : null;
    this.selected = entry.track_slug ?? entry.label;
    this.setHalo(entry.track_slug ?? null);
    this.setDimmed(true);
    this.hud.highlight(entry);
    this.panel.showEntry(entry, track, this.series.target);
    const at = this.placements.get(entry)?.lngLat;
    if (opts.fly && at) {
      this.map.easeTo({
        center: at,
        zoom: Math.max(this.map.getZoom(), 7.5),
        duration: reducedMotion() ? 0 : 900,
      });
    }
  }

  /** HUD ball: camera only — the card stays closed (operator-specified). */
  jumpToEntry(placement: EntryPlacement) {
    this.hud.highlight(placement.entry);
    if (!placement.lngLat) {
      this.selectEntry(placement.entry);
      return;
    }
    this.setSeriesMode(true);
    this.map.easeTo({
      center: placement.lngLat,
      zoom: Math.max(5.5, Math.min(this.map.getZoom(), 8)),
      duration: reducedMotion() ? 0 : 1100,
    });
  }

  clearSelection() {
    this.selected = null;
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
      this.map.easeTo({ center: points[0]!, zoom: 5.5, duration: reducedMotion() ? 0 : 900 });
      return;
    }
    const bounds = points.reduce(
      (acc, c) => acc.extend(c),
      new LngLatBounds(points[0]!, points[0]!),
    );
    this.map.fitBounds(bounds, { padding: 96, maxZoom: 6, duration: reducedMotion() ? 0 : 1100 });
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

  get placementIndex() {
    return this.placements;
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
  const gateBtn = root.querySelector<HTMLButtonElement>('[data-map-boot]')!;
  const canvas = root.querySelector<HTMLElement>('[data-map-canvas]')!;

  if (!hasWebGL2()) {
    root.classList.add('is-unavailable');
    gate.dataset.state = 'unavailable';
    return;
  }

  let started = false;
  const start = async () => {
    if (started) return;
    started = true;
    gate.dataset.state = 'loading';
    try {
      const [series, tracks] = await Promise.all([
        // The worker route is the live projection; the committed seed keeps `astro dev`
        // (no worker) and any R2 outage on a working page.
        fetchJson(cfg.seriesUrl).catch(() => fetchJson('/map/series.seed.json')),
        fetchJson(cfg.tracksUrl),
      ]);

      const world = new WorldMap(root, cfg, series as SeriesDoc, tracks as GeoJSON.FeatureCollection);
      const panel = createPanel({
        root: root.querySelector<HTMLElement>('[data-panel]')!,
        strings,
        lang: cfg.lang,
        joinUrl: cfg.joinUrl,
        onClose: () => world.clearSelection(),
      });
      await world.start(canvas);
      const hud = createHud(
        {
          root: root.querySelector<HTMLElement>('[data-hud]')!,
          strings,
          lang: cfg.lang,
          onPick: (placement) => world.jumpToEntry(placement),
          onToggleSeries: () => world.toggleSeriesMode(),
        },
        series as SeriesDoc,
        world.placementIndex,
      );
      world.attach(panel, hud);
      world.applyDeepLink();
      gate.dataset.state = 'done';
    } catch (err) {
      console.warn('worldmap boot', err);
      started = false;
      root.classList.add('is-unavailable');
      gate.dataset.state = 'unavailable';
    }
  };

  gateBtn.addEventListener('click', () => void start());
  if (!isNarrow()) void start();
}
