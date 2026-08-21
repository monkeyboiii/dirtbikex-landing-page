# TRAIL_UPLOAD_MODULE — letting a visitor put their own ride on the map

An operator-imported trail is [TRAILS_MODULE](TRAILS_MODULE.md): somebody decided a ride
belonged on the map and ran a script. This is the other path — a stranger drops a `.gpx`
on the map, gets a private link and a one-time code, and decides later whether it becomes
theirs and whether anyone else ever sees it.

Folded 2026-08-21 from `TRAIL_UPLOAD_PLAN.md` (six revisions, umbrella root, now deleted).
The revisions are kept below because three of them were killed by facts that are still
true and would otherwise be rediscovered.

## The two mechanisms it rests on

Everything else in this file follows from these, and neither is ours — they are how
Discourse already behaves:

- **An upload with no post referencing it dies by itself.** `CleanUpUploads` reaps any
  upload with no `upload_references` row once `clean_orphan_uploads_grace_period_hours`
  passes. A `UserUpload` does not count.
- **Claiming is what keeps the file alive.** Binding a trail to a real post creates the
  reference that stops the reaping. Persistence and intent are the same act, so nothing
  has to implement expiry for the bytes — only for the row that points at them.

The consequence worth stating plainly: **the worker holds exactly one Discourse scope,
`uploads:create`.** It never posts, never creates a topic, never speaks for a user. A leak
of that key can put files in the upload store and do nothing else. Everything needing a
forum identity is done by the plugin, server-side, inside a session the visitor
established themselves.

## End to end

```
VISITOR                 LANDING                      FORUM                         MAP
  │ drops a .gpx
  ├───────────────────►│ pre-flight — reject route-only / waypoint-only / zero-extent
  │                    │ rate-limit (fails CLOSED), 10 MB cap
  │                    │ POST /uploads.json ─────────►│ scope: uploads:create
  │                    │◄── url + short_url ──────────│ no post · no topic · no PM
  │                    │ D1: visibility=unlisted, expires in 72 h, no author
  │◄─ link + code ─────│
  │
  │ does nothing → no upload_reference → reaped at 72 h → row swept
  │
  │ opens /s/c/<code>
  ├───────────────────►│ claim card: state of the code, one button
  │                    └──────────────────────────────►│ GET /dbx/trails/claim?code=…
  │                                                    │ logged out → redirect_to_login
  │                                                    │              (carries the code)
  │                                                    │ logged in  → PM to themselves,
  │                                                    │   holding [name|attachment](upload://…)
  │                                                    │   ⇒ upload_reference exists
  │                                                    │   ⇒ the file stops expiring
  │                    │◄── bind ─────────────────────│ trail ⇢ (user, post), no expiry
  │
  │ taps the switch on that post (theme component)
  ├───────────────────────────────────────────────────►│ POST /dbx/trails/<secret>/visibility
  │                    │◄── set state ────────────────│  public → joins the map document
  │                    │                               │  private → link-only, NEW secret
  │
  │ deletes the post ─────────────────────────────────►│ on(:post_destroyed)
  │                    │◄── gone ─────────────────────│ → trail leaves the map
  │
  │                     every minute: worker ─── GET /dbx/trails/reconcile ───►
```

**No `TopicConverter` ever runs.** The personal message stays a personal message; map
visibility is a property of the trail record, keyed on a post id. That reframing is what
dissolved rev 4 — see the revision table.

**Private is never rendered on the map.** It exists only through its secret link, kept by
the owner in their own message, at their own discretion and responsibility. That last
clause belongs in the product copy, not only here.

## Module layout

| Concern | Where |
|---|---|
| The whole visitor write surface | [`worker/_lib/trailUpload.ts`](../worker/_lib/trailUpload.ts) |
| The index | [`migrations/0009_trails.sql`](../migrations/0009_trails.sql), [`0010_trails_short_url.sql`](../migrations/0010_trails_short_url.sql) |
| Client parse, measure, reject | [`src/scripts/worldmap/upload.ts`](../src/scripts/worldmap/upload.ts) |
| The control, the drop target, the sheets | [`src/components/WorldMap.astro`](../src/components/WorldMap.astro), [`index.ts`](../src/scripts/worldmap/index.ts) `uploadTrail`/`openSecretTrail`, [`panel.ts`](../src/scripts/worldmap/panel.ts) `showUpload*`/`showMissingTrail` |
| The claim card | [`worker/index.ts`](../worker/index.ts) `handleTrailClaim`, `CLAIM_COPY` |
| Merge into the map document | [`worker/index.ts`](../worker/index.ts) `/api/map/trails.json` augment → `publicTrailEntries` |
| Sweep + reconcile | [`worker/index.ts`](../worker/index.ts) `scheduled`, [`trailUpload.ts`](../worker/_lib/trailUpload.ts) `sweepExpiredTrails`/`reconcileTrails` |
| Claim, publish, drop | `discourse-dirtbikex-event-filters`: `lib/dirtbikex_event_filters/trail_claims.rb`, `trail_worker.rb`, `trail_claim.rb`, `app/controllers/dirtbikex_event_filters/trail_claims_controller.rb` |
| The owner's switch | `discourse-dbx-gpx-preview`: `javascripts/discourse/initializers/dbx-gpx-preview.js` |
| E2E | [`tests/trail-upload.spec.ts`](../tests/trail-upload.spec.ts) — opt-in, it really uploads |

## Routes

| Route | Who calls it | Notes |
|---|---|---|
| `POST /api/map/trail` | anyone | the one unauthenticated write on this worker |
| `GET /api/map/trail/<secret>.json` | the link holder | a miss and an expiry answer identically |
| `GET /api/map/trail/<secret>.gpx` | the link holder | proxy; `no-store` |
| `GET /s/c/<code>` | the code holder | the claim card |
| `GET /api/map/trail/claim/<code>` | the plugin | read-only |
| `POST /api/map/trail/claim/<code>` | the plugin | binds (user, post); clears code and expiry |
| `POST /api/map/trail/<secret>/state` | the plugin | `public` / `private` / `gone` |
| `GET /dbx/trails/claim?code=` | a browser | writes, deliberately — see below |
| `POST /dbx/trails/<secret>/visibility` | the owner | authorised on the claim, not the post |
| `GET /dbx/trails/post/<id>.json` | the theme component | 404 is the ordinary answer |
| `GET /dbx/trails/reconcile.json` | the worker's cron | shared bearer |

Everything on the landing side sits under `/api/map/*` and `/s/*`, both of which the
worker already owns in **both** `run_worker_first` blocks. No route ownership changed.

## D1, not R2, and the reason is concurrency

The operator-curated trails live in an R2 document. Uploads cannot: they arrive
concurrently from strangers, and R2 `put` has no compare-and-set, so a single document
would lost-update. A key-per-trail would mean a `list` plus a `get` per trail on every
cache miss. What this wants is an atomic insert, an indexed secret lookup and
`WHERE expires_at > now` — which is a table.

The two never merge on disk. `/api/map/trails.json` serves the R2 document with the
public uploads appended **at serve time**; an upload never enters the document, and the
document is never rewritten by the worker.

That has one consequence worth knowing: `push-map-data.mjs --check --doc trails` compares
the live URL against the source, so it strips every entry carrying `visibility` before
diffing. A merged entry is the only kind that has that field. Without the strip, the guard
would report R2 drift the moment anybody published a trail.

## The secrets

| Value | What it protects | Shape |
|---|---|---|
| `secret` | the trail itself — a precise trace of where somebody lives and rides | 8 chars of `23456789abcdefghjkmnpqrstuvwxyz` |
| `claim_code` | the right to make the trail yours | same alphabet, single use |
| `TRAILS_PLUGIN_TOKEN` | every plugin↔worker call, both directions | 64 hex, wrangler secret + a `secret: true` site setting |

The alphabet has no `0/O/1/I/l` because these are read aloud and typed from memory. 32^8
is about 1.1e12.

Three rules follow from the secret being the whole access control:

- **A miss and an expiry are the same answer.** Both are 404 with no body distinction, so
  the endpoint is not an enumeration oracle.
- **The proxy exists so expiry is true of the bytes.** Discourse keeps a deleted upload in
  `tombstone/` for `purge_deleted_uploads_grace_period_days` (30, and global), so a CDN URL
  a visitor once held stays fetchable long after the trail is gone. Serving the file
  through `/api/map/trail/<secret>.gpx` is what makes "lose the link, lose the trail" true.
- **A public trail is served from the CDN directly, not the proxy.** The proxy URL contains
  the secret, and `trails.json` is edge-cached for a day — publishing the proxy URL would
  put the secret in every cached copy. For the same reason, **flipping a public trail back
  to private mints a new secret**: the old one is already out there.

## The pre-flight is gpx.studio's rules, not ours

gpx.studio is a web app, not an API, so it cannot be asked to validate. But
`discourse-dbx-gpx-preview/RESEARCH.md` documents exactly how it fails, and refusing those
files is what stops a trail the forum embed could never draw:

| Input | What gpx.studio does | Rule |
|---|---|---|
| any `<rtept>` | `convertRouteToTrack` builds points with no index → throws in the statistics constructor, **even alongside a valid `<trk>`** | reject |
| waypoint-only | draws markers, never fits bounds, **throws nothing**, so no error handler catches it | reject |
| zero-extent | blank at 0.00 km — the `SW >= NE` guard trips | reject |
| valid track | `getStatistics()` succeeds | accept |

It runs **client-side**, where the scanner already lives, so the free plan's CPU budget
never enters into it. The worker re-checks two cheap things — the declared centre inside
the declared bbox, and the first trackpoint in the first 64 KB agreeing with both — and
that is a sanity check, not proof. A client that bypasses it lands a pin somewhere it did
not ride; for content that expires in 72 hours and is link-only until claimed, that is
proportionate, and parsing 10 MB at the edge is not.

Two components converged on the route-point rule independently (`gpx-trail.mjs` refuses
route points for its own reasons), which is a good sign the rule is right.

**What the client cannot fill:** the scanner reads coordinates out of trackpoint
attributes and never sees `<ele>` or `<time>`, so an uploaded trail carries no climb and
no recorded date. Both are present on an operator import. This is the one visible
difference between the two paths.

## Why the claim is a GET that writes

It is the far end of a link handed to somebody who may not have an account, and **no POST
survives a login round-trip.** `redirect_to_login` already stores `request.original_url`,
query string and all, in `cookies[:destination_url]`, and the session controller restores
it after sign-in — so the code is not lost. The reason the plugin has to call it by hand
is that core only calls it automatically when `login_required` is on, and it is not.

The code is single-use: the worker clears `claim_code` in the same statement that clears
`expires_at`, because a claimed trail is permanent and its code is spent, and neither
should be able to be true without the other. Arriving twice lands on the message.

Two things had to be verified on staging before this worked at all, both on 2026-08-21:

- **A trust-level-0 account cannot start a personal message** (`personal_message_enabled_groups`
  is `1|2|11` = admins, moderators, trust_level_1). `skip_validations: true` is what lets a
  brand-new claimer keep their own receipt. Without it, claiming would work only for people
  who had already been on the forum a while.
- **The upload only registers a reference when it is written as
  `[name|attachment](upload://…gpx)`.** The bare short URL cooks to plain text and
  registers nothing — measured: `upload_references` stayed at 0 with the bare form and went
  to 1 with the link form. That is why D1 carries `gpx_short_url` at all.

## Push for latency, pull for correctness

`retry_web_hook_events` is false on this forum, and even switched on, `EmitWebHookEvent`
gives up after `MAX_RETRY_COUNT = 4` with `RETRY_BACKOFF = 5` — 1s, 5s, 25s, 125s, then
silence. Four attempts over two and a half minutes then silent abandonment is fine for a
cache nudge and wrong for state the map must not lose.

So: **the plugin calls the worker on change** (the map updates in a second) **and the
worker pulls `/dbx/trails/reconcile` on its existing per-minute cron** (a missed call
self-heals). The plugin is the authority in that pull, because the plugin is where the
post lives. No webhook is involved — a direct call already knows the trail id, which is
less plumbing than parsing a topic payload to infer what changed.

Two ordering rules hold it together:

- **The row is written before the call.** `TrailClaims.claim!` creates the post, writes
  `dbx_trail_claims`, and only then tells the worker. If that last call fails, the pull
  applies the same row within the minute.
- **The sweep runs before the pull.** The other order would sweep a claim recorded only on
  the forum side a minute before the pull that would have made it permanent.

The one call that is **not** best-effort is the visibility toggle. The whole promise of a
private trail is that it is not on the map, and reporting success on a call that never
landed is the single lie this feature cannot afford — so it raises instead.

## Deleting the post is how a trail leaves

`on(:post_destroyed)` marks the claim gone and tells the worker to drop the row. Discourse
**trashes** by default, so the trail leaves the map immediately and the bytes stay until
the post is permanently deleted — at which point `dependent: :destroy` takes the
`upload_reference` with it and `CleanUpUploads` reaps the file on its next pass. Verified
on staging: a trashed post keeps its reference; a real destroy removes it.

`on(:user_anonymized)` drops every live claim the same way. A trail must not outlive the
account that signed for it.

**The owner deletes the topic, not the post.** `DELETE /posts/<id>` 403s on a first post
(`can_delete_post?` is false where `can_delete_topic?` is true), which is core behaviour
and is what the UI does too — the OP's delete button removes the topic. Either route
destroys the post and fires the hook; only one of them is reachable.

## Rate limiting, and where it is thin

| Limit | Value | Where |
|---|---|---|
| per IP | 6 / hour | `rateLimitConsume('trail:ip:<ip>:1h')` |
| global | 8 / minute | `rateLimitConsume('trail:all:1m')` |
| file size | 10 MB | client and worker, matching `max_attachment_size_kb` |
| forum-side | `max_uploads_per_minute = 10` | shared across all visitors |

The limiter **fails closed** here — no `RATELIMIT_KV` binding means 503, not "allow" —
because this is the only control in front of an unauthenticated write. That is a
deliberate departure from `/api/join`, which warns and allows.

Still true and still thin: `rateLimit.ts` is non-atomic, and there is no captcha anywhere
in this codebase. **6/hour per IP is tight for a shared or NAT'd connection** — a club at
one office IP will hit it — and it is the first number to revisit if real people complain.

## Traps

- **The rate limit is per IP and this box is one IP.** Testing burns the same budget real
  visitors use. The key is `trail:ip:<ip>:1h` in the preview `RATELIMIT_KV`
  (`eb95a24345d548efb72feb21244df875`); deleting it resets the hour.
- **`wrangler d1 execute dbx-subscribers` without `--env preview` targets PRODUCTION.**
  Both environments use the same `database_name` and different ids. Every trails migration
  must carry the flag.
- **Rows created before `0010` cannot be claimed.** They have no `gpx_short_url`, so
  `TrailClaims.claim!` raises `no_upload` and the claim card's button leads to a 404.
- **`/s/c/*` is deliberately not in AASA.** A path joins the association file only when the
  shipped app has a destination for it; claiming a trail has none yet. Adding it early is
  exactly what makes the app raise its invalid-link bubble on a good link — see
  [SHARE_MODULE](SHARE_MODULE.md).
- **The claim card is `no-store`.** Its whole content is the state of a secret.
- **A trail resolved from `?trail=` never joins the layer**, the search index or the cull.
  It is not in the catalog and must vanish when the visitor leaves.
- **An unclaimed trail has no author**, which is why `Trail.author_user_id` and
  `author_username` are optional and the sheet renders no byline and no share button for
  one. `push-map-data.mjs` still requires an author, correctly: uploads never pass through
  the curated document.
- **The plugin's routes are gated on `dirtbikex_trails_enabled`, and the plugin itself on
  `dirtbikex_event_filters_enabled`.** Both must be on, and the second is a
  discourse-calendar-flavoured name for a flag that now governs three unrelated features.
- **There are no request specs for the trail endpoints.** Everything here was verified by
  `rails runner` and curl against staging, because this host has no Rails dev environment.
- **`Theme.clear_default!` does not clear a cache — it sets `default_theme_id = -1`.**
  Calling it while updating the component's theme fields silently switched the whole forum
  off FKB Pro. Restore with `SiteSetting.default_theme_id = 1` (components only load
  through their parent theme, and all four are children of theme 1). Use
  `Theme.expire_site_cache!` and `Stylesheet::Manager.clear_theme_cache!` when a cache
  clear is what was meant.

## Operator

| When | Do |
|---|---|
| First install, per environment | `clean_orphan_uploads_grace_period_hours` **48 → 72**, or an unclaimed file is reaped a day before the row says it expires |
| | Create the service account and an API key scoped to `uploads#create` **only**; set `FORUM_TRAILS_USERNAME` and the `FORUM_TRAILS_KEY` secret |
| | Generate `TRAILS_PLUGIN_TOKEN`; set it as a wrangler secret **and** as `dirtbikex_trails_worker_token` |
| | Set `dirtbikex_trails_worker_base` to the landing origin, and turn `dirtbikex_trails_enabled` on |
| | Apply `0009` and `0010` with `--env preview` (or the prod equivalent, explicit-ask) |
| | `authorized_extensions` must include `gpx` |
| Theme component | The map switch ships in `discourse-dbx-gpx-preview`. The installed copy on staging is a **zip import** (`remote_theme` is nil), so a git push does not reach it — the theme fields have to be replaced from the repo, or a fresh zip uploaded |

## Verifying

```shell
B=https://www.dirtbikechina.com
curl -s -X POST "$B/api/map/trail" -F "file=@ride.gpx" -F "meta=<meta.json"   # 201 + link + code
curl -s "$B/api/map/trail/<secret>.json"                                      # the entry, proxied gpx_url
curl -sI "$B/api/map/trail/<secret>.gpx"                                      # 200, no-store, nosniff
curl -s "$B/api/map/trails.json?cb=$RANDOM" | grep -c '<secret>'              # 0 — not published
curl -s "$B/s/c/<code>?cb=$RANDOM" | grep -oE '<h1 class="headline">[^<]*'    # the claim card
```

Then the browser half, which is the only thing that exercises the pre-flight and the
sheets:

```shell
PLAYWRIGHT_BASE_URL=https://www.dirtbikechina.com TRAIL_UPLOAD_E2E=1 \
  ~/bin/pw-limited pnpm exec playwright test trail-upload --project=chromium --workers=1
```

**Set `PLAYWRIGHT_BASE_URL`**, or the config also boots `astro dev`, and vite plus esbuild
plus chromium on this box's two cores — alongside the staging stack — is what rebooted it
on 2026-08-18.

## The revisions, and what killed them

Kept because three of these were killed by facts that are still true.

| Rev | Outcome |
|---|---|
| 1 | Worker → R2 for everything. A second storage system, and a stranger's files on the app origin |
| 2 | A private **category** topic. **Killed** — the map never reads the forum: `MAP_BUCKET` is `.get`-only, and the importer reads posts anonymously and 403s on a private category |
| 3 | Personal message, worker writes R2. Better on four counts |
| 4 | Self-service PM → public conversion. **Blocked** — `can_convert_topic?` is admin/moderator only, so a user cannot convert their own message |
| 5 | Every upload anonymous; a one-time code claims it; trails bind to a **post id**, not to topic visibility — which dissolved rev 4 entirely |
| 6 | Decisions closed |

## Deferred

- **Grafana.** Worker counters (uploads, claims, rejects), a discourse-prometheus collector
  in the plugin (the fcm plugin already ships one), and `web_hook_events` for delivery
  health if webhooks are ever used.
- **Sharding the trails document.** Measured at 676 B/entry, so one document is fine to
  ~2,000 trails. Sharding earlier breaks share cards (`loadRoute` scans by id with no
  viewport) and search. When it comes, it is a per-trail key plus a small index, not
  viewport tiles.
- **Climb and recorded date on an uploaded trail** — needs a second scanner pass for
  `<ele>` and `<time>`.
- **The `/share/track` "Visit the website" link**, which is labelled by kind rather than by
  what the URL is. Parked at the user's request.

---

**Related:** [TRAILS_MODULE](TRAILS_MODULE.md) · [MAP_MODULE](MAP_MODULE.md) ·
[SHARE_MODULE](SHARE_MODULE.md) · [JOIN_MODULE](JOIN_MODULE.md)
