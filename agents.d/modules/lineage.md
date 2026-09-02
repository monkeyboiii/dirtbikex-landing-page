---
kind: why
status: current
summary: The public read surface for the lineage graph . Everything here is READ: the worker has no visitor session, so confirming, declining and …
---

# LINEAGE_MODULE — the rider résumé on the web

The public read surface for the lineage graph (design + phases:
the design record folded into this file 2026-08-21). Everything here is READ: the worker has
no visitor session, so confirming, declining and claiming all happen in the
forum, which is where the session lives.

## Routes

| Route | What it serves |
|---|---|
| `/s/l/<username>` | **The complete résumé, share spelling.** A bare segment is a forum username (the only handle you can give someone over the phone); `@name` and an `r-…` slug also resolve. This is the link to hand out. |
| `/lineage/<slug>` | The same document, addressed by node: the opaque rider slug, or `@username` for a claimed rider. Canonical — `/s/l/` points `rel=canonical` here so the two spellings do not split indexing. |
| `/lineage/claim?t=<token>` | "Is this you?" — the preview a claim link opens, then a hand-off into the forum's claim route. `no-store`. |
| `/api/lineage/rider.json?r=<slug\|@user>` | The same projection as JSON, for the app and anything else. |
| `/api/lineage/track.json?slug=` | Contributors of one track (the byline on a track sheet). |

`/s/*` was already in `run_worker_first` in both wrangler blocks, so `/s/l/`
needed no config change; the rest are listed explicitly. Without that,
`not_found_handling: "404-page"` preempts and edge-caches a 404 for them.

### Why `/s/l/` exists when `/lineage/` already did

`/s/*` is the share namespace: it is AASA-claimed by the iOS app, it is what
`shareURL(kind:key:)` builds, and it is the shape every other shareable thing
already uses (`/s/i/`, `/s/u/`, `/s/e/`). A lineage link handed to a track owner
is a *share*, and it should behave like one — open the app when the app is
installed, open the web page otherwise. Addressing it by username rather than by
slug is the other half: `r-a8z82qhgg7` is deliberately opaque and unguessable,
which is right for a consent boundary and wrong for something you read aloud.

**This is load-bearing on iOS:** because `/s/*` is AASA-claimed, a `/s/l/` URL
opens the app *whether or not the app can route it*. `ShareKind.lineage = "l"`
and the `.lineage` arm in `PushNotificationService.navigateToDestination` are
what stop it dead-ending on a blank screen. Do not add an `/s/<kind>/` route
here without the matching `ShareKind` case in the app.

## The two states of a résumé

A username that resolves to a real, visible account **always renders**, even with nothing recorded:
zeros in the stat strip and a "connect with riders" CTA into the forum's add form. Answering "no
such page" to the profile tab of exactly the people the feature is trying to reach was the old
behaviour and the wrong one — the plugin's `blank_resume` is shaped like a normal résumé so no
consumer needs a second code path (`slug` is null, `empty: true`).

A 404 still means what it always meant: no such user, or one the viewer may not see. That page now
carries **Join DirtBikeX** and **Explore the map**, because it is a landing page for a stranger who
followed someone's link, not only a dead end.

## `?debug=true`

Any of the three HTML routes above takes `?debug=true` and appends an operator
panel (`worker/_lib/lineageDebug.ts`). It exists for E2E passes — the questions
a verification run actually asks, answered on the page instead of in five curls:

| Block | Answers |
|---|---|
| request | which route matched, the raw segment, the normalized ref, `?lang=` vs `Accept-Language`, and **whether this locale has its own copy/label tables or silently fell back to `en`** |
| upstream | the exact forum URL fetched (as a link), outcome, HTTP status, elapsed ms, and the 5-minute edge-cache caveat |
| invariants | every counter against the length of the list rendered under it (`stats.mentors` = `learned_from`, `stats.students` = `taught`, `stats.tracks` = `contributed_to`, timeline arithmetic) with OK/MISMATCH. This is §3.4's contract made checkable: a public read counts reported *and* confirmed edges, and a withheld name still occupies a row, so the two must always agree |
| rider | the node as the projection returned it — `claimed`, `placeholder`, `state`, `map_visible`, `known_for` |
| sections | every edge with its raw values: id, provenance, documented, counterpart (`@user` / slug / `(placeholder)`), facet **codes**, years + precision, honorific vs proposed |
| vocabulary | facet codes in this payload with no label in this locale — they render as the bare code on the page, which is invisible until you look for it |
| related queries | one click to the rider/stats/track/user-serializer endpoints and the worker proxies for *this* rider |
| knobs | the same page in another locale, the other route, `lang=auto`, and back to the visitor view |

Notes:

- It exposes nothing privileged. Every field comes from the same anonymous
  endpoint the page already renders — a `curl` of the forum returns the same
  bytes. The claim page is the exception that proves it: the token is the only
  credential on that page, so the panel prints `(token withheld)`.
- Debug renders are `noindex`, and they emit **zero JavaScript** (`<details>`,
  no handlers) so the China asset invariant still covers them.
- `?debug=true` on a 404 is the useful case: the not-found page carries the
  panel too, and that is where the upstream status and reason live
  (`unreachable:bad_status` + HTTP 502 reads very differently from `not_found`).

## How it reads the graph

`worker/_lib/lineageLookup.ts` fetches the plugin's anonymous endpoints
(`/dirtbikex/lineage/…`) with a 5-minute edge cache. No API key, no CORS, no
Data Explorer query and therefore no per-environment operator step — the same
trade TRAILS_MODULE.md settled for trails. A missing rider, a retracted one
and a profile-hidden one are indistinguishable (uniform 404 from the plugin), so
the page cannot be used to test whether a named person is in the graph.

## What the page will not do

- **No client JS and no external assets.** `worker/_lib/lineageRender.ts` emits a
  complete document with inline CSS; avatars come from the forum host, which the
  no-external-assets allowlist already covers. The lineage route is in that
  spec's ROUTES so the China invariant extends to it.
- **No graph explorer.** The timeline argues the story reads
  better than a node graph on a phone, and a layout engine is a dependency this
  page does not need. The explorer is a v2 question.
- **No names it was not given.** An unclaimed rider renders as "Unclaimed rider"
  unless the operator marked the node public; the claim preview is the one place
  a name is shown to whoever holds the link, which is the point of the link.

## Facet labels

`getFacetLabels()` duplicates the plugin's `client.{en,zh_CN}.yml` vocabulary,
because this page is read by people who never sign in and so cannot reach the
forum's i18n. Adding a facet code means editing the Ruby constant, the plugin
locales, and this table.

## `/s/u/<username>`

The profile card gained a lineage line (students · downstream). It costs no
extra request: `dbx_lineage_counts` already rides the `/u/<name>.json` payload
`lookupUser` fetches. It disappears on its own when the plugin setting is off.

Under it, a "See the full lineage" CTA to `/s/l/<username>` — the card states
the numbers, the résumé is where they are accounted for.
Shown only when there is something to open.

## Verifying the asset invariant

The lineage route is in `tests/no-external-assets.spec.ts` (`LINEAGE_TEST_PATH`
overrides the seeded rider), and `playwright.config.ts` now takes
`PLAYWRIGHT_BASE_URL` — worker-served routes do not exist under `astro preview`,
so the check has to be able to point at a deployed environment:

```shell
PLAYWRIGHT_BASE_URL=https://www.dirtbikechina.com \
  ./node_modules/.bin/playwright test tests/no-external-assets.spec.ts --project=chromium --workers=1
```

**The staging box has no Playwright browser installed** (`playwright install
chromium`, ~180 MB), so 2026-08-17 the invariant was verified statically instead:
the rendered page has zero `<script>` tags, one inline `<style>`, no external
stylesheet or font, no `<img>` from a third-party host, and exactly two outbound
*links* (the forum thread cited as evidence, and the App Store CTA) — neither of
which is a loaded asset.

## On the map

Two touches, both small on purpose:

- **"Built by" on a track sheet.** `panel.ts` appends the byline *after* the
  sheet is already open, so a slow or absent lineage endpoint never delays the
  venue card. Contributors come from the same anonymous projection as the
  résumé; an unclaimed one stays a placeholder here too, and the ○/✓ glyph is
  the same honesty contract.
- **A `riders` rail toggle**, off by default and hidden entirely when nobody is
  on it. It is drawn with **DOM markers, not style layers** — a `Marker`
  survives `setStyle`, so this layer never joins the hard-coded `addLayers()`
  block, the hit-test list or the click-dispatch chain that
  MAP_MODULE.md wants refactored before another style layer lands. Each
  marker is a plain anchor to that rider's résumé: no sheet, nothing to keep in
  sync, nothing to clear when the layer is switched off.

Positions are coarsened to ~1 km on the server and only for riders the operator
approved (or who cleared the confirmed-edge bar). The
worker proxy returns an empty list rather than an error when the layer is off,
which the island treats the same as "nobody is on the map".

---

# Design record

Folded 2026-08-21 from `LINEAGE_PLAN.md` (293 lines) and `LINEAGE_INIT.md` (989), both
untracked at the umbrella root. Kept here because the decisions are still load-bearing and
the negative space is what stops them being re-litigated. The exploration prose is gone; the
calls survive.

## The calls, and what each one refused

- **Do not fork or extend `discourse-follow`.** Lineage is its own model; follow stays
  byte-identical. No auto-follow on a confirmed edge, and nothing in lineage may read follow
  edges or derive seeds from them — so retiring follow later stays a clean removal.
- **The graph lives in plugin-owned Postgres tables**, inside the existing
  `discourse-dirtbikex-event-filters` plugin as a second top-level block. No D1, no R2 graph
  document, no Data Explorer query for reads (a per-environment operator step, already
  rejected once for trails), no new plugin, no new container pin.
- **Unclaimed riders are plugin rows with `user_id NULL`** — never Discourse staged users, no
  shadow accounts, no email stored for someone who has not signed up.
- **Consent defaults closed.** `name_public=false`; a placeholder renders unless the operator
  flags the person as consented. No name is rendered for an unclaimed node anywhere public —
  the claim preview is the single exception, and only to whoever holds the token.
- **Mutual confirmation runs on notification types plus a plugin endpoint**, not Reviewables
  and not a PM courier. Reviewables are kept for disputes, token-less claim requests and
  abuse flags — never for the ordinary "X says you taught them".
- **The landing page is the primary public read surface; every write stays in the forum.**
  Every renderer consumes the same two query shapes, so a new surface is a renderer, not a
  new query.
- **Riders reach the map only gated**: claimed, located, and either operator-approved or over
  the confirmed-edge bar, with coordinates coarsened server-side. No people edges on the map.
- **Provenance is published instead of a verified/fake binary.** Every edge shows who
  asserted it and whether the counterparty agreed. No verification badge, no trust score, and
  a reported edge renders with ○ rather than being withheld.
- **Revelation is the reward** — contributing makes more of the network visible. No XP, no
  badges, no leaderboards, no streaks. Rejected outright, not postponed.
- **A neutral default label.** 师父/徒弟 is an optional elevation both parties opt into, a
  separate `honorific` pair on the edge, never a relationship type or a required field.
- **Approximate years with an explicit precision flag.** No mandatory dates, no session
  counts, no evidence requirement to record an edge.
- **Seed operator-first** — seed, claim, confirm, expand — stamping each seeded edge with its
  source and leaving it unconfirmed. Seed names live in a private repo cloned on dbc only:
  never in `Misc/`, never in the landing repo, never in the plugin repo, never in the CRM.
- **No coupling to video-master at all.** No `video:` refs, no manifest emits, no status
  field; `evidence_url` is a generic forum URL.

## What the plans said that is no longer true

- **The share URL is not `/s/l/<username>`.** Map-adjacent kinds moved to `/share/` — see
  [SHARE_MODULE](share.md) for why an un-evictable iOS cache forced a different prefix.
- **Notification 852 is `lineage_declined`, not `lineage_disputed`.** 850 and 851 are as
  planned.
- **`map_visible` is tri-state, not `bool default false`** — NULL means nobody has decided,
  which is not the same as a "no".
- **"Uniform 404" no longer covers a user with no rider node.**
- **There is a profile tab**, contradicting §4.1's "no profile tab in v1".
- **The worker's riders endpoint is `/api/lineage/riders.json`**, not `geo.json`.
- **The `run_worker_first` entries are done**, not pending, and present in both blocks.
- **The follow-keys time bomb is fixed in iOS source**, not pending.
- **Every version pin in the plan's status header is stale.**
- The five-state provenance table, the glyph legend's last row, the club/shop/event object
  types, the five-view product framing and the three-screen funnel all describe scope that
  was cut. **Every rider name in `LINEAGE_INIT.md` was an invented illustration**, not seed
  data — do not quote its counts as if they were measurements.

## Deferred

Graph explorer and ego graphs; skills filter; degrees of separation; scene genealogy; mentor
discovery; track→track influence edges; club/shop/event node types; "community-supported" as
a provenance state; per-facet legacy statistics; an `attestations` table; materialised
`dirtbikex_rider_stats` counters (build them event-driven only past ~2,000 nodes or p95 >
50 ms); the `lineage-feed` topic filter; a CRM people table; abusive-confirmation heuristics.
