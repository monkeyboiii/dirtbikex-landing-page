---
kind: why
status: current
summary: / on all 21 locales is a full-viewport MapLibre map: ~3,600 catalog pins, a 100-track journey, rider trails, shops, riders. Everything el…
---

# MAP_MODULE — the homepage is a map

`/` on all 21 locales is a full-viewport MapLibre map: ~3,600 catalog pins, a 100-track
journey, rider trails, shops, riders. Everything else the landing page used to be — join
funnel, app CTAs, legal, the indexable prose — lives in the drawer at the bottom.

Folded 2026-08-21 from `CONCRETE_MAP_PLAN.md`, `MAP_PLAN.md` and `MAP_LAYERS_PLAN.md`, which
sat at the umbrella root **in no git repo at all**. Everything below was re-checked against
the code on that date; the plans' claims that turned out to be false are listed under
[What the plans said that is no longer true](#what-the-plans-said-that-is-no-longer-true)
rather than quietly dropped, because a stale canonical doc is worse than a missing one.

Share cards for map entities are [SHARE_MODULE](share.md). How a trail gets onto the
map is [TRAILS_MODULE](trails.md). The rider layer is [LINEAGE_MODULE](lineage.md).

## Three datasets, three cadences

| Dataset | Source of truth | Reaches the map by | Cadence |
|---|---|---|---|
| catalog pins | `public/map/tracks.json` (committed bake) | the bundle | deploy |
| the journey | `public/map/series.seed.json` | R2 `dbx-map/<env>/series.json` → `/api/map/series.json` | R2 push, ≤5 min |
| trails / shops | `fixtures/map/<env>/{trails,shops}.json` | same R2 path | R2 push |

## Module layout

| Concern | Where | Notes |
|---|---|---|
| The island | [`src/scripts/worldmap/index.ts`](../../src/scripts/worldmap/index.ts) | 1,909 lines; the only file that owns the `MapLibreMap`. `bootWorldMap()` at 1792, `class WorldMap` at 392 |
| Shapes + layer registry | [`types.ts`](../../src/scripts/worldmap/types.ts) | Dependency-free on purpose so Astro frontmatter can import it |
| Sheets | [`panel.ts`](../../src/scripts/worldmap/panel.ts) | Episode / track / shop / trail cards, carousel, directions + short-video choosers |
| Journey HUD | [`hud.ts`](../../src/scripts/worldmap/hud.ts) | The scrubber rail, counter, series-mode toggle |
| Search | [`search.ts`](../../src/scripts/worldmap/search.ts) | Plain scan over the in-memory catalog — no index, no worker, no endpoint |
| GPX | [`gpx.ts`](../../src/scripts/worldmap/gpx.ts) | Fetch cap, hand-rolled scanner, decimation |
| Datum | [`geo.ts`](../../src/scripts/worldmap/geo.ts) | WGS-84 → GCJ-02, forward only |
| Markup + i18n dict | [`src/components/WorldMap.astro`](../../src/components/WorldMap.astro) | Server-renders canvas, gate, rail, search, HUD, panel, drawer; emits the config the island reads |
| Styling | [`src/styles/map.css`](../../src/styles/map.css) | 1,894 lines, banner-sectioned |
| Mount points | [`src/pages/index.astro`](../../src/pages/index.astro), [`[lang]/index.astro`](../../src/pages/[lang]/index.astro), [`BaseLayout.astro`](../../src/layouts/BaseLayout.astro) | `chrome="map"` suppresses the site footer — the drawer owns it |
| Basemap forks | [`public/map/style-dark.json`](../../public/map/style-dark.json), [`style-light.json`](../../public/map/style-light.json) | 43 layers each, identical ids/order/sources |
| Marker artwork | [`public/map/markers/`](../../public/map/markers) | Contract in its [README](../../public/map/markers/README.md): 24×24, 20×20 safe area, one colour via `currentColor` |
| Live documents | [`worker/index.ts`](../../worker/index.ts) 938–942, [`worker/_lib/mapData.ts`](../../worker/_lib/mapData.ts) | `/api/map/{series,trails,shops,track}.json`, `/api/map/og` |
| Publishing | [`scripts/push-map-data.mjs`](../../scripts/push-map-data.mjs) | `--env preview\|prod [--doc …] [--check]` |
| CI guards | [`tests/map-seeds-neutral.spec.ts`](../../tests/map-seeds-neutral.spec.ts), [`tests/no-external-assets.spec.ts`](../../tests/no-external-assets.spec.ts) | Seed neutrality; the tile carve-out |

## Both catalog tiers ship, not just the verified one

The forum's verified tier is 2,095 rows and Europe-heavy — FR 531, DE 360, IT 231, **US 72**.
Shipping it alone leaves the Americas and Asia empty at the exact moment the page says "the
dirt bike world". The bake is therefore both tiers: **3,641 features, 1,846 verified /
1,795 breadth**.

The cost is accepted deliberately: breadth rows are operators who never asked to be listed.
The takedown path is the in-app report and `/contact`.

**~79% of verified coordinates are town centroids.** Honesty about that is a per-feature
`precision` flag driving an "approximate area" chip and a wider halo — **not** a zoom cap.
Hiding imprecise pins would have hidden most of the map.

## R2 wins over the bundle

`worker/_lib/mapData.ts` `readMapDocBody()` resolves **R2 first, committed seed second**,
through `caches.default` at 300s. The seed is a fallback, not a source.

The consequence bites every time: **editing a committed seed and deploying changes nothing.**
An alpha.3 release shipped no visible change for exactly this reason. `push-map-data.mjs
--check` exists to answer "did I forget the push?" without pushing.

Worker responses are not edge-cached by `s-maxage` alone, and `cf.cacheTtl` applies only to
origin subrequests — **not to R2 binding reads**, which is what every other cache in this
repo rides on. Hence the explicit `caches.default`, at a TTL short enough that no purge
machinery is needed.

## Committed seeds are empty on purpose

`public/map/{trails,shops}.seed.json` must stay `[]`, enforced by
`tests/map-seeds-neutral.spec.ts`. The incident it encodes: seeds ship *inside the bundle*
and are served to whichever environment loses R2, so **a staging trail appeared on the
production map, attributed to a staging user, silently.**

"No trails" is the truthful degradation. "Here is another environment's trail" is not.

`series.seed.json` is the one seed with real content, because the journey document is
environment-neutral by design.

## One layer registry, imported by both sides

`LAYER_IDS` and `LAYER_DEFAULTS` are declared once in `types.ts`, which imports nothing so
Astro frontmatter can pull it in. A second hardcoded copy is how the server-rendered rail
came to paint a stale pressed state on first load.

**A layer owns its whole surface, not its style layers.** Turning off the 100 challenge also
hides the episode markers, the journey line, the HUD *and* the recenter control — "back to
the latest episode" is meaningless with episodes hidden. `riders: []` in the `LAYERS` map is
intentional: rider pins are DOM markers, and a `Marker` survives `setStyle`, so that layer
never needs replaying.

State persists to `localStorage` and mirrors to `?layers=`, so a filtered view is shareable.

## A restyle drops layers but keeps images

`setStyle` destroys every source and style layer, and they return **visible by default**, so
`applyLayers()` must re-run after every `addLayers()` — including the theme flip. The full
replay order is fixed at `index.ts:545`: projection → layers → cull → visibility → selection
→ dim → journey opacity.

Runtime images are the exception and behave the opposite way: **they survive `setStyle`**. A
`hasImage()` guard therefore skipped every reload and left each blip painted in the theme it
was born in — dark contours on the light map. Replace, never skip.

## Kind filters are written positively

Baked catalog rows carry no `kind` at all, so `IS_TRACK` coalesces rather than compares.
Written as negations — "not a shop, not a trail" — is how shops, and later trails, leaked
into the track layers twice. One toggle owns exactly one kind through `KIND_OF`, and that
same map drives the cull's ownership test and hit-test layer selection.

Every kind rides the single `tracks` GeoJSON source, so shops and trails inherit the
declutter for free.

## Three basemaps, and why not the fourth

A `layers` button in the rail switches the ground; the choice is remembered per device.
Only **DirtBikeX** follows the page theme — it is the light/dark pair built in
`public/map/style-{light,dark}.json`. **Streets** and **Topographic** are single styles and
ignore it, which is the honest behaviour: a topographic sheet has one look, and tinting it
dark would misrepresent terrain shading. Pin colours follow the GROUND (`groundIsDark`),
not the page, or dark pins land on a light topo sheet.

| | source | cost |
|---|---|---|
| DirtBikeX | OpenFreeMap vector, styled here | none — already the map's tiles |
| Streets | `tiles.openfreemap.org/styles/liberty` | none — same host |
| Topographic | OpenTopoMap raster, styled here | one new tile host |

**gpx.studio's Liberty Topo is not usable and cannot be made usable.** It is the style the
embed shows, so it is the obvious thing to reach for — but `styles.gpx.studio`,
`tiles.gpx.studio`, `fonts.gpx.studio` and `sprites.gpx.studio` all serve **no
`access-control-allow-origin`**. Their embed works because it runs on their own origin. A
browser on this one cannot fetch any of it, and proxying the whole tile stack through our
worker would be both expensive and a way of freeloading on them quietly.

Building the same look from a DEM is no easier: AWS terrarium
(`elevation-tiles-prod`) sends no CORS either, and MapLibre's demo terrain covers a single
square of the Alps. OpenTopoMap sends `*`, is global, and is the same
contours-and-hillshade picture — at the cost of being raster, so it carries baked labels
in its own language and stops at zoom 17. That trade is why it is the one that shipped.

## The map draws the viewport, not the catalog

3,640 pins at every zoom made a dense country read as a blob. `renderVisible` ships only what
is in view and decides, per pin, whether it gets artwork or stays a dot.

Nothing is dropped from the source. A pin that loses its slot ships with `top: 0` and draws as
a dot; every artwork layer — glyph, blip, glow, seal, label — filters on `top`. That two-tier
result is the whole design: the winners are readable, the losers are density, and pulling the
map back thins the artwork out instead of emptying the country.

**`pinPitch` sizes the grid, not a constant.** Icons scale with zoom, so the spacing that keeps
two of them apart has to scale with them. 1.35 × the artwork box, floored at 44 px, which lands
on 117 px at street zoom — the number the old fixed grid used. Pins that merely fail to overlap
still read as a clump, which is why the factor is above 1.

**Every layer that is switched on keeps a guaranteed share** (12% of the cap, minimum 4) before
the general fill. One shared grid without it lets 3,600 tracks take every cell in the country
and leaves the rider trails with none — a layer you deliberately switched on rendering as
nothing at all.

**Challenge badges are DOM markers**, outside the source and outside MapLibre's symbol placer,
so nothing was keeping two of them apart at any zoom. They are placed into the same grid first,
because a badge is the headline of whatever it is pinned to, and lose to `.is-crowded`.

**No clustering.** Graduated radius plus a low-zoom bloom reads as density and is far less
code; the plan's orange count bubbles were never built. Revisit only if a dense region looks
like a blob again.

The selected pin and every episode venue are exempt — culling the feature the panel is
describing strands its halo and its sheet.

### The scar: minzoom 8

Every artwork layer used to carry `minzoom: 8`, so below it a trail or a shop was not a smaller
mark, it was *nothing* — tracks kept their dot layer and the other two kinds had none. Combined
with a cull that deleted losers outright, a pulled-back map was a handful of dots on an empty
continent. Both halves had to change together: lowering the minzoom alone would have drawn
overlapping artwork, and marking losers alone would have kept them invisible.

## Verified is earned, not inherited from the catalog

There is exactly one implementation, `WorldMap.verdict()`. The series document's `verified`
block decides outright **in both directions** — including a `false` for a venue we rode,
filmed, and which then declined to join. Absent from that block, the signals speak: a stop in
the journey, or a bound forum topic.

The catalog's `tier` records how a row was *sourced* — a directory scrape versus a curated
import. It is bookkeeping, and publishing it as "Verified" / "Unverified" was publishing a
judgement we never made. **"Unverified" no longer exists anywhere.**

One verdict feeds three surfaces: the sheet's chip, the rail's dot colour, and the bloom under
an episode marker. Because it rides the series document it is an R2 push, not a rebuild.

## The tile host is a fenced breach of the China invariant

`tests/no-external-assets.spec.ts` forbids third-party runtime assets. The hosted OpenFreeMap
basemap breaches it knowingly. The fence is a **per-route allowlist** —
`/^tiles\.openfreemap\.org$/` attached only to the homepage routes, which additionally set
`exerciseMap: true` so the spec waits for real map traffic instead of asserting at `load`.

Required attribution, preserved in both style forks and repeated in the drawer:
**"OpenFreeMap © OpenMapTiles, Data from OpenStreetMap"**.

Chosen because it is $0, keyless, and explicitly permits commercial use. MapTiler's free tier
is non-commercial and we are commercial; Mapbox is a licence and an external dependency.
There is no SLA, so the boot gate degrading to the drawer is the floor.

**Two things about this are unresolved, not decided:** the mainland-vantage load test was
specified as a ship gate and there is no record it was ever run; and Cloudflare edge-injects
`static.cloudflareinsights.com` into deployed pages, invisible to the local test but a real
third-party host on the live staging site.

## What the plans said that is no longer true

Carried here so nobody re-derives them from the old files:

- **There is no `map-data/` directory.** Canonical sources are `public/map/series.seed.json`
  and `fixtures/map/<env>/{trails,shops}.json`; `scripts/lib/map-source.mjs` owns the mapping.
- **The claimed list is not R2-published.** It is `claimed: [] as string[]` in
  `WorldMap.astro`, currently empty. Live claim and owner data arrive from
  `/api/map/track.json?slug=` *after* the sheet opens, because a baked catalog cannot know who
  claimed a track this morning.
- **The tier chip is gone** — see "Verified is earned" above.
- **Directions ship on web, with GCJ-02 conversion.** The plans say both are out of scope.
- **Track → forum topic linkage is done**, not V1.5.
- **Trail geometry is fetched on tap, not baked into the document.** The plans describe
  Douglas–Peucker simplification *into* `trails.json`; entries are metadata-only now.
- **Client-side search is done**; the `/s/t/<slug>` share route names are wrong (see
  [SHARE_MODULE](share.md)).
- **No RTL text plugin was ever added**, though §5.3 asserts it as shipped.
- **The boot poster is a CSS surface, not a pre-rendered image**, so it is not the LCP element.
- `PROD_INSTALL_DEBT.md` was cited five times across the scripts, the CI guards and two
  prod-upgrade guides and **never existed**. All five citations were rewritten on 2026-08-21.
  That is what an unfixed fold looks like six weeks later; do not reintroduce it.

## What broke

- **MapLibre v6 is ESM-only with no default export** and derives its worker URL from
  `import.meta.url`, which Vite cannot analyse — the worker chunk is never emitted and the map
  404s at boot. Fixed with `?worker&url` + `setWorkerUrl`.
- **A CSS `display` rule beats the UA `[hidden]` rule.** The panel stayed in layout, invisible,
  swallowing every map click underneath it.
- **`import.meta.url` in `.astro` frontmatter** does not resolve relative to `src/`, so a
  relative `readFileSync` of the catalog silently yielded zero tracks — no error, empty map.
  Use `process.cwd()`.
- **A wide transparent scroll container is an invisible tap sink.** The recenter control was
  untappable on phones because the HUD rail's full-width scroll box outranked it.
  `elementFromPoint` found it; every screenshot looked perfect.
- **A regex with an apostrophe-safe backreference backtracks quadratically on a no-match
  document.** Facebook's wall page returned Cloudflare 1102, worker CPU exceeded. Replaced
  with a bounded head scan.
- **Capping fetched HTML by rejecting instead of truncating** killed Instagram previews — its
  HTML exceeds the cap.
- **`redirect: 'follow'` applied the host allowlist only to the pre-redirect URL.** Hops are
  now followed by hand and re-checked at each one.
- **Episode 02 was ~15 km off**, wearing coordinates that belonged to episode 00, because
  episodes were bound to inline coords instead of catalog slugs.
- **`pnpm build 2>&1 | tail` hides a failed build** — the pipeline's exit status is `tail`'s,
  so a chained deploy ships a stale `dist`.
- **Edge-cached HTML made a deploy look wrong** — desktop served the old bundle while mobile
  was correct. Confirm the live HTML references the freshly built `_astro/…js` hash first.
- **`run_worker_first` must list `/api/map/*` in BOTH wrangler blocks** or the asset layer
  405-shadows the routes.

## Deferred, and why

- **Self-hosted tiles (M2)** — hold not lifted. Planetiler → PMTiles on R2 (~70–100 GB,
  ≈$1.50/mo) is the likely winner because the style fork survives unchanged. Triggers: the
  China check fails, OFM wobbles, or bandwidth allows.
- **Terrain / hillshade** — the raster-DEM planet is ~706 GB even at z0–12.
- **Events layer** — V2; the forum's event data is real but was not needed to prove the map.
- **Shops as real entities** — `fixtures/map/<env>/shops.json` is empty in both environments;
  `amenities: []` ships on every feature as headroom.
- **Marker artwork** — engineer-drawn placeholders; no designer pass happened.
- **Hero / Features / FeaturedTopics / FAQ** still sit in `src/components/` with no home.
- **Held firm at V1:** accounts, personalization, GPX uploads on web, editing from web, any
  framework, live WebSocket anything. **Web upload has since shipped**, and it holds the line
  it was drawn against: the visitor still has no account here, and the forum is still the only
  place they have a session — see [TRAIL_UPLOAD_MODULE](trail-upload.md).

## Operator

| When | Do |
|---|---|
| After any story edit | `node scripts/push-map-data.mjs --env preview\|prod [--doc series\|trails\|shops]`. `--check` first. `--env prod` is explicit-ask |
| ~Monthly | Re-bake the catalog from a **copy** of `contacts.db` — `export_catalog.py` mints slugs as a write side-effect — and commit `public/map/tracks.json` |
| Episode goes live | Fill its `links`, or the card reads "Episode in production" |
| Before treating CN as shipped | Run a mainland-vantage check against `tiles.openfreemap.org` |
| Standing | Decide whether to switch off Cloudflare Web Analytics; it edge-injects a third-party script the local test cannot see |

## Verifying the map

1. Load `/` and wait for `[data-map-gate][data-state="done"]`. The HUD is built *after* that,
   so wait for `.wm-ball` before asserting on the rail.
2. Toggle each rail layer. Every surface the layer owns must move together — switch off the
   challenge and the HUD and recenter go with it.
3. Flip light/dark. Pins must repaint into the new palette; sampling the pixels is the only
   reliable check, since a small violet icon on black reads as grey in a screenshot.
4. Deep-link `?t=<slug>`: camera lands at city zoom, the sheet opens, the pin stays lit and
   clear of the sheet.
5. `PLAYWRIGHT_BASE_URL=<deployed> pnpm exec playwright test tests/no-external-assets.spec.ts`
   — **set the base URL**, or the config also boots `astro dev` and vite plus chromium on this
   box's two cores is what rebooted it on 2026-08-18.

Run Playwright through `~/bin/pw-limited` with `--workers=1`. Against staging the spec fails
on the Cloudflare beacon; that is the spec working, not a bug to allowlist away.

## A light basemap under dark chrome

Pins already followed `groundIsDark`; the rail, HUD and sheets did not. Choosing topo or
streets on a dark page left dark slabs on a pale map with light-palette pins beside them.

`syncGroundAttribute()` stamps `data-ground="light"` on the map root whenever the chosen
basemap is one of the light sheets and the page is dark, and `.dark .wm[data-ground='light']`
puts the map's own chrome back on the light token set.

**Scoped to `.wm`, not `html.dark`.** The visitor asked the *site* for dark; a basemap
picker is not a theme switch, and flipping the page theme would take the header, footer and
every other page with it. Called on boot, on restyle (before the tiles, so the chrome does
not flash the old palette across the style load) and on theme change.

## When the map app will not open

`openVia` tries the custom scheme, then falls back. **WeChat is the case the fallback is
written around**: MicroMessenger blocks schemes for apps it has not whitelisted *and* blocks
`window.open(_, '_blank')`, so both the attempt and the fallback failed silently — a button
that does nothing, twice.

The fallback now navigates the current tab, which WeChat allows, and says why first through
`deps.onNotice` → `WorldMap.notice()`, a transient line over the map. `window.open` is still
preferred everywhere else: keeping the map open is better when the browser permits it.

## The upload picker's `accept`, and the platform that cannot have one

The markup lists `.gpx`, `.gpx+xml`, `application/gpx+xml` and the XML MIME types. `.gpx+xml`
is not a typo — Discourse appends its own `.gpx` to a file a recorder already named
`.gpx+xml` — and plenty of exporters label a GPX `text/xml`.

**On Apple portables the attribute is removed entirely, and it cannot be narrowed.** iOS
resolves every token to a Uniform Type Identifier and greys out what it cannot map. GPX has
no system UTI unless an installed app declares `com.topografix.gpx`, so a `.gpx` resolves to
`public.data` — and no accept value both includes `public.data` and excludes anything else.
iOS 18 ignored unmatched tokens; iOS 26 honours them, which is why the same file on the same
phone stopped being selectable after an update. `preflight()` is the real filter, and it
gives a better message than a greyed-out row.

## Undoing a pinch after the rename field

`resetZoom()` sets `user-scalable=no`, waits two frames for Safari to commit the clamped
viewport, then restores. The first version set only `maximum-scale=1` and restored 250 ms
later, and often did nothing: once a visitor has pinched, `maximum-scale` alone is advisory
on iOS, and a restore landing in the same paint is indistinguishable from never having set
it. Scaling is handed back immediately after — clamping it permanently would take the map's
own gestures with it.

