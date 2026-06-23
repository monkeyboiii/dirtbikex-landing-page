# Join Module

Double-opt-in email waitlist at `dirtbikex.com/join`. Builds a **consent-first**
subscriber list so outreach is opted-in (the app is already live; the list is for
early-supporter perks + feature drops, not a launch countdown). The opt-in page
lives on the marketing site (keeps header/footer chrome); the confirmation email
sends from a **separate domain** (`joindirtbikex.com`) to isolate sending reputation.

```text
/join (static Astro page, chrome)
  └─ POST /api/join {email,locale}  ─► D1 upsert 'pending' + token ─► Resend confirmation email
GET /join/confirm?token  ─► D1 'pending'→'confirmed' ─► 302 /join?state=confirmed
GET|POST /api/unsubscribe?token  ─► D1 →'unsubscribed'  (POST = RFC 8058 one-click)
```

## Module layout

| Concern | Where | Notes |
|---|---|---|
| Page (EN + locales) | [src/pages/join.astro](../src/pages/join.astro), [src/pages/[lang]/join.astro](../src/pages/[lang]/join.astro) | wrap `BaseLayout` (chrome) + `JoinBody`; locale mirror via `getStaticPaths` |
| Form + states UI | [src/components/JoinBody.astro](../src/components/JoinBody.astro) | hero shell; scoped styles (theme tokens); inline script does `fetch` + `?state` switching |
| Copy (21 langs) | [src/i18n/locales/*.json](../src/i18n/locales/) | `join.*` keys; `UIKey = keyof typeof en` so EN is the source of truth, others fall back |
| Worker handlers | [worker/_lib/join.ts](../worker/_lib/join.ts) | plain: `handleJoinSubmit` / `handleJoinConfirm` / `handleUnsubscribe` + `sendConfirmationEmail`. Invites: `handleCodePrecheck` / `redeemInvite` / `sendInviteEmail` (Resend) |
| Route dispatch | [worker/index.ts](../worker/index.ts) | matches `/api/join`, `/api/join/code`, `/join/confirm`, `/api/unsubscribe` before the `ASSETS` fallthrough |
| Env + D1/R2 types | [worker/_lib/types.ts](../worker/_lib/types.ts) | `PagesEnv` join fields + minimal `D1Database` / `R2Bucket` interfaces |
| Rate limit (reused) | [worker/_lib/rateLimit.ts](../worker/_lib/rateLimit.ts) | `rateLimitConsume(kv,key,limit,window)` — shared with the SMS gateway |
| D1 schema | [0001_subscribers.sql](../migrations/0001_subscribers.sql), [0002_special_invites.sql](../migrations/0002_special_invites.sql) | `subscribers`; `invite_kinds` + `invite_codes` |
| QR images | R2 bucket `dbx-qr` (`QR_BUCKET`) | `qr/<kind>/<locale>.png`, en fallback; rotate with `admin.mjs upload-qr` (no deploy) |
| Admin CLI | [scripts/admin.mjs](../scripts/admin.mjs) | `mint` / `codes` / `subs` / `kinds` / `upload-qr` over wrangler (reuses your login) |
| Bindings / vars / routes | [wrangler.jsonc](../wrangler.jsonc) | `SUBSCRIBERS_DB`, `QR_BUCKET`, `run_worker_first`, `JOIN_*` vars (prod + preview) |
| Cache headers | [public/_headers](../public/_headers) | `/join/confirm` + `/api/unsubscribe` → `no-store` |

## Architecture decisions

### Page on `dirtbikex.com/join`; email sends from `joindirtbikex.com`
The opt-in page is a path on the marketing site so it inherits `BaseLayout` chrome
with zero new DNS/Workers-route/cert. The *sending* domain is separate so a cold/
bulk reputation hit never touches `dirtbikex.com`'s app/forum/transactional mail.
**NOT done:** no `join.` subdomain (would be a separate origin needing duplicated
chrome). **Invalidates if:** the page needs to live off the marketing origin.

### Double opt-in, stored in D1
A subscriber is `pending` until they click the emailed confirm link → `confirmed`.
Only `confirmed` rows are mailable. This is the consent record that keeps the list
ESP-compliant and defensible under GDPR/ePrivacy. **NOT done:** no welcome email
after confirm; no marketing send pipeline here (this module only captures consent).
**Invalidates if:** a regulator/ESP accepts single opt-in for this list (unlikely).

### One persistent per-row `token` for confirm *and* unsubscribe
Each row gets one random `token` (`crypto.randomUUID()`), used for both the confirm
link and the one-click unsubscribe link, and **not cleared on confirm** so the
unsubscribe link in the confirmation email keeps working afterward. **NOT done:** no
separate confirm/unsub tokens, no expiry column (a stale token just re-confirms or
unsubscribes — both idempotent). **Invalidates if:** tokens need TTL/rotation.

### Static page + worker routes; result states via `?state=`
Astro is `output:'static'`; the worker only runs for `run_worker_first` paths. The
confirm/unsubscribe routes mutate D1 then **302 back to `/join?state=…`**, and the
one page renders form / sent / confirmed / expired / unsubscribed from that query —
so there are no extra result pages and the script is one inline block. **NOT done:**
no SSR, no per-state routes. **Invalidates if:** states need their own URLs/SEO.

### Resend for the confirmation email
Workers can't open SMTP, so the email goes over an HTTPS API. Resend: one `fetch`,
generous free tier, easy DKIM on `joindirtbikex.com`. The first email carries the
strict standard — physical address, `List-Unsubscribe` (one-click HTTPS + mailto),
`List-Unsubscribe-Post`, real `Reply-To`. **NOT done:** not MailChannels (free tier
ended), not SES (SigV4 in-worker + sandbox gate). **Invalidates if:** volume needs a
dedicated-IP/contacts provider.

### Rate-limit warn-and-allows when KV is unbound
Unlike the SMS gateway (which fails closed without `RATELIMIT_KV`), a sign-up only
logs `join:no_ratelimit_kv` and proceeds — a missing-binding config gap shouldn't
block opt-ins. Missing `SUBSCRIBERS_DB`, by contrast, returns 503 (can't function).
**Invalidates if:** abuse forces a hard dependency on the limiter.

### Preview shares the prod D1
Only one database exists (`dbx-subscribers`), so both the prod and `preview` envs
bind `SUBSCRIBERS_DB` to it — preview test sign-ups land in the prod table. **NOT
done:** no `dbx-subscribers-preview` created. **Invalidates if:** preview noise
pollutes the real list — then create the preview DB and swap only the preview id.

### Special invites: codes in D1, QR in R2, config rotatable with no deploy
Influencer outreach sends a single-use `…/join?c=<code>` link. The code maps (via
`invite_kinds`) to one of three kinds — `holeshot_crew` / `track_stewards` / `plain`
— each carrying a `label` + a static per-kind `invite_url`; the QR is a per-locale
R2 object (`qr/<kind>/<locale>.png`, en fallback). On submit, `redeemInvite` does a
**race-safe claim** — `UPDATE invite_codes … WHERE used_count<max_uses AND not-expired
RETURNING kind` — so two concurrent submits can't both win; on a Resend failure the
claim is **released** so a code is never burned without an email. The QR + link are
delivered immediately; the email's confirm CTA is the list opt-in (a confirmed
subscriber still gets the QR and is never downgraded). **Why this shape:** links and
QRs rotate on their own (longer-lived than codes), so they're **data** — `invite_url`
is a D1 `UPDATE`, the QR is an R2 `put` — never a code change, never a redeploy.
**NOT done:** no per-influencer Discourse minting (the QR is static per kind, so the
link must match it); no per-locale `invite_url` (one URL + `?lang=auto`); no expiry on
the per-row token. **Invalidates if:** links must be unique per influencer (then mint
per redemption and drop the static-QR assumption).

## Routes, schema, config

**Routes** (all in [worker/index.ts](../worker/index.ts) → [worker/_lib/join.ts](../worker/_lib/join.ts)):

| Method · path | Does | Returns |
|---|---|---|
| `POST /api/join` | validate · rate-limit · upsert `pending`+token · send confirm | `200 {ok}` · `400/429/502/503` |
| `POST /api/join` `{code}` | claim invite code (race-safe) · send QR + link + confirm | `200 {ok,invite}` · `409 code_invalid` · `502` |
| `GET /api/join/code?c=` | precheck a code (no claim) — page theming / dead-link reject | `200 {valid,kind,label}` |
| `GET /join/confirm?token` | `pending`→`confirmed` (idempotent) | `302 → /<locale>/join?state=confirmed` (or `=expired`) |
| `GET /api/unsubscribe?token` | →`unsubscribed` | `302 → …?state=unsubscribed` |
| `POST /api/unsubscribe?token` | →`unsubscribed` (one-click) | `200` text |

**`subscribers`** ([migrations/0001_subscribers.sql](../migrations/0001_subscribers.sql)):
`email` (PK, lowercased) · `status` (`pending`/`confirmed`/`unsubscribed`) · `token`
(unique) · `locale` · `source` · `created_at` · `confirmed_at` · `unsubscribed_at`.

**`invite_kinds`** + **`invite_codes`** ([migrations/0002_special_invites.sql](../migrations/0002_special_invites.sql)):
`invite_kinds(kind PK, label, invite_url)` — 3 seeded rows; rotate with `admin.mjs kinds set`.
`invite_codes(code PK, kind, campaign, max_uses, used_count, expires_at, created_at, redeemed_email, redeemed_at)` — mint with `admin.mjs mint`.

**Env** ([wrangler.jsonc](../wrangler.jsonc) `vars`, + one secret):

| Key | Example | Notes |
|---|---|---|
| `RESEND_API_KEY` | *(secret)* | `wrangler secret put` — **not** in wrangler.jsonc |
| `JOIN_FROM_EMAIL` | `DirtBikeX <team@joindirtbikex.com>` | must be a Resend-verified domain |
| `JOIN_REPLY_TO` | `support@dirtbikex.com` | monitored inbox; also the mailto unsubscribe |
| `JOIN_ORG_ADDRESS` | `DirtBikeX LLC, …, Sheridan, WY …` | CAN-SPAM footer |
| `MARKETING_BASE` | `https://www.dirtbikex.com` | absolute confirm/unsubscribe link host |
| `SUBSCRIBERS_DB` | D1 binding | `dbx-subscribers` (holds subscribers + invite_kinds/codes) |
| `QR_BUCKET` | R2 binding | `dbx-qr` — per-locale QR images for invites |
| `RATELIMIT_KV` | KV binding | optional in prod (warn-and-allow) |

## Operator setup

```sh
# 1. D1 database (once) → paste the printed database_id into wrangler.jsonc (prod + preview).
pnx wrangler d1 create dbx-subscribers

# 2. Apply the schema (remote). Prod + preview share this DB, so once is enough.
pnx wrangler d1 execute dbx-subscribers --remote --file ./migrations/0001_subscribers.sql
pnx wrangler d1 execute dbx-subscribers --remote --file ./migrations/0002_special_invites.sql

# 2b. R2 bucket for invite QR images (once).
pnx wrangler r2 bucket create dbx-qr

# 3. Resend: verify joindirtbikex.com (SPF/DKIM/DMARC) in the Resend dashboard, then:
pnx wrangler secret put RESEND_API_KEY            # repeat with --env preview

# 4. (optional) prod rate-limit KV → paste id into wrangler.jsonc kv_namespaces.
pnx wrangler kv namespace create RATELIMIT_KV

# 5. Deploy.
pnpm build:prod && pnx wrangler deploy
pnpm build:dev  && pnx wrangler deploy --env preview

# Day-to-day admin (admin.mjs reuses your wrangler login; append --env preview for preview).
node scripts/admin.mjs subs --list                              # counts + confirmed emails
node scripts/admin.mjs mint --kind holeshot_crew --campaign alice --count 5   # → prints /join?c= links
node scripts/admin.mjs codes --campaign alice                   # redemption status
node scripts/admin.mjs kinds set --kind plain --url "https://www.dirtbikex.com/s/i/<key>?lang=auto"
node scripts/admin.mjs upload-qr ./qr                           # walks ./qr/<kind>/<locale>.png → R2
```

DNS: `joindirtbikex.com` gets Resend's SPF/DKIM/DMARC. `MARKETING_BASE` must match
where the worker actually serves (so the emailed confirm/invite link resolves).

**Rotation (no deploy):** invite links and QR images outlive codes, so they're data,
not config. Rotate a link → `admin.mjs kinds set --kind … --url …` (D1 `UPDATE`); add/
replace a QR → `admin.mjs upload-qr ./qr` or drag-drop in the R2 dashboard. Both apply
to all future redemptions immediately; only worker *code* changes need a redeploy.

## Debugging

- **`/api/join` → 502 `send_failed`** — Resend rejected. Check `RESEND_API_KEY` set, `joindirtbikex.com` verified in Resend, `JOIN_FROM_EMAIL` on that domain. Worker logs `join:resend_non_2xx`/`join:email_misconfigured`.
- **`/api/join` → 503 `service_misconfigured`** — `SUBSCRIBERS_DB` not bound / wrong id. `wrangler d1 list` vs wrangler.jsonc.
- **Binding present but queries fail** — binding name must be exactly `SUBSCRIBERS_DB` (code reads `env.SUBSCRIBERS_DB`); `wrangler d1 create` auto-suggests a name-derived binding (`dbx_subscribers`) — rename it.
- **Confirm link always lands on `?state=expired`** — token not found: schema not applied (`num_tables=0`), or pointing at the wrong DB id.
- **Email never arrives** — pre-verification: Resend domain unverified → sends rejected; post: check spam, and that DKIM/DMARC pass (the strict footer + `List-Unsubscribe` help inbox placement).
- **429 `rate_limited`** — per-email 3/day or per-IP 10/hr hit; or test from a fresh address.
- **`?c=` link shows "isn't valid" / `409 code_invalid`** — code used, expired, or unknown. `admin.mjs codes --campaign …` shows `used_count`/`expires`. Mint a fresh one.
- **Invite email has no QR attached** — no R2 object for that kind/locale and no `qr/<kind>/en.png` fallback. `admin.mjs upload-qr ./qr`; the link still sends, the attachment doesn't.
- **Invite email has no link** — `invite_kinds.invite_url` empty for that kind. `admin.mjs kinds set --kind … --url …`.

## Manual verification

1. `pnx wrangler deploy --env preview --dry-run` → bundles, lists `env.SUBSCRIBERS_DB (dbx-subscribers)`.
2. Submit a real address at `/join` → UI flips to "Check your inbox"; row appears `pending` (`SELECT * FROM subscribers`).
3. Open the emailed link → redirected to `/join?state=confirmed`; row is `confirmed` with `confirmed_at`.
4. Re-submit the same address → `200 {status:confirmed}`, **no** second email (idempotent).
5. Click unsubscribe in the email → row `unsubscribed`; one-click `POST /api/unsubscribe` returns 200.
6. **Invite:** `admin.mjs kinds set --kind plain --url …`, `upload-qr ./qr` (with `plain/en.png`), `mint --kind plain --campaign test` → open the printed `/join?c=…` (hero reframes to the invite) → submit a test address → invite email arrives with the QR attached + link → re-open the same link → "isn't valid" (single-use consumed).

## Tests

Covered by the existing Playwright suite over built pages: [tests/no-external-assets.spec.ts](../tests/no-external-assets.spec.ts) (the page adds only inline/scoped assets) and [tests/locale-routing.spec.ts](../tests/locale-routing.spec.ts) (`/join` + `/<locale>/join`). **Not covered:** worker handler logic (no worker test harness in-repo) — the numbered smoke above is the gate; `wrangler deploy --dry-run` bundles it.
