# Partners Module

The brand‑partnership funnel on the marketing site: attract **brands** (not consumers)
to the reserved **hero placement** — a direct, deal‑based cross‑branding arrangement, *not*
an in‑app purchase. Three surfaces, one job each:

```text
app "Brand partnerships" CTA (iOS Hub)  ──►  /sponsorship  (the pitch)
                                                   │  CTA
                                                   ▼
                                             /contact  → "Sponsorships & partnerships"  (the inbox)
/sponsors  (live wall — proof)  ◄── cross-linked from the pitch
```

The consumer avatar‑pool spot is a *separate* product (in‑app StoreKit IAP) and is **not** sold
here. The consumer **email waitlist** is a separate module ([JOIN_MODULE.md](./JOIN_MODULE.md)) —
deliberately *not* reused for B2B leads.

## Module layout

| Concern | Where | Notes |
|---|---|---|
| Pitch page | [src/pages/sponsorship.astro](../src/pages/sponsorship.astro) + [`[lang]/`](../src/pages/[lang]/sponsorship.astro) | hero → offer → the exchange (give/get) → how‑it‑works → CTA; design tokens (`t-*`, `btn`, `--brand*`) |
| Copy | [src/i18n/locales/en.json](../src/i18n/locales/en.json) `sponsorship.*` | EN is source of truth; other locales **fall back to EN** (a B2B page is EN‑first) |
| Live wall | [src/pages/sponsors.astro](../src/pages/sponsors.astro) + [`[lang]/`](../src/pages/[lang]/sponsors.astro) | client fetch → `/api/proxy/sponsors`; renders the v5 pool + a roster‑occupancy bar |
| Sponsor proxy | [worker/_lib/sponsorProxy.ts](../worker/_lib/sponsorProxy.ts) | edge‑cached (60s) pass‑through of sponsorhub `/sponsors.json`; **no remap** — the page owns the shape |
| Inbound | [src/pages/contact.astro](../src/pages/contact.astro), `contact.email.sponsors` | the "Sponsorships & partnerships" channel — the pitch's CTA destination |

## Architecture decisions

### Fill `/sponsorship`, don't build a new route
`/sponsorship` shipped as a placeholder ("real program copy lands later") already titled for
brands and already routing its CTAs to `/contact` + `/sponsors`. The web's job is to attract
*brands* (consumers buy the pool spot in‑app, and you can't sell StoreKit on the web), so the
page **becomes** the cross‑branding pitch. **NOT done:** no separate `/partners` route (the
existing page + its nav slot + CTAs were the right shape); no self‑serve checkout (deals are
negotiated — the page sells the *conversation*).

### EN‑first, fall back for other locales
The pitch copy lives only in `en.json`; `useTranslations` falls back to EN for missing keys, so
the 21 `[lang]/sponsorship` mirrors render EN for the new `sponsorship.*` keys. Brands negotiate
in English (± one or two languages) — translating a low‑volume B2B deal page 21× is not worth it.
**NOT done:** no per‑locale pitch copy. **Invalidates if:** a non‑EN market drives real partner
volume — then translate just `sponsorship.*` for that locale.

### The join/invite module is NOT reused for brand deals
[JOIN_MODULE.md](./JOIN_MODULE.md) is a consent‑first *consumer* email list + single‑use influencer
invites. Brand deals are B2B, negotiated, one‑off — a different audience and legal basis. Routing
partner leads into `subscribers` would mix them. What *is* reusable if a real inquiry form is ever
built: the join module's Resend + rate‑limit + D1 plumbing behind a new `partner_inquiries` table
(see deferred). Today the CTA points at `/contact` — zero new backend.

### The wall reads the v5 pool directly (no sections/podium)
`/sponsors` fetches sponsorhub's **v5** `/sponsors.json` — a **positionless pool** of
`{username,label,display_name,avatar_url,navigable,kind,slot_id}` (canonical:
`infra/submodules/dirtbikex-sponsors/src/schemas/wire.ts`). It renders showable riders
(anonymous airtime placeholders — null name+avatar — are skipped) linking to the forum profile,
plus a roster‑occupancy bar from `sell_capacity`/`airtime_capacity`. The stale
[src/lib/sponsor-types.ts](../src/lib/sponsor-types.ts) (v4: `sponsor_podium`, `section`) is left
alone — it still backs the legacy `src/data/*` static‑sponsor scaffold. **NOT done:** no shared
Web Component between the EN + `[lang]` pages (the `<script>` is inline‑duplicated; Astro doesn't
share hydration across page variants — keep the two in sync).

## Wire dependency

The wall depends on sponsorhub's `/sponsors.json` v5 top‑level keys (via the proxy):
`version · generated_at · hero_image_url · pool[] · render_limit · suggest_count · sell_capacity ·
airtime_capacity · booking_horizon_days · calendar_lookback_days · search_view_cap_ms(+_by_surface) ·
splash_pause_credit_ms · membership_on_sale · passes_on_sale · airtime_on_sale · credit{…}`.
A wire‑shape bump (v5→v6) that renames `pool`/`kind` breaks the wall — the client parse is the
contract, not `sponsor-types.ts`.

## Deferred

- **App‑side CTA.** The iOS Hub "Brand partnerships" entry → framing sheet →
  `openURL(.../sponsorship?utm_source=app&utm_medium=hub)` is an iOS change, not in this repo.
  (Discussed; not built.)
- **Dedicated inquiry form.** `POST /api/partner` reusing `join.ts`'s Resend + rate‑limit into a
  `partner_inquiries` D1 table + operator email — build only if `/contact` volume justifies it.
- **More wall charts.** The roster‑occupancy bar is ported from the app's `SponsorRotationView`.
  The other charts there (search‑dwell **budget pie**, **booking window**) are *operator config*
  viz — deliberately NOT on a public page. The **credit‑value trend** (airtime) could be added if
  airtime becomes a public selling point (data is in `payload.credit.trend`).

## Manual verification

1. `pnx wrangler deploy --env preview --dry-run` bundles (or `pnpm build`).
2. `/sponsors` → the roster of faces renders (no "Couldn't load"), avatars load, and a
   "Featured passes N/40 · Airtime cards N/20" occupancy bar shows.
3. `/sponsorship` → hero + offer + give/get + 3 steps; "Start a conversation" → `/contact`;
   "See current sponsors" → `/sponsors`.
4. A `[lang]/sponsorship` (e.g. `/zh-CN/sponsorship`) renders the EN pitch copy (fallback) under
   localized chrome.
