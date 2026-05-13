// Sponsor types — kept in sync with iOS/App/Caching/Sponsor/Sponsor.swift.
// Field names are snake_case to match the JSON wire format consumed by the iOS app.

export type SponsorSection = 'header' | 'hero' | 'mid_with_text' | 'bottom_icon';

export interface Sponsor {
  id: string;
  section: SponsorSection;
  logo_url?: string;
  name?: string;
  name_logo_url?: string;
  photo_url?: string;
  valid_from: string; // ISO 8601
  valid_until: string; // ISO 8601
  locale: string | null;
  region: string | null;
  slot_order: number | null;
}

export interface SponsorPayload {
  version: number;
  generated_at: string; // ISO 8601
  sponsors: Sponsor[];
}

export const SECTION_MAX_SLOTS: Record<SponsorSection, number> = {
  header: 3,
  hero: 2, // 2 auctionable; operator center is rendered locally by the iOS app
  mid_with_text: 4,
  bottom_icon: 8,
};
