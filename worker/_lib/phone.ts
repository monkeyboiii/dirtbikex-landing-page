// E.164 normalization + country detection for the SMS gateway.
//
// Handcrafted for CN/US only — libphonenumber-js is overkill for two countries
// and would pull ~50 KB into the worker bundle. Adding a country means: extend
// `Country`, add a regex branch below, and update SMS_QUOTAS in smsQuota.ts.
// See docs/sms-gateway.md §"Adding a country".

export type Country = 'CN' | 'US';

export interface PhoneInfo {
  /** E.164 form, e.g. "+8613800138000". */
  e164: string;
  country: Country;
}

/**
 * Accepts loosely-formatted input ("+86 138-0013-8000", "13800138000",
 * "1 (415) 555-1234") and returns the canonical E.164 form plus country,
 * or `null` if the number isn't a valid CN mobile or US number.
 *
 * Rules:
 *   CN mobile — 11 digits starting with `1`, optionally prefixed with +86 / 86.
 *   US        — 10 digits, NPA first digit 2-9, optionally prefixed with +1 / 1.
 */
export function normalizePhone(raw: string): PhoneInfo | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d+]/g, '');

  let m = cleaned.match(/^(?:\+?86)?(1\d{10})$/);
  if (m) return { e164: '+86' + m[1], country: 'CN' };

  m = cleaned.match(/^(?:\+?1)?([2-9]\d{2}[2-9]\d{6})$/);
  if (m) return { e164: '+1' + m[1], country: 'US' };

  return null;
}

/** Parses LOGTO_SMS_ALLOWED_COUNTRIES ("CN,US") into a Set. */
export function parseAllowedCountries(csv: string | undefined): Set<Country> {
  const out = new Set<Country>();
  if (!csv) return out;
  for (const raw of csv.split(',')) {
    const cc = raw.trim().toUpperCase();
    if (cc === 'CN' || cc === 'US') out.add(cc);
  }
  return out;
}
