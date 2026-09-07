---
kind: why
status: current
summary: Supersedes SHAREENTITIES.md , whose route table had gone stale: the map kinds moved from /s/ to /share/ and the old paths now 301. Also f…
---

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
| Routing, locale resolution, props assembly | [`worker/index.ts`](../../worker/index.ts) 875–930 |
| Card HTML: head, five bodies, all CSS | [`worker/_lib/render.ts`](../../worker/_lib/render.ts) |
| The four map-entity lookups | [`worker/_lib/shareEntity.ts`](../../worker/_lib/shareEntity.ts) |
| og:image fallback assets | [`worker/_lib/brand.ts`](../../worker/_lib/brand.ts), [`public/share/`](../../public/share), [`public/icon-512.png`](../../public/icon-512.png) |
| Rider résumé + its own OG head | [`worker/_lib/lineageRender.ts`](../../worker/_lib/lineageRender.ts) — see [LINEAGE_MODULE](lineage.md) |
| Inbound OG crawl for episode sheets | [`worker/_lib/ogPreview.ts`](../../worker/_lib/ogPreview.ts), [`shortlink.ts`](../../worker/_lib/shortlink.ts) |
| Per-surface lookups | [`userLookup.ts`](../../worker/_lib/userLookup.ts), [`eventLookup.ts`](../../worker/_lib/eventLookup.ts), [`inviteLookup.ts`](../../worker/_lib/inviteLookup.ts) |
| Universal-link claims | [`public/.well-known/apple-app-site-association`](../../public/.well-known/apple-app-site-association) |
| WeChat domain token | [`public/98cb4034d143c97e195fc21a62d2bd36.txt`](../../public/98cb4034d143c97e195fc21a62d2bd36.txt) |
| Route ownership | [`wrangler.jsonc`](../../wrangler.jsonc) `run_worker_first`, **both** blocks |
| Static-page OG (a separate chain) | [`src/layouts/BaseLayout.astro`](../../src/layouts/BaseLayout.astro) |

## og:image is never absent

The chain in `buildOgImage`, strictly in order:

1. an event's hero image
2. **the entity's own picture** — a track's forum write-up photo; a challenge stop borrows
   its venue's; routes and shops read an optional `thumb` from their map document, which is
   R2, so giving a route a photo is a push and not a deploy — though **no importer emits
   `thumb` today**, so in practice a route always falls through to its kind card
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

## The `_headers` catch-all cannot be narrowed, only changed

`public/_headers` rules are **additive, not overriding**. A narrow `/s/*  →  no-store` cannot beat
a broad `/*  →  s-maxage=86400`; it appends, producing
`public, max-age=300, s-maxage=86400, no-store`, and Cloudflare resolves that in favour of
caching. The `/s/*` rule carried a comment naming exactly the hazard it failed to prevent — a
transient 404 served by the asset layer during a Worker deploy gap, pinned at a PoP for a day —
and it was measured doing nothing on prod's `/s/c/`. The fix was to change the broad rule: `/*`
now carries `public, max-age=300` and no `s-maxage` at all.

Two consequences worth keeping. **For Worker-rendered responses `_headers` does not apply at
all** — `/s/*` and `/share/*` are `run_worker_first`, so their protection is the Worker's own
`no-store`/`no-cache`, and the `_headers` rule is live only for asset-served responses, which is
precisely the deploy-gap case where additivity defeated it. And **never cache a non-200**: a 404
is a statement about *now*, and `s-maxage` turns it into a statement about the next 24 hours.
That is still a general rule rather than an enforced one; removing the catch-all took away the
one place it bit.

## The hand-off out of WeChat is a scheme allowlist, not an https/scheme split

The first model of this was wrong, and measuring is what showed it. `apps.apple.com` publishes no
AASA and 301s every iOS-mobile UA into `itms-appss://` — identically for Safari and WeChat. So the
"Get DirtBikeX" button that works in WeChat is **not an https success story, it is a custom scheme
too**. The real rule is an allowlist: `itms-appss` is on WeChat's, `dirtbikex` is not, and never
will be.

That matters because it forecloses the obvious fix. Repointing "Open in the app" at an https
Universal Link would fail for two independent reasons. **A same-domain Universal Link never opens
the app in any browser, Safari included** (Apple TN3155: a browser expects the user wants to keep
navigating when the link's domain matches the previous navigation) — and our cards are served from
the same host our AASA claims. Serving the launch link from a different host with its own AASA is
the documented fix, and it costs an entitlement change, therefore an App Store build. **And
Universal Links inside a WKWebView are a host-app policy, not an OS law** — Apple says they fire,
and a private-API technique exists specifically to disable them, which only makes sense because
they do. So WeChat suppressing them is a navigation-delegate decision: measurable per app and per
version, never to be deduced. Do not write "WeChat blocks Universal Links" as though it were
physics, and do not assume Douyin behaves the same way.

What ships instead is a **one-second timer**, not an interception. The scheme is still attempted,
so anywhere it is honoured none of this runs. WeChat's delegate *declines* the scheme rather than
navigating, so nothing unloads and the page is still `visible` a second later — that is the
signal. The success path announces itself the opposite way: iOS backgrounds the web view to launch
the app, firing `visibilitychange` and `pagehide`, both of which cancel the timer. **`blur` is
deliberately not a cancel signal** — a WKWebView raises it spuriously for its own sheets, the
keyboard and the JS bridge, which would suppress the hint in exactly the case it exists for.

The hint is one localised line and an arrow, `pointer-events: none`, carrying the menu item's own
words (`用默认浏览器打开`). The first cut was a modal that buried the one instruction that mattered
under four that did not. It is armed for `MicroMessenger` only; WeCom rides along on the same UA
and the same menu item, and **Mini Program web views are excluded** because they may have no
browser item at all, and an arrow pointing at something absent is worse than silence. Douyin is
not included: unmeasured chrome gets its own probes first.

**One script, one selector — this is the part that will rot if it is not understood.** The
`appCTA` anchor is duplicated byte-identically in three template literals (invite, profile,
event), so hooking each separately is how a card silently loses the behaviour: no type error, no
failing build. The script is emitted once and finds the button with
`a.cta-secondary[href^="dirtbikex:"]`, and
[`tests/unit/browserHint.test.ts`](../../tests/unit/browserHint.test.ts) asserts that selector
still matches all three *rendered* bodies.

**The claim card keeps exactly one timer.** `/s/c/` already had a 1200 ms store fallback; a second
at 1000 ms would paint the hint and have it wiped 200 ms later, ejecting a rider who *has* the app
to the App Store. Its `visibilityState` guard would not have saved it — in WeChat the page *is*
visible, which is the premise.

Not doing: a WeChat Open Tag (`<wx-open-launch-app>`), the only sanctioned in-WeChat launch. It
needs an authenticated 服务号 and an authenticated 开放平台 app under the same legal entity, that app
already through review, with the page's host bound on that account — realistically a Chinese
business entity, and months rather than a sprint. And **not** "copy link" as the primary answer:
one more step, landing the rider where ⋯ would have, having read more text.

## Traps

- **`?stay=1` or you are measuring the map.** Entity cards arm a 3s `location.replace`
  countdown; only `stay` disarms it. Any manual inspection without it lands on the map.
- **The auto-jump script must stay at the end of `<body>`.** An inline script cannot be
  deferred, so in the head it runs before the button exists and bails silently — which is how
  it shipped doing nothing.
- **The kind-card PNGs sit under the `/share/*` prefix the worker claims**, so they reach the
  asset layer only via the router's final `env.ASSETS.fetch`.
- **Measure with GET, never `curl -I`.** `/s/*` and `/share/*` are in `run_worker_first`, so a
  HEAD is answered by the edge-cached 404 asset and never reaches the Worker at all — it will
  report a cacheable 404 that does not exist. Two sections of an earlier findings doc were wrong
  for exactly this reason.
- **`canonicalURL` strips only `lang`**, so `?from=` stays in `og:url` — and since WeChat
  caches per URL, the same route shared by two senders is two cards.
- **A bare handle resolves differently on the two lineage routes**, and `/lineage/<ref>` is
  ASCII-only, so a non-ASCII username falls through to the static 404.
- **`ShareLandingProps.kind` is typed as the retired two-letter codes** and `handleEntity`
  assigns the full word with a cast. Type and value disagree.
- **`cardKindFor` casts to `KindCard`** and works only because the five baked cards happen to
  cover all four entity kinds plus `rider`. A fifth entity kind without a baked PNG 404s its
  own og:image.
- **One stale comment survives in `render.ts`** (`:30`): it points error-state copy at
  `functions/s/i/[key].ts`, and there is no `functions/` directory.

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
