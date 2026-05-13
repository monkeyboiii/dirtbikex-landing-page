// Build-time validation for sponsor entries. Runs whenever `sponsors.ts` is imported
// (i.e. during `astro build`) — a failed validation throws and fails the build, so
// bad data can never ship to clients.
//
// Mirrors the constraints enforced in the iOS app's SponsorImageStore.

import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import type { Sponsor } from './sponsor-types';
import { SECTION_MAX_SLOTS } from './sponsor-types';

const MAX_IMAGE_BYTES = 500 * 1024;
const FIRST_PARTY_HOSTS = ['www.dirtbikex.com', 'www.dirtbikechina.com'];

const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));

export function validateSponsors(sponsors: Sponsor[]): void {
  const ids = new Set<string>();
  const perSectionCount: Partial<Record<string, number>> = {};

  for (const sponsor of sponsors) {
    if (ids.has(sponsor.id)) {
      throw new Error(`Duplicate sponsor id: ${sponsor.id}`);
    }
    ids.add(sponsor.id);

    // Per-section count cap. The iOS app caps at render time too, but if we ship
    // more than the cap we'd be telling sponsors a slot exists that won't display.
    const count = (perSectionCount[sponsor.section] ?? 0) + 1;
    perSectionCount[sponsor.section] = count;
    const cap = SECTION_MAX_SLOTS[sponsor.section];
    if (count > cap) {
      throw new Error(
        `Section ${sponsor.section} has ${count} entries, exceeds cap ${cap}. Sponsor: ${sponsor.id}`,
      );
    }

    // Section-conditional required fields.
    switch (sponsor.section) {
      case 'header':
        if (!sponsor.logo_url && !sponsor.name_logo_url && !sponsor.name) {
          throw new Error(`header sponsor ${sponsor.id} must have at least one of: logo_url, name_logo_url, name`);
        }
        break;
      case 'hero':
        if (!sponsor.photo_url || !sponsor.name) {
          throw new Error(`hero sponsor ${sponsor.id} must have both photo_url and name`);
        }
        break;
      case 'mid_with_text':
        if (!sponsor.logo_url || !sponsor.name) {
          throw new Error(`mid_with_text sponsor ${sponsor.id} must have both logo_url and name`);
        }
        break;
      case 'bottom_icon':
        if (!sponsor.logo_url) {
          throw new Error(`bottom_icon sponsor ${sponsor.id} must have logo_url`);
        }
        break;
    }

    // Date sanity.
    const from = Date.parse(sponsor.valid_from);
    const until = Date.parse(sponsor.valid_until);
    if (Number.isNaN(from) || Number.isNaN(until) || from >= until) {
      throw new Error(`Sponsor ${sponsor.id}: invalid valid_from/valid_until`);
    }

    // Image existence + size enforcement.
    for (const url of imageURLs(sponsor)) {
      const filePath = mapUrlToFile(url);
      if (filePath === null) {
        throw new Error(`Sponsor ${sponsor.id}: image URL must be first-party (got ${url})`);
      }
      if (!fs.existsSync(filePath)) {
        throw new Error(`Sponsor ${sponsor.id}: image file missing (${path.relative(PUBLIC_DIR, filePath)})`);
      }
      const size = fs.statSync(filePath).size;
      if (size > MAX_IMAGE_BYTES) {
        throw new Error(
          `Sponsor ${sponsor.id}: image ${url} is ${size}B, exceeds ${MAX_IMAGE_BYTES}B limit`,
        );
      }
    }
  }
}

function imageURLs(s: Sponsor): string[] {
  return [s.logo_url, s.name_logo_url, s.photo_url].filter((u): u is string => !!u);
}

function mapUrlToFile(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!FIRST_PARTY_HOSTS.includes(parsed.hostname)) return null;
  const rel = parsed.pathname.replace(/^\//, '');
  return path.join(PUBLIC_DIR, rel);
}
