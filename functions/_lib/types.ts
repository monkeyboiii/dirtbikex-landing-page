/**
 * Cloudflare Pages Functions context — minimal inline shape (no
 * `@cloudflare/workers-types` dep). Add the official types if/when
 * the function set needs more of the runtime surface (KV, Durable
 * Objects, etc.).
 */
export interface PagesContext<Params extends Record<string, string> = Record<string, string>> {
  request: Request;
  params: Params;
  env: PagesEnv;
  waitUntil(promise: Promise<unknown>): void;
  next(): Promise<Response>;
}

/** Bindings injected by Cloudflare Pages from the project dashboard. */
export interface PagesEnv {
  /** e.g. `https://forum.dirtbikechina.com` (dev) / `https://forum.dirtbikex.com` (prod). Wired in Phase 3.3. */
  FORUM_BASE?: string;
}

/** Props handed to the shared share-landing renderer. */
export interface ShareLandingProps {
  /** Discriminator. Currently only `'i'` (invite); future kinds add raw values per ShareKind. */
  kind: 'i';
  title: string;
  subtitle?: string;
  primaryCTA: { label: string; url: string };
  returnTapCopy: string;
  locale: 'en' | 'zh';
}

/**
 * Subset of Discourse `GET /invites/{key}` response that the landing page reads.
 * Discourse returns more fields; all are optional here because the response
 * shape varies by invite state. `email` is intentionally listed so the field
 * can be deleted explicitly — never rendered.
 */
export interface InviteResponse {
  invited_by?: { username?: string; name?: string | null; avatar_template?: string };
  email?: string;
  expired?: boolean;
  redemption_count?: number;
  max_redemptions_allowed?: number | null;
  groups?: Array<{ id: number; name: string; full_name?: string | null }>;
}
