# Outreach Module

The **pre-invite cold email** — the thin first touch to a track operator ("we built
DirtBikeX, interested?"), carrying **no invite code, link, or QR**. It is the top of
the funnel that precedes everything in [JOIN_MODULE](JOIN_MODULE.md): only if an
operator *replies* do we mint an invite (the `/api/join` Deliver flow). Sending is
Resend, `From joindirtbikex.com` — the same reputation-isolated identity as the join
confirmation email, so a cold-outreach reputation hit never touches `dirtbikex.com`.

```text
BUILT — single test send (both envs):
  CRM Templates tab ─► POST /api/outreach/test {to,trackName,locale}   (bearer: OUTREACH_SECRET)
                          └─ renderPreInvite() ─► Resend ─► one email   (preview deliverability + copy)

PLANNED — batch drip (ONE canonical-curation env, gated in code; design in §"Batch outreach"):
  CRM Outreach tab (filter country/reachable − suppressed − contacted)
     ─► POST /api/outreach/batch ─► D1 outreach ledger (email PK = send-once) ─► per-email disposition
  Cron ─► claim K (subquery, race-safe) ─► Resend (Idempotency-Key) ─► mark terminal ─► reaper re-queues stale
  GET|POST /api/outreach/u?token ─► D1 suppressions (one-click unsub) · POST /api/outreach/webhook ─► bounces
```

Two facts to keep straight: the **single test send is available in every env** (it is
just `handleOutreachTest`, env-agnostic — set the secret wherever the CRM runs and it
works). The **batch drip** runs from exactly **one** env — the canonical-curation env
(staging today), **gated in code** — because its D1 is the single send-once ledger and
the same operator must never be cold-mailed twice from two envs (see §"Batch outreach").

## Module layout

| Concern | Where | Notes |
|---|---|---|
| Template + send + test route | [worker/_lib/outreach.ts](../worker/_lib/outreach.ts) | `renderPreInvite` (track-name fill, bilingual local+EN), `sendPreInvite` (Resend), `handleOutreachTest` (bearer, single send) |
| Route dispatch | [worker/index.ts](../worker/index.ts) | `POST /api/outreach/test` matched before the `ASSETS` fallthrough |
| Env (secret) | [worker/_lib/types.ts](../worker/_lib/types.ts) | `OUTREACH_SECRET?` on `PagesEnv` (shared bearer with the CRM) |
| CRM caller | dirtbikex-contacts [scripts/contact_web.py](../../dirtbikex-contacts/scripts/contact_web.py) `POST /outreach/test` | proxies here with the bearer; the CRM never sends email itself ([CONTACT_MODULE](../../dirtbikex-contacts/docs/CONTACT_MODULE.md) §"Pre-invite") |
| Sending identity (shared) | `JOIN_FROM_EMAIL` / `JOIN_REPLY_TO` / `JOIN_ORG_ADDRESS` | reused verbatim from [JOIN_MODULE](JOIN_MODULE.md) — one verified domain, one CAN-SPAM footer |

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

**Where it runs — the pivotal decision.** Real batch sends run from a **single designated
env**, and it must be the one where the **canonical curation lives**, so that `contacted`
(which gates future sends) is written on the DB that *promotes*. Today that is **staging**
(curation is on dbc; prod mirrors it via a **wholesale** snapshot restore). Running the
batch on *prod* instead would auto-write `contacted` on prod **after** the snapshot was
taken, and the next wholesale promotion silently clobbers it → already-mailed operators
reappear as un-contacted and get re-enqueued (the send-once ledger masks the actual
re-send, so the funnel is quietly wrong with no operator signal). So: **send from the
canonical-curation env and gate `/api/outreach/batch` + the Cron to that one env in code**
(reject on the other) — not by operator discipline, because `/api/outreach/*` is reachable
on *both* workers and prod/preview bind **different** D1s, so a procedural rule would let
the same operator be enqueued twice from two envs. *(If prod must send: switch promotion to
a merge-import that preserves prod `contacted`, or derive "contacted" from the ledger —
both heavier. Canonical-env send is cleanest.)*

**Send-once ledger (D1 `outreach`).** `email` PK · `status` (`queued`→`claimed`→`sent` /
`failed_transient` / `failed_permanent` / `suppressed`) · `claimed_at` · `sent_at` ·
`attempts` · `unsub_token` (random, unique) · `track_name`/`track_region`
(**informational** — never key on the staging `trackId`; correlate CRM↔ledger by email and
re-resolve a track by `(lower(name),region)`, exactly as the invite cache does). Enqueue is
`INSERT … ON CONFLICT(email) DO NOTHING`, but that must not mask a retryable
`failed_transient` (a Resend 5xx/429 stays re-claimable; only `sent`/`suppressed`/
`failed_permanent` are terminal).

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

**Dry-run (rehearse safely).** A job-level `dry_run` flag (staging defaults it **on**) makes
the drip do everything except the Resend call: it logs `outreach:drip_dryrun {to,subject}`
and marks the row `sent_dryrun`. Plus an on-demand `POST /api/outreach/drip?dry=1` (bearer)
runs one tick immediately, so you can rehearse "select 50 → send" end-to-end with zero real
email (also `wrangler dev --test-scheduled` → hit `/__scheduled`).

**Still open (your call):** the sending-env decision above; the drip interval + warm-up
curve numbers; and the country source (`tracks.region` vs a dedicated locality column).

## Routes, schema, config

**Routes** (in [worker/index.ts](../worker/index.ts) → [worker/_lib/outreach.ts](../worker/_lib/outreach.ts)):

| Method · path | Does | Returns |
|---|---|---|
| `POST /api/outreach/test` | bearer-check · validate recipient · `renderPreInvite` · Resend one email | `200 {ok,sent_to}` · `401 unauthorized` · `400 invalid recipient email`/`invalid json` · `502` (Resend/env) |
| `POST /api/outreach/batch` | **PLANNED** — enqueue a filtered batch (send-once); gated to the canonical env | per-email disposition |
| `GET /api/outreach/status?since=` | **PLANNED** — CRM polls this to reconcile `contacted` (no worker→CRM callback) | ledger deltas |
| `GET /api/outreach/preview` | **PLANNED** — render the pre-invite for the CRM Outreach tab | subject/html/text |
| `GET\|POST /api/outreach/u?token` | **PLANNED** — tokened one-click unsubscribe → D1 `suppressions` | — |
| `POST /api/outreach/webhook` | **PLANNED** — Resend bounce/complaint (signature-verified) → D1 `suppressions` | — |
| `POST /api/outreach/drip?dry=` | **PLANNED** — run one drip tick on demand (`dry=1` logs, no send) | processed batch |

**Env** (shared with [JOIN_MODULE](JOIN_MODULE.md), + one new secret):

| Key | Notes |
|---|---|
| `OUTREACH_SECRET` | *(secret)* `wrangler secret put OUTREACH_SECRET --env <preview\|"">` — **per-env**, must equal that env's CRM `.env` `OUTREACH_SECRET` |
| `RESEND_API_KEY` | *(secret)* reused — the pre-invite sends over the same Resend account |
| `JOIN_FROM_EMAIL` / `JOIN_REPLY_TO` / `JOIN_ORG_ADDRESS` | reused — sender identity, mailto-unsubscribe target, CAN-SPAM footer |

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
