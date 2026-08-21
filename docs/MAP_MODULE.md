# MAP_MODULE — the homepage is a map

`/` on all 21 locales is a full-viewport MapLibre map: ~3,600 catalog pins, a 100-track
journey, rider trails, shops, riders. Everything else the landing page used to be — join
funnel, app CTAs, legal, the indexable prose — lives in the drawer at the bottom.

Folded 2026-08-21 from `CONCRETE_MAP_PLAN.md`, `MAP_PLAN.md` and `MAP_LAYERS_PLAN.md`, which
sat at the umbrella root **in no git repo at all**. Everything below was re-checked against
the code on that date; the plans' claims that turned out to be false are listed under
[What the plans said that is no longer true](#what-the-plans-said-that-is-no-longer-true)
rather than quietly dropped, because a stale canonical doc is worse than a missing one.

Share cards for map entities are [SHARE_MODULE](SHARE_MODULE.md). How a trail gets onto the
map is [TRAILS_MODULE](TRAILS_MODULE.md). The rider layer is [LINEAGE_MODULE](LINEAGE_MODULE.md).

## Three datasets, three cadences

| Dataset | Source of truth | Reaches the map by | Cadence |
|---|---|---|---|
| catalog pins | `public/map/tracks.json` (committed bake) | the bundle | deploy |
| the journey | `public/map/series.seed.json` | R2 `dbx-map/<env>/series.json` → `/api/map/series.json` | R2 push, ≤5 min |
| trails / shops | `fixtures/map/<env>/{trails,shops}.json` | same R2 path | R2 push |

## Module layout

| Concern | Where | Notes |
|---|---|---|
| The island | [`src/scripts/worldmap/index.ts`](../src/scripts/worldmap/index.ts) | 1,909 lines; the only file that owns the `MapLibreMap`. `bootWorldMap()` at 1792, `class WorldMap` at 392 |
| Shapes + layer registry | [`types.ts`](../src/scripts/worldmap/types.ts) | Dependency-free on purpose so Astro frontmatter can import it |
| Sheets | [`panel.ts`](../src/scripts/worldmap/panel.ts) | Episode / track / shop / trail cards, carousel, directions + short-video choosers |
| Journey HUD | [`hud.ts`](../src/scripts/worldmap/hud.ts) | The scrubber rail, counter, series-mode toggle |
| Search | [`search.ts`](../src/scripts/worldmap/search.ts) | Plain scan over the in-memory catalog — no index, no worker, no endpoint |
| GPX | [`gpx.ts`](../src/scripts/worldmap/gpx.ts) | Fetch cap, hand-rolled scanner, decimation |
| Datum | [`geo.ts`](../src/scripts/worldmap/geo.ts) | WGS-84 → GCJ-02, forward only |
| Markup + i18n dict | [`src/components/WorldMap.astro`](../src/components/WorldMap.astro) | Server-renders canvas, gate, rail, search, HUD, panel, drawer; emits the config the island reads |
| Styling | [`src/styles/map.css`](../src/styles/map.css) | 1,894 lines, banner-sectioned |
| Mount points | [`src/pages/index.astro`](../src/pages/index.astro), [`[lang]/index.astro`](../src/pages/[lang]/index.astro), [`BaseLayout.astro`](../src/layouts/BaseLayout.astro) | `chrome="map"` suppresses the site footer — the drawer owns it |
| Basemap forks | [`public/map/style-dark.json`](../public/map/style-dark.json), [`style-light.json`](../public/map/style-light.json) | 43 layers each, identical ids/order/sources |
| Marker artwork | [`public/map/markers/`](../public/map/markers/) | Contract in its [README](../public/map/markers/README.md): 24×24, 20×20 safe area, one colour via `currentColor` |
| Live documents | [`worker/index.ts`](../worker/index.ts) 938–942, [`worker/_lib/mapData.ts`](../worker/_lib/mapData.ts) | `/api/map/{series,trails,shops,track}.json`, `/api/map/og` |
| Publishing | [`scripts/push-map-data.mjs`](../scripts/push-map-data.mjs) | `--env preview\|prod [--doc …] [--check]` |
| CI guards | [`tests/map-seeds-neutral.spec.ts`](../tests/map-seeds-neutral.spec.ts), [`tests/no-external-assets.spec.ts`](../tests/no-external-assets.spec.ts) | Seed neutrality; the tile carve-out |

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

Every kind rides the single `tracks` GeoJSON source, so shops and trails inherit the viewport
cull and the per-kind budget for free.

## The map draws the viewport, not the catalog

3,640 pins at every zoom made a dense country read as a blob. The cull keeps only what is in
view, capped per kind, spread over a ~116px grid, with the budget scaling to viewport size.

**No clustering.** Graduated radius plus a low-zoom bloom reads as density and is far less
code; the plan's orange count bubbles were never built. Revisit only if a dense region looks
like a blob again.

The selected pin and every episode venue are exempt from culling — culling the feature the
panel is describing strands its halo and its sheet.

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
  [SHARE_MODULE](SHARE_MODULE.md)).
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
  framework, live WebSocket anything. Web upload is now under discussion — see
  [TRAIL_UPLOAD_PLAN](../../../../TRAIL_UPLOAD_PLAN.md).

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
