# SHARE_MODULE — a card for every thing on the map

Supersedes `SHARE_ENTITIES.md` (deleted 2026-08-21), whose route table had gone stale: the
map kinds moved from `/s/` to `/share/` and the old paths now 301. Also folds the decisions
taken from `wechat_doc.md` at the umbrella root.

`/s/<kind>/<key>` is the share grammar the product already used — `/s/i` invite, `/s/u`
profile, `/s/e` event. The four map kinds sit one prefix over:

| Route | Key | Source |
|---|---|---|
| `/share/route/<trail-id>` | trail id | R2 map document |
| `/share/track/<track-slug>` | catalog slug | `GET /dirtbikex/tracks/<slug>.json` |
| `/share/shop/<shop-slug>` | shop slug | R2 map document |
| `/share/challenge/<label>` | episode label, e.g. `03` | `series.json` |
| `/share/lineage/<ref>` · `/lineage/<ref>` | username or rider slug | plugin lineage endpoints |

`/s/{route,track,shop,challenge,tr,ta,sh,ch,l}` **301 permanently** to their `/share/` form.
A share URL that ever worked keeps working, and only one spelling is ever indexed.

## Module layout

| Concern | Where |
|---|---|
| Routing, locale resolution, props assembly | [`worker/index.ts`](../worker/index.ts) 875–930 |
| Card HTML: head, five bodies, all CSS | [`worker/_lib/render.ts`](../worker/_lib/render.ts) |
| The four map-entity lookups | [`worker/_lib/shareEntity.ts`](../worker/_lib/shareEntity.ts) |
| og:image fallback assets | [`worker/_lib/brand.ts`](../worker/_lib/brand.ts), [`public/share/`](../public/share/), [`public/icon-512.png`](../public/icon-512.png) |
| Rider résumé + its own OG head | [`worker/_lib/lineageRender.ts`](../worker/_lib/lineageRender.ts) — see [LINEAGE_MODULE](LINEAGE_MODULE.md) |
| Inbound OG crawl for episode sheets | [`worker/_lib/ogPreview.ts`](../worker/_lib/ogPreview.ts), [`shortlink.ts`](../worker/_lib/shortlink.ts) |
| Per-surface lookups | [`userLookup.ts`](../worker/_lib/userLookup.ts), [`eventLookup.ts`](../worker/_lib/eventLookup.ts), [`inviteLookup.ts`](../worker/_lib/inviteLookup.ts) |
| Universal-link claims | [`public/.well-known/apple-app-site-association`](../public/.well-known/apple-app-site-association) |
| WeChat domain token | [`public/98cb4034d143c97e195fc21a62d2bd36.txt`](../public/98cb4034d143c97e195fc21a62d2bd36.txt) |
| Route ownership | [`wrangler.jsonc`](../wrangler.jsonc) `run_worker_first`, **both** blocks |
| Static-page OG (a separate chain) | [`src/layouts/BaseLayout.astro`](../src/layouts/BaseLayout.astro) |

## og:image is never absent

The chain in `buildOgImage`, strictly in order:

1. an event's hero image
2. **the entity's own picture** — a track's forum write-up photo; a challenge stop borrows
   its venue's; routes and shops read an optional `thumb` from their map document, which is
   R2, so giving a route a photo is a push and not a deploy
3. an avatar at 288 — invite inviter, profile, event organiser
4. **the per-kind card** — `/share/card-{track,route,shop,challenge,rider}.png`
5. the brand mark, and only for a page that is about nothing in particular: an expired
   invite, a key that does not resolve

Before this, route/track/shop/challenge carried **no `og:image` at all** and unfurled as a
blank grey rectangle in every chat app.

**Dimensions are declared only for images we own.** The 288 avatar and the 512 cards get
`og:image:width`/`height`; an event hero and an entity photo are somebody else's upload and
pass `null`. A wrong `og:image:width` is worse than none. `twitter:card` follows the same
split — `summary_large_image` for the two we do not measure, `summary` for the rest.

## The kind cards carry no words

Drawn from the map's own marker glyph in that kind's colour, so a share looks like the pin it
came from. Two reasons they are wordless, and the second is the load-bearing one:

- WeChat shows the title and description as **live text beside a small square thumbnail**, so
  text baked into the picture is text rendered twice.
- Rendering CJK at the edge means shipping a font. A 3,500-hanzi subset is 1–1.5 MB against a
  Worker bundle cap of a few MB. Satori/resvg on the edge dies on the font before it dies on
  the CPU.

Because there are no words, there are no locale variants: five files, not ten. They are
**checked-in binaries with no generator in the repo** — re-cutting one is a manual step.

## WeChat is the strictest consumer, so it sets the shape

- The fallback mark is **square and 512px**: WeChat's crawler refuses anything under 300px,
  crops to a square, and will not follow a redirect or send cookies. A 1200×630 site card
  survives that crop only by luck.
- Every worker-rendered head emits `<meta itemprop="image">` and `<link rel="image_src">`
  beside `og:image`. WeChat and QQ predate Open Graph in places and still read both.
- Domain verification is `public/<token>.txt` at the asset root — no route matches it in
  `run_worker_first`, so no code is in the path. Served `text/plain`, 300s, byte-identical to
  the file WeChat issued, and both apex and `www` answer it 200 with **no redirect**.

### The locale rule exists because of how WeChat caches

Precedence: `?lang=` (anything but `auto`) → `Accept-Language` → **a `MicroMessenger`
User-Agent forces `zh-CN`** → `en`.

WeChat builds a card from **one crawler fetch and caches it against the URL**, so the
reader's own language never reaches the decision — the crawler's does, and it sends none.
Without the rule every card pasted into WeChat came out English for a Chinese audience.

Two things to know about it: it is checked *after* the `Accept-Language` loop, so a WeChat
build that starts sending one silently reverts those cards; and a WeChat user outside China
now gets a Chinese card unless the link carries `?lang=`.

## Map kinds live under `/share/`, never `/s/`, and an iOS cache is why

Narrowing AASA to exclude `/s/route/*` was correct and **did not work**: iOS caches the
association file and re-reads it reliably only on app install or update, so devices holding
the old broad `/s/*` claim kept opening the app. A different prefix is immune by
construction.

The bug it fixed was not hygiene. A broad `/s/*` claim meant the shipped build opened for
`/s/challenge/03`, failed to classify it, and raised its invalid-link bubble — the product
telling a recipient that a good link is broken. It also inverted the dependency between two
artifacts on different release cadences: the web could not ship a share kind until App Review
approved one.

### AASA: allowlist, not wildcard

```json
{ "/": "/s/i/*" }, { "/": "/s/u/*" }, { "/": "/s/e/*" },
{ "/": "/s/*", "exclude": true }
```

Order matters — first match wins, so the catch-all is last. Those three are the kinds the
**shipped** app handles.

**The rule this file exists to state: a path joins AASA only when the app has a real
destination for it, and never before.** The web ships a kind whenever it likes; the app
claims it when it can honour it. That is also how "Get the app" and "Open in the app" become
one button — for a claimed path with the app installed, iOS opens the app and this page never
renders. No scheme-probing JavaScript, no second button. Which is why the map cards carry no
app CTA today and will need no new one when they gain a destination.

## One body for four kinds

They differ only in which facts they carry and where "the source" points. Branching inside a
single `entityCardBody` keeps the OG tags, the CSS and the CTA plumbing identical, and makes
a fifth kind a lookup plus a copy row.

`shares` is a **function per locale**, not a pattern with placeholders: word order around the
name and the noun would read wrong in half of the 21 locales.

**The sentence carries no noun.** `(name) => "<name> shared this with you"`. Naming the
object needs the right article in English and the right gender in eight languages — four
nouns each, 84 strings, as many chances to be quietly wrong. It shipped reading "share a
episode". The kicker and title already say what the thing is.

Only a **route** falls back to its author for that line. A track's owner did not share their
track by owning it, and captioning their name with "shared this with you" would be a small
lie.

## One button, then a link

Content first — sender line, kicker, title, subtitle, facts — then exactly one primary action
(the map) and at most one quiet text link. A challenge card renders no secondary link at all
even when it has one; its platform links live one tap further in on the map sheet. Four
buttons over an empty card is what started this.

Facts render as `4.5 km · ↑ 200 m · loop`, not labelled chips. `Where 浙江·杭州·桐庐县` is a
database row with the column names left on.

## Traps

- **`?stay=1` or you are measuring the map.** Entity cards arm a 3s `location.replace`
  countdown; only `stay` disarms it. Any manual inspection without it lands on the map.
- **The auto-jump script must stay at the end of `<body>`.** An inline script cannot be
  deferred, so in the head it runs before the button exists and bails silently — which is how
  it shipped doing nothing.
- **The kind-card PNGs sit under the `/share/*` prefix the worker claims**, so they reach the
  asset layer only via the router's final `env.ASSETS.fetch`.
- **A transient 404 during a deploy is cacheable.** `/share/*` has no `_headers` rule, so it
  falls to `/*`'s `s-maxage=86400`. A crawler that fetches mid-deploy can cache a broken card
  for a day. Verify after deploying, with a cache-buster.
- **`canonicalURL` strips only `lang`**, so `?from=` stays in `og:url` — and since WeChat
  caches per URL, the same route shared by two senders is two cards.
- **A bare handle resolves differently on the two lineage routes**, and `/lineage/<ref>` is
  ASCII-only, so a non-ASCII username falls through to the static 404.
- **`ShareLandingProps.kind` is typed as the retired two-letter codes** and `handleEntity`
  assigns the full word with a cast. Type and value disagree.
- **`cardKindFor` casts to `KindCard`** and works only because the five baked cards happen to
  cover all four entity kinds plus `rider`. A fifth entity kind without a baked PNG 404s its
  own og:image.
- Two stale comments in `render.ts`: it claims `_headers` maps `/s/*` to `max-age=60` (it is
  `no-store`), and points at a `functions/` directory that no longer exists.

## Verifying these routes

`tests/no-external-assets.spec.ts` covers `/share/route/…?stay=1` — the `stay` is
load-bearing, or the run follows the countdown into the map and starts asserting the map's
hosts (which have their own deliberate tile allowance).

- **Set `PLAYWRIGHT_BASE_URL`.** Without it the config also boots `astro dev`, and vite plus
  esbuild plus chromium on this box's two cores — alongside the staging stack — is what
  rebooted it on 2026-08-18.
- **The staging zone injects a script the origin never sends.** Cloudflare Web Analytics adds
  `static.cloudflareinsights.com/beacon.min.js` at the edge, to browser-like requests only:
  `curl` sees nothing, a real browser does. It is on `dirtbikechina.com` and not on
  `dirtbikex.com`. Every HTML route fails the spec when pointed at staging, and that is the
  spec working. Turn Web Analytics off for the zone; do not widen the allowlist.

To check a card as WeChat sees it, send a `MicroMessenger` User-Agent and a cache-buster:

```shell
curl -s -A 'Mozilla/5.0 (iPhone; MicroMessenger/8.0.49)' "$B/share/track/<slug>?cb=$RANDOM" \
  | grep -oE '<meta property="og:[^>]*>|<meta itemprop="image"[^>]*>'
```

## Tracks do not come from the map document

`public/map/tracks.json` is ~3,600 baked features; scanning it per card render would be
absurd, and the plugin already answers by slug. Routes, shops and episodes come from
`readMapDocBody`, the one place that knows R2-then-seed order — so the JSON routes and the
share cards can never disagree about which document is canonical.

Track and challenge cards cost one extra forum round-trip for their og:image, edge-cached at
3600s for the topic image and 300s for the track row.
