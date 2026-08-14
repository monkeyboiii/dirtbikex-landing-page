export type Tier = 'verified' | 'breadth';

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
  /** One entry per GPX track segment: [lng, lat] pairs. */
  lines: [number, number][][];
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
