---
kind: why
status: current
summary: The pre-invite cold email — the thin first touch to a track operator , carrying no invite code, link, or QR. It is the top of the funnel …
---

# Outreach Module

The **pre-invite cold email** — the thin first touch to a track operator ("we built
DirtBikeX, interested?"), carrying **no invite code, link, or QR**. It is the top of
the funnel that precedes everything in [JOIN_MODULE](join.md): only if an
operator *replies* do we mint an invite (the `/api/join` Deliver flow). Sending is
Resend, `From joindirtbikex.com` — the same reputation-isolated identity as the join
confirmation email, so a cold-outreach reputation hit never touches `dirtbikex.com`.

```text
BUILT — single test send (both envs):
  CRM Templates tab ─► POST /api/outreach/test {to,trackName,locale}   (bearer: OUTREACH_SECRET)
                          └─ renderPreInvite() ─► Resend ─► one email   (preview deliverability + copy)

PLANNED — batch drip (PROD real; staging = test only; gated in code; design in §"Batch outreach"):
  CRM Outreach tab (filter country/reachable − suppressed − contacted)
     ─► POST /api/outreach/batch ─► D1 outreach ledger (email PK = send-once) ─► per-email disposition
  Cron ─► claim K (subquery, race-safe) ─► Resend (Idempotency-Key) ─► mark terminal ─► reaper re-queues stale
  GET|POST /api/outreach/u?token ─► D1 suppressions (one-click unsub) · POST /api/outreach/webhook ─► bounces
```

Two facts to keep straight: the **single test send is available in every env** (it is
just `handleOutreachTest`, env-agnostic — set the secret wherever the CRM runs and it
works). The **real batch drip runs from prod**, **gated in code**; **staging can only run
it in a test mode** — dry-run (log) or override-to-your-own-inbox — so real cold mail
never originates off prod and the same operator is never contacted twice (see §"Batch
outreach").

## Module layout

| Concern | Where | Notes |
|---|---|---|
| Template + send + test route | [worker/_lib/outreach.ts](../../worker/_lib/outreach.ts) | `renderPreInvite` (track-name fill, bilingual local+EN), `sendPreInvite` (Resend), `handleOutreachTest` (bearer, single send) |
| Route dispatch | [worker/index.ts](../../worker/index.ts) | `POST /api/outreach/test` matched before the `ASSETS` fallthrough |
| Env (secret) | [worker/_lib/types.ts](../../worker/_lib/types.ts) | `OUTREACH_SECRET?` on `PagesEnv` (shared bearer with the CRM) |
| CRM caller | dirtbikex-contacts [scripts/contact_web.py](../../../dirtbikex-contacts/scripts/contact_web.py) `POST /outreach/test` | proxies here with the bearer; the CRM never sends email itself ([CONTACT_MODULE](../../dirtbikex-contacts/docs/CONTACT_MODULE.md) §"Pre-invite") |
| Sending identity (shared) | `JOIN_FROM_EMAIL` / `JOIN_REPLY_TO` / `JOIN_ORG_ADDRESS` | reused verbatim from [JOIN_MODULE](join.md) — one verified domain, one CAN-SPAM footer |

## Architecture decisions

### The pre-invite is worker-sent, never CRM-sent
The CRM (dirtbikex-contacts) is behind Cloudflare Access with no egress mail path,
and the whole invite chain already funnels every send through the landing worker's
Resend identity ([CONTACT_MODULE](../../dirtbikex-contacts/docs/CONTACT_MODULE.md)
§"Sending (REMOVED)"). The pre-invite is the one send that happens *before* a code
exists, so it would have been the temptation to re-grow a second mailer in the CRM.
Instead the worker owns it and the CRM **proxies** `POST /api/outreach/test`.
**NOT done:** no SMTP/mailer in the CRM, no second sending domain. **Invalidates if:**
the CRM ever needs to send without a worker round-trip (it does not).

### Copy is conversion-framed: incremental reach + a quiet 4-step timeline (EN first)
2026-07-29 rewrite (operator-decided, two rounds): the value block argues **incremental
reach, never channel replacement** — a track's Facebook already covers the riders who
know it, so RSVP/local-reach claims argue against their existing tools; the pitch is
the riders they *can't* reach: map-searchers, travelers, newcomers, the global catalog.
The reel link rides inside the intro paragraph (the "see it" belongs beside the
description), the CTA is one line ("If you're in, just reply." — the timeline carries
the mechanics), and each block may carry `steps`, a *typographic* 4-step timeline
(● you got this note ← you are here / ○ you reply to agree / ○ invite / ○ install)
that shows the whole path costs one reply and one install. Deliberately NOT a graphic
progress bar — the cold email's plain-text look is load-bearing (see the 600px-wrapper
decision); the graphic bar lives in the warm steward invite email (JOIN_MODULE).
`steps`/`early` are per-Block; the **locale pass is DONE** (2026-07-29, all 21 — machine-translated, native review advised before large sends). The DM variant compresses the same clarity to its medium:
profile-one-tap-away replaces links ("our profile here has a 30-second look"), one link
total, and the next step is channel-consistent ("I'll send your personal invite right
here" — a DM funnel delivers the `/s/i` link by DM, not email).

### Template is worker-hardcoded, bilingual, track-name only
`renderPreInvite(trackName, locale)` fills `{track}` into a hardcoded `Block`
(`subject/lead/body/cta`). A non-English locale stacks the **local block above the
English one in a single email** (send-once forbids two emails to one address); with
no translation for that locale it falls back to English-only. Personalization is the
**track name only** — no owner-name greeting (we rarely have a clean contact name, and
a wrong name is worse than none). **Copy is a placeholder** (`TODO(copy)` in
`outreach.ts`, `LOCALES` empty) — finalize it and add translations, then redeploy.
**NOT done:** no runtime/D1 copy store, no per-owner greeting, no A/B variants.
**Invalidates if:** copy iteration outpaces the redeploy friction — then promote the
blocks to a D1/KV store the worker reads at send time (the CRM's Template tab already
wants a preview endpoint; that endpoint + a store would land together).

### Email layout: a 600px wrapper div, no tables, AA-legible fine print
The email stays plain-text-styled HTML (no tables, images, tracking pixels, `<style>`
blocks, media queries or web fonts — see the pitch rationale above), so line length is
constrained by a single `max-width:600px;margin:0 auto` **div** rather than the usual
table scaffold. Without it Gmail on a wide window measured **~185 characters per line**
against a 45–75 optimum; that was the dominant layout defect, not the copy.

Fine print is `13px/#767676`, not `12px/#888`. `#888` on white is **3.54:1** — below
WCAG AA (4.5:1) — on the one line that carries the Privacy and Unsubscribe links, i.e.
the legally load-bearing line. `#767676` is 4.54:1. Both footer anchors carry an
explicit inline colour: an anchor with no inline colour inherits the client's default
link blue, which made Unsubscribe and Privacy render differently in the same sentence.

**Note the preview endpoint does not show any of this.** `/api/outreach/preview` returns
`renderPreInvite` — the **body only**. The wrapper, socials line and CAN-SPAM footer are
added later in `buildPreInviteMessage`, which is private. To see the real mail, drive
`handleOutreachTest` with a stubbed `fetch` and read the captured Resend payload.

**NOT done:** the intro is still one long paragraph. Splitting it at the sentence
boundary before the iOS mention needs the operator to review all 21 locale splits first.

### The route must be registered in `run_worker_first`
The worker shares its origin with Cloudflare Static Assets, so a path **not** listed
in `wrangler.jsonc` `run_worker_first` is handled by the assets layer first — and a
POST to a non-asset path returns **405 before the worker ever runs**. `/api/outreach/*`
is listed in **both** the top-level and the `preview` blocks so the whole family
(`/test` now; `/batch` · `/preview` · `/u` later) reaches the handler. **Symptom if
forgotten:** the handler is right there in `index.ts` yet the route 405s, identical to a
bogus path — it is not a code bug, the request simply never reached the code. (This bit
the first `/api/outreach/test` deploy: handler present, route absent from the allowlist.)

### Bearer-authed test send, constant-time compare
`handleOutreachTest` gates on `OUTREACH_SECRET` (shared with the CRM) via the same
constant-time compare as the SMS gateway's `checkAuth`: reject on length mismatch,
else XOR-accumulate. The secret is **per-env** — the staging CRM
(`crm.dirtbikechina.com`) calls the **preview** worker (`www.dirtbikechina.com`), prod
calls the top-level worker, and each worker's `wrangler secret put OUTREACH_SECRET
--env <…>` must match that env's CRM `.env`. **NOT done:** no per-caller keys, no rate limit on the test
route (it is Access-gated at the CRM and single-send). **Invalidates if:** the route
is ever exposed beyond the CRM (then add `rateLimitConsume`).

### Cold-outreach unsubscribe is mailto today (tokened HTTPS one-click is the batch follow-up)
A cold recipient has no subscriber row, so the test send's `List-Unsubscribe` is a
`mailto:<JOIN_REPLY_TO>?subject=unsubscribe` plus a footer "reply to unsubscribe" — a
valid **RFC 2369** mailto + CAN-SPAM opt-out that needs no token. It is **not** RFC-8058
one-click (that requires an HTTPS URI). The code also emits `List-Unsubscribe-Post:
List-Unsubscribe=One-Click` alongside the mailto, which no client honors over a mailto —
harmless but non-conformant; it becomes real when the tokened HTTPS endpoint ships (drop
or condition that header then). The **automated** HTTPS one-click → D1 `suppressions`
arrives with the batch pipeline (below, `/api/outreach/u?token`), where volume makes
manual mailto handling stop scaling. **NOT done:** no suppression check on the test route
— you type the address (must be your own inbox); the batch path checks suppressions.

### Batch outreach (PLANNED — runs from ONE canonical env; not built)
The design the test send is a stepping-stone toward. **Nothing here is implemented** —
this is the *corrected* shape (an adversarial design review caught the hazards below, so
the built pieces don't foreclose them). Everything is a proposal until the build round.

**Where it runs — DECIDED: prod, with a merge-promotion.** Real batch sends run from
**prod**, **gated in code** — `/api/outreach/batch` *and* the Cron reject on the preview
env (they are reachable on *both* workers, which bind **different** D1s, so a procedural
"prod-only" rule would let one operator be enqueued twice from two envs). The batch writes
`contacted` on prod; since promotion is otherwise a **wholesale** snapshot restore that
would clobber those prod-written stamps, **staging→prod promotion becomes a merge that
preserves `contacted`** — implemented as the wholesale restore **followed by a reconcile
step**: re-stamp `contacted` on every prod track whose email is in prod's D1 send-once
ledger (`status='sent'`) and whose *incoming* staging disposition is not a newer human call
(`skip`/`rejected`/`broken`, which win). So the **D1 ledger is the durable "we mailed them"
record** and `tracks.contacted` is its re-derivable projection — no fragile general
per-column merge. *(An earlier draft recommended sending from **staging** to sidestep this;
the operator chose prod + merge-promotion.)*

**Send-once ledger (D1 `outreach`).** Synthetic `id` PK (0007) · `email` (lowercased
operator) · `status` (`queued`→`claimed`→`sent` / `sent_dryrun` / `failed_permanent` /
`suppressed`) · `mode` · `claimed_at` · `sent_at` · `attempts` · `send_after` · `unsub_token`
(random, unique) · `track_name`/`track_region` (**informational** — never key on the staging
`trackId`; correlate CRM↔ledger by email + `(lower(name),region)`). **Send-once is a PARTIAL
UNIQUE INDEX** `(email) WHERE mode='real'` — so a `real` enqueue is `INSERT … ON CONFLICT(email)
WHERE mode='real' DO NOTHING` (conflict ⇒ already ledgered), while **test rows (override/
dry_run) are plain inserts** and may repeat: two concurrent override jobs to the same tracks
get independent rows (the old `email` PK made the 2nd job upsert-overwrite the 1st, orphaning
it). The drip keys every per-row mark on `id`, not `email`.

**Race-safe drip (Cron).** Claim K with `UPDATE … WHERE rowid IN (SELECT rowid FROM
outreach WHERE status='queued' … LIMIT K) RETURNING …` — the **subquery** form, verified
against a live D1 (bare `UPDATE … LIMIT` is not guaranteed in D1's SQLite build). Per row:
suppression re-check → `sendPreInvite` with a **Resend `Idempotency-Key` = row id** (so a
replay after a lost `sent` ack dedupes at Resend) → mark terminal. A **reaper** re-queues
rows stuck in `claimed` past a TTL — a crashed mid-batch invocation would otherwise strand
them forever. (This is the release/retry safety `redeemInvite`'s single-PK claim gives for
free but a K-of-N queue claim does **not** — the earlier "same pattern as redeemInvite"
framing was wrong.)

**Warm-up = a daily budget, not a per-fire count.** Today's budget = `cap(day) −
count(status='sent' AND sent_at ≥ start-of-UTC-day)`, derived from the ledger — idempotent
under overlapping/retried Cron fires, surviving deploys (a worker has no scheduler memory).
Keying the ramp to elapsed *calendar days* is wrong: a pause would "warm up" on paper while
sending nothing, then resume at a high cap and torch reputation. The cap bounds
total-sent-today, independent of the Cron interval.

**Suppressions are one authoritative set.** A cold recipient opts out two ways: the tokened
HTTPS one-click (`GET|POST /api/outreach/u?token` → D1 `suppressions`) and the mailto/reply
the operator records via `unsubscribe.py`. The CRM opt-out **must push to D1 synchronously**
(not "seed D1 once from the snapshot"); enqueue is gated against the unified set and a
still-`queued` row for a newly-suppressed address is cancelled. **Reverse sync:** prod-side
D1 unsubs + hard bounces must flow back into the canonical curation DB, or the sending env
goes blind to real opt-outs. Hard bounces/complaints enter D1 via a **Resend webhook**
(`POST /api/outreach/webhook`, verify Resend's signing secret) that suppresses the address
and flips its ledger row terminal — without it the drip keeps hitting dead addresses and
wrecks the young domain's reputation (the exact failure warm-up exists to prevent).

**CRM drives it; `contacted` is stamped truthfully.** The **Outreach** tab (renamed from
Templates — *preview · test-send · send-jobs*) filters contacts by country + reachability
(has email, not suppressed, not already `contacted`) and POSTs `{email,trackName,locale}[]`
to `/api/outreach/batch`, which returns a **per-email disposition**
(`enqueued`/`already-ledgered`/`suppressed`/`rejected`). The CRM stamps
`disposition='contacted'` **only** for `enqueued` addresses — stamping optimistically would
mark deduped/suppressed/failed tracks "reached" and drop real prospects from every future
batch. Because the CRM sits behind Access (no ingress — the worker cannot call back),
send-completion is reconciled by the CRM **polling** a bearer-authed `GET
/api/outreach/status?since=…`, not by a per-send ack.

**Preview endpoint.** `GET /api/outreach/preview?trackName&locale` returns
`renderPreInvite(...)`, so the Outreach tab previews the *actual* email for any locale — the
worker is the single source of the pre-invite copy (localized blocks live in the worker
`LOCALES` map, edited-then-redeployed; the CRM never re-authors copy).

**Test modes (staging never sends for real).** Each job carries a `mode`:
- `real` — deliver to the actual operator, write the ledger, stamp `contacted`. **Prod only**
  (rejected on the preview worker).
- `dry_run` — everything except the Resend call; logs `outreach:drip_dryrun {to,subject}`.
  Pure rehearsal of claim/throttle/suppression.
- `override` — a staging **override-to** email: render each message with the *real* track's
  name/locale (subject prefixed `[TEST→<real recipient>]`) but **deliver every one to your
  own inbox**. A real Resend send, so it exercises deliverability + the actual drip cadence
  with zero mail to real operators. Send-once dedup is **off** in this mode (re-run freely).

An on-demand `POST /api/outreach/drip?dry=1` runs one tick immediately (also `wrangler dev
--test-scheduled` → `/__scheduled`), so you don't wait for the Cron.

**Why staging tests can't pollute prod (the D1 question).** Two structural reasons, so
"don't save" isn't required: (1) the staging worker binds a **different D1** than prod — the
real send-once ledger is a database prod alone reads; (2) staging→prod **promotion carries
the SQLite snapshot, not D1**, so staging outreach rows never ride to prod. The only column
that *does* promote is `tracks.contacted` — hence the hard rule: **test modes never write
`contacted`**. Given that, staging *may* save its override/dry-run rows to its own D1 (tagged
`mode`) — worth it, because the **Outreach tab's Send-jobs panel then shows a real test job**
and you exercise the true claim/drip/reaper/status path. Zero-footprint variant: `dry_run`
pure-logs (no D1 write); `override` should save, or you aren't really testing the pipeline.

**Still open (your call):** the sending-env decision above; the drip interval + warm-up
curve numbers; and the country source (`tracks.region` vs a dedicated locality column).

### Drip throughput, the daily cap, and failure handling

Three *independent* limiters shape the send rate; conflating them is what caused the
2026-07-26 stall.

| Limiter | Where | Bounds |
|---|---|---|
| `OUTREACH_DAILY_CAP` | `wrangler.jsonc` `vars` (prod) | the **day's** real-send total — a runaway backstop, **not** the throughput knob |
| `CLAIM_LIMIT` = 100 | `outreach.ts` | the **burst**: rows claimed per tick = one `POST /emails/batch` per minute |
| per-row `send_after` | stamped at enqueue from the CRM's `start_delay_min`/`interval_min` | the **pacing** of a given job |

**The cap clamps the CLAIM, not the send.** `claimN = min(CLAIM_LIMIT, cap − sentToday)`;
at zero the tick logs `outreach:drip_cap_exhausted` and returns. Deferring *after* claiming
(the old shape) meant a spent budget re-claimed and re-queued the same rows every 60s —
~40 D1 row-writes/minute, zero sends, zero log output. Cap `0` is honoured as a deliberate
**hard stop**; the old `parseInt(…) || DEFAULT` silently turned an operator's "0" into 200.

**The cap is a ceiling, not the pacer.** With it set far above normal volume, the only
thing standing between a large batch and a reputation spike is `CLAIM_LIMIT` (100/min) and
the `interval_min` you choose when enqueuing. **Set `interval_min` on any job you would not
want delivered at 100/minute** — the cap will not save you.

**Failure classification decides whether a row survives.** A row that reaches
`failed_permanent` is unrecoverable: the partial unique index `(email) WHERE mode='real'`
plus `ON CONFLICT … DO NOTHING` makes every later batch report it `already`, forever, while
the CRM has already stamped the track `contacted`. So the default is **defer**, not failure:

- `defer` — requeue, **no** attempt consumed, `send_after` pushed out by the backoff
  (`max(send_after, now+backoff)`, so a deliberately-paced row is never pulled *earlier*).
  Covers 429, 5xx, **and 401/403/404** — a revoked key or paused account is an operator
  fault, and previously burned every claimed row on its first attempt.
- `attempt` — requeue, consumes one of `MAX_ATTEMPTS`. Only a single-send network throw,
  where delivery is genuinely unknown; safe to retry because of the per-row Idempotency-Key.
- `permanent` — 400/422 only, and a rejected *batch* is retried as singles first so one bad
  address cannot take 99 good rows with it.

**Batch send.** Up to 100 messages per `POST /emails/batch` (Resend's maximum); `data[i]`
is index-aligned with the payload, and an index with no `id` is deferred, never marked sent.
The batch `Idempotency-Key` is a hash of the chunk's sorted row ids — it dedupes a retry
whose chunk has the *same* membership (the crash-after-accept case), and does not cover a
retry whose membership shifted. D1 writes for a chunk go out in one atomic `db.batch`
immediately after its response; if that write throws, the accepted addresses are logged
(`outreach:drip_write_failed_after_send`) so the send is recoverable rather than lost.

**Staging asymmetry.** Wrangler `vars` are **non-inheritable**, so both knobs are declared
explicitly in `env.preview.vars` (2026-07-29): `OUTREACH_ALLOW_REAL: "0"` and
`OUTREACH_DAILY_CAP: "1000"`. With `allowReal` false the claim is never clamped, so the cap
path is still **not exercisable on staging** — the preview cap value only feeds the staging
`/metrics` gauge and the per-tick drip log line. Staging does exercise the batch send, the
failure classification, and the drip log line (via `override` mode). `observability` *is*
inheritable, so both workers persist logs.

## Routes, schema, config

**Routes** (in [worker/index.ts](../../worker/index.ts) → [worker/_lib/outreach.ts](../../worker/_lib/outreach.ts)):

| Method · path | Does | Returns |
|---|---|---|
| `POST /api/outreach/test` | bearer-check · validate recipient · `renderPreInvite` · Resend one email | `200 {ok,sent_to}` · `401 unauthorized` · `400 invalid recipient email`/`invalid json` · `502` (Resend/env) |
| `POST /api/outreach/batch` | **PLANNED** — enqueue a filtered batch (send-once); gated to the canonical env | per-email disposition |
| `GET /api/outreach/status?since=` | **PLANNED** — CRM polls this to reconcile `contacted` (no worker→CRM callback) | ledger deltas |
| `GET /api/outreach/preview` | **PLANNED** — render the pre-invite for the CRM Outreach tab | subject/html/text |
| `GET\|POST /api/outreach/u?token` | **PLANNED** — tokened one-click unsubscribe → D1 `suppressions` | — |
| `POST /api/outreach/webhook` | Resend bounce/complaint, **Svix-verified** (`RESEND_WEBHOOK_SECRET`, +5min replay guard) → hard bounce + complaint suppress in D1 + cancel pending; other events acked | `200 {ok}` · `401` bad sig · `503` unconfigured |
| `POST /api/outreach/drip?dry=` | **PLANNED** — run one drip tick on demand (`dry=1` logs, no send) | processed batch |

**Env** (shared with [JOIN_MODULE](join.md), + one new secret):

| Key | Notes |
|---|---|
| `OUTREACH_SECRET` | *(secret)* `wrangler secret put OUTREACH_SECRET --env <preview\|"">` — **per-env**, must equal that env's CRM `.env` `OUTREACH_SECRET` |
| `RESEND_API_KEY` | *(secret)* reused — the pre-invite sends over the same Resend account |
| `RESEND_WEBHOOK_SECRET` | *(secret)* `whsec_…` for `/api/outreach/webhook`. Set on the sending env (prod). Create the webhook in the Resend dashboard → `https://www.dirtbikex.com/api/outreach/webhook`, subscribe to `email.bounced` + `email.complained`, copy the signing secret → `wrangler secret put RESEND_WEBHOOK_SECRET`. Absent → webhook 503s. |
| `JOIN_FROM_EMAIL` / `JOIN_REPLY_TO` / `JOIN_ORG_ADDRESS` | reused — sender identity, mailto-unsubscribe target, CAN-SPAM footer |
| `OUTREACH_ALLOW_REAL` | `"1"` on prod only — gates `mode='real'` at enqueue *and* in the drip. Absent on `preview`, which is what makes staging structurally unable to send real cold mail |
| `OUTREACH_DAILY_CAP` | plain **var**, not a secret — keep it in `wrangler.jsonc` (a value edited in the Cloudflare dashboard is clobbered by the next `wrangler deploy`). Unset → `DEFAULT_DAILY_CAP` = 200. `"0"` = hard stop. See § "Drip throughput" — this is a backstop, not the pacer |

## Operator setup

```sh
# Per env, using the SAME value the CRM env holds (staging = preview, prod = "").
pnpm wrangler secret put OUTREACH_SECRET --env preview     # staging worker (www.dirtbikechina.com)
pnpm wrangler secret put OUTREACH_SECRET --env=""          # prod worker    (www.dirtbikex.com)

# Deploy the worker code that carries the /api/outreach/test route (secret put alone
# does NOT ship code — a missing deploy shows as HTTP 405 on the route, see Debugging).
pnpm build:dev  && pnpm wrangler deploy --env preview
pnpm build:prod && pnpm wrangler deploy --env=""

# CRM side (infra): set OUTREACH_SECRET in that box's /srv/dirtbikex/infra/.env to the
# same value, then recreate the contacts container so it re-reads env:
#   sdcpdf up -d --force-recreate contacts
```

The CRM's **Templates** tab shows the test-send form; its button greys with a "set
OUTREACH_SECRET to enable" hint until the CRM sees the secret. A send there hits the
worker for **this** env — verify the env's secret and deploy both match.

## Debugging

- **`POST /api/outreach/test` → 405** — the assets layer is preempting the route.
  Two causes, in likelihood order: (1) the path isn't in `wrangler.jsonc`
  `run_worker_first` (both blocks) — a POST to a non-asset path 405s before the worker
  runs; add `/api/outreach/*`, rebuild, redeploy. (2) the worker code isn't deployed for
  that env — `wrangler secret put` uploads the secret but never ships code; run
  `wrangler deploy --env <…>`. Either way, confirm the worker is reachable with a known
  route (`POST /api/join` → 400) — if that also 405s, it's a deploy problem, not the list.
- **CRM test send → "Test send failed (401)"** — the CRM's `OUTREACH_SECRET` and the
  worker's `wrangler secret` for *that env* don't match, or the secret was put on the
  wrong env (`--env preview` for staging vs top-level for prod). Re-put both to one value.
- **CRM button greyed "set OUTREACH_SECRET to enable"** — the CRM container hasn't the
  secret. It's an env var, not baked in: set it in infra `.env` and recreate the
  container. Check `compose.crm.yml` actually has `OUTREACH_SECRET: ${OUTREACH_SECRET:-}`.
- **`→ 502` on the test route** — `RESEND_API_KEY`/`JOIN_FROM_EMAIL` unset for that env,
  or Resend rejected. Worker logs `outreach:resend_non_2xx` / `outreach:resend_threw`.
- **Email renders English on a non-English locale** — expected: `LOCALES` has no block
  for that locale yet (English fallback). Add the block in `outreach.ts` + redeploy.
- **The drip silently stops sending** (backlog sits, nothing arrives, no error anywhere) —
  this is the 2026-07-26 failure. Read the per-tick `outreach:drip` line in the Cloudflare
  **Workers → Logs** tab (persisted by `observability` in `wrangler.jsonc`; before that it
  existed only for someone running `wrangler tail`). `cap`/`sentToday` in that line say
  whether the budget is spent — `outreach:drip_cap_exhausted` is the explicit warning.
  `outreach:drip_backoff` means Resend rate-limited or the account is blocked. A tick that
  logs nothing at all did not run: check the Cron trigger and the `scheduled` handler, which
  re-throws so failures reach Cloudflare's cron error metrics. The **`Outreach pipeline
  stalled`** alert ([DASHBOARDS_MODULE](../../../guides/DASHBOARDS_MODULE.md) § 4) is the
  intended pager for this and is **still not created** — the stall was found by eye.

## Manual verification

1. `wrangler secret put OUTREACH_SECRET --env preview`; set the same value in the
   staging infra `.env`; `wrangler deploy --env preview`; recreate the CRM container.
2. CRM **Templates** tab → the test-send button is enabled → enter your own email + a
   track name + `en` → **Test send** → flash "Test pre-invite sent to …".
3. The inbox shows one email: subject/body carry the track name, honest From, physical
   address + mailto-unsubscribe footer, no code/link/QR. Confirm it in the Resend console.
4. Bad email in the form → "does not look like an email address" (CRM-side reject, no
   worker call). Wrong/absent secret → "Test send failed (401)".
5. `POST /api/outreach/test` with a bad bearer (curl) → `401`; unknown path → `405`
   (distinguishes "route live, auth failed" from "code not deployed").

## Tests

No worker test harness in-repo (as with JOIN_MODULE) — the numbered smoke is the gate,
and `wrangler deploy --env preview --dry-run` bundles the route. The render logic
(`renderPreInvite`: `{track}` fill, EN-only vs local+EN stacking, `escapeHtml`) is pure
and node-checkable in isolation. **Not covered:** Resend delivery (exercised live by
the test send), and the entire batch pipeline (unbuilt).
