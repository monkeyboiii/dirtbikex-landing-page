# SHARE_ENTITIES — a card for every thing on the map

`/s/<kind>/<key>` is the share grammar the whole product already uses (`/s/i` invite, `/s/u`
profile, `/s/e` event, `/s/l` lineage). These four are the map, and they take **two** letters
on purpose: single-letter `t` is reserved for topic sharing, the one obvious future kind that
would otherwise collide with `track`.


| Route | Key | Source |
|---|---|---|
| `/s/tr/<trail-id>` | trail id from `trails.json` | R2 map document |
| `/s/ta/<track-slug>` | catalog slug | `GET /dirtbikex/tracks/<slug>.json` on the forum |
| `/s/sh/<shop-slug>` | shop slug from `shops.json` | R2 map document |
| `/s/ch/<label>` | episode label, e.g. `01` | `series.json` |

`/s/*` was already in `run_worker_first` in both wrangler blocks, so none of this needed config.

## `?from=<username>`

Names the sender, so the card opens with **"Monkeyboi wants to share a route with you"** and a
small avatar. It is resolved through the same anonymous `/u/<name>.json` read `/s/u` uses, and only
when the parameter is present — an unattributed share stays one request. A route with no `?from=`
falls back to the rider whose ride it is, because that is who a recipient will assume sent it. A
track or a shop has no author, so without `?from=` it simply has no sender line.

## Why one body for four kinds

They differ only in which facts they carry and where "the source" points. Branching inside a single
`entityCardBody` keeps the OG tags, the CSS, the install→return helper and the CTA plumbing
identical, and it means a fifth kind is a lookup plus a copy row.

`shares` is a **function per locale**, not one pattern with placeholders: word order around the
name and the noun ("X wants to share a route with you" / "{n}さんが{k}をシェアしました" /
"يريد {n} مشاركة {k} معك") would read wrong in half the 21 locales otherwise.

## Where the CTAs go

Every card deep-links back into the web map using the parameters it already understands — `?t=<slug>`
for route/track/shop, `?ep=<label>` for an episode — plus the App Store, the `dirtbikex://s/<kind>/<key>`
deep link on mobile, and "the source" (forum thread / shop website / episode video).

## The rule this file exists to state

**Never add an `/s/<kind>/` route here without the matching `ShareKind` case in the app.** `/s/*` is
AASA-claimed, so the URL opens the app regardless; a kind the web serves and the app does not know
is a blank screen for every user who has it installed. See
`iOS/docs/SHARING_MODULE.md` § Map-entity kinds — and note that only `track` has a native
destination today; the rest land on the catalog map on purpose.

## Tracks do not come from the map document

`public/map/tracks.json` is ~3,600 baked features. Scanning it per card render would be absurd, and
the plugin already answers by slug. Routes, shops and episodes come from `readMapDocBody`, the one
place that knows R2-then-seed resolution order.
