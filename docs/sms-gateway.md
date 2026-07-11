# SMS Gateway (`/api/logto/sms`)

Cloudflare Worker endpoint that backs Logto's HTTP SMS connector. Routes by country (CN → Aliyun, US → AWS SNS), enforces a seven-bucket quota stack in KV, returns the HTTP status codes Logto expects. Lives **inside the landing-page Worker** at `www.dirtbikex.com` (prod) / `www.dirtbikechina.com` (preview) — not a separate worker.

Engineer orientation: read this before touching `worker/_lib/logtoSms.ts` or its callees.

---

## Status

> **NOT IN USE (as of 2026-07-11).** The gateway has never been wired into the live Logto tenant and has had **no end-to-end test** (no real OTP has been sent through it). Treat everything below as built-but-unverified until the operator checklist completes and an E2E send is confirmed per country.

Code (worker side) is complete; secrets + DNS + Logto admin + Brevo steps below are operator tasks.

- [x] Worker handler, phone normalization, quota stack, Aliyun + AWS providers, dispatch in `index.ts`.
- [x] `wrangler.jsonc` declares `RATELIMIT_KV` binding + non-secret vars.
- [x] `aws4fetch@^1.0.20` in `package.json` — run `pnpm install` if not yet done.
- [x] Preview `RATELIMIT_KV` namespace id set in `wrangler.jsonc`.
- [ ] Uncomment + fill the prod `RATELIMIT_KV` id in `wrangler.jsonc` (run `wrangler kv namespace list` to get it).
- [ ] Set the 5 secrets per env (see [Secrets](#secrets)).
- [ ] Provision Aliyun sign-name + template; fill the two `ALIYUN_SMS_*` vars.
- [ ] Configure Logto HTTP SMS connector (see [Logto](#logto-admin-config)).
- [ ] Publish null MX on `phone.dirtbikex.com` + `phone.dirtbikechina.com`; add Brevo suppression.
- [ ] Confirm Discourse `must_approve_users` + email-confirmation gates are off (these would block phone-OTP signups since Logto is the trust root).

---

## Architecture decisions worth knowing

1. **Colocated with the marketing worker, not a dedicated `hooks.*` worker.** Reuses the existing deploy pipeline, custom domains, and `RATELIMIT_KV`. Trade-off: SMS shares uptime with the marketing site — acceptable for the current scale.
2. **KV sliding-window quota, not Durable Objects.** Seven buckets (phone-min, ip-10m, phone-day, ip-day, country-day, provider-day, global-day) each one `rateLimitConsume()` call from [`worker/_lib/rateLimit.ts`](../worker/_lib/rateLimit.ts). Daily buckets are keyed by UTC `YYYYMMDD` so all colos roll over together. KV cross-colo lag can leak ~1–2 sends past a cap; provider-side cost caps are the real backstop.
3. **Phone-only users get a synthetic `<msisdn>@phone.dirtbikex.com` email** so Discourse's `users.email NOT NULL` constraint is satisfied. The subdomain has an RFC 7505 null MX (`MX 0 .`); Brevo additionally suppresses the domain so non-deliverability never inflates the sender's bounce rate. Discourse email features for these users (welcome, digests, notifications) silently no-op — see [Concerns](#concerns).
4. **Handcrafted E.164 parsing for CN/US only.** `libphonenumber-js/min` is ~50 KB and overkill for two countries with crisp formats. Adding a country is documented below and stays under ~10 lines.
5. **Fail-closed when `RATELIMIT_KV` is unbound.** The SMS handler returns 503 — auth flows must not silently bypass abuse caps. (The old finalize/claim routes this was once contrasted against were removed with sponsorhub's web-claim flow.)
6. **Aliyun signature v1 (HMAC-SHA1), not v3.** v3's canonical-headers step adds nothing for one hand-built request; v1 is ~40 lines of Web-Crypto.

---

## File map (impl reference)

All paths relative to the submodule root (`submodules/dirtbikex-landing-page/`).

| File | Role |
| --- | --- |
| `worker/index.ts` | Dispatch: `POST /api/logto/sms → handleLogtoSms`. |
| `worker/_lib/logtoSms.ts` | Auth (bearer, constant-time), payload parse, route to provider, return 200/400/401/403/429/502/503. |
| `worker/_lib/phone.ts` | `normalizePhone(raw) → {e164, country}`; `parseAllowedCountries(csv)`. Edit here to add countries. |
| `worker/_lib/smsQuota.ts` | `SMS_QUOTAS` table, `PROVIDER_FOR` country→provider map, `checkSmsQuota()` runs all buckets in order. |
| `worker/_lib/rateLimit.ts` | Sliding-window KV rate-limit helper (used by the SMS gateway and join flow; the finalize/claim routes that originally shared it are gone). |
| `worker/_lib/providers/aliyun.ts` | `SendSms` over RPC v1 signature; reads `ALIYUN_*` env. |
| `worker/_lib/providers/aws.ts` | SNS `Publish` via `aws4fetch` SigV4; reads `AWS_*` env. Transactional SMSType. |
| `worker/_lib/types.ts` | `PagesEnv` declares every binding/secret consumed. |
| `wrangler.jsonc` | `run_worker_first` includes `/api/logto/*`; `kv_namespaces` binds `RATELIMIT_KV`; non-secret SMS vars (sign-name, template code, region). |

### Request contract

```http
POST /api/logto/sms
Authorization: Bearer <LOGTO_SMS_TOKEN>
Content-Type: application/json

{"to": "+8613800138000", "payload": {"code": "123456", "type": "SignIn"}}
```

Response is always JSON. Key status codes and bodies:

| Status | Body example | Meaning |
| --- | --- | --- |
| `200` | `{"ok":true}` | Accepted by provider. |
| `400` | `{"error":"invalid_phone"}` | Phone not a valid CN/US number. |
| `400` | `{"error":"bad_payload","reason":"missing to/payload.code"}` | Missing fields. |
| `401` | `{"error":"unauthorized"}` | Bad or missing Bearer token. |
| `403` | `{"error":"country_blocked","country":"GB"}` | Country not in `LOGTO_SMS_ALLOWED_COUNTRIES`. |
| `429` | `{"error":"rate_limited","scope":"phone_minute"}` | Quota hit; `scope` names which bucket. |
| `502` | `{"error":"provider_failed","provider":"aliyun","code":"..."}` | Provider rejected the send. |
| `503` | `{"error":"service_misconfigured"}` | `RATELIMIT_KV` not bound. |

Any non-2xx makes Logto fail the OTP.

---

## Config steps

### Secrets

Per env, via `wrangler secret put … [--env preview]`:

```
LOGTO_SMS_TOKEN              # random 32+ char string, also pasted into Logto connector
ALIYUN_ACCESS_KEY_ID         # RAM user with AliyunDysmsFullAccess (or narrower)
ALIYUN_ACCESS_KEY_SECRET
AWS_ACCESS_KEY_ID            # IAM user with sns:Publish on `arn:aws:sns:*:*:*`
AWS_SECRET_ACCESS_KEY
```

Non-secret `vars` live in `wrangler.jsonc`: `LOGTO_SMS_ALLOWED_COUNTRIES`, `ALIYUN_REGION`, `ALIYUN_SMS_SIGN_NAME`, `ALIYUN_SMS_TEMPLATE_CODE`, `AWS_SNS_REGION`, optional `AWS_SNS_SENDER_ID`, optional `LOGTO_SMS_GLOBAL_DAILY_CAP`.

### KV namespace

If `RATELIMIT_KV` doesn't exist yet:

```sh
wrangler kv namespace create RATELIMIT_KV               # prints prod id
wrangler kv namespace create RATELIMIT_KV --env preview # prints preview id
```

Paste the prod id into the commented-out `kv_namespaces` block in the top-level `wrangler.jsonc`. (Preview id is already set.)

### Aliyun

Console → SMS service → 国内消息 → Apply for sign-name (`签名`) and template (`模板`). The template must contain `${code}` as its sole variable, e.g. `您的 DirtBikeX 验证码：${code}，5 分钟内有效。` Once approved, paste the sign-name into `ALIYUN_SMS_SIGN_NAME` and the template code (e.g. `SMS_12345678`) into `ALIYUN_SMS_TEMPLATE_CODE`.

### AWS SNS

No template registration needed (SNS uses freeform messages). One-time per region: SNS console → Text messaging → set the **default message type** to `Transactional` (the worker also sets it per-message, but this protects manual sends). For prod outside the sandbox, request a spend-limit increase if 1 USD/month default isn't enough.

### Logto admin config

`admin.dirtbikex.com` → Connectors → Phone → HTTP SMS:

- **Endpoint**: `https://www.dirtbikex.com/api/logto/sms` (prod) or `https://www.dirtbikechina.com/api/logto/sms` (preview).
- **Authorization**: `Bearer <LOGTO_SMS_TOKEN>` (the literal `Bearer ` prefix matters).
- **Template body**: irrelevant for Aliyun (template is server-side); for AWS it's overridden by the worker's `buildMessage()` in `providers/aws.ts`.

Then Sign-in experience → enable Phone as identifier.

### Synthetic-email plumbing

**DNS** (Cloudflare DNS, proxy OFF):

```
phone.dirtbikex.com.       MX 0 .
phone.dirtbikechina.com.   MX 0 .
```

The literal `.` is RFC 7505 null MX: "no mail accepted". Verify with `dig MX phone.dirtbikex.com`.

**Brevo** → Settings → Suppression list → add domain blocks for `phone.dirtbikex.com` and `phone.dirtbikechina.com`. Brevo silently drops sends to those domains and does **not** count them against the account's bounce rate (the failure mode we're avoiding — a high bounce rate flags the sending domain).

**Logto user claim**: phone-only users need an `email` claim of the form `<msisdn-without-+>@phone.dirtbikex.com` to satisfy Discourse's NOT NULL constraint. Configure via Logto's profile-mapping UI or a post-sign-in hook. This is a Logto config step, not worker code.

---

## Adding a country

The hot path is ~10 lines of code edits + a provider-side change. Order:

1. **Worker code**:
   - `worker/_lib/phone.ts` — add the country to `Country`, add a regex branch in `normalizePhone()`, accept the ISO code in `parseAllowedCountries()`.
   - `worker/_lib/smsQuota.ts` — add the country to `PROVIDER_FOR` and to `SMS_QUOTAS.perCountryDay`.
   - If the provider is new (not Aliyun/AWS): create `worker/_lib/providers/<name>.ts` exporting `sendXxx(env, {to, code}): Promise<SendResult>`; add the dispatch branch in `logtoSms.ts`; add `SMS_QUOTAS.perProviderDay[<name>]`.
2. **`wrangler.jsonc`**: extend `LOGTO_SMS_ALLOWED_COUNTRIES` to include the new ISO code in both env blocks. Add any new vars/secrets.
3. **Provider**: register sign-name/template (Aliyun-style) or confirm SNS region.
4. **Smoke**: curl-test the new prefix returns 200 and an SMS lands; curl-test a disallowed prefix still returns 403.

Re-enabling JP/KR/EU is the same recipe; the v1 cut deliberately excluded them.

---

## Verification

End-to-end smoke (run against preview first, then prod):

```sh
# 1. Happy path — expect 200 + an actual SMS.
curl -sS -X POST https://www.dirtbikechina.com/api/logto/sms \
  -H "Authorization: Bearer $LOGTO_SMS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"+8613800138000","payload":{"code":"123456","type":"SignIn"}}'

# 2. Auth — expect 401.
curl -i -X POST https://www.dirtbikechina.com/api/logto/sms \
  -H "Content-Type: application/json" -d '{"to":"+8613800138000","payload":{"code":"1"}}'

# 3. Invalid phone (UK not normalizable as CN/US) — expect 400 {"error":"invalid_phone"}.
curl -i -X POST https://www.dirtbikechina.com/api/logto/sms \
  -H "Authorization: Bearer $LOGTO_SMS_TOKEN" -H "Content-Type: application/json" \
  -d '{"to":"+447911123456","payload":{"code":"1"}}'

# 4. Rate limit — send a 2nd request to the same number within 60s.
#    Expect 429 {"error":"rate_limited","scope":"phone_minute"}.
```

Then drive the full Logto flow from a test client: confirm the OTP lands, succeeds, and a Discourse user is created with `email = '<msisdn>@phone.dirtbikex.com'`. Verify Brevo dashboard shows zero bounces from that domain (suppressed, not bounced).

---

## Concerns

Phone-OTP users are second-class for Discourse's email-driven features; all are mitigated by null-MX + Brevo suppression but may surface as UX paper cuts:

- **Welcome / reply / mention / digest emails** silently dropped. Mitigate at the Discourse layer (`default_email_level=never`, `default_email_digest_frequency=never` for users created from the synthetic domain).
- **Email-change notice** to the old synthetic address if a user later adds a real email. Harmless.
- **`must_approve_users` / `email must be confirmed`** must be **off** — they'd block all phone-OTP signups.
- **Bounce auto-disable**: Brevo suppresses (doesn't bounce), so Discourse doesn't see bounces and won't disable email. If we ever switch suppression strategy, this could cascade — fine outcome, document it then.
- **Aliyun template variability**: changing the template wording requires a new approved template code (the worker only sends `{code}` as a parameter; the template body is owned by Aliyun's review queue).
