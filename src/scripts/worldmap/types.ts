export type Tier = 'verified' | 'breadth';

/** Properties baked into public/map/tracks.json — see CONCRETE_MAP_PLAN.md §6.1. */
export interface TrackProps {
  slug: string;
  name: string;
  name_local: string | null;
  country_code: string;
  locality: string | null;
  category: string;
  tier: Tier;
  website: string | null;
  precision: 'exact' | 'centroid';
  claimed?: boolean;
}

/** One activity on the journey — episode or side entry. CONCRETE_MAP_PLAN.md §6.2. */
export interface SeriesEntry {
  main: number;
  sub: number;
  label: string;
  kind: 'episode' | 'side';
  hud?: 'show' | 'hide';
  video_id?: string | null;
  track_slug?: string | null;
  coords?: { lat: number; lng: number } | null;
  venue?: Record<string, string> | null;
  title?: Record<string, string> | null;
  tagline?: Record<string, string> | null;
  status: 'visited' | 'live';
  /** Operator-set dot colour on the journey rail: "success" | "partial" (green
   *  shades) — anything else, or absent, uses the brand accent. */
  tone?: string | null;
  links?: Record<string, string | null> | null;
  thumb?: string | null;
  visited_on?: string | null;
  published_on?: string | null;
}

export interface SeriesDoc {
  series: string;
  target: number;
  entries: SeriesEntry[];
}

export interface MapConfig {
  lang: string;
  /** Two forks of the basemap; the map follows the site's light/dark toggle. */
  styleDarkUrl: string;
  styleLightUrl: string;
  tracksUrl: string;
  seriesUrl: string;
  markersBase: string;
  /** DirtBikeX profile per platform — the fallback when an episode has no link yet. */
  socials: Partial<Record<string, string>>;
  /** Last-resort fallback for platforms we have no profile URL for. */
  contactUrl: string;
  /** Curated active-claim slugs; replaced by a forum endpoint in V1.5 (D8). */
  claimed: string[];
}

export type Strings = Record<string, string>;

/** Resolved position for a journey entry (own coords, or borrowed from its track). */
export interface EntryPlacement {
  entry: SeriesEntry;
  lngLat: [number, number] | null;
}
