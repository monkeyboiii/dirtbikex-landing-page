// The authoritative sponsor list. Add entries here as campaigns are signed.
//
// Images must live under `public/sponsors/<id>/...` and stay under 500 KB each.
// `validateSponsors` runs at build time and fails the build on any violation.
//
// Schema kept in sync with iOS/App/Caching/Sponsor/Sponsor.swift.

import type { Sponsor, SponsorPayload } from './sponsor-types';
import { validateSponsors } from './sponsor-validation';

const sponsors: Sponsor[] = [
  // Example — populate as sponsors sign up:
  //
  // {
  //   id: 'acme-2026-05',
  //   section: 'mid_with_text',
  //   logo_url: 'https://www.dirtbikex.com/sponsors/acme/logo.png',
  //   name: 'ACME Motors',
  //   valid_from: '2026-05-01T00:00:00Z',
  //   valid_until: '2026-06-01T00:00:00Z',
  //   locale: null,
  //   region: null,
  //   slot_order: 0,
  // },
];

validateSponsors(sponsors);

export const payload: SponsorPayload = {
  version: 1,
  generated_at: new Date().toISOString(),
  sponsors,
};
