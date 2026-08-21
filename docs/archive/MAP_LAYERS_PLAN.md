# MAP_LAYERS_PLAN.md — The layer rail, and the entity migration that has to come first

**Status: §3, the render budget, the rail (§6) and trails (§3b) are all BUILT and deployed to staging on 2026-08-14 — see CONCRETE_MAP_PLAN §Round 11 and §Round 12. What remains is shops (§4) and the migration (§5).** Companion to [CONCRETE_MAP_PLAN.md](CONCRETE_MAP_PLAN.md) (what the map is today) and [CRM_MIGRATION_PLAN.md](CRM_MIGRATION_PLAN.md) (where entity data lives). Grounded in read-only recon of the island, the CRM, the plugin, the staging forum, and OSM/Overpass — every count below is measured, not estimated.

**One sentence:** a vertical rail of layer toggles at the map's top-trailing edge turns the map from "a lot of track pins" into a world with kinds of places in it — but only one kind has data today, so the rail is built behind the entity migration rather than in front of it.

---

## 0. Decisions (operator, 2026-08-14)

| # | Decision | Status |
|---|---|---|
| L1 | **"My route" = the 100-track series overlay** (HUD + episode markers), not a personal route. No accounts, no new identity work | **DECIDED** |
| L2 | **Episodes bind to catalog track entities**, not hand-entered coordinates. The venue is a place in the catalog; the episode points at it | **DECIDED** |
| L3 | Shops: **steward/community submissions for prod (long run)**; **OSM-derived demo layer on STAGING ONLY** so the rail can be shown working before real submissions exist | **DECIDED** |
| L4 | ~~Surface the rail when a second real layer exists~~ — **REVISED by the operator 2026-08-14**: the 100 challenge *is* the second layer, and being able to switch it off is the point. Rail shipped with tracks / trails / the 100 challenge | **SHIPPED** |
| L5 | **CRM_MIGRATION_PLAN option C is signed off**: published entities live in the plugin's Postgres tables, the map reads a bulk endpoint, the CRM stays the private outreach surface. Phases 1–2 in scope | **DECIDED** |
| L6 | **Amenities are explicitly NOT this round** — Phase 2 here means the `kind` axis (track / shop), nothing else | **DECIDED** |
| L7 | Rail position, collapse behaviour and glyph set | **SETTLED in the build**: top-trailing under the header, no collapse (three buttons don't need one), line-art glyphs matching the control language, struck-through when off |

---

## 1. The data reality this plan is built on

Measured 2026-08-14. This table is the whole argument for the sequencing.

| Proposed layer | What exists today | Verdict |
|---|---|---|
| **Tracks** | 3,640 baked features (1,845 verified / 1,795 breadth); 1.2 MB raw, **163 KB gz** | Ships. The only layer with mass |
| **Shops** | **Zero.** No CRM column, no plugin table, no scraper, no iOS model anywhere in the project | Needs a source *and* the migration |
| **Trails** (GPX lines) | **Zero organic.** 7 uploads on staging, all synthetic test files from 2026-08-10 | Needs real rider content |
| **Events** | 5 live on staging, **0 upcoming**, exactly 1 geolocatable (via `track_id`); events carry no coordinates of their own | A toggle would render one pin |
| **Claimed / stewarded** | 3 active claims | A filter chip, not a layer |
| **My route** → series | 3 episodes, already drawn | Ships (see §3) |

And within tracks, the category axis is far thinner than it looks:

| category | count | as its own toggle |
|---|---|---|
| motocross | 3,515 | the map |
| trail_area | 48 | moves nothing |
| club | 39 | moves nothing |
| riding_park | 28 | moves nothing |
| ebike_park | 9 | moves nothing |
| other | 1 | — |

**So category is a filter *inside* the tracks layer, never a row of toggles.** Four of five buttons would look broken. `tier` (1,845 / 1,795) is the only axis in the current data with a real bipartition.

---

## 2. Layer taxonomy

Five layers, in rail order. Type on the rail; state (verified / claimed) stays a filter, per the type ⊥ state rule established in CONCRETE_MAP_PLAN §4.3.

```text
┌────┐
│ 🏁 │  TRACKS      places to ride — category filter lives inside this layer
│ 🔧 │  SHOPS       service, parts, mechanics
│ 〰️ │  TRAILS      recorded GPX lines promoted from the forum
│ 🎬 │  THE RIDE    the 100-track series: episode markers + journey line + HUD
│ 📅 │  EVENTS      race days and meets, positioned through their track
└────┘
```

- **THE RIDE** is L1's "my route": it is the existing series overlay promoted from a hidden mode (currently only reachable by clicking the HUD counter) into a first-class, discoverable toggle. Zero new data.
- A layer with no data is **not rendered in the rail at all** (L4) — no greyed placeholders.
- Counts ride on each button, so the rail doubles as the legend the map currently lacks.

---

## 3. The series overlay, bound to catalog entities (L2)

Today `series.seed.json` carries hand-entered `coords` per episode. That was always the fallback path; the `track_slug` field has existed since the first draft and is the correct one. Both riding venues **are already in the catalog**, verified, with coordinates:

| Episode | Catalog slug | Name | Locality | Category | Coordinates |
|---|---|---|---|---|---|
| **01** | `cn-hu-zhou-yue-ye-shan-ye-ying-di` | 湖州越野杉野营地 | 浙江·湖州 | **motocross** (verified — corrected 2026-08-14) | 30.816235, 120.080339 |
| **02** | `cn-qiu-long-ke-ji-hang-zhou-yue-ye-ji-di` | 虬龙科技杭州越野基地 | 浙江·杭州·西湖区 | ebike_park (verified) | 30.117044, 120.038839 |
| **00** | — | West Lake, Hangzhou — a scene-setter, not a riding venue | — | — | keep inline coords |

### ✅ Applied 2026-08-14 — this had been a live data error

Episode 02 was seeded at **30.2374, 120.15** — the "柳浪闻莺 / Liulang Wenying" pin taken from a burned-in caption in the footage — while the actual riding venue is 虬龙科技杭州越野基地 at **30.117044, 120.038839**, about **15 km away**. Those West Lake coordinates belong to **episode 00**, the opener, which is a scene rather than a venue; they now sit there. Episodes 01 and 02 carry `track_slug` instead of coordinates, so the position comes from the catalog and a steward correcting a track's pin corrects the episode with it.

The Huzhou venue was also mis-categorised as `ebike_park`; it is a real **motocross** park. Corrected in the dev checkout *and* the deployed CRM copy (the two-copies scar), then re-baked: motocross 3,515 / ebike_park 9.

---

## 3b. Trails: tied to the rider who recorded them (operator, 2026-08-14)

A promoted GPX is somebody's ride, so the trail carries its author as a **forum identity**, not a name string.

**Data.** A `trails.json` entry gains `author_user_id` — the Discourse numeric user id — as the canonical author field. The id is stored rather than the username because **usernames can be changed and the link would rot**; the id never moves.

**Resolving id → username.** There is no anonymous core endpoint for this: `/u/<username>.json` is anon-readable (that is what `worker/_lib/userLookup.ts` already uses) but `/admin/users/<id>.json` returns 404 without a key — verified against staging. Two workable paths, in preference order:

1. **A Data Explorer query**, exactly mirroring the invite lookup that already exists (`FORUM_INVITE_QUERY_ID` = 1 prod / 2 preview, run with the scoped `FORUM_API_KEY`). Add a `select username from users where id = :user_id` query, a `FORUM_USER_QUERY_ID` var per env, and resolve in the worker with an edge cache. **Operator step:** the query must be created in Discourse admin per environment, like the invite one.
2. **Cache the username at promotion time as a fallback.** The promotion flow already starts from the forum post, and `/posts/<id>.json` returns `user_id` and `username` together (verified anon). Storing the username alongside the id costs nothing and keeps the link working if the query is unavailable; the id remains the source of truth and re-resolves on a rename.

**Link target.** `<apex>/s/u/<username>` — already live and verified: it returns a real profile card with the rider's display name and avatar (`/s/u/calvin` → "Monkeyboi (@calvin) · DirtBikeX", 200), carries per-entity OG tags, and already has an app deep link (`dirtbikex://s/u/<username>`). No new route needed.

**Trail sheet.** Same treatment as an episode sheet's platform row: a row of brand-style marks under the trace, sharing the `.wm-social` styling — the rider's profile as one mark (avatar or person glyph), the forum thread as another, and "Open in gpx.studio" as the outbound link. Consistent with the TikTok/Instagram/Facebook row rather than a separate visual language.

**BUILT 2026-08-14.** Path 2 (cache the username in the doc) is what shipped — the operator chose storing the post reference and username in the seed JSON, so no Data Explorer query and no per-environment operator step. `author_user_id` stays the identity; `author_username` is the cached resolution the link uses; `post_url` is optional and its mark is omitted when absent.

**Superseded 2026-08-15 — geometry no longer lives in the doc.** The operator rejected baking it: a trail should behave like a track, storing metadata only, with the line fetched on demand so the payload stays flat as the catalog grows. `trails.json` is now a centre, a bbox, the ride's stats and the file URL (5,766 → 1,033 bytes); the GPX is fetched **on tap** from `uploads-cdn.<apex>`, which serves `ACAO: *` and already matches the no-external-assets allowlist — so the invariant never needed challenging, and the `/uploads/short-url/` form must never be used at runtime because it 302s to the raw bucket host, which does not match it. Published with `push-map-data.mjs --doc trails`; `/api/map/trails.json` shares the series handler and falls back to the committed seed.

**Data reality unchanged:** one real trace is seeded (`xihu-easter-egg`, the DBX doodle over West Lake). The other staging uploads are synthetic, and route-point files are refused by the importer. The layer fills as riders post.

**Amended 2026-08-18 — the seed stopped being the source, and a post id became enough.** Two changes, both from `PROD_INSTALL_DEBT.md`:

*Where trail data lives.* The committed seed was doing two incompatible jobs: `astro dev` fixture (wants content) and R2-outage fallback served to **both** environments (must want nothing environment-specific). It resolved in favour of dev, so prod inherited a staging trail attributed to a staging user whenever R2 hiccuped — and `alpha.2` made all four layers default-on, which widened that from "a curious visitor" to "everyone". Now:

| File | Role |
|---|---|
| `fixtures/map/<env>/{trails,shops}.json` | canonical environment content; pushed to `r2://dbx-map/<env>/`, never copied into `dist/` |
| `public/map/{trails,shops}.seed.json` | `{"…": []}` — the truthful outage answer for either environment |
| `public/map/series.seed.json` | unchanged: real product content, identical in both environments, so it has no fixture and pushes from the seed |

`tests/map-seeds-neutral.spec.ts` fails CI if a seed names an environment, carries a placeholder slug, or stops being empty — and if a fixture references the *other* environment's forum. That is what retires the after-every-install ritual: the bad state is now unrepresentable, not merely absent.

*How a trail gets in.* `scripts/import-forum-trail.mjs --post <id> --env <env>` derives everything from the anonymous `GET /posts/<id>.json`: the author (id, username, display name, avatar) from the post, the back-link from its topic, the title from the topic, and the `gpx_url` by following the attachment's short URL **once, at import time**, and keeping only the sha1 to rebuild the `uploads-cdn.<apex>` form. That last step is why the runtime rule above is never violated: the short URL is resolved by the importer, never by a visitor. `import-gpx-trail.mjs` remains for a file with no post behind it; both share `scripts/lib/gpx-trail.mjs` so their numbers cannot drift.

*The trap that made a release ship nothing.* R2 wins over the bundle, so editing a seed and deploying changes nothing until it is pushed. `push-map-data.mjs --check` diffs the source against the live `/api/map/<doc>.json` and exits non-zero on drift; run it before calling a seed change shipped.

## 4. Shops: two sources, two environments (L3)

**Prod — steward and community submissions.** Riders and track stewards submit real dirt shops through the forum, reusing machinery that already exists: the claims flow, `curated_fields` protection, and the reviewable queue. Slow to fill, dirt-relevant by construction. This is the only source recon found that survives the relevance test.

**Staging — an OSM-derived demo layer**, so the rail can be demonstrated working before submissions exist. This is allowed *only* under four conditions, and they are not optional:

1. **Regional cut, never global.** The global extract is ~47,400 features ≈ **2 MB gzipped** — twelve times the current map payload on a page whose entire map budget is ~250 KB gz. Cut to the demo regions (CN, plus whatever is being shown).
2. **ODbL notice, attribution, and a download link on the staging page.** A GeoJSON file the browser parses is a *Derivative Database*, not a Produced Work — the OSMF test is whether the published result is intended for extraction of the original data, and ours is. Share-alike attaches.
3. **Never merged into our entity graph.** This is the trap: under the Collective Database Guideline our data stays clean only while each dataset is *all OSM* or *all ours* within a region. The moment an OSM shop row lands in `dirtbikex_tracks`, or an OSM POI is used to geocode one of our tracks, **the entire published entity graph becomes ODbL**. The staging shops layer must be a separate file and a separate table, flagged `source='osm'`, excluded from every export that feeds the catalog.
4. **Removed or replaced before prod.** Prod ships submissions only.

Recon numbers behind this: `shop=motorcycle` 34,223 · `shop=motorcycle_repair` 12,358 · `shop=motorcycle_parts` 826 (DE 2,303 / US 2,156 / FR 2,006 / CN 494). Dirt relevance measured in Germany: **30 of 2,303 = 1.3%** — the rest are scooter shops and road-bike dealerships. `motocross:type` exists but has 415 uses worldwide. OSM's real value here is as a **private prospecting list for CRM outreach** (never published, therefore no ODbL exposure at all), which is how prod should use it.

---

## 5. Migration (L5, L6) — option C, Phases 1–2

Option C is signed off: **the plugin's Postgres tables are canonical for the published entity graph; `contacts.db` stays the private outreach surface; the funnel stays one-way.** This feature is what forces it — a layer rail over stale operator-run bakes would show a world that disagrees with the app.

**Phase 1 — the map reads Postgres.** Already specified in CRM_MIGRATION_PLAN §4 with its two prerequisites, both still required:
- a tier gate on `listable` surfaces (it currently includes `unverified`, so an unguarded breadth import would dump 6,139 rows into the iOS picker), and
- an audit-logged `curated_fields` override, so the pin-fix runbook stops silently no-opping on steward-edited rows.
Plus a coords-only, bake-shaped GeoJSON endpoint and a documented pg rollback. **3–4 days.**

**Phase 2 (this scope only) — the `kind` axis.** `kind` on the entity table with values `track` and `shop`, the CRM gaining shop rows, and the export/import extended. **Amenities are explicitly out of this round (L6)** — the map keeps shipping `amenities: []` as headroom and nothing reads it.

**New rule for Phase 2, from §4:** an ODbL firewall. OSM-derived rows never enter the published entity tables; the staging demo layer lives beside them, never inside them.

---

## 6. The rail — UI specification

**Space is not the constraint.** Measured on the live map: the top-trailing band is free from y≈76 down to the bottom-right controls — **600 px on desktop, 608 px at 390 px wide** — room for about eleven 44 px buttons. Restraint is the constraint; the taxonomy is five.

**Placement.** Top-trailing, starting below the fixed 64 px header. Buttons ~44 px (46 px on touch), stacked vertically with a 10 px gap, glass surface matching the existing control language.

**The desktop panel collides with it.** `.wm-panel` currently sits at `top: 80px; right: 20px; width: 372px` — exactly where the rail goes. The panel must shift left to clear the rail column (right: 20 → ~88) rather than the rail hiding when a pin is selected; losing the toggles the moment you inspect something would be the wrong trade. On mobile the panel is a bottom sheet, so there is no conflict.

**The tap-shadow scar applies directly.** The recenter control was recently unreachable because a wide transparent scroll container sat over it with a higher z-index. The rail must keep its box tight to the buttons — no full-height wrapper — carry `pointer-events: none` on the wrapper with `auto` on the buttons, and be hit-tested with `elementFromPoint` before it is called done. Screenshots will not catch this class of bug.

**Behaviour.**
- Each button: glyph, active state, and a count. Label on hover at desktop; icon-only on mobile.
- Data loads **on first enable**, not at boot — the pattern already exists in the carousel's IntersectionObserver loader. Tracks stay eager (it is the default view); everything else defers. This matters: `tracks.json` alone is 1.2 MB fetched before the gate clears today.
- A failed load returns the button to off with a tooltip, never a blank layer.
- Visibility persists in `localStorage`, and mirrors to `?layers=` so a filtered view is shareable.
- `role="group"`, `aria-pressed` per button, keyboard reachable.
- The LangSwitcher dropdown (z 60, 220 px) overlays this corner when open — acceptable, but the rail must sit below it, not fight it.

---

## 7. Island refactor

Recon puts this at **~250 lines touched, no new dependency**. The shape:

A `LayerSpec` registry — `{ id, label, glyph, kind, url, sourceId, layerIds[], hitLayers[], dimLayers[], haloLayer, idProp, renderCard() }` — plus `layers: Map<string, LayerState>` holding `{ visible, loaded, data }`. Then these stop being single-dataset:

| Function | Now | Becomes |
|---|---|---|
| `addLayers()` | 135 lines, hard-codes the `tracks` source and six layers | iterates the registry; the tracks block becomes one spec |
| `wireInteractions()` | `const hit = ['tracks-dot']` | `hit` derived from visible specs; click dispatches on `feature.layer.id` |
| `setDimmed()` | names `tracks-dot/glyph/label` | loops visible specs' `dimLayers` |
| `setHalo()` | filters `tracks-halo` on `slug` | per-spec halo id and `idProp` |
| `selectTrack()` / `flyToSlug()` / `applyDeepLink()` | slug-only | `select(specId, id)`; one deep-link param per spec |
| `panel.showTrack()` / `trackInfo()` | track schema only | card renderer supplied by the spec |

**The one hard constraint:** `setStyle` drops every source, layer and runtime image, and `applyTheme()` rebuilds by re-running `addLayers()`. **Anything added outside that path disappears on the next theme toggle** — so per-layer visibility must be replayed there, exactly as selection and dim state already are.

---

## 8. Phasing

| Stage | Work | Ships |
|---|---|---|
| **0 — data correction** | Bind episodes 01/02 to their catalog slugs; re-push R2 | Immediately, on your word (§3) |
| **1 — plumbing** | LayerSpec registry, lazy `ensureLayer()`, restyle replay, per-kind panel cards. Rail **not yet surfaced** | Invisible refactor; map behaves identically |
| **2 — migration** | Option C Phase 1 (map on Postgres, both prerequisites), then Phase 2 `kind` axis | Live catalog, no stale bakes |
| **3 — layer #2** | Staging: OSM demo shops under §4's four conditions. Prod: shop submission flow | **The rail appears** — Tracks, Shops, The Ride |
| **4 — later** | Trails once real GPX exists; Events once there are upcoming ones; amenities (deferred by L6) | Rail grows |

Estimates: stage 1 ≈ 1–2 days; stage 2 = 3–4 days (Phase 1) + 2–4 days (Phase 2, `kind` only); stage 3 ≈ 2–3 days split across the demo extract and the submission surface.

---

## 9. Risks

1. **The ODbL firewall is the highest-consequence rule here.** One OSM row in `dirtbikex_tracks` relicenses the published entity graph. It needs to be a documented invariant on the import path, not a habit.
2. Staging is publicly reachable, so the demo shops layer carries real ODbL obligations there — attribution, licence notice, and a download link — not just "it's only staging".
3. A rail whose layers are empty reads as broken; L4 exists to prevent that, and stage 3 is the gate.
4. The tap-shadow class of bug is now twice-proven on this map. Hit-test overlays with `elementFromPoint`.
5. Phase 1's tier gate is load-bearing: without it the breadth import changes the iOS picker's behaviour, not just the web map's.
6. Layer payloads compound. Tracks is already 163 KB gz; lazy loading is what keeps the rail from turning the homepage into a megabyte of GeoJSON.

---

## 10. Open

- **L7** — rail mock: glyph set, collapsed vs always-expanded on mobile, count-badge treatment.
- Whether episode 00 keeps inline West Lake coordinates or is dropped from the map entirely (it is a scene-setter, not a venue).
- Which regions the staging OSM demo cut should cover.
- Whether "The Ride" toggle replaces the HUD counter's current series-mode click, or both remain.
