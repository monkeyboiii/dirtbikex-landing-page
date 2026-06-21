# Sponsor Buy Flow — Landing Page Architecture (IAP-first)

**Status (V1 slim — as-built):** The web Worker routes and Astro pages for `/sponsors/finalize`, `/s/g/<token>` (grant claim), and `/admin/uploads` are **built and mounted** (`worker/index.ts:555–600`; Astro pages in `src/pages/`). They are **inert in V1** because the sponsorhub backend leaves those endpoints unmounted (see [`SPONSORSHIP.md — Parked for V2`](../../dirtbikex-sponsors/docs/SPONSORSHIP.md#parked-for-v2-in-tree-unwired)). V1 live web surface: the public `/sponsors` gallery only. **Canonical for the web-side surface** — when this doc and the backend doc disagree on a web-side detail, this doc wins.
**Backend doc:** [`dirtbikex-sponsors/docs/SPONSORSHIP.md`](../../dirtbikex-sponsors/docs/SPONSORSHIP.md) — data model, IAP/pricing, API contract, admin/moderation. iOS surface: see the iOS repo's `SPONSOR_MODULE.md`.
**Backend repo:** [`infra/submodules/dirtbikex-sponsors/`](../../dirtbikex-sponsors/) — Hono + TypeScript service implementing the API endpoints referenced here.
**Owners:** Calvin (product + iOS + web).

---

## 1. Shape

iOS owns the buyer-facing surface (checkout, upload, stats). Web owns the public surface (`/sponsors` gallery) and two thin escape-hatch routes (`/sponsors/finalize?token=<>` for desktop upload, `/s/g/<token>` for admin grant claims).

| Surface | Owner | Auth |
|---|---|---|
| Browse | Web `/sponsors` | none |
| Checkout (slot pick + Apple IAP) | iOS | Discourse session |
| Image upload — primary | iOS | Discourse session |
| Image upload — desktop convenience | Web `/sponsors/finalize?token=<>` | single-use `finalize_token` from receipt email |
| Stats dashboard | iOS `GET /sponsors/me` | Discourse session |
| Admin grant claim | Web `/s/g/<token>` | claim-token-in-URL; recipient self-declares forum username; **no finalize_token issued** — image upload happens later via iOS Discourse session |
| Image moderation portal | Web `/admin/uploads` | Cloudflare Access (admin email allowlist; see [`SPONSORSHIP.md — Admin auth`](../../dirtbikex-sponsors/docs/SPONSORSHIP.md#admin-auth-cloudflare-access--dual-allowlist)) |
| Admin surface | sponsorhub `/admin/*` | Cloudflare Access (same allowlist; Worker forwards `X-Admin-Email`) |

---

## 2. Scope

Four escape-hatch/admin routes on `www.<apex>` (plus Worker proxies for `/api/proxy/sponsors`, `/api/proxy/leaderboard/*`, and `/api/forum/*` metrics/featured):

1. **`/sponsors`** — public, read-only "who's sponsoring right now" gallery. Live data from `api.<apex>`.
2. **`/sponsors/finalize?token=<finalize_token>`** — **optional desktop convenience for IAP buyers only.** Magic-link upload page. Single-use, 7-day TTL. Lower priority than the iOS path. **Not used by the grant-claim flow** — see §4.3.
3. **`/s/g/<claim_token>`** — admin grant claim flow. No SSO; claim-token-as-credential. **Does not issue a finalize_token** on successful claim (revised 2026-05-26).
4. **`/admin/uploads`** — image moderation portal. Cloudflare Access gated via admin email allowlist (see [`SPONSORSHIP.md — Admin auth`](../../dirtbikex-sponsors/docs/SPONSORSHIP.md#admin-auth-cloudflare-access--dual-allowlist)). Lists pending custom-image uploads with image preview + slot context + approve/reject actions. Required for Apple Guideline 1.2 (UGC moderation) compliance.

What's **not** on the landing page in v1:
- No slot picker (iOS-only).
- No purchase / checkout (iOS-only — Apple IAP).
- No sponsor stats page (iOS-only via `GET /sponsors/me`).
- No buyer SSO of any kind (no Logto, no CF Access on buyer paths). Buyers authenticate via iOS Discourse session; recipients authenticate via claim-token-in-URL. CF Access is reserved for the operator surface only.

Brand-only sponsors arrive via admin grant. No web-side self-serve for brands in v1.

---

## 3. Inherited constraints

From [`SPONSORSHIP.md`](../../dirtbikex-sponsors/docs/SPONSORSHIP.md) (V1 model + API contract — canonical):

- **Apple IAP only in v1.** No Stripe, no Alipay, no web-side card capture.
- **Forum users only as IAP buyers** in v1. Brand sponsors arrive via admin grant.
- **Bookable months:** `current` (with day-of-month discount mechanic), `current+1`, `current+2`. 3+ months out rejected.
- **No cancellation, no refund.** Surface this in iOS purchase confirmation AND on `/sponsors/finalize` AND on `/s/g/<token>` claim pages.
- **Pricing/SKU:** see [`SPONSORSHIP.md — V1 model`](../../dirtbikex-sponsors/docs/SPONSORSHIP.md#v1-model) (backend-canonical; positionless pool + airtime, Apple IAP SKUs).
- **All locales matter eventually.** New pages live under `[lang]/`; English-only at first, structured to localize.
- **Wire-shape fixtures are test-only**, not runtime-served. See [`SPONSORSHIP.md — API contract`](../../dirtbikex-sponsors/docs/SPONSORSHIP.md#api-contract). Worker code calls the live API; for local dev before sponsorhub is up, import the JSON fixture from the sponsor repo directly.

---

## 4. Routes

### 4.1 `/sponsors` (public)

Live gallery, fetched on page load via the Cloudflare Worker `/api/proxy/sponsors`. Section-grouped grid (hero pool, header strip, featured row, supporter strip). Month selector for `current` / `current+1` / `current+2`.

The "Become a sponsor" CTA points to the **iOS App Store Smart App Banner** to drive install. Actual buy flow happens inside the app after install — no web checkout in v1.

- Forum-user sponsors: avatar links to `forum.<apex>/u/<username>`.
- Brand sponsors with `brand_link_url`: tap opens an "External link" interstitial page (web equivalent of the iOS confirmation alert per [`SPONSORSHIP.md`](../../dirtbikex-sponsors/docs/SPONSORSHIP.md)), then jumps to the brand URL in a new tab.

Replaces the current static-from-TS rendering. Delete `src/data/sponsors.ts`, `src/data/sponsor-validation.ts`, and `src/pages/api/sponsors.json.ts` after sponsorhub serves one full daily refresh cycle without regressions.

### 4.2 `/sponsors/finalize?token=<finalize_token>` (lower-priority desktop convenience)

Magic-link upload page. **Optional** — most buyers should upload from the iOS app where preview is richer and the auth is implicit. This page exists for buyers who designed the asset on desktop and don't want to AirDrop / re-shoot on their phone.

**Auth:** the `finalize_token` URL parameter IS the credential. Token is high-entropy (≥128-bit random), single-use, 7-day TTL.

**Lifecycle:**

1. iOS `POST /bookings` succeeds → sponsorhub returns `{ slot_id, finalize_token }`.
2. iOS displays the token (as a copy-paste URL) on the post-purchase confirmation card. Same URL is in the SES/Brevo receipt email.
3. If the buyer prefers desktop, they open the URL.
4. Server validates the token (exists, not expired, not used), shows the upload widget.
5. On successful upload, server marks `used_at`, slot becomes complete.
6. If expired/used and the buyer wants a new link, iOS app `/sponsors/me` exposes a "Send me a new upload link" action that mints a fresh `finalize_token` and emails it.

**Page contents:**

- Slot summary card: section, slot_order, month(s), tier, paid price, "No refunds" disclosure.
- Custom-image upload widget:
  - File picker, PNG only, ≤500KB (matches the image rules in [`SPONSORSHIP.md`](../../dirtbikex-sponsors/docs/SPONSORSHIP.md)).
  - **Live preview** via a client-side blob URL — the splash render code is also available server-rendered on this page for the preview frame.
  - "Use forum avatar instead" button — POSTs the slot complete with `custom_image_object_key = null`, no upload needed.
- "Upload & finish" CTA → presigned PUT to OCI at the stable key `sponsors/<slot_id>/hero.png` → on PUT success, `POST /uploads/sponsor-image/complete?token=<finalize_token>` marks slot ready and consumes the token.

**Rate limit:** per-token attempt counter in Cloudflare KV. 10 attempts/hour. Defense-in-depth only — the token is single-use and high-entropy, so guessing is infeasible regardless.

### 4.3 `/s/g/<claim_token>` — admin grant claim flow

Mirrors the existing `/s/i/<invite_key>` invite-lookup pattern in [`worker/_lib/inviteLookup.ts`](../worker/_lib/inviteLookup.ts).

**Two grant modes** (per [`SPONSORSHIP.md — Parked for V2`](../../dirtbikex-sponsors/docs/SPONSORSHIP.md#parked-for-v2-in-tree-unwired)):

- `email_pinned` — admin enters `granted_to_email` as a hint. The claim form pre-fills it but the claimer can override (with a soft "this grant was reserved for a different email — proceed anyway?" nudge). Pinning is a UX guardrail, not a security boundary.
- `open` — anyone with the URL can claim; first claim wins. Use for community giveaways.

**Auth model: the claim URL is the credential.** No SSO on the recipient side — claim is unauthenticated. The high-entropy token (≥128-bit) is the access control; operator distribution discipline is the trust model. CF Access is not used here (it gates `/admin/*`, which is operator-only).

**Flow:**

1. Admin runs `sdcup grant ...` (or POSTs `/admin/grants`); sponsorhub returns `claim_token` and the shareable URL `https://www.<apex>/s/g/<claim_token>`.
2. Admin shares via private channel (DM, email, etc.).
3. Recipient opens URL.
4. **Claim page renders** (publicly readable, no auth required):
   - Section / slot / month preview ("Hero pool slot, July 2026").
   - Optional `grant_message_public` if the admin set one.
   - Mode indicator: "Reserved hint: bob@example.com" (email_pinned) or "First-come, first-served" (open).
   - Expiry: "Expires 2026-06-30."
   - **Claim form:**
     - `forum_username` (required) — recipient self-declares; server validates the username exists in Discourse via `GET forum.<apex>/users/<username>.json`. If not found, surface a friendly error.
     - `contact_email` (required) — pre-filled with `granted_to_email` for `email_pinned` mode, editable. Used only for sending the `finalize_token` magic link.
     - "Claim my sponsor slot" submit.
5. Server validates token + Discourse username, creates the `sponsor_slot` row linking to the discovered `discourse_user_id`, marks grant `claimed`. **No `finalize_token` is issued.** Slot goes live at the recipient's default Discourse avatar (`custom_image_object_key = null`, `image_status = 'no_custom'`). Confirmation page tells the recipient: "Your sponsor slot is live. To upload a custom hero image, open the DirtBikeX iOS app and go to Profile → My Sponsorships." Email sent to `contact_email` with the same instructions.
6. Open-mode races: server uses `UPDATE sponsor_slot_grants SET status='claimed' WHERE id=? AND status='pending' RETURNING *`; loser sees 410 Gone.

**Why no `finalize_token` for grants** (revised 2026-05-26): an earlier draft issued one so the claimer could upload a custom image immediately. Split-state hole — if the URL leaks, the leaker can claim under any forum username they know, slot links to that user's `discourse_user_id`, but the leaker retains the upload token. End state: the named recipient owns the slot, the leaker controls the image. Dropping `finalize_token` from this path forces image uploads through the Discourse-session-authenticated iOS path (`POST /uploads/sponsor-image`, which checks `discourse_user_id == caller_id`). A leaked claim URL can still mis-name the slot, but the leaker can no longer publish an image on it.

**Expiry:** `expires_at = LEAST(created_at + 30 days, granted_month - 1 day)`.

- July grant created May 1 → expires May 31 (30-day rule wins).
- July grant created June 25 → expires June 30 (day-before-month wins).

A nightly job flips expired pending grants to `expired` and reopens the slot to inventory.

**Visibility rules:**

- `grant_reason_internal` is **never** shown on the claim page or anywhere recipient-facing. Audit-log only.
- `grant_message_public` is optional, surfaced on the claim page if set.

Recipient SSO is deferred (see [`SPONSORSHIP.md — Parked for V2`](../../dirtbikex-sponsors/docs/SPONSORSHIP.md#parked-for-v2-in-tree-unwired) for rationale).

### 4.4 `/admin/uploads` — image moderation portal

Pre-publish admin review of custom sponsor images. Required by Apple Guideline 1.2 (UGC moderation). Lifecycle + render rules in [`SPONSORSHIP.md — Parked for V2`](../../dirtbikex-sponsors/docs/SPONSORSHIP.md#parked-for-v2-in-tree-unwired).

**Auth:** Cloudflare Access (admin email allowlist; see [`SPONSORSHIP.md — Admin auth`](../../dirtbikex-sponsors/docs/SPONSORSHIP.md#admin-auth-cloudflare-access--dual-allowlist)). Same gate as sponsorhub `/admin/*`. Operator-only surface.

**Page layout:**

- **Pending queue** (top section): all `sponsor_slots` with `image_status = 'pending'`, ordered oldest-first. Each row:
  - Image preview (full size + thumbnail).
  - Slot context: section, slot_order, month, tier, sponsor identity (forum username or brand name).
  - Upload time + "x hours since uploaded" pill.
  - Approve button (primary) → `POST api.<apex>/admin/uploads/<slot_id>/approve` → `image_status = 'approved'`, triggers immediate `/sponsors.json` rebuild server-side, optional approval email to buyer.
  - Reject button + reason text field → `POST api.<apex>/admin/uploads/<slot_id>/reject {reason}` → `image_status = 'rejected'`, `custom_image_object_key = null`, OCI object DELETE, rejection email to buyer with the operator-provided reason.
- **Recently approved / rejected** (collapsed section): last 30 days, for audit reference. Same fields, no action buttons.

**Throughput expectations:** <10 reviews/week at MVP volume (<50 paying sponsors, most opting for default forum avatar). Operator attention cost is low.

**Notification of new uploads:** when an upload flips a slot to `pending`, sponsorhub enqueues an email + optional iOS push to the operator's account. Operator can also just refresh `/admin/uploads` periodically — the queue is small.

**Pagination:** none in v1. If the pending queue exceeds 50 entries (operational alarm), revisit.

**iOS surface for buyer:** the "My sponsorships" screen renders the slot's `image_status` so the buyer sees `pending review → approved` (or `rejected → please re-upload`) without polling the admin.

---

## 5. Data flow

```
              ┌──────────────────────────────-┐
              │ www.<apex>  (Cloudflare       │
              │   Worker, Astro assets)       │
              │                               │
              │  /sponsors                    │
              │  /sponsors/finalize?token=<>  │
              │  /s/g/<claim_token>           │
              │                               │
              │  Worker /api/proxy/sponsors ──┤
              │  Worker /s/g/:token ──────────┤
              │  Worker /s/i/:key (existing)  │
              └───────────────────────────────┘
                                          │
                            HTTPS         ▼
              ┌──────────────────────────────────────┐
              │ api.<apex>  (Caddy → sponsorhub)     │
              │   /sponsors.json                     │
              │   /leaderboard/{period}.json         │
              │   /availability                      │
              │   /bookings (POST, iOS-only caller)  │
              │   /uploads/sponsor-image (presign)   │
              │   /sponsors/me   (iOS stats)         │
              │   /events  (iOS impression/tap)      │
              │   /s/g/<token> + claim               │
              │   /admin/*                           │
              │   /webhooks/apple                    │
              └──────────────────────────────────────┘
                            │
                            ▼
                      sponsorhub + Postgres (own DB)
                            │
                            ▼
                      OCI Object Storage
                      (dirtbikex-forum-uploads/sponsors/)
```

Landing page stays static-built (Astro pre-render). Anything dynamic goes through the Cloudflare Worker, which proxies to `api.<apex>`. No Astro SSR commitment.

**Worker responsibilities** vs today:

1. Existing: `/s/i/:key` invite lookup against Discourse.
2. New: `/api/proxy/sponsors` — server-side fetch from `api.<apex>/sponsors.json` for the public gallery.
3. New: `/s/g/:token` (page render proxy) and `/s/g/:token/claim` (POST proxy to sponsorhub).
4. New: `/sponsors/finalize?token=<>` page support — fetches slot metadata from sponsorhub via the token, hands the upload widget the presigned PUT URL.

`wrangler.jsonc` env-split already exists (`forum.dirtbikex.com` prod, `forum.dirtbikechina.com` preview). Mirror to API: prod Worker → `api.dirtbikex.com`, preview Worker → `api.dirtbikechina.com`.

---

## 6. The iOS → web handoff (single-use token)

**Flow:**

1. User opens iOS app, picks section + slot + month + duration, taps Buy.
2. StoreKit 2 IAP completes. iOS posts `/bookings` with `{product_sku, apple_signed_transaction_payload, section, slot_order, months}`.
3. sponsorhub validates the receipt, creates `payments` + `sponsor_slots` rows in one transaction, mints a `finalize_token` (single-use, 7-day TTL), returns `{slot_id, finalize_token}`.
4. iOS shows a confirmation card with three buttons:
   - **"Upload custom image here"** → native iOS picker + live preview, POSTs `/uploads/sponsor-image` authenticated by Discourse session. The buyer never has to touch the web.
   - **"Upload from desktop later"** → copy URL to clipboard (the magic link). The same URL is in the receipt email.
   - **"Use my forum avatar"** → POSTs `slot.complete?slot_id=<>&use_forum_avatar=true` with the Discourse session, dismisses.
5. If the buyer takes the desktop path: opens the magic link on any browser, validates server-side, uploads, slot completes.

**The `finalize_token` is single-purpose: desktop upload.** It does NOT grant access to stats or any other action. iOS stats use `GET /sponsors/me` authenticated by Discourse session — totally separate concern.

---

## 7. Auth model

| Surface | Auth |
|---|---|
| `/sponsors` (public gallery) | None — public |
| `/sponsors/finalize?token=<>` (desktop upload, **IAP path only**) | `finalize_token` in URL; single-use; 7-day TTL |
| `/s/g/<token>` (claim page render) | None — public read |
| `/s/g/<token>/claim` (claim action) | `claim_token` in URL; no SSO; recipient self-declares forum username (server-validated against Discourse); **no token returned** |
| iOS `POST /bookings` | Discourse session token (already wired) |
| iOS `POST /uploads/sponsor-image` (direct upload — both IAP buyers AND grant recipients) | Discourse session token; slot ownership check via `discourse_user_id == caller_id` |
| iOS `GET /sponsors/me` (stats) | Discourse session token |
| `/admin/uploads` (image moderation portal) | Cloudflare Access (admin email allowlist; see [`SPONSORSHIP.md — Admin auth`](../../dirtbikex-sponsors/docs/SPONSORSHIP.md#admin-auth-cloudflare-access--dual-allowlist)) |
| `/admin/*` (grants, slot edits, revocation) | Cloudflare Access (same allowlist; Worker reads `Cf-Access-Authenticated-User-Email` and forwards it as `X-Admin-Email` to sponsorhub, which also validates it against `ADMIN_EMAILS`; CLI uses a CF Access Service Token) |
| `sdcup grant` CLI | Cloudflare Access Service Token (Client-ID + Client-Secret; same dashboard) |

**Cloudflare Access's role:** operator admin only (`/admin/*` and `/admin/uploads`). Not on the recipient side, not on the buyer side. Smallest auth surface possible for v1. Logto is **not** used for v1 sponsor admin — see [`SPONSORSHIP.md — Admin auth`](../../dirtbikex-sponsors/docs/SPONSORSHIP.md#admin-auth-cloudflare-access--dual-allowlist) for rationale.

---

## 8. OCI bucket setup

The existing [`infra/bucket.sh`](../../../bucket.sh) provisions `dirtbikex-forum-uploads` (used by Discourse). Sponsor images live in the same bucket under a `sponsors/` prefix per [`SPONSORSHIP.md`](../../dirtbikex-sponsors/docs/SPONSORSHIP.md).

Status of the three original additions:

1. **IAM user `sponsorhub-s3`** + scoped policy on the `sponsors/*` prefix only — **SHIPPED** via [`infra/bucket-sponsorhub.sh`](../../../bucket-sponsorhub.sh). Don't reuse the `discourse-s3` principal — keeps blast radius scoped.
2. **CORS** — **not configurable on OCI Object Storage.** OCI returns fixed, non-editable CORS headers; `PutBucketCors` is absent from the S3-compat operation set (see `bucket-sponsorhub.sh:95-103` for explanation). If a presigned PUT needs an origin OCI's fixed headers don't allow, proxy the upload through the Worker/sponsorhub rather than going straight to OCI from the browser.
3. **Stable per-slot key** `sponsors/<slot_id>/hero.png` — overwrites on re-upload, no version sprawl.

iOS cache-bust via `?v=<updated_at_epoch>` server-stamped on the URL inside `/sponsors.json`. Same OCI object key, different cache entry.

---

## 9. What to retire

- `src/data/sponsors.ts` — **DELETE** (TS array no longer source of truth)
- `src/data/sponsor-validation.ts` — **DELETE** (validation moves to sponsorhub admin write path)
- `src/pages/api/sponsors.json.ts` — **DELETE** (iOS reads `api.<apex>` directly; web reads via Worker proxy)
- `src/lib/sponsor-types.ts` — **KEEP** (already at this path; useful for typing Worker fetch results)
- `public/sponsors/` static images — **ALREADY GONE** (deleted; OCI is now the upload target)

Cut once sponsorhub serves all sponsor JSON for at least one full daily refresh cycle in prod without regressions.

---

## 10. Phased rollout (web side)

| Phase | What ships | Verifies | V1 status |
|---|---|---|---|
| **L1. Worker proxy** | `/api/proxy/sponsors` against `api.dirtbikechina.com` preview first | Worker can fetch sponsorhub server-side | **SHIPPED** (commit `7df285d`) — active in V1 |
| **L2. `/sponsors` refactor** | page reads via Worker proxy; month selector; CTA points to App Store Smart App Banner | live data on the public page; no buy flow yet | **SHIPPED** (commit `7df285d`) — active in V1 |
| **L3. OCI prefix + presigned uploads** | `sponsorhub-s3` IAM user shipped (`bucket-sponsorhub.sh`); CORS not configurable on OCI (see §8); `/uploads/sponsor-image` presign endpoint parked backend-side | presigned PUT works from iOS; browser-direct may need Worker proxy | **PARTIAL** — IAM shipped; backend endpoint parked for V2 |
| **L4. `/admin/uploads` moderation portal** | Cloudflare Access gated page (admin email allowlist; see [`SPONSORSHIP.md — Admin auth`](../../dirtbikex-sponsors/docs/SPONSORSHIP.md#admin-auth-cloudflare-access--dual-allowlist)); approve/reject actions; OCI DELETE on reject | operator can clear the pending queue; audit log captures actor email | **SHIPPED** web side (commit `7df285d`) — **dormant in V1** (backend endpoint parked) |
| **L5. `/sponsors/finalize?token=<>`** | IAP-path-only magic-link upload page; single-use token validation; upload flips slot to `pending` | end-to-end test with a dev-mode booking | **SHIPPED** web side (commit `7df285d`) — **dormant in V1** (backend endpoint parked) |
| **L6. `/s/g/<token>` claim flow** | both `email_pinned` and `open` grant modes; no SSO; **no `finalize_token` returned** | admin can grant + recipient can claim, both modes | **SHIPPED** web side (commit `7df285d`) — **dormant in V1** (backend endpoint parked) |
| **L7. Retire static surface** | delete files listed in §9 | sponsorhub is sole source of truth | **REMAINS** |

**iOS in-app upload (the primary path) is in [`SPONSORSHIP.md`](../../dirtbikex-sponsors/docs/SPONSORSHIP.md) — it ships in iOS phase 4 independent of web phase L5.** L5 is the desktop convenience and is lower priority; ship after L4 (moderation portal) lands, but don't gate the iOS launch on it. **L4 (moderation portal) IS required before any custom-image upload can go live** — without it there is no way to approve images, and the splash never renders them.

---

## 11. What's deferred (next planning round)

- **Web-side buy flow.** Returns when Stripe/Alipay come online (the original web-first buy flow, retired 2026-05-25, is in git history if needed as a starting reference).
- **Web sponsor stats dashboard.** Returns with the Stripe/Alipay phase. v1 = iOS-only via `GET /sponsors/me`. Brand sponsors get stats via operator email until then.
- **`/sponsor/<username>` per-sponsor mini-profiles.** Low priority; gallery already provides visibility.
- **Discord-style social proof on `/sponsors`.** "X new sponsors this month" badges, hover-to-see-recent-activity, etc. Wait for product signal.
- **Brand self-serve buy.** Admin grant only in v1.
- **Recipient-side SSO on claim.** Reconsider if we observe abuse of the claim-URL-as-credential model (wrong-recipient claims that hurt sponsors). The schema is forward-compatible — adding any SSO (Logto, CF Access, Discourse session, etc.) later is a server-side change, not a URL change.

---

## 12. Open questions

1. **Rate-limit values.** `/sponsors/finalize?token=<>` proposed at 10/hr/token, /IP. `/s/g/<token>/claim` proposed at 5/hr/token, /IP. Confirm or override.
2. **Where the `finalize_token` magic-link is shown on iOS.** Post-purchase confirmation card AND recoverable from `/sponsors/me` "Send me a new upload link"? Default yes to both.
3. **KV key structure for rate limit.** Token-scoped (`ratelimit:finalize:<token>`, `ratelimit:claim:<token>`) plus IP-scoped (`ratelimit:ip:<ip>`) for bot defense? Default yes.
4. **Refund handling UX (flagged for next iteration).** Apple lets buyers request a refund within ~48h of purchase regardless of our "no refund" policy. The ASSN-v2 `REFUND` webhook is the system-level fallback ([`SPONSORSHIP.md`](../../dirtbikex-sponsors/docs/SPONSORSHIP.md)), which flips `payments.status = 'revoked'` → next `/sponsors.json` drops the slot. Open: how the iOS "My sponsorships" surface presents `status = 'refunded'`, buyer notification on refund, whether to auto-DELETE the OCI image on REFUND, brand-sponsor-style operator manual recovery. Not blocking MVP; iterate next round.
5. **Auto-moderation pre-filter for L4.** Optional Cloudflare image classification (or similar) to flag obvious NSFW before queueing. Deferred — manual review at MVP volume is fine.

Questions 1, 3 unblock L4/L5. Questions 2, 4, 5 are non-blocking refinements.
