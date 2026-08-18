# SHARE_ENTITIES — a card for every thing on the map

`/s/<kind>/<key>` is the share grammar the whole product already uses (`/s/i` invite, `/s/u`
profile, `/s/e` event, `/s/l` lineage). These four are the map:


| Route | Key | Source |
|---|---|---|
| `/s/route/<trail-id>` | trail id from `trails.json` | R2 map document |
| `/s/track/<track-slug>` | catalog slug | `GET /dirtbikex/tracks/<slug>.json` on the forum |
| `/s/shop/<shop-slug>` | shop slug from `shops.json` | R2 map document |
| `/s/challenge/<label>` | episode label, e.g. `01` | `series.json` |

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

## Names, and the codes they replaced

The segment is the whole word. A share URL is read aloud, pasted into chat and typed from memory,
and `tr` vs `ta` is exactly the pair that gets transposed. The words also settle the collision the
short codes were invented to avoid: `/s/track/` and a future `/s/topic/` cannot be confused, so `t`
stays reserved without costing legibility.

`tr` / `ta` / `sh` / `ch` / `l` **301 permanently** to their words. A share URL that ever worked
keeps working, and only one spelling is ever indexed.

## AASA: allowlist, not wildcard

```json
{ "/": "/s/i/*" }, { "/": "/s/u/*" }, { "/": "/s/e/*" },
{ "/": "/s/*", "exclude": true }
```

Order matters — the first matching component wins, so the catch-all is last. Those three are the
kinds the **shipped** app handles. Everything else stays on the web.

This is the fix for a real bug, not hygiene: a broad `/s/*` claim meant the shipped build opened
for `/s/challenge/03`, failed to classify it, and raised its invalid-link bubble — the product
telling a recipient that a good link is broken. It also inverted the dependency between two
artifacts on completely different release cadences, so the web could not ship a share kind until
App Review approved one.

**Adding a path to AASA is also how "Get the app" and "Open in the app" become one button.** For a
claimed path with the app installed, iOS opens the app and this page never renders; without the
app, the page renders and the store is the only sensible action. No scheme-probing JavaScript, no
second button — the OS does the branching. That is why the map cards carry no app CTA at all
today, and why they will need no new button when they gain one.

Caveat: AASA is cached from Apple's CDN and re-read reliably on app install/update, so narrowing it
does not clear the bubble on an already-installed build until that build updates.

## One button, then a link

Every card is content first: sender line, kicker, title, subtitle, facts — then exactly one primary
action (the map) and at most one quiet text link (the discussion, or the website). Challenge has no
second action at all; its platform links live on the map sheet one tap away, and four buttons over
an empty card is what started this.

Facts render as `4.5 km · ↑ 200 m · loop`, not as labelled chips. `Where 浙江·杭州·桐庐县` is a
database row with the column names left on.

## The sentence carries no noun

`shares` is `(name) => "<name> shared this with you"`. Naming the object needs the right article in
English and the right gender in Spanish, Italian, French, German, Portuguese, Dutch, Danish and
Swedish — four nouns each, 84 strings, and as many chances to be quietly wrong. It shipped reading
"share a episode". The kicker and the title already say what the thing is.

## The rule this file exists to state

**A path joins AASA only when the app has a real destination for it — and never before.** The
inverse of the old rule, and the safer direction: the web can ship a kind whenever it likes, and
the app claims it when it can honour it. Today that means `/s/lineage/*` and `/s/track/*` are the
next two candidates (both have native destinations in unreleased source), while route, shop and
challenge stay web-only until the iOS map grows those layers. See
`iOS/docs/SHARING_MODULE.md` § Map-entity kinds.

## Tracks do not come from the map document

`public/map/tracks.json` is ~3,600 baked features. Scanning it per card render would be absurd, and
the plugin already answers by slug. Routes, shops and episodes come from `readMapDocBody`, the one
place that knows R2-then-seed resolution order.
