# LINEAGE_PLAN.md — Rider lineage: who taught whom, grounded in the stack we have

**Status: round 2 agreed. P1–P5 are BUILT; P1–P4 are deployed and verified on STAGING (plugin `v1.0.7`, landing `v1.0.10` on the preview worker, umbrella `v1.0.3-alpha.6`, 2026-08-17/18). `dirtbikex_lineage_enabled` is ON on staging, PROD untouched and still default-off. P5 (iOS) is committed at `170fa6eb` but UNRELEASED — no tag, no TestFlight build, and no compiler has seen it (dbc has no Swift toolchain), so the satellite pin deliberately still records v1.0.2; on-device verification is the outstanding gate.** Round-2 changes carried in this doc: the taxonomy/forward-compat edge model (§3.1–3.2), the query plan (§3.6), abuse/reputation (§3.7), the follow retirement path (§2.5), the résumé/timeline-first rendering order (§4.2), the gated riders map layer (§4.2), the no-iPhone onboarding flow (§4.4), and the removal of every video-master coupling. Concept: [LINEAGE_INIT.md](LINEAGE_INIT.md). Grounding: read-only recon of the deployed discourse-follow plugin (staging container), `discourse-dirtbikex-event-filters`, the landing Worker, core Discourse at the pinned SHA, the identity/invite chain, the CRM seeding path, and the iOS profile/notification/share surfaces — every load-bearing claim cites a file. Companions: [MAP_LAYERS_PLAN.md](MAP_LAYERS_PLAN.md) (the layer rail and option C), [CRM_MIGRATION_PLAN.md](CRM_MIGRATION_PLAN.md) (plugin Postgres = canonical published entities), [META_MODULE.md](META_MODULE.md).

**One sentence:** lineage is a *relationship graph* (rider ⟶ learned-from ⟶ rider, rider ⟶ contributed-to ⟶ track, more object types later) that lives in plugin-owned Postgres tables next to the track catalog, is written only where a session exists (forum web, later the app), and is **read** anonymously by the landing page as a rider résumé + timeline — the follow plugin stays pinned and untouched for now, because its "graph" is one notification-level edge table with nothing lineage can build on.

---

## 0. Decisions (operator marks from round 1 kept verbatim; round-2 additions L16–L21)

| # | Decision | Recommendation | Status |
|---|---|---|---|
| L1 | **Do not fork or extend discourse-follow.** Lineage is its own model; follow stays byte-identical | Yes — §2.1 | Operator Confirmed |
| L2 | **Graph lives in plugin Postgres tables** (discourse DB), not D1/R2 | Yes — §2.2 | Operator Confirmed |
| L3 | **Placement: inside `discourse-dirtbikex-event-filters`** (own `dirtbikex_lineage_enabled` sub-setting, own settings, code *outside* the calendar `defined?` guard) | In-plugin — §2.3 | in plugin |
| L4 | **Unclaimed riders = plugin rows (`dirtbikex_riders.user_id NULL`)**, never staged users | Yes — §2.4 | Operator Confirmed |
| L5 | **Consent default for unclaimed nodes:** `name_public=false` (placeholder rendering) unless the operator flags on-camera/consented; reported edges between claimed users are public with the ○ glyph; the named party can decline (hidden) or dispute | §3.4 | Confirmed |
| L6 | **Confirmation channel v1:** dedicated notification types (850–852) + a forum web confirm route; *not* Reviewables (staff-only at this core), *not* a PM courier | §3.5 | PROPOSED (unchanged) |
| L7 | **Landing page = primary public READ surface.** `/s/u/<username>` renders the stat strip + a CTA; **`/s/l/<username>` renders the complete legacy view** (résumé + timeline), with `/lineage/<slug>` as the node-addressed twin and the canonical URL — backed by the query plan in §3.6 | §4.2 | **BUILT 2026-08-18** (landing `v1.0.11`): `/s/l/` is the link you hand out (a username can be read aloud; an `r-…` slug cannot), `/lineage/` keeps `rel=canonical`, and any of the three HTML routes takes `?debug=true` for an E2E panel — upstream trace, counter-vs-list invariants, unlabelled facet codes, locale fallback |
| L8 | **Riders map layer, gated.** A claimed rider who set a location (discourse-locations `geo_location`, already user-editable and serialized) renders as a pin **only if staff-approved or above a bar**; coordinates coarsened; no people edges on the map in v1 | §4.2 | People can set location in discourse settings, that should render, only if approved by me, or reach a certain bar (help control exposure, valued route) |
| L9 | **v1 scope = Lineage + Legacy views** (résumé lists + timeline + counts). Skills filter, degrees-of-separation, scene genealogy, graph explorer, "community-supported" = v2 | §5 | Okay |
| L10 | **iOS is its own release phase** (P5) — v1 app users see lineage via notification row → profile, the landing page, and forum web; plus the independent follow-keys fix | §4.3 | PROPOSED (unchanged) |
| L11 | Seed doc fast path (R2 `lineage.json` before the plugin exists)? | **No** for people data unless a campaign date forces it — §5 P0.5 | OPEN |
| L12 | Vocabulary freeze (verbs, facets, honorifics, year precision) before the first import | Shape fixed in §3.2; the *list* is frozen when the operator says | WAIT (operator) |
| L13 | Prod enablement waits on Terms §5 / Privacy amendment — v1 ships staging + default-off | §6 | OPEN |
| L14 | Where the seed JSONL with real names lives | **Decided (delegated):** a new **private** GitHub repo `dirtbikex-lineage-seeds` cloned on dbc only — names, edges, `probable_user`, consent flag; **no** phone/WeChat/email (contact details stay in the CRM as today). Backed up by being a private remote + the operator box. Never `Misc/`, never the landing or plugin repo (the plugin repo is baked into the container image) | Decided |
| L15 | Auto-follow on confirmed edge | **No.** Follow stays for now; retirement path in §2.5 | No auto follow, i'm thinking removing follow altogether? But discuss |
| L16 | **Abuse & reputation:** provenance outcomes per asserter (declined / disputed / retracted vs confirmed) feed an auto-flag → `/review`; staff can **permanently block** a user from lineage (`dirtbikex_lineage_blocked` custom field, edges tombstoned) or suspend via core | §3.7 | PROPOSED |
| L17 | **Caps:** per-rider ceilings on mentors, pending assertions, unclaimed nodes created; per-day rate limits; all as settings | §3.7 | PROPOSED |
| L18 | **Forward-compatible edge model:** `relation` verb + polymorphic `object` (rider / track / later club, shop, event) + `facets` (dotted, versioned vocabulary, i18n keys) + `honorific`; **who confirms** is derived per relation (counterparty rider; the track's active steward for track contributions) | §3.1–3.2 | PROPOSED |
| L19 | **Rendering order:** landing résumé + timeline (P3) → forum profile view (P4/v2) → iOS native (P5). Graph explorer deferred | §4.2 | PROPOSED |
| L20 | `external_id` = import-idempotency + crosswalk key only (§3.1 note); never serialized | — | Explained |
| L21 | **No coupling to video-master** — no `video:` refs, no manifest emits, no status. `evidence_url` is a generic forum post/topic/upload URL | — | Applied |

---

## 1. The data reality this plan is built on (measured on staging, 2026-08-17)

| Thing | What exists | Verdict for lineage |
|---|---|---|
| discourse-follow "graph" | one table `user_followers(user_id, follower_id, level)`, one unique index, no FKs; **4 rows**, all `level=3` (`level` = notification level watching/regular, *not* relationship type — `lib/follow/notification.rb:5`, `lib/follow/updater.rb:9-11`); list endpoints return bare `BasicUserSerializer` arrays, no edge metadata | Nothing to build on. Patterns only (users-route-map + `user-main-nav` connector, `FollowPagesVisibility` enum setting, postless notification creation) |
| iOS ↔ follow | 4 endpoints + **7 serializer keys, non-optional on `PublicUser`** (`iOS/App/Models/User/Info/PublicUser.swift:91-98`); any decode failure on `/u/<name>.json` degrades to "Profile Hidden" (`ProfileService.swift:331-338`) | Follow must stay byte-identical → **never fork it**. Also a live time bomb independent of lineage (§6) |
| Track catalog plugin | `dirtbikex_tracks` (2,102 rows staging / 2,095 prod), `dirtbikex_track_claims` (3 active), `dirtbikex_track_claim_hints` (1), `ReviewableDirtbikexTrackClaim`, `ClaimCaps`, rake import idempotent on `external_id` with `curated_fields` protection, `on(:user_anonymized)` + `before_destroy` lifecycle, anon-readable `/dirtbikex/tracks/*` routes; staging `dirtbikex_track_claim_min_trust_level=2`, owner group id 43 | The exact kit lineage needs: entity-before-owner + claim, provenance fork (auto vs manual), caps, import, lifecycle. Lineage gets its **own** TL/caps settings |
| discourse-locations | deployed + `location_enabled=t`, `location_users_map=t`; user `geo_location` custom field is editable in preferences and serialized on the user (`plugin.rb:128-148`) | The rider location source for L8 — no new field to build |
| Humans | 5 human users on staging; 3 claims; 4 follow edges | `confirmed` will be ~0 for months — every surface must read right at 100% ○ reported with unclaimed nodes |
| Core primitives (pinned 06d03da) | Staged users: takeover is **email-keyed only** (`users_controller.rb:702`), email mandatory+unique, `unstage!` destroys notifications (`user.rb:519`), postless staged users auto-deleted after 365 d, still receive notification email, hidden from search/@mention, 404 for anon. Reviewables: `reviewable_by_group_id` is an ignored column; queue is staff/category-mod only (`user_guardian.rb:202`) | Staged users **rejected** for unclaimed riders. Reviewables only for *disputes*, token-less claims and abuse flags — mutual confirmation must be a plugin endpoint |
| Notifications / push | Plugin ints assigned by bare hash write (`discourse-follow/plugin.rb:25-27`); core reserves 1–45, 800–802, 900. FCM plugin pushes any `notification_created` row not already pushed (`plugin.rb:63-71`); a postless row with `data.display_username` gets url `/u/<name>` (`pusher.rb:64-93`). iOS: unknown raw type → `.custom`/`.unknown` generic bell row (`Notification.swift:114`) | New types ship server-first with no FCM change; old app builds route to the reporter's profile |
| Landing Worker | one secret toward the forum (query-scoped `FORUM_API_KEY`); every other read anon; `/s/u/<username>` card renders avatar/name/stats + OG + deep link (`worker/index.ts:522-532`, `render.ts:535-609`); `/api/map/*` in `run_worker_first`, `/api/lineage/*` and `/lineage/*` are **not**; AASA claims `/s/*` and `/u/*` and `ShareKind` decodes only `i|u|e` → a `/s/l/…` route dead-ends on a phone with an old app build; no CSP (Playwright allowlist test is the enforcement); no visitor auth at all | Read + share surface; new page outside `/s/` in v1; renderer must be inline/bundled |
| iOS profile | another user's profile is **100 % native SwiftUI**; topic/PM webviews block every same-forum link that isn't `/t/`, `/u/`, `/c/` (`topic-link-interceptor.js`) | An Ember tab is invisible in-app; a forum confirm link inside a PM is a dead tap in-app → iOS needs its own phase |
| Seeding | No person entity anywhere (CRM is track×channel rows); one-way funnel CRM → JSONL → rake; import has **no delete path**; PII scan only matches email/phone regexes | Seed forum-side via a lineage rake import with a real retract verb; people stay out of the CRM in v1 |
| Legal | ToS §5 forbids storing personal data about others without consent; Privacy has no third-party-data clause; LEGAL_REVIEW item 4 flags PIPL rep + cross-border as unbuilt | Zhejiang-first is intentional CN targeting → L13 |
| Prod (dbx) | **not inspected** (follow enabled? visibility overrides? `login_required`? core SHA parity) | P0 contract check |

---

## 2. What we are *not* doing, and why

### 2.1 Not forking discourse-follow (L1 confirmed)
`user_followers` cannot hold lineage: `unfollow` is a blind `destroy_all` on the pair, `follow` is `find_or_initialize_by` + level overwrite, the pair index is unique, every read path INNER JOINs `users` (no unclaimed nodes). A fork adds all of lineage as net-new inside someone else's plugin, buys ~200 lines of nav/notification scaffolding, and costs permanent ownership of ~2k lines of CDCK code, lineage coupled to `discourse_follow_enabled` (`lib/plugin/instance.rb:193-198`), and the only nonzero blast radius on the iOS "Profile Hidden" trap. This project has **never bumped core** (`git log -S DISCOURSE_VERSION` in infra: set once, then frozen to a SHA) — the first bump is a big-bang; a fork makes it bigger.

### 2.2 Not putting the graph in D1 / R2 (L2 confirmed)
Writes need a session — the Worker has none. D1 is outside every backup discipline in the project and already drifts per env (`migrations/0008` preview-only). R2 docs are for operator-published story data, not a graph participants must correct. Option C already made plugin Postgres canonical for published entities with the map reading a bulk endpoint; lineage follows the same read path (§4.2).

### 2.3 Placement: existing plugin (L3 decided)
Zero new pins/repos, shared kit, `contributed_to` edges reference `dirtbikex_tracks.id` in the same migration set. Structural cost: `plugin.rb` wraps everything in `if defined?(::DiscoursePostEvent)` (`plugin.rb:18-141`); lineage loads in a **second top-level block** with its own lifecycle hooks; only the track object type `defined?`-checks `Track`. Own settings: `dirtbikex_lineage_enabled` (default off), `dirtbikex_lineage_min_trust_level` (default 1), caps (§3.7).

### 2.4 Not modelling unclaimed riders as staged users (L4 confirmed)
Email mandatory + unique, takeover only by email (our signup is the Logto exchange), 365-day auto-destroy, `unstage!` wipes notifications, hidden from @mention, 404 for anon, still emailed. **A rider row is the entity; a claim binds a user** — exactly tracks + claims.

### 2.5 Follow: keep, and the retirement path if lineage makes it redundant (L15)
Removing follow *now* breaks every shipped iOS build (seven non-optional keys → "Profile Hidden"; the FollowFeed tab). Follow's actual job — a feed of posts by people you chose — is not what lineage does; lineage will only make it redundant if a "posts by my mentors/students" feed exists. Path, in order, none of it now: (1) P5 makes the seven keys optional and puts the Follows UI behind a server flag; (2) lineage ships a `lineage-feed` custom topic filter (the follow plugin's own `add_filter_custom_filter` idiom) if a feed is wanted; (3) once app adoption of the P5 build is high enough, `discourse_follow_enabled=false` on staging → keys vanish safely → verify → prod; (4) drop the pin. Nothing in lineage may depend on follow (no auto-follow, no follow-derived seeds), so step 3 is a one-way door with no lineage side effects.

Also not: Reviewables for mentor confirmation (staff-only), a Data Explorer query for graph reads (per-env operator step; MAP_LAYERS_PLAN §3b already rejected this once), CORS on the forum (off; the Worker proxy avoids it), a graph explorer in v1 (L19), any video-master coupling (L21).

---

## 3. Architecture

### 3.1 Data model (plugin migrations; no FKs, house style; ids kept < 2^31 for `reviewables.target_id`)

**`dirtbikex_riders`** — the node. Exists whether or not an account does. Unchanged from round 1 except `map_visible`.

| column | notes |
|---|---|
| `id` | bigserial |
| `user_id` int NULL, UNIQUE partial | claimed ⇒ set; **NULL = unclaimed**. Numeric id is identity; `cached_username` beside it |
| `slug` varchar UNIQUE | opaque, server-minted (copy `Track.mint_slug`), permanent public address; **never** the claim token |
| `external_id` varchar UNIQUE partial | **what it is for (L20):** the idempotency key of the operator's seed JSONL — re-running the import upserts instead of duplicating; also the crosswalk that lets one row be corrected later by re-importing a single line (the track pin-fix runbook shape). Operator-chosen namespace, e.g. `zj-2026-08:laowang`. Never serialized, never shown |
| `display_name`, `name_local`, `name_pinyin` | trilingual shape; ILIKE search across all three (copy `Track.search`) |
| `name_public` bool default **false** | the consent switch (L5) |
| `state` int | `unclaimed / claimed / merged / retracted`; `merged_into_id` |
| `claim_token` varchar UNIQUE partial NULL | random, single-use, NULLed on claim, **never serialized** |
| `probable_user_id` int NULL | seed hint resolved at import like `ClaimHintImporter`; not proof |
| `map_visible` bool default false | L8: set by staff, or auto when the bar is met (`dirtbikex_lineage_map_min_confirmed_edges`, default 1); requires `user_id` + a `geo_location` |
| `created_by_id`, `source` (`seed/user/claim`), `country_code`, `region`, `riding_since_year`, `known_for` jsonb `[]` (facet codes), `curated_fields` jsonb `{}`, timestamps | `curated_fields`: participant edits outrank the seed; rake skips `"user"`-marked keys unless `--override=` (audit-logged) — ships **with** the first import |

**`dirtbikex_lineage_edges`** — the relationship record, generalized for L18 so later kinds are *rows and vocabulary*, not migrations.

| column | notes |
|---|---|
| `relation` varchar(32) | verb, closed list enforced in the model: v1 `learned_from`, `contributed_to`. Later `member_of`, `worked_at`, `rode_at`, `influenced_by` are new values, not new columns |
| `subject_rider_id` | the rider the sentence is about (student; contributor) |
| `object_type` varchar(16) + `object_id` bigint | polymorphic: v1 `rider`, `track` (`dirtbikex_tracks.id`); later `club`, `shop`, `event`. CHECK on the allowed (relation, object_type) pairs; UNIQUE partial `(subject_rider_id, relation, object_type, object_id)` — one edge per subject–object pair per relation; **facets live in the edge**, so one confirmation covers the relationship and "Edit" adjusts facets |
| `facets` jsonb `[]` | dotted codes from the versioned vocabulary (§3.2): what was taught (`mx.cornering`, `enduro.navigation`, `wrench.suspension`…) or which build roles (`build.design`, `build.earthwork`, `build.permits`, `build.funding`, `build.general`) |
| `honorific` varchar(16) NULL | optional elevation of a `learned_from` edge: `mentor / coach / shifu`; **rendered only when both sides confirmed the same honorific**, else the neutral verb |
| `start_year`, `end_year`, `year_precision` (`exact/approx/decade`) | "2016" / "~2016" / "2010s" |
| `intensity` varchar(16) NULL | `once / occasional / regular / formal` — LINEAGE_INIT §8's "showed me cornering once ≠ trained me for three years", without sessions counting |
| `notes` ≤500 | |
| `provenance` int | `reported / confirmed / declined / disputed / retracted`. `documented` derived = `evidence_url` present. `community` not stored in v1 |
| `asserted_by_rider_id` | which side asserted (老王's node for an interview seed even though `created_by_id` is the operator) |
| `confirmer_kind` (derived, not stored) | who may confirm — `counterparty` (the object rider) for `learned_from`; the track's **active steward** (`dirtbikex_track_claims` ACTIVE) for `contributed_to`, staff if none; the same resolver later returns a club's admin. This is the one place new relations plug in |
| `created_by_id`, `source` (`seed/user`), `evidence_url` (forum post/topic/upload URL, ≤500) | |
| `confirmed_by_id/at`, `declined_by_id/at`, `disputed_by_id/at`, `retracted_by_id/at`, `review_note` | stamps |
| `external_id` UNIQUE partial, `curated_fields`, timestamps | |

Indexes: `(subject_rider_id, relation)`, `(object_type, object_id, relation)`, `(provenance)`, `(created_by_id, created_at)` (abuse queries), plus the partial UNIQUE. Both traversal directions are covered by the first two.

**Not built in v1 (headroom, not columns):** attestations table (community-supported), `dirtbikex_rider_stats` materialized counters (§3.6 says when), clubs/shops/events as object types.

### 3.1a What P1 actually shipped (deviations from the draft above)

Three decisions changed while building; they are the code's truth, not the table's:

1. **Rider slugs are random-opaque (`r-xxxxxxxxxx`), not `Track.mint_slug`-style.** A name-folded slug (`cn-lao-wang`) publishes the very name `name_public=false` exists to withhold — the URL would leak it. Claimed riders get the readable address instead: `/dirtbikex/lineage/u/<username>`, and later `/lineage/@<username>` on the landing page.
2. **`dirtbikex_lineage_visible` is a `choices:` enum, not an `EnumSiteSetting` class.** `settings.yml` constantizes an `enum:` class while `SiteSetting` itself loads — long before any plugin `after_initialize` — so a class in the plugin's `app/models/` would have to rely on plugin autoload, which this plugin deliberately does not (`discourse-follow`'s `FollowPagesVisibility` survives only because of that autoload). Values: `everyone` (default) / `logged_in` / `staff` / `no-one`.
3. **Public counts include `reported` as well as `confirmed`.** The stat must equal the length of the list rendered beside it; with a cold graph a confirmed-only count reads zero everywhere, exactly where the veteran legacy page needs to work (§3.4's rationale, made concrete).

Also worth recording: both new user-serializer keys (`dbx_lineage_counts`, `allow_lineage_claims_about_me`) ride core's `respect_plugin_enabled`, so they vanish if `dirtbikex_event_filters_enabled` goes false — the lineage sub-setting cannot outlive its parent. Same shape as the follow-key trap in §1, and the reason both keys must be decoded as optional on iOS.

### 3.1b P1 staging verification (2026-08-17)

Run against the live staging stack after the rebuild; test rows cleaned up afterwards.

| Check | Result |
|---|---|
| Migrations in the bootstrap | both applied (`CreateDirtbikexRiders` 0.07 s, `CreateDirtbikexLineageEdges` 0.04 s), all indexes + the `no_self_edge` CHECK present |
| Seed import (4 riders, 4 edges) | created, then a re-run reported `0 created, 4 updated` on both tables — idempotent |
| Import dry-run | catches an unknown facet code (`mx.corner` → WARN, dropped), an unresolvable `object_ref`, an unknown verb, and an out-of-range year — **after** the fix in §3.1c |
| Claim links | minted and printed per unclaimed rider; never present in any serialized payload (asserted directly) |
| Counters (CTE) | Wang: 2 students / 3 downstream / 2 generations / 1 track; a deliberate cycle (`wang → chen → rubio → wang`) terminated on the path guard |
| Consent projection | anon sees `Chen Shifu` (`name_public=true`) and `PLACEHOLDER` for `Zhang Qiang` (`name_public=false`); staff sees both |
| Timeline | ordered `2004 (riding since) → 2010 → 2014 → 2016`, undated last |
| Claimed rider | binding a rider to `@calvin` renders the identity from the User (`Monkeyboi`, avatar, username) and lights up `dbx_lineage_counts` on `/u/calvin.json` |
| Uniform 404 | unknown slug, unknown username, and a user with no rider node are indistinguishable |
| `dirtbikex_lineage_visible` | `everyone` → 200 anon; `logged_in` / `staff` / `no-one` → 404 anon |
| Kill switch | `dirtbikex_lineage_enabled=false` → every route 404s **and** both new user keys disappear, while all seven follow keys stay intact |
| Cache headers | anonymous reads carry `public, max-age=60, s-maxage=300`; logged-in reads keep core's no-store |
| Retract verb | rider tombstoned (`state=retracted`, `name_public=false`, token cleared), its edges retracted, counts recompute, row leaves `listable` |

### 3.1c What verification caught (and reading did not)

`LineageProjection.resume` passed `tracks:` to a `Context` that takes `track_ids:` — **every résumé request raised `ArgumentError`**, while stats, contributors and the user serializer were all fine. It survived a syntax check and a read-through precisely because the broken call site is the one place no other path touches. Fixed in plugin `v1.0.4`, together with two seed-import defects: the dry-run resolved rider refs only against the database (so the first run of a fresh seed validated nothing), and unknown facet codes were dropped silently instead of warning.

The lesson for P2: the write endpoints have many more such single-call-site paths (confirm, decline, dispute, merge-on-claim), so each needs an actual staging exercise, not a review.

### 3.2 Vocabulary — the *shape* is fixed now, the *list* freezes on L12 (WAIT)
- **Verbs** (`relation`) are i18n keys with a subject-side and object-side rendering: `learned_from` → "Learned from · 向…学习" / inverse "Taught · 教过". `contributed_to` → "Built · 修建" when facets ⊆ `build.*` and the steward confirmed; "Contributed to · 参与建设" otherwise. Verbs are what the résumé rows and timeline entries print.
- **Facets** are dotted, namespaced codes; the plugin ships the list as a constant with `lineage.facet.<code>` i18n keys (forum en + zh_CN; landing en + zh-CN first). Adding a code = a list edit + two locale lines, never a migration. Starter proposal, two levels, ~30 codes:
  - `mx.*`: `fundamentals, cornering, jumping, whoops, starts, body_position` · `enduro.*`: `fundamentals, hard_enduro, navigation, hill_climbs` · `trials.fundamentals` · `wrench.*`: `maintenance, two_stroke, four_stroke, carburetors, suspension` · `race.*`: `racecraft, fitness, mindset` · `coach.coaching` · `trail.knowledge` · `build.*`: `design, earthwork, permits, funding, maintenance, general` · `other`.
  - The UI shows the top level as chips (MX / Enduro / Wrench / Racing / Coaching / Trail / Building) and sub-codes as optional detail — "3 tags max at first contribution", enrichment later (LINEAGE_INIT §2).
- **Honorifics**: `mentor` (Mentor · 导师), `coach` (Coach · 教练), `shifu` (师父 — the character with 父, the apprenticeship sense, not 师傅). Chips, only when mutual.
- **Years**: `(start_year, end_year, precision)`; approximate is the expected case.
- **Glyphs**: ○ reported · ✓ confirmed · ◇ documented · ⚠ disputed. ○ is the hero glyph for the first year.

### 3.3 API (plugin, `/dirtbikex/lineage/*`; controller shape copied from `tracks_controller.rb`)

Anonymous reads (edge-cacheable, uniform 404 for unknown/retracted/merged — no enumeration oracle):
- `GET /dirtbikex/lineage/riders/:slug.json` — **résumé payload** (§3.6 Q2): node, stats, edges grouped by relation/direction, timeline events
- `GET /dirtbikex/lineage/u/:username.json` — same, by claimed user
- `GET /dirtbikex/lineage/riders/:slug/stats.json` — counts only (§3.6 Q1) for `/s/u` and header stats
- `GET /dirtbikex/lineage/graph.json?root=…&depth=≤3` — v2 (explorer); the CTE exists in v1 for downstream counts
- `GET /dirtbikex/lineage/tracks/:slug.json` — contributors with facets + provenance
- `GET /dirtbikex/lineage/riders/geo.json` — L8: `map_visible` claimed riders `{slug, name, avatar, lat, lon}` with coordinates coarsened (~1 km grid), cached 300 s
- `GET /dirtbikex/lineage/claims/:token/preview.json` — bearer-gated preview for the claim landing

Login-required (own TL gate, `RateLimiter`, `LineageCaps` §3.7):
- `POST /dirtbikex/lineage/edges` (assert; "not on DirtBikeX yet" creates an unclaimed node + returns the claim link) · `POST …/edges/:id/confirm|decline|dispute` (resolved confirmer only) · `PUT …/edges/:id` (counterparty edit → back to `reported`) · `POST …/edges/:id/retract` (asserter or staff → tombstone) · `POST …/riders/:slug/claim {token}` (bind `user_id`; merge if the claimant already has a node; NULL the token) · `POST …/riders/:slug/claim` without token → `ReviewableDirtbikexRiderClaim` · `GET …/mine` (self lists + pending, the iOS/forum home) · `PUT …/riders/me` (own `known_for`, `riding_since_year`)
- Staff: `POST …/riders/:slug/assign {username}` · `POST …/riders/:slug/retract` · `POST …/riders/:slug/map_visible` · `POST …/users/:username/block` (L16)
- `add_to_serializer(:user, :dbx_lineage_counts, include_condition: lineage enabled)` — optional key, degrades to nil on old clients (the `dbx_claimed_track_count` template)
- Opt-out custom field `allow_lineage_claims_about_me` (follow's 5-field recipe)
- Lifecycle: `on(:user_anonymized)` + `before_destroy` → unbind rider, tombstone edges the user asserted; a named non-member has no hook → the support@ erasure path (§6) is manual by design.

### 3.4 Visibility / provenance projection (L5 confirmed)
Anonymous projection emits: claimed, non-hidden users' nodes; edges `reported` or `confirmed` between them (with glyph); `declined`/`disputed`/`retracted` never; unclaimed nodes as **placeholders** ("Unclaimed rider · reported by 老王") unless `name_public`. The two parties + staff see everything about their own edges. A `dirtbikex_lineage_visible` enum setting (copy of `FollowPagesVisibility`, default `everyone`) governs the read endpoints wholesale.

### 3.5 Confirmation channel (L6)
Reserve `Notification.types` **850 `lineage_reported`, 851 `lineage_confirmed`, 852 `lineage_disputed`** (non-adjacent to 800–802; documented in the plugin README and `NotificationType.swift`). Postless, `data ≤1000 chars` `{edge_id, display_username, relation, facets, year, rider_slug}`, 24 h dedupe, honoring the opt-out. Today with zero client work: FCM push → old iOS builds open the reporter's profile; forum web renders a real item via `api.registerNotificationTypeRenderer` linking to `/dirtbikex/lineage/pending`. Track-contribution confirmations go to the steward the same way.

### 3.6 Query plan — the surfaces' questions, and how each is answered (L7)

One JSON contract, three payload sizes; every renderer (Worker HTML, forum Ember, iOS) consumes the same shapes so a later surface is a renderer, not a query.

| # | Question | Surface | Query | Cost control |
|---|---|---|---|---|
| Q1 | **Counts** for one rider: mentors, students, downstream riders, generations, tracks contributed | `/s/u` strip, profile header stat, iOS header | direct: two indexed `COUNT`s on the edge indexes; downstream + generations: **bounded recursive CTE** over `learned_from` (depth ≤ 6, ≤ 2,000 nodes, cycle-guarded by a visited array) | `Discourse.cache` 5 min per rider, busted for the two endpoints of any edge transition (downstream counts may lag ≤ 5 min — accepted); Worker `cf.cacheTtl 300`; **materialize into `dirtbikex_rider_stats` (event-driven, ancestors up to the depth cap) when a scene passes ~2k nodes or p95 > 50 ms** |
| Q2 | **Résumé + timeline** for one rider: mentors (with facets, years, glyph), students, contributions, plus timeline events | `/lineage/<slug>`, forum profile view, iOS lineage list | three indexed selects (subject side, object side, contributions) + user/track lookups in one round trip; timeline = the same edges bucketed by `start_year` server-side (`riding_since_year` first, edges by year, "undated" bucket last) | one payload, no N+1 (preload users by id, tracks by id); cached like Q1 |
| Q3 | **Pending for me** (edges awaiting my confirmation, my claim banners) | forum `/pending`, iOS `mine.json`, notification counts | `object_rider_id = me AND provenance = reported` + steward-of-track resolution for `contributed_to` | tiny; indexed |
| Q4 | Contributors of a track | track sheet byline, track topic | `(object_type='track', object_id, relation)` index | cached 300 s |
| Q5 | Riders geo layer | map rail | `map_visible` riders join `user_custom_fields.geo_location`; coarsen | 300 s edge cache; row cap |
| Q6 | Ego graph depth ≤ 3 (explorer) | v2 landing explorer, iOS "how am I connected" | the Q1 CTE both directions with node cap 200 | v2; Redis overlay if it ever gets hot |
| Q7 | Abuse signals per user (§3.7) | `/review`, staff | `created_by_id, created_at` index → outcome ratios over 30 d | run on write (cheap) + a daily job |

Payload rules: numeric ids as identity + cached usernames; unclaimed nodes carry `placeholder=true` and no name unless `name_public`; the same `stats` object appears in Q1 and Q2 so the strip and the page can never disagree.

### 3.7 Abuse, reputation, caps (L16, L17)
- **Caps (settings, defaults):** `dirtbikex_lineage_max_mentors` 8 (confirmed + reported `learned_from` per subject — the concept's "1–3 tags, one relationship is enough"; more mentors than this is noise, not lineage), `…_max_pending_assertions` 5 per asserter, `…_max_unclaimed_created` 5 outstanding per user (frees on claim/retract), `…_max_contributions_per_track` 12, rate `…_assert_rate_per_day` 10; staff exempt; 0 disables. Checked before the row is written (no orphans) — the `ClaimCaps` idiom.
- **Reputation is provenance outcomes**, no new store: per asserter over a window, `confirmed / declined / disputed / retracted` counts from the `(created_by_id, created_at)` index. Rendered nowhere publicly (no FarmVille); used only by the flagger and staff.
- **Auto-flag → `/review`** (`ReviewableDirtbikexLineageAbuse`, target = the user): thresholds as settings — `declined + disputed ≥ 3` in 30 d, or ratio `(declined+disputed)/(asserted) ≥ 0.5` with ≥ 4 asserted, or ≥ 3 claim attempts on distinct nodes rejected, or a TL0/1 account asserting at cap on day one. On flag: **freeze** (no new assertions until staff clears) — automatic, reversible.
- **Permanent block** is a staff action on the reviewable or `POST /users/:username/block`: sets `dirtbikex_lineage_blocked` (user custom field), tombstones the user's `reported` assertions (confirmed ones stay — the counterparty vouched), keeps the rider row. Core `suspend`/`silence` remain available for the account itself. Every staff action → `StaffActionLogger.log_custom`.
- **Abusive confirmations** (v2 heuristics, flagged not blocked): reciprocal confirm rings between fresh accounts, one account confirming > N edges in an hour, honorific elevation on day-one edges. v1 has the rate limits and caps that make rings expensive.

---

## 4. Surfaces

### 4.1 Forum (Discourse) — the write surface, and the *only* place a session exists in v1
Minimal Ember, no profile tab in v1 (the native iOS profile can't show it and forum-web usage by the cohort is unproven):
- `/dirtbikex/lineage/pending` — "X says you taught them MX ~2016" with Confirm / Edit / Not accurate; steward view for track contributions.
- `/dirtbikex/lineage/claim/:token` — if logged out, stash the token in the session (core's `destination_url` idiom) → Logto login/signup → return → claim → land on `/pending`.
- `/dirtbikex/lineage/add` — the 3-screen "Who taught you? / Who have you taught? / What did you build?" flow; search hits the plugin's rider+user search; "not on DirtBikeX yet" → unclaimed node + claim link to share.
- Notification renderers 850–852. `/review`: rider claims, disputes, abuse flags (P4).
- The Follows-style profile tab (route map + `user-main-nav` connector) is a v2 renderer of Q2 (L19).

### 4.2 Landing page — the public READ surface (L7, L8, L19)
- Worker: `/api/lineage/{rider,stats,track,geo}.json` proxies with `cf: { cacheTtl: 300 }` (the `userLookup.ts` idiom) — no key, no CORS, no Data Explorer; add `/api/lineage/*` **and** `/lineage/*` to `assets.run_worker_first` in *both* wrangler blocks.
- **`/lineage/<slug>` — the rider résumé, worker-rendered** (render.ts style: no client JS, inline CSS, per-person OG, letter-avatar fallback): header (avatar, name, riding since, known-for chips), the Q1 stat strip, then résumé sections in LinkedIn order — *Learned from* (rows: mentor · facet chips · ~years · intensity · glyph · honorific), *Taught*, *Built / contributed to* (track · roles · glyph) — and a **vertical timeline** (year buckets from Q2: started riding → learned X from Y → built Z → students…). Placeholders for unclaimed nodes. CTAs: open in app / forum profile / "Is this you? Claim". Mobile-first; LINEAGE_INIT §7 says the timeline beats the tree on phones — the graph explorer is v2.
- `/lineage/claim?t=<token>` — previews the résumé-to-be and hands off to the forum claim route (§4.4).
- `/s/u/<username>` gains the Q1 strip via the proxy (`boldLead` + `.stats` CSS) — no new route, no AASA, no iOS release. `/s/l/<token>` (share card with OG) **only after** P5 ships `ShareKind.lineage`, else phones with an old app build dead-end.
- **Riders map layer (L8):** a `riders` toggle on the rail fed by `geo.json` — claimed + located + `map_visible` only; avatar pins; tap → mini card → `/lineage/<slug>`; coordinates coarsened server-side. Adding a layer today means touching the hard-coded `addLayers()`/hit-test/click chain (~135 lines, MAP_LAYERS_PLAN §7's LayerSpec refactor is unbuilt) — budgeted in P4. No people edges on the map in v1.
- Track sheet: "Built by @a ○" byline reusing the trail-author `.wm-by` block (P4).
- i18n: en + zh-CN properly for v1; the other 19 mirrors follow. New routes into `tests/no-external-assets.spec.ts`; zero new client dependencies.

### 4.3 iOS — its own release (P5, L10)
- **Independent time bomb, do first:** make the seven follow keys optional on `PublicUser`.
- Additive decode of `dbx_lineage_counts` (Int?) on `PublicUser` **and** `DetailedUser` + bridge; header stat → pushed `.lineage(username:)` résumé list copied from `StewardedTracksView` (own destination so rider→rider hops keep a back-stack); native Confirm / Not accurate off `mine.json`; the native 3-screen add flow; decode/route 850–852 + `PushPayloadParser` arm; `ShareKind.lineage = "l"`; distinct `LineageNode` Swift model (everything optional but id — `User.name` is non-optional).
- 21-language xcstrings batch (verbs, facets, honorifics, provenance, confirm copy).

**Built 2026-08-18 (iOS `170fa6eb`, docs `iOS/docs/LINEAGE_MODULE.md`) — deviations from the sketch above:**
- The résumé model is `LineageRider` / `LineageEdge` / `LineageResume`, not one `LineageNode` — the wire has three shapes (a person, a relationship, a whole résumé) and collapsing them would have made every field optional twice over.
- The add flow is **one** Form, not three screens: direction → who (debounced user search, or a plain name for someone not here yet) → year → facets. Three screens buys a progress bar and costs three taps on the only question that has to be easy.
- `ShareKind.lineage = "l"` **was added** (2026-08-18, second pass). It was deliberately skipped on the first pass — a share kind with no caller is a route to nowhere — and then became load-bearing the moment the landing page grew `/s/l/<username>`: `/s/*` is AASA-claimed, so that URL opens the app whether or not the app can route it, and a missing case is a dead-end on a blank screen. Identity-rendered like `.profile`/`.event`: `PushNotificationService` rewrites it to `.lineage(username:)` before the overlay presenter ever sees it.
- The header stat is `mentors + students + tracks`, not `students`: a learner who has only named mentors would otherwise get a column reading "0", which states something false about them. The row narrows 72 → 62 pt at five columns so an iPhone SE still fits.
- Notification decode is lenient (`try?`, like `.chat`) and 850 routes to the confirm queue in **both** the inbox and `PushPayloadParser`; 851/852 route to the other party's résumé.
- 87 catalog keys × 21 languages. Facets/honorifics/provenance are looked up by runtime code, so `LineageVocabulary` humanizes an unknown code instead of printing the key — a server-side vocabulary addition degrades to a readable label on a shipped build.
- **Not verified:** dbc has no Swift toolchain, so nothing here has been compiled. `python3 scripts/i18n/validate.py --strict` is green (0 missing across all 21 languages, no symbol collisions); everything else needs Xcode.

### 4.4 E2E: Rubio onboards a track owner who has no iPhone (least friction)
1. Conversation → operator writes one JSONL line per person + edges into the private seeds repo (L14): `external_id`, names, `probable_user` if they already have a forum account, edges with facets/~years, `name_public` only if they agreed on the spot.
2. `rake dirtbikex:lineage:import[file] --dry-run` → diff → import on staging → the résumé exists at `/lineage/<slug>` (placeholder-named unless consented) with every edge ○.
3. Operator copies the claim link (`www/<apex>/lineage/claim?t=…`, from `mine`/staff UI) and sends it by WeChat.
4. Recipient opens it on **any** phone/desktop → sees the preview ("老王's riding résumé · 3 students reported · Is this you?") → *Claim* → forum web (Logto login or signup: email today; phone OTP is not wired — P0 verifies this path end-to-end incl. WeChat's browser) → the token binds the node → `/pending`: confirm/decline each edge, fix years, add a mentor, add someone they taught → their unclaimed additions get their own claim links.
5. Their `/lineage/<slug>` is now name-public (their own profile), the `/s/u` strip lights up, the notification/push reaches the counterparties who have the app.
No iPhone required at any step; the app becomes the nicer surface in P5. If web login/signup fails the P0 check, v1 falls back to operator-assisted claim (staff `assign` after the person registers) — say so before promising the loop.

---

## 5. Phases (each shippable + verifiable on staging; solo-operator estimates, already ×1.5)

| Phase | Scope | Verify | Days |
|---|---|---|---|
| **P0 — Decide + contract check** | remaining OPEN rows; **prod (dbx) inspected** (follow enabled?, `follow_*_visible`, `login_required`, core SHA, `/u/<name>.json` seven-key contract); **web login/signup via Logto tested as a first-time visitor on desktop + WeChat browser**; Terms/Privacy amendment drafted for counsel; seeds repo created; seed JSONL template | facts recorded here; login verdict recorded | 1–2 |
| **P0.5 (optional, L11)** | R2 `lineage.json` + `handleMapDoc` — consented names only; retired when P1 lands | preview renders the seeded scene | 1–2 |
| **P1 — Graph core in the plugin** ✅ **BUILT + VERIFIED ON STAGING 2026-08-17** (plugin `v1.0.4`; §3.1b) | second top-level block; settings; migrations (§3.1); models + `Rider.mint_slug` + trilingual search + relation/facet validation + confirmer resolver + bounded CTE; `rake dirtbikex:lineage:import` (upsert on `external_id`, `curated_fields` skip **with** `--override=`, `--dry-run` diff, `probable_user` like `ClaimHintImporter`) + `…:retract`; anon reads Q1/Q2/Q4 + counters + opt-out; lifecycle hooks; specs incl. a request spec pinning the `/u/<name>.json` key set | plugin on staging; seed imported; `riders/<slug>.json` returns résumé + stats with placeholders; re-import no-op; `/u/calvin.json` diff shows only the new optional key | 5–7 |
| **P2 — Claim → confirm → expand** ✅ **BUILT + VERIFIED ON STAGING 2026-08-17** (plugin `v1.0.5`/`v1.0.6`) | assert/confirm/decline/dispute/edit/retract; claim tokens + claim + merge + session stash; caps + TL + rate limits + auto-freeze flagger; notification ints 850–852; Ember: pending, claim, add, renderers | two staging users: A adds B as mentor → B gets push + web item → confirms → ✓; A adds unclaimed 小陈 → claim link → C claims logged-in → edge re-points; opt-out D cannot be named; A hits `max_pending` → 422 | 6–8 |
| **P3 — Landing résumé + timeline** ✅ **BUILT + PREVIEW-DEPLOYED 2026-08-17** (landing `v1.0.7`) | `/api/lineage/*` proxy; `run_worker_first` both blocks; worker-rendered `/lineage/<slug>` (résumé + timeline + OG); `/lineage/claim?t=`; `/s/u` strip; en + zh-CN; allowlist test rows | preview deploy: `/lineage/<seed-slug>` renders résumé + timeline with placeholders/glyphs; Playwright allowlist green under the systemd-run cap; `/s/u/calvin` shows the strip; a claim link on a phone without the app lands on the web page | 4–5 |
| **P4 — Tracks, adjudication, riders layer** ✅ **BUILT + VERIFIED ON STAGING 2026-08-18** (plugin `v1.0.7`, landing `v1.0.10`) | `contributed_to` edges + steward confirmation; `tracks/:slug.json`; `ReviewableDirtbikexRiderClaim` / `…LineageEdge` (disputes) / `…LineageAbuse` + block action; forum profile view of Q2 (first renderer beyond landing, L19); track-sheet byline; **riders map layer** (`geo.json`, rail toggle, avatar pins, coarsening) | A asserts "built Xinchang MX" → the track's steward gets 850 → confirms → sheet byline ✓; B disputes → /review → retract; abuse threshold → freeze → /review; located + approved rider appears on the preview map, unapproved does not | 5–7 |
| **P5 — iOS release** ✅ **BUILT, UNRELEASED 2026-08-18** (iOS `170fa6eb`; needs an Xcode build + on-device pass) | §4.3 (follow-keys fix first) | on-device: stat → résumé → confirm; push 850 routes to pending; xcstrings ×21 | 6–10 |
| v2 | graph explorer (Q6), skills filter, degrees-of-separation, region genealogy, attestations, people edges on the map, `lineage-feed` filter (§2.5), CRM `people` prospecting table if seed volume warrants | — | — |

Totals: web loop P0–P3 **~17–22 days**; + P4 + P5 **~28–39**. Batch server phases — every plugin change is a `launcher rebuild app` forum-downtime event.

---

## 6. Still open for the operator (everything else is marked in §0)

1. **L13 — Terms §5 / Privacy / PIPL** before prod enablement; the erasure channel for a named non-member (support@ + 24 h ToS SLA; retract-as-tombstone vs hard delete).
2. **L11 — seed doc fast path**: only if a campaign date needs a seeded scene before P1 (~2 weeks in).
3. **L12 — vocabulary list** (§3.2 starter) whenever ready; the shape no longer blocks P1.
4. **Cohort + web login reality** — P0 verifies Logto web signup/login for a first-time visitor (desktop + WeChat); if it fails, v1 claim is operator-assisted (§4.4 last line).
5. **iOS appetite for P5 this quarter** (21-locale batch) — otherwise the app stays at "generic row + landing" for the first campaign.
6. Independent of lineage: the follow-keys "Profile Hidden" time bomb in shipped builds; the deployed `/srv/dirtbikex/infra/app.yml` embeds a plaintext GitHub PAT in three clone lines (rotate / build arg); prod parity never inspected.

---

## 7. What lineage reuses

| From | What |
|---|---|
| event-filters plugin | entity+claim model, `TrackClaim.claim!` reopen semantics, `ClaimCaps`, `RateLimiter` + TL gate, `ReviewableDirtbikexTrackClaim` (model/serializer/gjs/locales), `Track.mint_slug`, trilingual `Track.search`, `merged_into_id`, `dirtbikex_catalog.rake`, `ClaimHintImporter` identity rule, lifecycle hooks, `add_to_serializer(:user, :dbx_claimed_track_count)`, anon-read/`ensure_logged_in`-write controller shape, uniform-404; **active steward lookup** for track-contribution confirmation |
| discourse-locations | user `geo_location` (already editable + serialized) as the rider location for L8 |
| discourse-follow (patterns only) | route map + `user-main-nav` connector (v2 tab), `FollowPagesVisibility` enum setting, postless notification creation w/ dedupe, 5-field custom-field opt-out recipe, `add_filter_custom_filter` (v2 feed) |
| Landing Worker | `/s/u` card + `boldLead`/`.stats`, `render.ts` (no-JS HTML + letter avatars + OG + RTL), `userLookup.ts` cached anon fetch, trail-author `.wm-by` byline, layer-rail registry, `no-external-assets.spec.ts` |
| iOS | `StewardedTracksView` + `.stewardedTracks` destination, `ProfileHeaderView.statsRow`, `NotificationType` coverage-matrix convention, `PushPayloadParser`, `ShareKind` family, `ClaimTrackBanner` host for "someone named you" |
