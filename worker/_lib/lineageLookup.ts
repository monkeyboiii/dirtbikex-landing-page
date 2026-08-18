import type { PagesEnv } from './types';

/**
 * Reads the forum's lineage graph. Every endpoint here is anonymous by design —
 * the plugin serves the same JSON to the app, the forum and this worker, so the
 * landing page needs no key, no CORS and no per-environment Data Explorer query
 * (the trade MAP_LAYERS_PLAN §3b already settled once).
 */

export interface LineageRiderCard {
  /** Null when the forum account has no rider node yet — see `blank_resume`. */
  slug: string | null;
  claimed: boolean;
  placeholder: boolean;
  username: string | null;
  name: string | null;
  name_local: string | null;
  avatar_template: string | null;
}

export interface LineageStats {
  mentors: number;
  students: number;
  downstream: number;
  generations: number;
  tracks: number;
}

export interface LineageEdge {
  id: number;
  relation: string;
  provenance: string;
  documented: boolean;
  facets: string[];
  honorific: string | null;
  honorific_proposed?: string | null;
  intensity: string | null;
  start_year: number | null;
  end_year: number | null;
  year_precision: string;
  notes: string | null;
  evidence_url: string | null;
  rider?: LineageRiderCard | null;
  track?: { slug: string; name: string; name_local: string | null; locality?: string | null } | null;
}

export interface LineageResume {
  /** True when this is a real account with nothing recorded yet, not a 404. */
  empty?: boolean;
  rider: LineageRiderCard & {
    region: string | null;
    country_code: string | null;
    riding_since_year: number | null;
    known_for: string[];
    state: string;
  };
  stats: LineageStats;
  sections: { learned_from: LineageEdge[]; taught: LineageEdge[]; contributed_to: LineageEdge[] };
  timeline: { year: number | null; year_precision: string; kind: string; entry: LineageEdge | null }[];
}

export interface LineageClaimPreview {
  rider: { slug: string; name: string; name_local: string | null; region: string | null; country_code: string | null };
  reported_by: LineageEdge[];
}

/**
 * `reason` + `httpStatus` exist for `?debug=true` (LINEAGE_MODULE.md § debug):
 * "unreachable" alone cannot tell an operator whether the forum was down, the
 * plugin was disabled, or the JSON was malformed. Callers that only branch on
 * `status` are unaffected.
 */
export type LineageResult<T> =
  | { status: 'valid'; data: T; httpStatus: number }
  | { status: 'not_found'; httpStatus: 404 }
  | {
      status: 'unreachable';
      reason: 'missing_env' | 'fetch_failed' | 'bad_status' | 'bad_json';
      httpStatus: number | null;
    };

async function getJSON<T>(env: PagesEnv, path: string): Promise<LineageResult<T>> {
  if (!env.FORUM_BASE) {
    console.error('lineage:missing_env');
    return { status: 'unreachable', reason: 'missing_env', httpStatus: null };
  }

  let resp: Response;
  try {
    resp = await fetch(`${env.FORUM_BASE}${path}`, {
      headers: { Accept: 'application/json' },
      // Same 5min edge cache as the profile lookup; the plugin also sets
      // s-maxage=300 on anonymous reads.
      ...({ cf: { cacheTtl: 300, cacheEverything: true } } as RequestInit),
    });
  } catch (err) {
    console.error('lineage:fetch_failed', { path, err: String(err) });
    return { status: 'unreachable', reason: 'fetch_failed', httpStatus: null };
  }

  if (resp.status === 404) return { status: 'not_found', httpStatus: 404 };
  if (!resp.ok) {
    console.error('lineage:bad_status', { path, status: resp.status });
    return { status: 'unreachable', reason: 'bad_status', httpStatus: resp.status };
  }

  try {
    return { status: 'valid', data: (await resp.json()) as T, httpStatus: resp.status };
  } catch (err) {
    console.error('lineage:bad_json', { path, err: String(err) });
    return { status: 'unreachable', reason: 'bad_json', httpStatus: resp.status };
  }
}

/** `@name` addresses a claimed rider by forum username; anything else is a slug. */
export function lineagePath(ref: string): string {
  const trimmed = ref.trim();
  return trimmed.startsWith('@')
    ? `/dirtbikex/lineage/u/${encodeURIComponent(trimmed.slice(1))}.json`
    : `/dirtbikex/lineage/riders/${encodeURIComponent(trimmed)}.json`;
}

export function lookupResume(env: PagesEnv, ref: string) {
  return getJSON<LineageResume>(env, lineagePath(ref));
}

export function lookupClaimPreview(env: PagesEnv, token: string) {
  return getJSON<LineageClaimPreview>(env, `/dirtbikex/lineage/claims/${encodeURIComponent(token)}/preview.json`);
}

export function lookupTrackContributors(env: PagesEnv, slug: string) {
  return getJSON<{ track: unknown; contributors: LineageEdge[] }>(
    env,
    `/dirtbikex/lineage/tracks/${encodeURIComponent(slug)}.json`
  );
}

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

export function lookupRiderPins(env: PagesEnv) {
  return getJSON<{ riders: RiderPin[] }>(env, '/dirtbikex/lineage/riders/geo.json');
}
