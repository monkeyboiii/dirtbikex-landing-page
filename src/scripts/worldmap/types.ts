export type Tier = 'verified' | 'breadth';

/** The map's toggleable layers, in rail order. Declared here because BOTH the island
 *  and the server-rendered rail markup need them, and a second hardcoded copy is how
 *  the rail came to render a stale pressed state on first paint. This module imports
 *  nothing, so it is safe to pull into Astro frontmatter. */
export const LAYER_IDS = ['tracks', 'trails', 'shops', 'ride', 'riders'] as const;
export type LayerId = (typeof LAYER_IDS)[number];

/** What a first-time visitor sees. A returning visitor's stored set replaces it whole. */
export const LAYER_DEFAULTS: Record<LayerId, boolean> = {
  tracks: true,
  trails: true,
  shops: true,
  ride: true,
  // Off by default, and the rail hides it entirely when nobody is on it: riders
  // are people, and appearing on a public map is opt-in twice over — the rider
  // sets a location, and the operator (or the confirmed-edge bar) allows it.
  riders: false,
};

/** Properties baked into public/map/tracks.json — see CONCRETE_MAP_PLAN.md §6.1. */
export interface TrackProps {
  slug: string;
  /** Entity kind; absent means `track`. Render budgets are applied per kind. */
  kind?: string;
  name: string;
  name_local: string | null;
  country_code: string;
  locality: string | null;
  category: string;
  tier: Tier;
  website: string | null;
  precision: 'exact' | 'centroid';
  claimed?: boolean;
  /** Stamped from the feature geometry at boot so the sheet can hand off to a map app. */
  lng?: number;
  lat?: number;
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
  /** `upcoming` is announced but unreached: it draws on the rail and can be scrubbed
   *  to, but it never wins the opening camera. */
  status: 'visited' | 'live' | 'upcoming';
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

/** A GPX ride promoted from the forum — MAP_LAYERS_PLAN.md §3b.
 *  The author is stored as the numeric forum id (usernames can be renamed);
 *  `author_username` is the cached resolution the profile link uses. */
export interface TrailStats {
  segments: number;
  points: number;
  bbox: [number, number, number, number];
  centre: [number, number];
  shape?: 'loop' | 'point_to_point' | null;
  ele?: { ascent_m?: number | null } | null;
  time?: {
    recorded_at?: string | null;
    moving_s?: number | null;
    elapsed_s?: number | null;
    source?: 'trkpt' | 'metadata' | null;
  } | null;
  gpx_bytes?: number;
}

export interface Trail {
  id: string;
  title?: Record<string, string> | null;
  author_user_id: number;
  author_username: string;
  post_url?: string | null;
  gpx_url?: string | null;
  /** Cached from the forum so the profile link keeps working between imports. */
  author_name?: string | null;
  author_avatar?: string | null;
  summary?: Record<string, string> | null;
  distance_km?: number | null;
  stats?: TrailStats | null;
  /** Legacy baked geometry. Metadata-only docs omit it: the GPX is fetched on tap. */
  lines?: [number, number][][];
}

export interface TrailsDoc {
  version?: number;
  trails: Trail[];
}

export interface MapConfig {
  lang: string;
  /** Two forks of the basemap; the map follows the site's light/dark toggle. */
  styleDarkUrl: string;
  styleLightUrl: string;
  tracksUrl: string;
  seriesUrl: string;
  trailsUrl: string;
  ridersUrl: string;
  shopsUrl: string;
  /** Origin the rider avatar is fetched from. */
  forumBase: string;
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

/** A rider on the map: coarsened position + the numbers worth a pin label. */
export interface RiderPin {
  slug: string;
  name: string | null;
  username: string | null;
  avatar_template: string | null;
  region: string | null;
  lat: number;
  lon: number;
  students: number;
}

export interface RidersDoc {
  riders: RiderPin[];
}

/** One row of the track sheet's "managed by" byline. */
export interface LineageContributor {
  id: number;
  provenance: string;
  facets: string[];
  start_year: number | null;
  rider: {
    slug: string;
    username: string | null;
    name: string | null;
    name_local: string | null;
    placeholder: boolean;
  } | null;
}
