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
  /** e.g. `https://forum.dirtbikechina.com` (dev) / `https://forum.dirtbikex.com` (prod). */
  FORUM_BASE?: string;
  /** Numeric ID of the Discourse Data Explorer query that returns the invite shape below. */
  FORUM_INVITE_QUERY_ID?: string;
  /** Discourse `Api-Username` header. Defaults to `system`. */
  FORUM_API_USERNAME?: string;
  /** Discourse `Api-Key` header. Secret — wired via the Pages dashboard, not in wrangler.jsonc. */
  FORUM_API_KEY?: string;
}

/** Props handed to the shared share-landing renderer. */
export interface ShareLandingProps {
  /** Discriminator. Currently only `'i'` (invite); future kinds add raw values per ShareKind. */
  kind: 'i';
  locale: 'en' | 'zh';
  primaryCTA: { label: string; url: string };
  returnTapCopy: string;
  /** Forum origin (e.g. `https://forum.dirtbikex.com`) — needed to resolve `avatar_template`. */
  forumBase: string;
  /** Error-state copy. Mutually exclusive with `invite`. */
  title?: string;
  subtitle?: string;
  /** Valid-state payload — drives the hero card. Mutually exclusive with `title`/`subtitle`. */
  invite?: InviteRow;
}

/**
 * Recipient-facing invite payload. Field names mirror iOS `Invite.swift` /
 * `InvitePayload.swift` so a future iOS migration to this endpoint can reuse
 * the existing Codable decoders verbatim.
 *
 * Intentionally omitted vs `Invite.swift`: `link`, `email`, `domain`,
 * `can_delete_invite` — recipient doesn't need them, and `email` is the
 * long-standing leak vector (SHARING_MODULE.md "Discourse contracts").
 */
export interface InviteRow {
  id: number;
  invite_key: string;
  description: string | null;
  max_redemptions_allowed: number | null;
  redemption_count: number;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  expired: boolean;
  topics: TopicReference[];
  groups: GroupSummary[];
  /** Extension beyond `Invite.swift` (iOS list is inviter-owned). Mirrors `InviterSummary`. */
  invited_by: InviterSummary;
}

export interface TopicReference {
  id: number;
  title: string;
  fancy_title: string | null;
  slug: string | null;
  posts_count: number | null;
}

export interface GroupSummary {
  id: number;
  name: string;
  full_name: string | null;
}

export interface InviterSummary {
  username: string;
  name: string | null;
  /** Discourse user title (e.g. "Moderator"). Additive vs iOS `InviterSummary`. */
  title: string | null;
  /** Discourse-format template with `{size}` placeholder, e.g. `/user_avatar/host/user/{size}/123_2.png`. */
  avatar_template: string | null;
}
