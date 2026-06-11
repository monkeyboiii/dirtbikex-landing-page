# Wiring TODO — placeholders awaiting real values

Live, visitor-facing placeholders that need real values before/at launch.
Tick items off as they land. (Identified in the 2026-06 UI/UX audit round.)

- [ ] **App Store URL** — `https://apps.apple.com/app/id0000000000` placeholder.
  Update **both** copies (the worker bundles separately and cannot import `src/`):
  [src/config.ts](../src/config.ts) and `APP_STORE_URL` in
  [worker/index.ts](../worker/index.ts). Every install CTA on the site and the
  `/s/i/:key` share-landing CTAs point here.
- [ ] **Founder social profile URLs** — `url: '#'` in
  [src/components/FoundersBody.astro](../src/components/FoundersBody.astro)
  (Calvin + Rebecca, X/Instagram). Replace `'#'` with real profile URLs —
  `https` URLs automatically get `target="_blank"`.
- [ ] **Contact page social handles** — all four networks currently say
  `@dirtbikex` in [src/components/ContactBody.astro](../src/components/ContactBody.astro).
  Confirm or replace the per-network handles (rows are deliberately non-links
  until launch).
- [ ] **Sponsorship program copy** — `/sponsorship` is a placeholder page
  ([src/pages/sponsorship.astro](../src/pages/sponsorship.astro) and
  `src/pages/[lang]/sponsorship.astro`). The two bodies are duplicated verbatim;
  extract a shared `SponsorshipBody.astro` when the real program copy lands.
- [ ] **/sponsors wall restyle + i18n** — the live sponsor wall
  ([src/pages/sponsors.astro](../src/pages/sponsors.astro) and
  `src/pages/[lang]/sponsors.astro`) still uses raw Tailwind utilities instead
  of the design-token system, and all copy is hardcoded EN on every locale
  route. It is one click from the header nav via /sponsorship.
