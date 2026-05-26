// Sponsor wire-shape types — v4. Mirrors sponsorhub's src/schemas/wire.ts
// (canonical at infra/submodules/dirtbikex-sponsors/src/schemas/wire.ts).
// Snake_case to match the JSON wire format.

export type SponsorSection = 'header' | 'hero' | 'mid_with_text' | 'bottom_icon';

export interface Sponsor {
  id: string;
  section: SponsorSection;
  logo_url?: string | null;
  name?: string | null;
  name_logo_url?: string | null;
  photo_url?: string | null;
  valid_from: string;
  valid_until: string;
  locale: string | null;
  region: string | null;
  slot_order: number | null;
  // v4 additions (§6.5 identity variants):
  username?: string | null;
  brand_link_url?: string | null;
}

// Stable rider shape across podium modes (§6.4).
export interface Rider {
  username: string | null;
  label: string;
  avatar_url: string | null;
  navigable: boolean;
  brand_link_url?: string;
}

export interface SponsorPodiumPool {
  center: Rider;
  pool: Rider[];
}

export interface SponsorsResponse {
  version: 4;
  generated_at: string;
  podium_modes: string[];
  sponsors: Sponsor[];
  sponsor_podium: SponsorPodiumPool;
}

// Legacy v1 envelope — still emitted by src/data/sponsors.ts until L7.
// Retired at L7 along with the static array. Don't add new fields here.
export interface SponsorPayload {
  version: number;
  generated_at: string;
  sponsors: Sponsor[];
}

export const SECTION_MAX_SLOTS: Record<SponsorSection, number> = {
  header: 3,
  hero: 5,            // v4 pool capacity (§6.6); was 2 in v1 (operator + 2 flanking)
  mid_with_text: 4,
  bottom_icon: 8,
};
