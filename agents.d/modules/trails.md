---
kind: why
status: current
summary: A trail is one rider's recorded GPX, promoted onto the world map by an operator. It draws as a blip like any catalog pin until you tap it…
---

# TRAILS_MODULE — somebody's actual ride, on the map

A trail is one rider's recorded GPX, promoted onto the world map by an operator. It draws as
a blip like any catalog pin until you tap it, at which point its trace is fetched and drawn
as a polyline.

This documents the operator path. The other one — a visitor dropping their own `.gpx` on
the map — is [TRAIL_UPLOAD_MODULE](TRAIL_UPLOAD_MODULE.md), and it shares this file's entry
format, its parser and its map layers, but none of its storage: an upload lives in D1 and is
merged into the document at serve time, never written into it.

Folded 2026-08-21 from the trail sections of `CONCRETE_MAP_PLAN.md` (D12) and
`MAP_LAYERS_PLAN.md` §3b, both untracked at the umbrella root. The surface a trail appears on
is [MAP_MODULE](MAP_MODULE.md); its share card is [SHARE_MODULE](SHARE_MODULE.md).

## Module layout

| Concern | Where |
|---|---|
| A forum post id → a trail entry | [`scripts/import-forum-trail.mjs`](../scripts/import-forum-trail.mjs) |
| A loose file or CDN URL → a trail entry | [`scripts/import-gpx-trail.mjs`](../scripts/import-gpx-trail.mjs) |
| The GPX → entry maths, shared by both | [`scripts/lib/gpx-trail.mjs`](../scripts/lib/gpx-trail.mjs) |
| Which file is canonical for which environment | [`scripts/lib/map-source.mjs`](../scripts/lib/map-source.mjs) |
| Validation + the R2 push | [`scripts/push-map-data.mjs`](../scripts/push-map-data.mjs) |
| The documents themselves | [`fixtures/map/preview/trails.json`](../fixtures/map/preview/trails.json), [`fixtures/map/prod/trails.json`](../fixtures/map/prod/trails.json) |
| Outage fallback (must stay empty) | [`public/map/trails.seed.json`](../public/map/trails.seed.json) |
| Serving | [`worker/_lib/mapData.ts`](../worker/_lib/mapData.ts) → `/api/map/trails.json` |
| Client fetch + parse + decimate | [`src/scripts/worldmap/gpx.ts`](../src/scripts/worldmap/gpx.ts) |
| Ingest, layers, tap-to-draw | [`src/scripts/worldmap/index.ts`](../src/scripts/worldmap/index.ts) — `fetchTrails`, `openTrail`, `traceTrail`, `drawTrail`, `fitTrail` |
| The trail sheet | [`src/scripts/worldmap/panel.ts`](../src/scripts/worldmap/panel.ts) `showTrail` |
| Seed-neutrality guard | [`tests/map-seeds-neutral.spec.ts`](../tests/map-seeds-neutral.spec.ts) |

## A trail entry is metadata; the geometry is fetched on tap

An entry carries `id`, `title` (a locale blob), the author's forum identity, `gpx_url`,
`post_url`, `distance_km` and `stats { segments, points, bbox, centre, shape, ele, time }`.
It does **not** carry the line.

This reversed an earlier decision. Geometry used to be Douglas–Peucker-simplified *into* the
document; the plans still describe it that way. The reversal was for growth: the trails
document is fetched whole when the layer switches on, and every trail's polyline living in it
made that payload scale with the catalog. Metadata-only keeps it flat, and the trace is
fetched only for the one trail somebody tapped — bounded by the same viewport cull and render
budget as everything else.

The cost is one extra round trip per tap, and a client-side parse.

## Its file must be a Discourse upload on this environment's CDN

`push-map-data.mjs` refuses anything else. The rules, all of them:

| Rule | Why it exists |
|---|---|
| `id`, `author_username`, integer `author_user_id` | the id is the identity; the cached name keeps `/s/u/<username>` working through a rename |
| `stats.centre` numeric, `[lng, lat]`, in range | a swapped pair throws inside MapLibre's bounds check and **takes the whole catalog down** — and the series document uses `{lat, lng}`, so the swap is the likely hand-edit mistake |
| no duplicate `id` | — |
| `gpx_url` starts with `<uploads-cdn for this env>/` | a staging URL served to prod visitors 404s every trace. **Host only** — the path is whatever Discourse returned |
| author avatar host must be this environment's forum | pointing it at the other environment attributes the ride to a stranger, which reads as true and is not |

That fourth rule is the load-bearing one: **a trail's file has to be a Discourse upload.**
There is no other storage path today, and every proposal to add one has to answer to this
validation.

## Never the short URL

Cooked forum HTML always carries `/uploads/short-url/<base62>.gpx`, which **302s to the raw
object-store host**. That host serves the bytes, but the map must fetch
`uploads-cdn.<apex>` — it is what the site's allowlist and the mainland-China invariant are
written against, and it serves `ACAO: *`.

So the short URL is followed exactly once, at import time, and **only the host is
swapped** — the path is carried verbatim. See the first trap.

## Trails are environment data and never ship in the bundle

`fixtures/map/<env>/trails.json` is canonical and reaches an environment only through R2.
`public/map/trails.seed.json` must stay `[]`.

The incident: seeds ship inside the bundle and are served to whichever environment loses R2,
so **a staging trail appeared on the production map, attributed to a staging user**, silently,
for anyone who hit an R2 hiccup. `tests/map-seeds-neutral.spec.ts` now fails CI on a
non-empty seed, an environment-named string, or a fixture pointing at the other forum.

The same bytes can legitimately exist in both environments — the two live trails share a
sha1 — but the authorship differs, because the author is that forum's user.

## A forum post id is all you need

```shell
node scripts/import-forum-trail.mjs --post 164 --env preview [--push]
```

Everything derives from the anonymous `GET /posts/<id>.json`: author id, username, display
name and avatar; the topic back-link; the `.gpx` attachment resolved to the CDN form; the
title; and a slugified id. `import-gpx-trail.mjs` is the same maths when there is no post.

**This is the human step.** An operator decides a ride belongs on the map, confirms the
attachment is in a public category, and pings the author first — a trace is a precise
location, and promoting one is a consent decision, not a data decision.

Two rules the importer enforces and any upload path inherits:

- **A rider may only put their own ride on the map, from their own post.** The post is the
  author's, so the trail is theirs; the operator running the script is not the author.
- **Exactly one `.gpx` per post**, or it refuses. Ambiguity is not guessed at — "split them
  across posts, or import each one separately".

An ASCII slug collapses a CJK title to nothing, which is why the post id is always appended:
a fully-Chinese title yields `trail-<postId>`.

## The parser is hand-rolled, and not for fun

`gpx.ts` uses neither `DOMParser` nor a regex. `DOMParser` retains roughly twelve times the
file size in renderer memory and yields nothing at all from a stream truncated by a byte cap;
a regex can be made to backtrack, and this project has already taken a worker-CPU outage from
one. The scanner cannot backtrack by construction and recovers whatever prefix it was given.

Caps: `MAX_POINTS` 2000, `SCAN_LIMIT` 80,000 points, `MAX_GPX_BYTES` 10 MB — which is exactly
`max_attachment_size_kb` on the forum, so both ends agree.

Simplification is deliberately **not** Douglas–Peucker at draw time: MapLibre re-simplifies
per zoom anyway, and DP costs several times more than handing it the points. The decimation
that exists only bounds memory.

**A hoisted terminator is load-bearing.** Searching for the segment terminator inside the
scan loop made it O(points × filesize): a single-segment 20,000-point ride took 5.4 s on the
main thread, and a 10 MB file took minutes.

## There are two GPX parsers, and their numbers disagree

`scripts/lib/gpx-trail.mjs` parses with regexes, in Node, at import time. `gpx.ts` parses
with the hand-rolled scanner, in the browser, at tap time. They read the same file and do not
have to agree, and nothing checks that they do.

It has not bitten yet because the importer's numbers go in the document (distance, point
count, bbox) and the browser's only feed the drawn line. There is now a **third**:
`src/scripts/worldmap/upload.ts` measures a visitor's file in the browser, using the same
hand-rolled scanner, and those numbers go straight into the entry — so an uploaded trail's
distance comes from `gpx.ts`'s reading and an imported trail's from `gpx-trail.mjs`'s. See
[TRAIL_UPLOAD_MODULE](TRAIL_UPLOAD_MODULE.md).

## Route points poison a file

`<rtept>` is a plotted route, not a ridden line. A file containing them is **rejected
outright, even when a valid `<trk>` sits alongside** — route points crash gpx.studio's stats
and are not a record of anyone riding anywhere. `fells_loop.gpx` on staging is the test case
that keeps failing on purpose.

Segments stay separate. Joining them draws a stroke through every pause.

## A drawn trace owns the ground its pin was on

While a trail is traced, the trail layers exclude it — blip, glow and label. A pin sitting on
top of the line it stands for hides the shape the visitor tapped to see.

It is tied to the geometry **landing**, not to the tap, so a failed or aborted fetch leaves
the pin where it was. The consequence to know: **while a trace is drawn, its line is the only
clickable surface for that trail.** Hit-test order is explicit for the same reason — a blip
beats the line it belongs to, and a small pin beats a large one drawn over it, so nothing
becomes unselectable by being underneath.

One trail is drawn at a time and one download is ever in flight; opening another aborts the
previous fetch. Three fields have to move together: `selected`, `selectedTrail` and
`tracedTrail` — the last is not the same as the second, and any track or episode selection
must run `clearTrail()` first, or a late-arriving download flies the camera away from what
the visitor is reading.

## Traps

- **`/original/1X/<sha1>.gpx` is not the only upload path, and both scripts used to assume
  it was.** Discourse computes `depth = ceil(log16(id/1000))`, so past upload id 1000 a file
  lands at `original/2X/<c>/<sha1>.gpx`. `import-forum-trail.mjs` rebuilt the shallow form
  from the sha1 (a URL that would 404) and `push-map-data.mjs` asserted it (rejecting a
  legitimate entry). **Fixed 2026-08-21** — the importer now carries the redirect's path and
  swaps only the host, and the validator checks the host only. Staging was at upload id 138
  when this was found, so it had never fired.
- **`gpx-trail.mjs` and the two importers must not drift** — `push-map-data.mjs` validates
  one shape, and even the key order is fixed.
- **`push-map-data` validates far less than it looks like it does.** For trails it checks the
  id, the author, `stats.centre`, uniqueness and the two host rules — and nothing else. Not
  `distance_km`, not `title`, not `bbox`/`points`/`segments`, and not that the `gpx_url`
  basename is a 40-hex sha1. Any host-correct URL passes.
- **A local-file import produces an entry that cannot be published.** `--gpx` only sets
  `gpx_url` when the argument is already an http(s) URL; otherwise the key is omitted and the
  push bails. Upload to the forum first.
- **`--env preview` means the *staging forum*** (`forum.dirtbikechina.com`) and the `preview/`
  R2 prefix. It is not the wrangler environment name, and the two are easy to conflate aloud.
- **A missing trails document never 404s.** The worker falls back to the empty seed and only
  503s when both R2 and the assets fail — so a bad `MAP_DATA_PREFIX` or an unpushed
  environment looks exactly like "there are no trails yet".
- **The `--check` flag fetches the live URL, not the bucket**, so a fresh push can still
  report DRIFTED from edge cache for minutes. Read the R2 object to settle it. For trails it
  also strips every live entry carrying `visibility` first — those are visitor uploads merged
  at serve time and are not in R2 at all.
- **A committed fixture change does nothing until pushed.** R2 wins over the bundle.
- **A failed GPX fetch is cached as an empty trace for the rest of the page load.** Fixing
  the upload on the forum does not fix an open tab — reload it.
- **`?layers=` replaces the stored set whole**, so a share link naming `tracks,trails` turns
  every other layer off.
- **`loadTrails()` is memoised as a promise, not a result** — four concurrent callers would
  otherwise each push a full copy of every trail into the shared source.
- **`PROD_INSTALL_DEBT.md` never existed.** It was cited five times across the scripts, the
  guards and two prod-upgrade guides. Every citation was rewritten on 2026-08-21 to state the
  rule it meant, or to point here. Do not reintroduce it.

## Written but never read

Flagged rather than removed — each is someone's unfinished intent, not litter:

- **`Trail.summary`** is rendered by the trail sheet and **`Trail.thumb`** is read as the
  route card's og:image, but **no importer emits either**. The share card's "routes and shops
  read an optional `thumb`" is true of the reader and currently unreachable in practice.
- **`Trail.lines`** is documented as legacy baked geometry; nothing reads it. A document still
  carrying it would have it silently ignored.
- **The boot-time trails prefetch** is started, passed into the `WorldMap` constructor and
  stored — and never referenced again. `loadTrails()` fetches independently.
- **`ascent_m: null` is ambiguous** despite a comment claiming it keeps "flat" distinguishable
  from "unknown": the noise gate and the no-gain case both return `null`.
- **`personBlock` does not handle an absolute avatar URL** while the worker's `avatarURLFor`
  does. Today `push-map-data` guarantees a root-relative path, so it holds by validation
  rather than by code.

## Operator

| When | Do |
|---|---|
| A ride is worth promoting | Confirm the attachment is in a **public** category and ping the author. A trace is a precise location |
| Then | `node scripts/import-forum-trail.mjs --post <id> --env <env> --push` |
| Prod | Explicit-ask, same discipline as a prod deploy. `--check` first |

## Verifying a trail

1. `curl -s "$B/api/map/trails.json"` — the entry is there, with a `gpx_url` on **this**
   environment's `uploads-cdn`.
2. `curl -sI "<that gpx_url>"` — 200, `application/gpx+xml`, no redirect.
3. Open `/?t=<trail-id>`: the sheet opens, the trace draws, **the trail's own pin
   disappears**, and the camera fits the line clear of the sheet.
4. Switch the trails layer off with a trace drawn — the selection must clear, not strand.
5. `pnpm exec playwright test tests/map-seeds-neutral.spec.ts` — passes only while the seeds
   are empty and each fixture names its own forum.
