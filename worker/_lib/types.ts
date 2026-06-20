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
  /** sponsorhub edge — e.g. `https://api.dirtbikechina.com` (dev) / `https://api.dirtbikex.com` (prod). */
  SPONSOR_API_BASE?: string;
  /** CF Access service-token credentials for the Worker's calls to `SPONSOR_API_BASE/admin/*`,
   *  which sits behind CF Access. Secrets — set via `wrangler secret put`, not wrangler.jsonc.
   *  Without them the upstream admin call is bounced by CF Access with a 302. */
  SPONSOR_CF_ACCESS_CLIENT_ID?: string;
  SPONSOR_CF_ACCESS_CLIENT_SECRET?: string;
  /** KV binding for /sponsors/finalize + /s/g/:token rate-limiting (PLAN_2 §4.2/§4.3). Created via `wrangler kv namespace create` per env. */
  RATELIMIT_KV?: KVNamespace;

  // --- /api/logto/sms — Logto HTTP SMS connector gateway. See docs/sms-gateway.md.
  /** Shared bearer that Logto sends in `Authorization: Bearer …`. Secret. */
  LOGTO_SMS_TOKEN?: string;
  /** Comma-separated ISO 3166-1 alpha-2 list, e.g. "CN,US". Phones outside → 403. */
  LOGTO_SMS_ALLOWED_COUNTRIES?: string;
  /** Optional override for the 400/day global cap (testing); falls back to 400. */
  LOGTO_SMS_GLOBAL_DAILY_CAP?: string;

  // Aliyun SMS (China). Secrets: AccessKey pair. Public: sign-name + template code + region.
  ALIYUN_ACCESS_KEY_ID?: string;
  ALIYUN_ACCESS_KEY_SECRET?: string;
  ALIYUN_SMS_SIGN_NAME?: string;
  ALIYUN_SMS_TEMPLATE_CODE?: string;
  ALIYUN_REGION?: string;

  // AWS SNS (US). Secrets: AccessKey pair. Public: region + optional sender ID.
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_SNS_REGION?: string;
  AWS_SNS_SENDER_ID?: string;
}

/** Minimal KV shape — we only use the get/put surface; full @cloudflare/workers-types is overkill. */
export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/**
 * Locale tags the worker honors. Mirrors `src/i18n/ui.ts`'s `languages` keys —
 * kept duplicated here so the worker bundle stays self-contained (no cross-
 * import from `src/`). Update both when adding/removing a locale.
 */
export type Lang =
  | 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'de' | 'it' | 'fr' | 'es' | 'ar'
  | 'da' | 'el' | 'fa-IR' | 'fi' | 'id' | 'nl' | 'pt' | 'tr-TR' | 'th' | 'vi' | 'sv';

/** Props handed to the shared share-landing renderer. */
export interface ShareLandingProps {
  /** Discriminator per ShareKind raw value: `'i'` invite, `'u'` profile, `'e'` event. */
  kind: 'i' | 'u' | 'e';
  locale: Lang;
  primaryCTA: { label: string; url: string };
  /** Optional secondary CTA — the "open in the app" deep link. Set only for a
   *  mobile valid card; funnels into the app via `dirtbikex://`. */
  appCTA?: { label: string; url: string };
  /** Shown only beneath `appCTA` (the install→return helper). */
  returnTapCopy: string;
  /** Forum origin (e.g. `https://forum.dirtbikex.com`) — needed to resolve `avatar_template`. */
  forumBase: string;
  /** Error-state copy. Mutually exclusive with `invite`/`user`. */
  title?: string;
  subtitle?: string;
  /** Valid invite payload — drives the invite hero card. Mutually exclusive with `title`/`subtitle`/`user`. */
  invite?: InviteRow;
  /** Valid profile payload — drives the profile card. Mutually exclusive with `title`/`subtitle`/`invite`. */
  user?: UserRow;
  /** Valid event payload — drives the event card. Mutually exclusive with the others. */
  event?: EventRow;
}

/**
 * Recipient-facing event payload for `/s/e/<id>`. Identity-rendered (like
 * profile): the card shows the event, it doesn't create a relationship. Sourced
 * from the admin-keyed `discourse-post-event` endpoint (event id == post id).
 */
export interface EventRow {
  id: number;
  name: string;
  /** ISO8601, in `timezone`. Date-only when `all_day`. */
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  /** IANA identifier, e.g. `Asia/Shanghai`. */
  timezone: string | null;
  location: string | null;
  description: string | null;
  organizer: {
    username: string;
    name: string | null;
    /** Discourse-format template with `{size}` placeholder. */
    avatar_template: string | null;
  };
  /** Discourse topic post path (e.g. `/t/slug/16/1`) for the desktop "view on forum" CTA. */
  post_url: string | null;
  /** Attendance — `going` / `interested` drive the card's count line. */
  stats: { going: number; interested: number; invited: number } | null;
  /** Topic tags (names, e.g. `honda`) — rendered as `#honda` pills. */
  tags: string[];
  /** Sample invitees (avatar + RSVP status) for the card's invitee row. */
  invitees: { avatar_template: string | null; name: string | null; status: string | null }[];
  /** Lifecycle flags (mirror iOS `statusKind`) → the status badge. */
  is_ongoing: boolean;
  is_expired: boolean;
  is_closed: boolean;
  /** Event hero image — absolute CDN URL (from `image_upload.url`), or null. */
  image_url: string | null;
}

/**
 * Recipient-facing public-profile payload for `/s/u/<username>`. Sourced from
 * the public `GET /u/<username>.json` endpoint (no API key). `email` is never
 * part of that public shape — do not add it.
 *
 * `hidden` collapses Discourse's `profile_hidden:true` minimal response into the
 * same shape: when true, the stat/bio fields are null and the renderer shows a
 * "private profile" card.
 */
export interface UserRow {
  username: string;
  name: string | null;
  title: string | null;
  admin: boolean;
  moderator: boolean;
  /** Discourse-format template with `{size}` placeholder. */
  avatar_template: string | null;
  bio_excerpt: string | null;
  total_followers: number | null;
  total_following: number | null;
  gamification_score: number | null;
  primary_group_name: string | null;
  /** Account creation timestamp (ISO) — rendered as "joined N ago". */
  created_at: string | null;
  /** Pre-computed short location (`state ?? country ?? address`). */
  location: string | null;
  website: string | null;
  website_name: string | null;
  /** Status emoji is a Discourse shortcode → `/emojis/<emoji>.png` (bundled). */
  status: { emoji: string; description: string } | null;
  hidden: boolean;
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
