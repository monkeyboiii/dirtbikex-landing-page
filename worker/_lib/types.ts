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
  | 'da' | 'el' | 'fa-IR' | 'fi' | 'id' | 'nl' | 'pt' | 'tr-TR' | 'th' | 'vi';

/** Props handed to the shared share-landing renderer. */
export interface ShareLandingProps {
  /** Discriminator. Currently only `'i'` (invite); future kinds add raw values per ShareKind. */
  kind: 'i';
  locale: Lang;
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
