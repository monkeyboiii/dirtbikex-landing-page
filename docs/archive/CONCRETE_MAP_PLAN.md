# CONCRETE_MAP_PLAN.md — The DirtBikeX World Map (www homepage)

**Status: BUILT + DEPLOYED TO STAGING 2026-08-13 (rev 3).** The MVP described here is live at `www.dirtbikechina.com`. This doc stays the design record; §13 lists exactly what shipped and where it deviates. Supersedes `MAP_PLAN.md` (kept for reference; its ideas are dispositioned in §2). Companion doc: [CRM_MIGRATION_PLAN.md](CRM_MIGRATION_PLAN.md) (where the entity data should canonically live as shops/amenities arrive). Recon basis: landing repo, contacts CRM, event-filters plugin, video-master, iOS track map, GPX-preview component, and current web-map ecosystem facts (2026-08-13).

**One sentence:** `www.dirtbikex.com/` becomes a full-viewport, always-dark interactive world map — the global track catalog is the terrain, the *Visiting 100 Dirt Bike Tracks* journey (app-community S03) is the story layer, community trails and future shops/amenities join the same world — while every existing landing job (join, app CTAs, legal, i18n, share cards) survives as overlay chrome and untouched routes.

---

## 0. Decision log

| # | Decision | Status |
|---|---|---|
| D1 | Homepage = **full-map takeover** (map is the page; existing header overlaid; footer/stats/legal in a slim drawer) | **DECIDED** 2026-08-13 |
| D2 | Catalog pins = **all tracks with coords (~3,640), tiered**: verified bright, breadth dim | **DECIDED** 2026-08-13 |
| D3 | Story state source of truth = **operator-curated `series.json`, hosted in R2 and overwritable without a redeploy** (repo copy is canonical, R2 is the live projection). Production states `visited` → `live`. Explicitly NOT derived from video-master — manifests lag reality (E002 is already posted — operator-attested — while its manifest says `scripting`) | **DECIDED** 2026-08-13 (R2 revision same day) |
| D4 | ~~Map is always dark~~ → **REVERSED 2026-08-13 (round 2): the map follows the site light/dark toggle.** `style-light.json` is a recolor of the dark fork (identical layer ids/order/source/font stack) so the island's layers survive `setStyle` | **DECIDED + BUILT** |
| D5 | Renderer = **MapLibre GL JS v6** (globe projection at world zoom) | DECIDED-BY-CONSTRAINT (§5.1) |
| D6 | Tiles: **hosted OpenFreeMap dark fork SHIPPED for MVP; self-host later** — the final tile architecture is deliberately HELD. Provider proposal for MVP: OpenFreeMap dark style, forked + self-hosted style JSON (§5.2) | **DECIDED (hold)** 2026-08-13; provider PROPOSED |
| D7 | Track data = **deploy-time GeoJSON bake from the CRM export**, committed into the landing repo (graduates to a plugin bulk endpoint per CRM_MIGRATION_PLAN Phase 1) | PROPOSED |
| D8 | Claimed-state source V1 = curated slug list in `map-data/config.json` (R2-pushed, ≤5-min updates); documented drift risk — invite-path claims are born ACTIVE with no operator action; the V1.5 anonymous plugin endpoint is the real fix | PROPOSED |
| D9 | No framework island — vanilla TS module bundled by Astro/Vite (keeps the site's zero-framework posture) | PROPOSED |
| D10 | HUD progress bar = **dotted connectors + filled balls (done) / empty balls (upcoming); hover/tap a ball opens an info popover.** The bar is the journey's *activity sequence*: main episodes plus side entries (2.5-style skits), each side entry individually shown/hidden by flag | **DECIDED** 2026-08-13 (operator spec) |
| D11 | Entity headroom now: map schema carries `kind` + `amenities[]`; a track with a shop on site gets a **wrench badge** on its card. Shops/amenities as real data = CRM_MIGRATION_PLAN Phase 2 | **DECIDED** direction 2026-08-13 |
| D12 | Community trails layer: operator-promoted forum GPX → **GPX copied into R2 at promotion** + `trails.json` → native MapLibre polyline, click-to-load (same-origin); gpx.studio is an outbound link only (never an embedded iframe on the landing) | PROPOSED (V1.5 module, mechanism fixed now) |
| D13 | ~~Mobile tap-to-load~~ → **REVERSED (round 2): the map auto-initialises everywhere** — the gate added friction for no benefit and is now just a loading backdrop. Either way the opening camera sits on the **latest `live` episode**. A HUD ball moves the camera only; the card opens from the **pin**. | **DECIDED + BUILT** 2026-08-13 |
| D14 | Hero / Features / FeaturedTopics / FAQ **stay in source, unreachable** — no home chosen yet | **DECIDED** 2026-08-13 (operator will place them later) |
| D17 | Opening + every camera move lands at **city zoom** (~10.4 desktop / 9.8 narrow) — "show me Hangzhou", not "show me Asia" | **DECIDED + BUILT** round 2 |
| D18 | **Recenter-to-current-episode** control, stacked with the zoom buttons under the header (bottom-right is taken by attribution + CTA). Recenter-to-user-location is explicitly a later round | **DECIDED + BUILT** round 2 |
| D19 | Mobile chrome diet: **no floating Join pill** (it ate a third of the map and duplicated the header), header "Get the app" collapses to an **Apple mark**, language picker shows the **locale code** (`en`, `zh-CN`), drawer handle reads **"About"** | **DECIDED + BUILT** round 2 |
| D15 | Marker glyphs = **engineer-drawn SVG mocks** at `public/map/markers/` (24×24, `currentColor`); a UX designer replaces them behind the same contract | **BUILT (placeholder)** 2026-08-13 |
| D16 | Entity-store migration (CRM SQLite vs Discourse Postgres) | See [CRM_MIGRATION_PLAN.md](CRM_MIGRATION_PLAN.md) — recommendation = split-canonical (option C), awaiting sign-off |

---

## 1. Product statement

The map answers *"what's out there, and where has the journey been?"* — not "how do I get somewhere." Emotional loop kept from MAP_PLAN: **explore → discover → watch → join.**

Primary use case at launch (pre-App-Store, waitlist era): a visitor lands on a dark globe, sees a living world of tracks, sees `VISITING 100 DIRT BIKE TRACKS — 02/100`, clicks a numbered mission marker, gets the episode card, watches, and hits **Join DirtBikeX**. The map is simultaneously the brand image, the series tracker, and the top of the invite funnel.

The same world is built to absorb what comes next without remodeling: side-quest entries on the journey bar, community trails, shops and amenities as they enter the data — MAP_PLAN's "world map as the product model" idea, kept.

Secondary (passive): "there are tracks near me" discovery — served by pin density, not by search/routing features (those stay in the iOS app).

---

## 2. Disposition of MAP_PLAN.md

### Kept (and made concrete)
| MAP_PLAN idea | Where it lands here |
|---|---|
| §12 homepage *is* the map | D1; §4.1 layout |
| §3 icon vocabulary, **type ⊥ state** separation | §4.3 — state axis instantiated on *real* data tiers (breadth / verified / claimed / episode), type axis = category glyph (real `category` column exists) |
| §4 series as a **layer**, never the data model | Catalog GeoJSON = the world; `series.json` = one curated journey overlaid on it. Future series reuse the same mechanism (§9 V2) |
| §5 location → story click panel, episode-first | §4.5 panel spec |
| §6 focus mode (select → world dims) | §4.4 |
| §7 three zoom registers | §4.2 — globe / region / local |
| §10 mission-identity progress HUD (`●────●────○` sketch) | §4.6 — now the decided ball-and-dotted-line activity bar (D10) |
| §11 completed markers visibly change the world | §4.3 state matrix; claimed seal + live ring |
| §15 visual midpoint — "off-road GPS meets open-world game map" | Art direction line, kept verbatim; §4.7 |
| §16 world-as-product hierarchy | The GeoJSON + story-layer split IS that hierarchy |
| Intro's "maybe routes" | §6.4 community trails layer (D12) |

### Deferred with a data path (was: pruned)
| MAP_PLAN idea | Disposition |
|---|---|
| Shops / mechanics as map content (§2, §8) | **Deferred pending the entity data model** — no shop data exists anywhere yet, but the long-run need is real (standalone shops AND shop-on-site-at-track amenities). V1 carries schema headroom (`kind`, `amenities[]`, wrench badge, §3/§4.5); the data-model plan is [CRM_MIGRATION_PLAN.md](CRM_MIGRATION_PLAN.md) Phase 2 |
| Events layer | V2 — forum discourse-post-event data is real; not needed to prove the map |
| "People" layer (§8) | Reduced to a **steward credit line** on claimed-track cards; a full people layer waits for real identities |

### Pruned (with reasons)
| MAP_PLAN idea | Why it's out |
|---|---|
| Homepage stats mock ("1,632 tracks / 483 shops / 120 events") | Real numbers only: catalog counts from the bake + the existing live `/api/forum/metrics.json` strip, relocated into the drawer |
| §13 parallel iOS map UX design | iOS already shipped its own track map (picker, claimed seals, clustering). We carry **visual tokens** (§4.8), not a second UX project |
| §14-B "find places to ride" as a V1 *goal* | Story-first web map; riding utility is the app's job. Density serves this passively |
| "VIEW TRACK" → forum CTA at V1 (§5) | **No track→topic linkage exists** — topic URLs are not derivable from catalog slugs (topic slugs come from titles; CJK titles collapse to `/t/topic/<id>` on prod). V1.5 once a linkage field exists (§6.5) |
| Keyboard shortcuts, "quests" taxonomy, full-neon NFS skin | Later / never; restraint is the point of the chosen art direction |
| Search | V1.5 — trivial client-side over the baked GeoJSON, but not needed to prove the product |

---

## 3. The map model (grounded in real data)

Three datasets, three cadences:

```text
tracks.json  (the world)        series.json  (the story)         trails.json  (community)
~3,640 GeoJSON points           small curated file in R2          small curated file in R2
CRM bake, committed, slow       operator-edited per activity      operator-promoted forum GPX
├── kind: "track" (headroom     ├── order {main,sub} + label      ├── title, author, topic_url
│   for shop|…, D11)            ├── kind: episode | side          ├── gpx: copy in R2 (§6.4)
├── tier: verified | breadth    ├── hud: show | hide (side only)  ├── center, distance_km
├── category: mx|trail|park|    ├── status: visited | live        └── added_on
│   ebike|club|other            ├── track_slug | coords + venue       (V1.5 — §6.4)
├── amenities: [] ("shop" →     ├── title/tagline (en, zh-CN)
│   wrench badge, when data     ├── links {douyin, bilibili, …}
│   exists)                     └── thumb, visited_on, published_on
├── name, name_local, locality
├── country_code, website
└── lat/lng (WGS-84)
```

Data reality that shaped D2/D3 (from recon, live CRM 2026-08-13):

- CRM: **8,236 tracks; 2,097 verified / 6,139 breadth.** Coords: 1,848 verified (lat/lng columns) + 1,792 breadth (decimal GPS in notes that the current `GPS_RE` parser reads) = **~3,640 mappable today**; ~15 more breadth rows carry DMS-format GPS and need a small parser extension.
- The deployed forum catalog is **verified-tier only (2,095 rows) and Europe-heavy** (FR 531, DE 360, IT 231… US just 72). The breadth tier holds most US inventory (US 2,187 total rows) — this is why D2 includes breadth: without it, North America reads empty.
- **~79% of verified coords are town centroids** (geo_source locality-fallback share; centroid-ship policy 2026-07-29) — km-level accuracy. Honesty comes from a per-feature `precision` flag + approximate-area treatment, not from zoom alone (§4.5, §6.1, §11).
- Everything is **WGS-84** end-to-end; OSM-derived tiles are WGS-84 → zero datum shift on web. (GCJ-02 is a mainland-native-client rendering concern only; never ingest AMap/Baidu coords unconverted.)
- Story ↔ catalog: entries carry `track_slug` when the venue is a catalog row, else inline `coords` + display name (CN coverage is thin — 66 CRM rows — so S03's Chinese venues may well not be catalog rows). Side entries (`kind: "side"`) may have **neither** — they exist only on the HUD bar (a skit produced off-site still belongs to the journey sequence).
- Numbering: entries order by an integer pair `{main, sub}` (main-line episodes are `sub: 0`; side entries sit between as `{2,5}`, `{3,1}`, …) with an always-explicit display `label` ("02", "2.5", "3.01") — no float keys, so 3.1-vs-3.10 ambiguity can't exist. E000 is the mission opener ("0/100"). **HUD counter = count of `kind:"episode"` entries with `main ≥ 1` and status ∈ {visited, live}** — count-based, so skipped or out-of-order visits can't inflate it; E000 and side entries never move it.
- Amenities (D11): `amenities` ships empty until the CRM grows the columns (CRM_MIGRATION_PLAN Phase 2). The card contract is fixed now — `"shop"` renders a wrench badge — so data arrival is a bake change, not a UI change.

---

## 4. Visual & UX spec (V1)

### 4.1 Layout — full takeover

```text
┌──────────────────────────────────────────────────────────┐
│  [existing Header, dark treatment, overlaid]             │
│                                                          │
│        ·      ·   (mx)        ·                          │
│    ·      ◉02▶         ·    (tr)                         │
│              FULL-VIEWPORT MAP          ┌─────────────┐  │
│   (mx)✓   ·        ·      ◉01           │ selection   │  │
│       ·        ·                        │ panel       │  │
│  ┌───────────────────────┐              │ (desktop)   │  │
│  │ VISITING 100 …  02/100│              └─────────────┘  │
│  │ ●┄┄●┄┄●┄┄○┄┄○         │                              │
│  └───────────────────────┘   [ Join DirtBikeX ]  [ App]  │
│  ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔  │
│   ≡ drawer: stats · app badges · about · footer links    │
└──────────────────────────────────────────────────────────┘
```

- Header: the existing `Header.astro` (nav, LangSwitcher, get-app CTA) rendered over the map with the **dark treatment forced on this page only** (scoped class — the global theme toggle keeps governing every other page; D4).
- Drawer (bottom edge, collapsed to a thin bar): real SSR'd HTML — live forum stats strip (existing `/api/forum/metrics.json` plumbing), app badges, one-paragraph "what is DirtBikeX", full footer link groups (legal/App-Review pages, `/join`, `/sponsors`, socials), OSM attribution. This is also where the page's indexable text lives (§8).
- Overlay CTAs: primary **Join DirtBikeX** → `/join`; secondary App Store badge (`APP_STORE_URL` — remember it's duplicated in `src/config.ts` AND `worker/index.ts`).
- Mobile: same map; panel becomes a bottom sheet; HUD shrinks to a pill (tap expands to a horizontally scrollable bar); drawer behind a handle. Occlusion rule: an open bottom sheet suppresses the HUD pill and the CTA row (they return on dismiss), and the drawer is reachable only with the sheet closed. Touch targets: verified+ markers keep a ≥24px hit area; breadth dots are not tappable on touch devices below z8.

### 4.2 Zoom registers

| Register | Zoom | What renders |
|---|---|---|
| **World** | z0–3, globe projection | Dark globe; episode mission markers always visible; **all tiers render as aggregated faint density** (verified a notch brighter) — verified alone is Europe-heavy, so hiding breadth here would leave the Americas and Asia dead at the "THE DIRT BIKE WORLD" moment |
| **Region** | z4–9 | Verified markers (category glyph), breadth dots fade in ~z5, orange cluster bubbles where dense, trail markers |
| **Local** | z10+ (cap ~z14) | Full labels, claimed seals readable, episode markers with name plates, trail traces on demand. Zoom capped for restraint; centroid honesty comes from the precision ring (§4.5), not the cap |

### 4.3 Marker matrix — type ⊥ state

One marker per entity; **highest state wins the marker, the card shows every badge.** Priority: episode > claimed > verified > breadth. Trails render as their own kind, never mixed into the catalog hierarchy.

```text
STATE           breadth      verified       claimed         ep: visited      ep: live
                ·            (glyph)        (glyph)✓        ◉ 02             ◉ 02 ▶
size            ~5px dot     ~18px circle   orange fill     ~28px numbered   + play ring
                bone-gray    charcoal +     + seal at       orange, name     pulses once
                             glyph          bottom-trail    plate always     on load
label           never        hover / z≥9    hover / z≥9     always           always
card CTA        info only    info+website   + steward line  "coming soon"    watch links

KIND (other)    trail: dashed-path glyph marker at trailhead → click loads the trace (§6.4)
```

- **Type axis** = `category` glyph inside verified+ markers: mx / trail-area / riding-park / e-bike (bolt) / generic (club+other). Glyph set is a round-2 design task (D15); V1 can ship with 3 glyphs + generic if design time is tight.
- **Claimed seal**: `checkmark.seal` motif at bottom-trailing — identical placement and meaning as the iOS map.
- **Episode states** (D3): `visited` = solid numbered marker, card says episode in production; `live` = play-ring + watch links. The world visibly "unlocks" as the journey progresses — MAP_PLAN §11 delivered with real states.
- **Multi-episode venues** (revisits, "day two" follow-ups): one marker per venue showing the latest `label`; the card lists every episode there, newest first.
- **Amenity badges** (D11): card-level only in V1 (wrench = shop on site). Markers stay clean; amenities never change the pin.
- Clusters: orange count bubbles (iOS parity), verified+ only; breadth dots decimate by zoom instead of clustering.

### 4.4 Focus mode

Four states, explicit so nobody invents them later:

| State | Catalog | Journey layer | Camera | Esc |
|---|---|---|---|---|
| world | full | full | free | — |
| world + focus | ~25% | ~25% except selection | ease toward selection (never past zoom cap) | → world |
| series | ~25% | full + journey polyline | fit journey bounds | → world |
| series + focus | ~25% | ~25% except selection | ease toward selection | → series |

Transitions: a marker click adds focus in the current base mode; the HUD module title toggles world ↔ series (dropping any focus); a HUD ball click enters series + focus on that entry (venue-less side entries open their panel with no camera move); deselect (map tap / ✕ / Esc) pops focus first, then series. Cheap in MapLibre (feature-state + opacity expressions), and it's what makes a click feel like selecting a mission.

### 4.5 Selection panel (desktop right panel ≈ 380px / mobile bottom sheet)

Episode card (episode-first when one exists):

```text
02 / 100                      ← counter chip (side entries show their label, e.g. "2.5")
E-BIKE PARK DAY TWO           ← entry title (en / zh-CN)
柳浪闻莺 · Hangzhou · CN       ← venue line (omitted for venue-less side entries)
─────────────────────────────
[ thumbnail when it exists ]
"one-line hook from the cover copy"
▶ Douyin   ▶ Bilibili   ▶ TikTok    (status: live)
   — or —
● EPISODE IN PRODUCTION              (status: visited)
─────────────────────────────
TRACK INFO  category · tier badge · steward · 🔧 shop on site · website
```

Track card (no episode): iOS card field order, carried verbatim — name + seal / `name_local` · locality · country code / category · tier chip ("Verified" / "Unverified") / amenity badges / website link. When `precision: "centroid"` the location line says "approximate area" and the map draws a soft area ring instead of promising an exact spot. No directions on web V1 (China maps mess + read-only story map). No forum CTA until linkage exists (§6.5).

Trail card (§6.4): title / "community trail — user-uploaded" + author / distance / **Discuss on the forum** + **Open in gpx.studio** (outbound links).

- Watch links are per-platform, shown per-locale (zh locales lead with rednote/douyin/bilibili; others with tiktok/ytshorts/reels — mirrors `default_platforms` in video-master), and open in a new tab so the map keeps its state. The panel footer carries a persistent **Join DirtBikeX** CTA — the funnel must survive the outbound hop, and the overlay CTA can sit occluded under the mobile sheet.
- Deep links: `/?t=<slug>` and `/?ep=<label>` open the panel on load — shareable, and a future `/s/t/<slug>` share card can reuse it (V2). `/?trail=<id>` arrives with the trails module (§6.4).

### 4.6 Series HUD — the journey bar (D10)

Bottom-left mission module:

```text
VISITING 100 DIRT BIKE TRACKS                02 / 100
●┄┄┄●┄┄┄●┄┄◆┄┄○┄┄┄○┄┄┄○ ┄┄…
00  01  02  2.5
```

- **Filled ball** = done activity (`visited` or `live`; live balls get the tiny play tick). **Empty ball** = upcoming runway — a short fixed runway (~3 empties + ellipsis), never 100 balls, and **inert decoration**: no popover, no camera move (there is no pre-committed target list to show). **Dotted connectors** between all balls.
- **Side entries** (`kind:"side"`, e.g. 2.5 skit, 3.01 on-site skit) render as smaller diamond balls between the mains **only when `hud:"show"`** — the bar is the *sequence of activities in Rubio's journey to build this community*, not strictly one-ball-one-track. Side entries never move the counter.
- **Hover (desktop) / tap (mobile) any filled or side ball → info popover**: label, title, status, date; click/confirm enters series + focus on that entry (§4.4; venue-less side entries open their panel without a camera move).
- **Overflow window**: the bar renders a sliding window — a leading "⋯" chip (older entries, tap/scroll to reach) + the last ~5 entries + the runway — so `3.01`-style growth never bursts the module; the mobile expanded pill is the same bar, horizontally scrollable.
- Click the module title → **series mode**: catalog dims, journey markers + a subtle polyline light up, camera fits the journey. Click again / Esc → world mode.
- Counter animates up on first load (endowed-progress instinct from the orientation tour work).

### 4.7 Art direction

**"Off-road GPS meets open-world game map."** MVP base: **forked OpenFreeMap dark style** (self-hosted style JSON), customized: POI layers deleted, road classes desaturated toward `track`-gray, water near-black, terrain in the `bone-950 → #0d0c09` family (matching the existing dark hero gradient), sparse place labels growing with zoom. Single accent: **dirt-500 `#ed6b00`** (landing token — note iOS uses `#F3760B`; web uses the landing token, unification noted for later). Panel/HUD surfaces reuse the existing glass/dark-hero treatment + `topo-pattern.svg` and `.grain` textures — the brand already gestures at cartography; the map completes the thought. Typography: Bricolage Grotesque for display (HUD, panel titles), Geist/Geist Mono for data lines — all already self-hosted.

Entry motion: load at globe with markers on → ~2s ease toward the latest episode, **stopping at a continental framing (~z3–4) that keeps surrounding density in view** — the catalog is thin around the current CN venues, so a tight regional landing would open on empty terrain (round-2 mock validates the framing) → HUD counts up. Any input skips; `prefers-reduced-motion` gets the same framing statically. No idle spinning, no neon.

### 4.8 Carried from the iOS map (tokens only)

Keep: orange = claimed/ours; `checkmark.seal` bottom-trailing; circular badge markers; orange zoom-then-split cluster bubbles; POI-suppressed basemap; card field order. Don't copy: GCJ-02 handling, Apple-Maps directions alert, 6×8 grid clustering, pick/claim actions (web is read-only).

### 4.9 Accessibility

HUD, panels, drawer are real DOM (focusable, aria-labeled, Esc-dismissable); the journey bar is a list of buttons under the hood. The canvas gets an aria-label + the drawer carries the textual equivalent (journey entries as plain links) — SSR'd from the repo copy at deploy time and re-hydrated from the same `/api/map/series.json` fetch after boot, so it never lags an R2 push for interactive users (the SSR baseline serves SEO and no-JS). Reduced motion honored everywhere. Panel contrast on AA against the dark surfaces.

---

## 5. Stack

### 5.1 Renderer — MapLibre GL JS v6 (D5)

Current stable v6.3.0; globe projection has been stable since v5 (Jan 2025). ~253KB gz — the site's first real JS bundle, homepage-only, deferred (§5.5). v6 is **WebGL2-mandatory and ESM-only**: the §5.5 capability check tests WebGL2 (WebGL1-only devices get the poster — an accepted device-floor raise; pinning v5 is the fallback if it ever bites), and ESM-only is fine for the Vite island but rules out script-tag shortcuts. Everything in §4 is native capability: vector styling, `cluster:true` GeoJSON sources, feature-state dimming, flyTo easing, runtime `addImage` markers, GeoJSON line sources for trails/journey, `name:*` label localization, RTL via plugin.

Dismissed: Leaflet (raster-era, can't do this styling), Mapbox GL v3 (license + telemetry + external), Google (aesthetic/wrong model/external), deck.gl/Cesium (overkill), hand-drawn SVG world (can't zoom to real venues).

### 5.2 Basemap — hosted for MVP, self-host held (D6)

Per operator decision, the tile-architecture call is **held**; MVP goes hosted, self-host comes later.

- **MVP provider proposal: OpenFreeMap** — $0, keyless, no usage limits, commercial use explicitly allowed, community-run (no SLA). We fork its **dark** style, tune it per §4.7, and self-host the forked style JSON same-origin; tiles + glyphs + sprites load from the OFM origin. Rejected for MVP: MapTiler (free tier is non-commercial — we're commercial), Mapbox (license/external), Protomaps' hosted API noted as the paid fallback if OFM proves unreliable.
- **Invariant carve-out (deliberate, temporary):** the repo enforces *no external runtime assets* (`tests/no-external-assets.spec.ts`, mainland-China invariant). Hosted tiles breach it by definition — and the test's `ALLOWED_HOST_PATTERNS` is one global list applied to every route, so "scoped" needs real work: restructure the test for per-route allowlists (OFM legal on the homepage only — preferred) or accept a global allow with the deny-list backstop intact, documented either way with the self-host revert condition. The test must also **wait for map idle + one pan/zoom** before asserting — today it asserts at `load`, which the deferred map's style/glyph/tile fetches would escape entirely. This is the price of the MVP shortcut, paid consciously.
- **China check = a ship-gate, not advice:** OFM's mainland reachability is unknown, and the takeover page is exactly the page the mainland invariant protects. M1 runs a mainland-vantage load test **before the basemap choice hardens**; on hard failure the takeover does not ship to CN audiences on OFM — the named remedies are (a) pull the self-host milestone into MVP, or (b) CN locales keep the current homepage / a static poster page until tiles are in-house. Operator picks the remedy; silently shipping a homepage that doesn't load in China is not an option.
- **Failure posture:** no SLA → the page must degrade to poster + drawer if style/tiles don't arrive (§5.5 already guarantees this).
- **Self-host exit (both paths pre-costed, choose when the hold lifts):**
  1. **Planetiler-built OpenMapTiles-schema planet → PMTiles on R2** — keeps the forked OFM style nearly unchanged (same schema); one-time big build job; ~70–100GB; ≈$1.50/mo R2 storage, zero egress. *Likely winner because the style survives.*
  2. **Protomaps daily planet PMTiles on R2** (~120GB, ≈$2/mo) — zero build effort, but the style must be re-based on the protomaps schema (`@protomaps/basemaps`).
  - Either way the serving layer is the same: a `/tiles/*` range-read route in the existing landing worker + R2 bucket, added to `run_worker_first` in **both** wrangler blocks; CF cache needs the custom domain (prod fine; `*.workers.dev` preview uncached). Glyphs/sprites move same-origin at that point and the test carve-out is reverted.
- Terrain/hillshade: deferred entirely (Mapterhorn raster-dem planet is ~706GB even at z0–12); the topo texture on UI surfaces carries the vibe. Revisit only if the flat dark basemap disappoints in the round-2 mock.
- Attribution: the required string is "OpenFreeMap © OpenMapTiles, Data from OpenStreetMap" (only the OpenFreeMap part is optional) — preserved in the forked style's `sources` attribution (MapLibre's control only shows what the fork keeps) and repeated in the drawer.

### 5.3 Page integration (D9)

`src/components/WorldMap.astro` (canvas container + SSR'd poster, HUD, panel skeleton, drawer) + `src/scripts/worldmap/*.ts` (vanilla TS: init, sources/layers, markers, journey bar, focus, panel render, trail loader, deep links, i18n via injected strings). Bundled by Astro/Vite as the site's first processed module — a deliberate, contained break from the inline-`is:inline` convention (map code is too big to stay inline; still zero frameworks). MapLibre CSS inlined into the page's styles. RTL text plugin self-hosted and registered with `lazy: true` on **every** locale — RTL place names surface on the basemap whenever anyone pans to MENA, in any locale; lazy registration fetches the plugin only when RTL text is actually encountered.

### 5.4 Worker & storage additions

- **New R2 bucket `dbx-map`** (binding `MAP_BUCKET`, both env blocks) holding `series.json`, `trails.json`, later episode thumbs. Comfortably inside the R2 free tier.
- **New routes** `GET /api/map/series.json`, `GET /api/map/trails.json`, `GET /api/map/trails/<id>.gpx` (§6.4) — worker reads R2 and edge-caches via **`caches.default` with ~300s TTL**: `s-maxage` alone does NOT edge-cache worker-generated responses (the repo's existing 1h/24h caches all ride `cf.cacheTtl` on origin subrequests, which doesn't apply to R2 binding reads), and at 300s no purge machinery is needed. Browser-side `max-age=60`. Add `/api/map/*` to `run_worker_first` in **both** the top-level and `env.preview` blocks (standing scar).
- **Publish flow (D3):** canonical copies live in the landing repo (`map-data/series.json`, `map-data/trails.json`, committed, reviewed like any change); a small `scripts/push-map-data.mjs` wraps `wrangler r2 object put` to publish repo → R2. **Repo is the source of truth; R2 is the live projection; never hand-edit R2.** Rollback = re-push the previous commit's file. No redeploy, no new secrets (wrangler auth is the existing operator flow). **Env separation:** one bucket, env-prefixed keys (`prod/…`, `preview/…`); `push-map-data --env` is explicit and `--env prod` carries the same explicit-ask discipline as prod deploys — a staging rehearsal must never mutate the live story.
- `tracks.json` stays a **static asset** (`public/map/tracks.json`) — deploy-cadence data, monthly-ish churn (D7); own `_headers` rule (1d edge).
- No tiles route in MVP (hosted); it arrives with the self-host milestone (§5.2).
- V1.5 options: `/api/map/claimed.json` forum proxy (§6.3), and — only if even the R2 push feels heavy — a tiny authed POST for series updates.

### 5.5 Boot & performance

- SSR delivers the full head contract + poster (a pre-rendered AVIF/PNG of the styled dark map — also the LCP element) + HUD skeleton + drawer HTML. The map module loads `defer`, boots on DOMContentLoaded, crossfades over the poster.
- Budget: MapLibre ~253KB gz + app TS ~20KB + style ~50KB + tracks.json ~200KB gz + series/trails.json (KBs) + tiles on demand. Acceptable for a map-first brand page; unacceptable to ship to users who never interact on slow links — hence D13 (mobile auto vs tap-to-boot) stays open for round 2, with a poster fallback either way.
- WebGL2 unavailable (the v6 floor) / style or tile fetch fails → poster stays + drawer content works. The page never blanks.
- No CSP exists today; the Playwright asset test — restructured per-route and waiting for map idle (§5.2) — is the enforcement layer for origins.

---

## 6. Data pipeline

### 6.1 `tracks.json` (the world) — D7

- New `scripts/export_map_geojson.py` in the **contacts repo**, reusing `export_catalog.py`'s projection + PII abort-scan. Filter: has coords AND not defunct; both tiers (~3,640 features; a small DMS parser extension recovers ~15 more breadth rows). Fields per feature: `kind` ("track"), `slug, name, name_local, country_code, locality, category, tier, website, amenities` (empty for now), `precision` ("exact" | "centroid", derived from `geo_source` — locality-fallback hits are centroids), `lat, lng`. Never: email/phone/notes/disposition (the existing PII scan already guards this).
- **Scars honored**: run against a snapshot COPY of `contacts.db` (`export_catalog.py` mints slugs as a write side-effect); `contacts.db` is canonical on operator boxes and in no repo — so the bake is **operator-run, output committed** into the landing repo (`public/map/tracks.json`, ~1MB raw / ~200KB gz). Same versioned-projection model as `versions.lock`.
- Known staleness accepted for V1: steward coordinate edits live only in the forum's `dirtbikex_tracks.curated_fields` (reverse sync is a standing open item) — baked pins can lag the app's. The graduation path — web map reads a plugin bulk endpoint over Postgres instead of a CRM bake — is CRM_MIGRATION_PLAN Phase 1.

### 6.2 `series.json` (the story) — D3 + D10

Operator-owned; canonical in repo, live in R2 (§5.4):

```jsonc
{
  "series": "visiting-100-tracks",
  "target": 100,
  "entries": [
    {
      "main": 2, "sub": 0,                    // integer order pair; side entries sit between mains ({2,5}, {3,1}, …)
      "label": "02",                          // display label, always explicit ("02", "2.5", "3.01")
      "kind": "episode",                      // "episode" | "side" (skits, off-site activities)
      "hud": "show",                          // side entries only: "show" | "hide"
      "video_id": "DBX-APP-S03E002",          // provenance only; map never reads video-master
      "track_slug": null,                     // catalog slug when the venue is a catalog row
      "coords": { "lat": 30.24, "lng": 120.14 }, // WGS-84, named keys on purpose (tracks.json GeoJSON is [lng,lat] — objects kill the swap bug); null for venue-less side entries
      "venue": { "en": "Hometown e-bike park", "zh-CN": "柳浪闻莺" },
      "title": { "en": "E-bike park, day two", "zh-CN": "…" },
      "tagline": { "en": "…", "zh-CN": "…" },
      "status": "live",                       // "visited" | "live"  ← operator-set (D3)
      "links": { "douyin": "…", "bilibili": "…", "rednote": "…", "tiktok": null },
      "thumb": "/api/map/thumb/002.jpg",      // null until cover art exists (R2)
      "visited_on": "2026-08-01",
      "published_on": "2026-08-10"
    }
  ]
}
```

- Locale strings: en + zh-CN inline; the other 19 locales fall back to en (matches the site's existing i18n fallback behavior).
- Update flow: edit repo file → commit → `push-map-data` → live in ≤5 min. No deploy (D3).
- video-master gets an optional `track:` block in `manifest.yml` + a validator nudge **later**, for provenance only — per D3 the map never depends on it. (Side note flagged so it isn't lost: video-master's `series.yml` still says `season: 1`, so its scaffolder would mint S01E006 today.)

### 6.3 Claimed state — D8

V1: `claimed: [<slug>, …]` in `map-data/config.json`, R2-pushed like the story files. Known drift: not every claim crosses the operator's desk — manual claims land in /review, but **invite-path claims are born ACTIVE automatically**, so the list lags until noticed (check the steward hub on a cadence). V1.5: tiny anonymous plugin endpoint (`GET /dirtbikex/tracks/claimed.json` → list of active-claim slugs, edge-cached 1h through the landing worker's existing forum-proxy pattern) — gives live claims + removes the manual list. The existing anonymous tracks API can't do this today (50/200-row caps, no bulk endpoint).

### 6.4 Community trails (V1.5 module; mechanism + fixture fixed now — D12)

Forum members already upload GPX (the `discourse-dbx-gpx-preview` component handles in-forum preview). Standout files get **manually promoted** onto the world map as *user-uploaded trails — explicitly not tracks*:

- **Data**: `trails.json` in R2 (§5.4). Entry: `id, title {en, zh-CN}, author` (forum username), `gpx` (R2 key), `topic_url` (provenance + discuss link), `center {lat, lng}`, `distance_km`, `added_on`. Promotion is an operator act: pick a public-category GPX attachment and **copy the file into `dbx-map`** (served same-origin at `/api/map/trails/<id>.gpx`) — resolved uploads-cdn URLs die when uploads are deleted/re-uploaded or `uploads_cdn_url` changes, and consent is obtained at promotion anyway; the forum URL is kept as provenance only, and the landing never does short-url resolution. (The resolve mechanics, if ever needed: cooked short-urls 302 to raw OCI; re-base onto `uploads_cdn_url`; `ACAO: *` live-verified by the GPX-preview work.)
- **Rendering (MVP choice: native trace)**: dashed-path trailhead marker at `center`; click → trail card + same-origin fetch of the R2 GPX → parse `trkpt` (tiny parser; the promotion-time gate reuses the preview component's classification: ≥2 distinct track points, and **any file containing `<rtept>` is rejected** — route points poison files even alongside a valid `<trk>`) → draw a dashed **moto-blue `#2a5cff`** polyline + fitBounds (orange stays reserved for claimed/ours per §4.8 — trails are explicitly not ours). Click-to-load keeps boot weight at zero — same reasoning that made the forum component click-to-load. Deep link `/?trail=<id>` ships with this module.
- **Why not a gpx.studio embed here**: the landing already has a map engine on the page — drawing a polyline is less code than an iframe; an embedded gpx.studio iframe would add an external runtime origin (China + invariant) and a second WebGL context. gpx.studio appears only as an **outbound "Open in gpx.studio" link** on the trail card (user-initiated navigation, not a runtime asset). Same analysis as the forum component, different answer, because here we own a map.
- **Curation policy**: public-category attachments only; author credited and pinged before promotion; traces are precise locations by nature — promotion is the consent+judgment step.
- **Dev fixture**: `Misc/map-dev/sample-trail.gpx` — valid GPX 1.1 (44 trkpt loop + 3 wpt, ele + timestamps, Anji-hills-plausible), created with this plan; passes the preview component's embed classification.

### 6.5 Track → forum topic linkage (V1.5)

Not derivable today (topic slugs come from titles; CJK titles collapse to `/t/topic/<id>`). Plan: add a `topic_id` column to the CRM (filled by the track-onboarding skill when it posts a topic) → flows through the bake → track card gains "Read on the forum". Requires a small schema+skill change in the contacts repo; deliberately out of V1.

### 6.6 Freshness model

| Data | Source | Update trigger | Latency |
|---|---|---|---|
| Basemap tiles | OpenFreeMap (MVP) | n/a (hosted) | n/a |
| `tracks.json` | CRM bake, committed | operator, ~monthly or on notable catalog change | deploy |
| `series.json` | repo edit → R2 push | per journey activity (visited / published / side) | **≤5 min, no deploy** |
| `trails.json` | repo edit → R2 push | per promotion | ≤5 min, no deploy |
| Claimed list | `map-data/config.json` → R2 push (V1) | operator, on noticing a claim (invite-path claims activate unattended — cadence check; V1.5 endpoint removes the drift) | ≤5 min, no deploy |
| Forum stats strip | existing `/api/forum/metrics.json` | live | 1h/24h cache (existing) |

---

## 7. i18n & China

- All 21 locale homepages get the map (`src/pages/index.astro` + `[lang]/index.astro` keep their structure; the island receives the page locale). ~20 new UI string keys in `src/i18n/locales/*.json` (HUD, panel labels, drawer). The silent locale auto-redirect script keeps working — the map page must keep `BaseLayout`.
- Basemap labels localize per page locale via `name:*` fields in the forked style (`zh-CN`→`name:zh` family; exact field names verified against the OFM/OpenMapTiles schema during the style fork). RTL pages (`ar`, `fa-IR`) load the RTL plugin.
- **Datum**: WGS-84 everywhere (§3); no GCJ shift on web. Never paste AMap/Baidu coords into the CRM unconverted.
- **Reachability**: the site's Cloudflare posture is already degraded-but-working from the mainland; **hosted tiles add a second, unmeasured origin** — hence the M1 mainland-vantage check (§5.2). The poster-first boot keeps the page meaningful even when tile fetches crawl. A China-side mirror (Aliyun CDN over the China domain is already a known open topic) stays out of scope for V1.
- **Map-content risk note (accepted)**: serving OSM-based maps of China from overseas infrastructure is standard practice for non-ICP sites but is not a licensed China map service; borders/names render per OSM. Accepted as-is; revisit only if a China-hosted variant is ever pursued.

---

## 8. SEO & preserved landing jobs

| Existing job | How it survives |
|---|---|
| Head contract: canonical, 21 hreflang alternates, OG/twitter, theme-color, manifest | Map page renders through `BaseLayout` unchanged; new dark-map `og-image` (static V1; auto-updating counter OG is a V2 flourish) |
| Locale auto-redirect + theme bootstrap inline scripts | Kept (BaseLayout) |
| App CTAs | Overlay badge + drawer badges; `APP_STORE_URL` dual-source scar respected |
| `/join` waitlist funnel | Primary overlay CTA targets it; page untouched |
| Legal / App-Review pages, footer link groups | Drawer reproduces the full footer; routes untouched |
| AASA + `/s/*` share cards | Untouched (worker routes; `/s/*` skips locale prefixing already) |
| Live stats + featured topics data plumbing (`/api/forum/*`) | Stats strip moves into the drawer; endpoints unchanged. FeaturedTopics' new home = D14 (open) |
| `no-external-assets` Playwright test | Restructured for per-route allowlists (OFM legal on the homepage only) + extended to wait for map idle before asserting; carve-out documented, reverted at self-host — §5.2 |
| Sitemap/robots | Unchanged; map page is still a static page per locale |
| Indexable content | The drawer's SSR text + journey entries as real links; displaced Features/FAQ content rehomed per D14 |

---

## 9. Phasing

- **Round 2 (next, still discussion):** visual mock — marker set, HUD journey bar, panel, one region of the forked dark style (static HTML artifact); resolve D13–D15; confirm D6 provider (incl. mainland check result), D7/D8/D9/D12; sign off this doc + CRM_MIGRATION_PLAN option C → only then an implementation plan.
- **M1 (V1 build):** fork + tune OFM dark style → test restructure (per-route allowlist + map-idle wait) → mainland-vantage tile check (**ship-gate**, §5.2) → map island (markers, focus, panel, HUD journey bar, drawer, deep links, entry motion) → `tracks.json` bake → `dbx-map` bucket + `/api/map/*` routes + `push-map-data` script + initial `series.json`/`config.json` → i18n keys ×21 → poster + OG image → Playwright (map boot smoke; restructured asset test green) → preview deploy → prod (explicit-ask).
- **M1.5:** trails layer (§6.4) with first promoted GPX; client-side search; claimed.json endpoint + proxy; track→topic linkage column + card CTA; episode thumbs into R2 (Remotion cover comps exist, nothing rendered yet); category glyph polish.
- **M2 (self-host milestone — lifts the D6 hold):** planetiler OMT-schema planet (or protomaps planet) → PMTiles on R2 → `/tiles/*` worker route → glyphs/sprites same-origin → revert the test carve-out. Trigger: China check fails hard, OFM reliability wobbles, or simply when bandwidth allows.
- **V2:** events layer (forum discourse-post-event data is real); shops/amenities as real entities (CRM_MIGRATION_PLAN Phase 2 feeds `kind`/`amenities`); steward surfaces; auto-generated OG with live counter; series-mode fly-through cinematic; `/s/t/<slug>` map share card; **second series as a second `series.json` — the layer system is series-generic by construction**; China tile mirror if demand shows.
- **Non-goals (V1, explicit):** accounts/personalization, routing/directions, GPX *uploads* on web (promotion is operator-side; uploads stay on the forum), editing/claiming from web, shops/people/events layers before their data exists, React/Vue/Svelte, live WebSocket anything.

---

## 10. Costs & ops

| Item | Cost |
|---|---|
| Tiles (MVP, OpenFreeMap) | $0 (donation-worthy if it sticks) |
| R2 `dbx-map` (series/trails/thumbs) | ~0 — inside free tier |
| Workers | Existing worker/plan; `/api/map/*` adds trivial requests |
| Self-host milestone (later) | ~70–120GB R2 ≈ $1.50–2.00/mo, zero egress; one-time planetiler build or planet download + rclone upload |
| Recurring ops | `series.json` edit + R2 push per journey activity; catalog re-bake ~monthly; trail promotion as they come |

---

## 11. Risks & scars (standing rules honored)

1. **The MVP tile carve-out is a real breach of the mainland-China invariant** — and the test's allowlist is global-by-construction today, so the carve-out includes restructuring it per-route and teaching it to wait for map traffic (§5.2); the mainland vantage check is a **ship-gate** with named remedies. Don't let it normalize; don't add any *other* external origin.
2. OpenFreeMap has no SLA — poster+drawer degradation is the floor; Protomaps' paid API is the named fallback provider; self-host is the exit.
3. Style-schema lock-in: fork the OFM (OpenMapTiles-schema) style knowing exit path 1 (planetiler) preserves it and exit path 2 (protomaps) rewrites it.
4. `run_worker_first` must gain `/api/map/*` (and later `/tiles/*`) in **both** wrangler blocks, or the asset layer 405-shadows them.
5. `worker/` and `src/` are separately bundled — R2 route logic in `worker/_lib/`, map island in `src/`; no shared imports.
6. Catalog bake runs against a **copy** of `contacts.db` (slug-mint write side-effect) with the PII abort-scan on.
7. `APP_STORE_URL` is defined twice (src + worker) — any CTA change touches both.
8. HTML edge cache is 1 day — interactive state always comes from `/api/map/series.json` (~300s `caches.default`); the SSR'd drawer copy is a deploy-time baseline re-hydrated from that same fetch (§4.9).
9. **R2 push discipline**: repo file is canonical; R2 is a projection; never hand-edit R2; `--env` is explicit and `--env prod` is explicit-ask; rollback = re-push prior commit.
10. Centroid accuracy (~79% of verified coords): the per-feature `precision` flag drives an approximate-area ring + "approximate area" card phrasing — the zoom cap alone doesn't deliver honesty. Steward-corrected coords reach the web only via re-bake until CRM_MIGRATION_PLAN Phase 1.
11. Trails are precise location traces — promotion is a manual consent+judgment act (public-category only, author pinged); the GPX is copied into R2 at promotion, so upload deletion or CDN changes can't break the map.
12. Publishing the breadth dataset is a deliberate choice (D2) — if operators object to being listed, the in-app report path exists; web takedown contact is `/contact`. Revisit exposure if complaints materialize.
13. MapLibre is the site's first heavy JS — poster-first boot protects LCP; D13 protects mobile data.
14. prod deploys remain explicit-ask; preview deploys via the established ubuntu wrangler flow; R2 pushes are operator-run.

---

## 12. Round-2 agenda

1. **D13** mobile boot: auto-init vs tap-to-explore poster.
2. **D14** rehome Features / FeaturedTopics / FAQ (drawer? `/about`? drop?).
3. **D15** review the visual mock: marker glyphs, HUD journey bar, panel, dark style tuning.
4. **D6** provider confirmation: OFM mainland-vantage result; fallback trigger.
5. Confirm D7/D8/D9/D12 (bake model, claimed list, no-framework island, trails mechanism).
6. **D16**: sign off CRM_MIGRATION_PLAN option C (split canonical) + breadth-import timing.
7. Episode thumbnails: placeholder design until covers render.
8. `og-image` for the map homepage.
9. Which journey entries are already `live` (E002 confirmed posted — E000/E001? initial `series.json` fill).


---

## 13. What actually shipped (2026-08-13, staging)

Live: `https://www.dirtbikechina.com` (preview worker `dirtbikex-landing-page-preview`).
Commits: landing `8450c22` + `c97f4b3`, contacts `53e20f8`, infra pin `5aba8ce` (+ pnpm follow-up).

**Built:** full-viewport dark map homepage on all 21 locales; 3,640 baked catalog pins (tier-graduated radius/opacity/bloom, category glyphs + name labels from z7.5/z9, claimed seal layer, orange selection halo sized by `precision`); numbered episode markers (live = pulsing ring); dotted-ball journey HUD with hover/tap popovers, side-entry diamonds, overflow window and inert runway; four-state focus/series machine with dashed journey polyline; selection panel (episode-first, track card, per-locale watch order, persistent Join CTA); bottom drawer carrying intro + real `<Footer/>` + live forum stats + map credit; `?t=` / `?ep=` deep links; WebGL2-gated boot with poster fallback.

**Data path:** `public/map/tracks.json` (deploy cadence) + `/api/map/series.json` served from R2 `dbx-map` under env-prefixed keys via `caches.default` (300s), with `public/map/series.seed.json` as the committed fallback. `scripts/push-map-data.mjs --env preview|prod` publishes without a redeploy.

**Deviations from the plan, all deliberate:**
- **No marker clustering.** Graduated radius + low-zoom bloom reads as density and is far less code. Revisit only if a dense region looks like a blob.
- **No RTL text plugin.** Chrome is RTL via `dir=rtl` already; the catalog has no MENA tracks, so Arabic-script *basemap labels* are the only gap. Cheap to add later.
- **Trails layer (§6.4) not built** — V1.5 as planned. The dev fixture `Misc/map-dev/sample-trail.gpx` exists.
- **Amenities not built** — `amenities: []` ships in every feature as schema headroom (operator: keep it minimal until real shop data exists).
- Boot poster is a styled CSS surface (topo + glow), not a pre-rendered map image — nothing to maintain and it never implies content that isn't there.

**Scars earned building it (all fixed, all worth remembering):**
1. **MapLibre v6 is ESM-only with no default export**, and derives its worker URL from `import.meta.url` — Vite can't analyse that, so the worker chunk is never emitted and the map dies on a 404. Fix: `import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'` + `setWorkerUrl(workerUrl)`.
2. **`pnpm add` generates a `pnpm-workspace.yaml` with no `packages` field.** pnpm 11 (dev) tolerates it; pnpm 10 (the staging box) fails *every* command with "packages field missing or empty", which breaks `pnpm dlx wrangler deploy`.
3. **The staging box does not auto-install on build** (pnpm 10). A new dependency needs an explicit `pnpm install` there or the build fails on an unresolved import.
4. **`pnpm build 2>&1 | tail` hides a failed build** — the pipeline exit status is `tail`'s, so `&& wrangler deploy` happily ships a stale `dist`. Never pipe the build in a deploy chain.
5. **CSS `display` on a `[hidden]` element beats the UA rule** — the panel and HUD tooltip stayed in layout, invisible, swallowing map clicks. Fix: `.wm [hidden] { display: none !important }`.
6. **OFM's dark style references sprite icon `circle-11`, which its own sprite doesn't contain** (264 icons, absent) — console warnings on every load. Removed the three `icon-image` refs; we didn't want town dots anyway.
7. **`import.meta.url` in `.astro` frontmatter doesn't resolve to `src/`** at build time — a relative `readFileSync` silently yielded 0 tracks. Use `process.cwd()`.
8. **MapLibre v6 renders its compact attribution already expanded**, which ran across the mobile CTA. Solved by giving the attribution its own row in the bottom stack rather than fighting the class.
9. **Cloudflare injects `static.cloudflareinsights.com`** into deployed pages. It's edge-injected (not in the repo), so the local Playwright asset test can't see it — but it *is* a third-party runtime host on the live site, relevant to the mainland-China invariant. Toggleable in the CF dashboard.

### Round 12 (2026-08-14, deployed) — the layer rail + rider trails

The top-trailing rail ships with three toggles: **Tracks**, **Rider trails** and **The 100 challenge**. Each button owns its layer's *whole* surface, not just its style layers — turning off the 100 challenge also hides the episode markers, the journey line, the HUD and the recenter control, because a "back to the latest episode" button is meaningless when episodes are hidden. Off is a struck-through glyph rather than a colour, the label appears on hover and flashes for 1.6s after a tap (touch has no hover), and state persists to `localStorage` while mirroring to `?layers=` so a filtered view is shareable. Visibility is re-applied after every `addLayers()`, including the theme restyle, which rebuilds style layers visible by default. The desktop sheet shifted left to clear the rail column instead of the rail hiding when a pin is selected; on mobile an open sheet takes the whole screen and the rail stands down with the HUD.

**L4 revised.** The plan gated the rail on "a second real layer"; the operator's answer was that the 100 challenge already *is* one — the rail's job is letting you turn the series off and just look at tracks.

**Rider trails (MAP_LAYERS_PLAN §3b).** A promoted GPX becomes an entry in `trails.json`, served from R2 through `/api/map/trails.json` with the committed seed as fallback — the same no-redeploy path as `series.json`, now sharing one handler. The author is stored as the **numeric forum user id** with the username cached beside it: the id is the identity, the cached name keeps `/s/u/<username>` working, and a rename re-resolves rather than rotting. The sheet reuses the platform-mark row — rider profile, forum thread when the trail has one, and Open in gpx.studio — so a trail card and an episode card speak the same visual language.

Geometry is **simplified into the doc**, not fetched at runtime: `scripts/import-gpx-trail.mjs` pulls the GPX, keeps `<trkseg>` boundaries (joining them draws a stroke through every pause), runs Douglas–Peucker at a metre tolerance, and writes a MultiLineString. That keeps the site's no-third-party-assets rule intact — gpx.studio only ever sees the file when a visitor asks for it. The layer is **off by default and loads on first enable**; an empty or failed fetch leaves the button off rather than showing a blank layer. A near-invisible 14px line under the trace makes a 2px path tappable.

Seeded with the one real trace on the forum: `xihu-easter-egg`, a GPS doodle spelling DBX over West Lake — 144 points → 76 across 4 segments, 6.3 km, author `calvin` (id 1). The other six staging uploads are synthetic; `fells_loop.gpx` is route points only and the importer refuses it by design. Verified live on staging at desktop, mobile touch and zh-CN.

### Round 11 (2026-08-14, deployed) — viewport rendering + episodes bound to entities

The map drew all 3,640 pins at every zoom. It now draws **only what is in the viewport**, capped per entity `kind` and spread over a ~90px grid, so a dense country reads as individual places instead of a blob; panning fills in incrementally on settled moves and the budget scales with the viewport (50–150). The selected pin and every episode venue are pinned into the render set — culling the feature the panel is describing would strand its halo and sheet. The cap is keyed on `kind`, so a future shops layer gets its own budget rather than competing with tracks.

**Episode bindings corrected** (operator): 00 is the West Lake opener and keeps inline coordinates — which are the ones episode 02 was wrongly wearing; 01 and 02 now point at catalog entities (`cn-hu-zhou-yue-ye-shan-ye-ying-di`, `cn-qiu-long-ke-ji-hang-zhou-yue-ye-ji-di`) instead of hand-entered coordinates, so a steward fixing a track's pin fixes the episode with it. Episode 02 had been ~15 km off. The Huzhou venue is a **motocross** park, not an e-bike park — corrected in both CRM copies and re-baked (motocross 3,515 / ebike_park 9).

### Round 10 (2026-08-14, deployed)

**The recenter control was untappable on phones.** The rail's scroll box ran the full width (x=12–378) with the button sitting inside it at x=333–379, and the HUD (z 12) outranks the control layer (z 10), so `elementFromPoint` at the button's centre returned `wm-hud__rail`. Fixed three ways: the module is now narrow enough on phones to clear the controls (right edge 325 vs 333), the control layer moved above the HUD so a future overlap can't silently eat taps, and phones draw **two** upcoming stops instead of six. The module stays viewport-centred, so the active stop still lands dead centre (verified 0px on both breakpoints). Tapping the clip itself now opens the same TikTok/Douyin chooser as the button.

*Lesson worth keeping: a wide, transparent scroll container is an invisible tap sink. Verify hit-testing with `elementFromPoint`, not by eye — the control looked perfectly fine in every screenshot.*

### Round 9 (2026-08-14, deployed)

TikTok and Douyin carry the same clip, so the short-video mark in an episode sheet stops guessing: pressing it opens a small chooser listing both, the locale's platform first and flagged **Recommended** (Douyin on `zh-CN`, TikTok everywhere else). Instagram and Facebook stay direct links, and the chooser collapses to a plain link when only one of the two exists. Dismissed by backdrop or Esc; `map.panel.watchOn` / `map.panel.recommended` are translated in all 21 locales.

Since Douyin returns only a shell (Round 8), its carousel slide now **previews the same clip's TikTok card** — image and caption borrowed — while still linking to Douyin. Verified live on `zh-CN`: first slide is `douyin`, preview sourced from `www.tiktok.com`, image present, link target `v.douyin.com`.

### Round 8 (2026-08-14, deployed)

Header: the icon-only get-app button on phones alternates between the Apple mark and a download glyph on a slow cross-fade (held still under `prefers-reduced-motion`) — an Apple logo alone says "Apple" more than "download".

Douyin previews now go through the landing site's own resolver, the same one `/api/resolve/shortlink` exposes to the forum's native-embed component; the hop loop moved out of that HTTP handler into an exported `resolveCanonical()` so both callers share one implementation and one FOLLOW_HOSTS allowlist. Order matters and the obvious one is backwards: `www.douyin.com/video/{id}` is a JS shell, so the **server-rendered iesdouyin share page is crawled first** and the canonical form only as a fallback. Douyin candidates also use the mobile Safari UA (the crawler UA gets a wall) with a bounded CDN cover-URL fallback.

**Outcome: Douyin still yields no card, and that is a platform limit, not a routing bug.** From a Cloudflare worker outside China both pages return a shell — the site's boilerplate title (`在抖音记录美好生活…`) and no cover. A card built from that is worse than none, so it is rejected and the slide shows the clean Douyin brand mark. Failed previews now carry a `trace` (`host=bytes+t+i`, or `=shell`/`=unreachable`) so this is diagnosable without a deploy. TikTok, Instagram and Facebook all return real cards.

### Round 7 — adversarial review + fixes (same day, deployed)

A 3-lens review (interaction state machine / CSS+a11y / worker security) over the rail, carousel and OG route. Fixed: a **stale settle timer** that flew the camera back to the stop you'd just left if you tapped within 170ms of a flick; a **self-scroll guard armed for zero-distance centring**, which swallowed 480ms of real scrolling and could invert the scrub-vs-open rule (`centre()` now reports whether it moved; `scrollend` releases the guard); the rail's **~22px scroll box clipping the active ring**, and every state shadow *replacing* rather than appending the glow that lifts dots off the map (so with all entries live, no dot had one); `success` vs `partial` being **1.03:1 apart** — partial is now a hollow ring, and both tones plus the verified/claimed chips became theme tokens instead of dark-only hard-coded values.

Worker `/api/map/og` hardening: redirects are followed by hand with a hop cap and **re-checked each hop** (the allowlist previously applied only pre-redirect while `redirect: 'follow'` was used), `og:image` gained its own CDN allowlist (it had none), content-type is whitelisted rather than interpolated, and both size caps moved from post-buffering to streaming.

**Two self-inflicted regressions caught only because the fixes were re-verified live**, both worth remembering: capping HTML by *rejecting* instead of *truncating* killed Instagram previews (its HTML exceeds 300KB); and an apostrophe-safe `content=(["'])([\s\S]*?)\1` regex backtracks quadratically on a no-match document — Facebook's wall page returned **Cloudflare error 1102, worker CPU exceeded**. Meta parsing is now a bounded `<meta …>` head scan with per-tag attribute reads (~5ms on a 300KB no-match doc). Facebook previews work as a side effect.

### Round 6 (same day, deployed)

The rail becomes a **scrubber**. Scrolling it selects whatever lands in the middle — dot and label follow immediately with a haptic tick (`navigator.vibrate`; Android only, iOS Safari has no web haptics), camera follows once scrolling settles, and stops snap to centre. Opening a sheet is now a deliberate second action: tapping an **off-centre** stop only scrubs to it, and the sheet opens from the **centred** stop or from the label beneath it (which is why that label is a button now). Dot colour moved out of code into operator data — a `tone` field per entry in `series.json`: `success` = brand green `#2fa84f`, `partial` = muted green `#6f9c62`, absent = brand accent. S03E000–002 are all `live`; 00 and 01 are `success`, 02 is `partial`.

**Deploy scar:** a live check right after deploy showed desktop on the *old* bundle with orange dots while mobile was correct — edge-cached HTML (`/*` carries `s-maxage=86400`). Confirm the live HTML references the freshly built `_astro/…js` hash before concluding a deploy is wrong.

### Round 5 (same day, deployed)

The rail stops pretending to be the whole route: six upcoming stops plus a muted `+N`, a narrower module, and half a viewport of padding on each end so the **active stop always sits dead centre** (verified at 0px offset from viewport centre, first and last included). The hover tooltip becomes a short trimmed venue label under that stop. Tapping a stop now opens its sheet rather than only moving the camera. The single preview becomes a **swipeable carousel** — one slide per platform in locale order, each fetching its own card only when scrolled into view (verified live: 1 of 3 loaded on open, 2 after a swipe) — and a platform that serves a wall keeps its slide with its brand mark. Sheets gain prev/next arrows at the bottom trailing edge for walking the journey without returning to the map.

### Rounds 3–4 (same day, deployed)

Orange retreats to the data — episode markers, claimed pins, progress dots — and leaves the chrome alone. The journey HUD loses its card and title and becomes a centred launch-sequence rail: a half-transparent `NN / 100` over stops that fade off both edges, capped at 20 upcoming dots with the remainder summed into a muted `+N`, the selected stop always scrolled to centre, and the counter doubling as the series-mode toggle. Episode sheets drop the Join pill for brand-coloured TikTok/Facebook/Instagram marks (Douyin replaces TikTok on zh-CN) and lead with a **worker-fetched link preview** — `/api/map/og` crawls the post with a crawler UA (the only UA these platforms answer with OG tags), enriches TikTok from its public oEmbed for the real caption, inlines `og:image` as a data URI so the page never reaches off-origin, and edge-caches for six hours; candidates are tried in locale order and the first that answers wins (TikTok and Instagram do; Douyin and Facebook serve a wall, so the card steps aside). The floating Join pill is gone on every breakpoint; the header's "Get the app" is glass; the About drawer leads with the web forum beside Join and no longer repeats the map credit the attribution control already shows.

### Round 2 (same day, deployed)

Auto-init everywhere; theme-aware basemap wired to the existing site toggle (MutationObserver on `<html>` → `setStyle` → rebuild sources/layers/images, then restore selection, dim and series state — `setStyle` drops all of them); pin colours invert with the basemap; city-level zoom everywhere; recenter control; mobile chrome diet (D19). Live-verified in both themes plus a live toggle. Landing `3b32240`.

**Operator follow-ups:** fill `links` for episode 02 in `public/map/series.seed.json` (it's `live` but link-less, so the card falls back to "Episode in production"), confirm whether 00/01 are published, then `node scripts/push-map-data.mjs --env preview`. Prod deploy remains an explicit ask.
