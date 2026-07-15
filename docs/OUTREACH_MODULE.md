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

PLANNED — batch drip (PROD only; design in §"Batch outreach"):
  CRM batch UI (filter country/reachable − suppressed − contacted)
     ─► POST /api/outreach/batch ─► D1 outreach queue (email PK = send-once)
  Cron (every N min) ─► claim K unsent (race-safe) ─► Resend ─► mark sent ─► CRM stamps `contacted`
  GET/POST /outreach/u?token ─► D1 suppressions (one-click unsubscribe)
```

Two facts to keep straight: the **single test send is available in every env** (it is
just `handleOutreachTest`, env-agnostic — set the secret wherever the CRM runs and it
works). Only the **batch drip** is prod-only, because prod's D1 is the single
send-once ledger and we never want one operator cold-mailed twice from two envs.

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
(`www.dirtbikechina.com`) calls the **preview** worker, prod calls the top-level
worker, and each worker's `wrangler secret put OUTREACH_SECRET --env <…>` must match
that env's CRM `.env`. **NOT done:** no per-caller keys, no rate limit on the test
route (it is Access-gated at the CRM and single-send). **Invalidates if:** the route
is ever exposed beyond the CRM (then add `rateLimitConsume`).

### Cold-outreach unsubscribe is mailto today (D1 one-click is the batch follow-up)
A cold recipient has no subscriber row, so the test send's `List-Unsubscribe` is a
`mailto:<JOIN_REPLY_TO>?subject=unsubscribe` plus a footer "reply to unsubscribe" — a
valid CAN-SPAM/RFC-8058 channel that needs no token. The **automated** HTTPS
one-click unsubscribe → D1 `suppressions` arrives with the batch pipeline (below),
because only then are we sending at a volume where manual mailto handling stops
scaling. **NOT done:** no suppression enforcement on the test route (you type the
address; it is your own inbox).

### Batch outreach (PLANNED — prod only; not built)
The design the test send is a stepping-stone toward. **None of this is implemented**
— it is the agreed shape so the built pieces don't foreclose it:
- **Send-once ledger in D1.** An `outreach` table keyed on `email` (PK) is the single
  record that an address was cold-mailed. Enqueue is idempotent (`INSERT … ON
  CONFLICT(email) DO NOTHING`), so re-submitting an overlapping batch never
  double-queues. Prod's D1 is the *only* ledger — that is why real sends are prod-only.
- **Race-safe drip via Cron.** A Workers Cron trigger fires every N minutes, claims K
  unsent rows with an `UPDATE … WHERE status='queued' … RETURNING` (the same
  claim-before-send pattern as `redeemInvite`), sends each via `sendPreInvite`, and
  marks `sent`/`failed` — so a crashed invocation never re-sends a claimed row, and a
  **warm-up ramp** (small K, growing daily) protects the young sending domain.
- **Suppressions gate.** A D1 `suppressions` table (unsub + hard bounces) is checked
  as the queue is loaded; a suppressed address is never claimed. The CRM keeps its own
  `suppressions` (SQLite, rides the snapshot for the curation view); the worker's D1
  suppression is authoritative for *sending*. They reconcile on promotion.
- **CRM drives the batch + owns `contacted`.** The CRM batch UI filters contacts by
  country + reachability (has email, not suppressed, not already `contacted`) and
  POSTs `{email,trackName,locale,trackId}[]` to `/api/outreach/batch`. The CRM stamps
  those tracks `disposition='contacted'` — a **stored column that travels with the
  snapshot** (NOT D1-derived), so "we reached out" survives staging→prod promotion.
- **Preview endpoint.** A read-only `GET /api/outreach/preview?trackName&locale` that
  returns `renderPreInvite(...)` so the CRM Template tab can show the *actual* email
  (today the tab previews only the file-based `templates/`).

**Open decisions (confirm before building):** drip interval + warm-up curve; whether
the batch endpoint enqueues-and-returns (CRM stamps `contacted` optimistically) or
acks per-send; country source (`tracks.region` vs a dedicated column); and whether the
CRM `suppressions` push up to D1 or D1 is seeded once from the snapshot.

## Routes, schema, config

**Routes** (in [worker/index.ts](../worker/index.ts) → [worker/_lib/outreach.ts](../worker/_lib/outreach.ts)):

| Method · path | Does | Returns |
|---|---|---|
| `POST /api/outreach/test` | bearer-check · validate recipient · `renderPreInvite` · Resend one email | `200 {ok,sent_to}` · `401 unauthorized` · `400 invalid recipient email`/`invalid json` · `502` (Resend/env) |
| `POST /api/outreach/batch` | **PLANNED** — enqueue a filtered batch into the D1 send-once ledger | — |
| `GET /api/outreach/preview` | **PLANNED** — render the pre-invite for the CRM Template tab | — |
| `GET\|POST /outreach/u?token` | **PLANNED** — one-click unsubscribe → D1 `suppressions` | — |

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
