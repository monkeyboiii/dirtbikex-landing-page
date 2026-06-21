# dirtbikex-landing-page

Astro 6 + Tailwind static site for `www.dirtbikex.com`. Deployed as a single Cloudflare **Worker (Static Assets)** — `dist/` is served via the `ASSETS` binding, dynamic routes are handled in [worker/index.ts](worker/index.ts). Ships 21 locales (`en` default, `zh-CN`, `zh-TW`, `ja`, `ko`, `de`, `it`, `fr`, `es`, `ar`, `da`, `el`, `fa-IR`, `fi`, `id`, `nl`, `pt`, `tr-TR`, `th`, `vi`, `sv`); routing via `src/pages/[lang]/`.

## Setup

```bash
pnpm install
```

Create a `.dev.vars` at the repo root (gitignored). The example below is the China/preview pairing — values for prod differ:

```ini
FORUM_BASE=https://forum.dirtbikechina.com
FORUM_INVITE_QUERY_ID=2
FORUM_API_USERNAME=system
FORUM_API_KEY=<discourse-api-key>
```

`FORUM_API_KEY` is a secret — never commit it. The other three are mirrored from [wrangler.jsonc](wrangler.jsonc) for parity with deployed environments. For the full env surface (sponsor CF Access tokens, Logto SMS creds, `RATELIMIT_KV`) see [wrangler.jsonc](wrangler.jsonc) and [docs/sms-gateway.md](docs/sms-gateway.md).

---

## Workflow

### Dev — Astro only (fast iteration on Astro pages)

```bash
pnpm dev      # http://localhost:4321
```

Hot-reload for the marketing site. Does **not** run the Worker, so `/s/i/:key` is unavailable here.

### Dev — full Worker (needed to exercise `/s/i/:key`)

```bash
pnpm build && pnpm wrangler dev   # http://localhost:8787
```

Serves built `dist/` + the Worker handler. `.dev.vars` is auto-loaded. Restart after every `pnpm build`.

### Preview — staging Worker against the China forum

```bash
pnpm build:dev                                    # SITE_URL → dirtbikechina.com
pnpm wrangler deploy --env preview            # deploys Worker `dirtbikex-landing-page-preview`
pnpm wrangler secret put FORUM_API_KEY --env preview   # one-time per env
```

Lands at `dirtbikex-landing-page-preview.<account>.workers.dev`. Use this URL to validate against `forum.dirtbikechina.com` before touching prod.

### Prod — canonical Worker against the production forum

```bash
pnpm build:prod                                   # SITE_URL → dirtbikex.com
pnpm wrangler deploy --env=""                 # top-level env; bind custom domain via dashboard
pnpm wrangler secret put FORUM_API_KEY --env=""   # one-time
```

`--env=""` is Wrangler's explicit "use the top-level config" — required because multiple envs are defined.

Custom domains (`www.dirtbikex.com` canonical, `dirtbikex.com` → www redirect) are wired in the Cloudflare dashboard under the Worker's *Settings → Triggers → Custom Domains*.

### Debug — tail deployed logs

```bash
pnpm wrangler tail --env=""           # prod
pnpm wrangler tail --env preview      # preview
```

[inviteLookup.ts](worker/_lib/inviteLookup.ts) emits a `console.error('lookupInvite:<reason>', …)` on every failure path — tail surfaces which branch fired (`missing_env`, `non_200`, `bad_shape`, etc.) when a deployed invite renders the fallback card.

---

## Project structure

| Path | Role |
| --- | --- |
| [worker/index.ts](worker/index.ts) | Worker entrypoint: routes `/s/i/:key`, `/s/u/:id`, `/api/forum/*`, `/api/proxy/*`, `/admin/uploads/*`, `/sponsors/finalize/*`, `/s/g/*`, `/api/logto/sms`; everything else falls through to `ASSETS`. |
| [worker/_lib/](worker/_lib/) | Discourse lookup, share-landing renderer, SMS gateway, finalize/claim, admin proxy, types (pure code, no Astro imports). |
| [src/pages/](src/pages/) | Astro routes: `/` (en default, no prefix) and `src/pages/[lang]/` for all 20 non-EN locales; legal MDX pages; sponsors/sponsorship/founders/contact/admin. |
| [src/i18n/ui.ts](src/i18n/ui.ts) | Locale registry (`languages` map, `appLocales`); per-locale JSON in `src/i18n/locales/`. |
| [src/components/](src/components/) | UI components (14 files: Header, Hero, Features, FAQ, Footer, LangSwitcher, SponsorsWall, etc.). |
| [src/content/legal/](src/content/legal/) | Legal MDX: 7 docs; en + zh-CN translations for privacy/terms; remaining locales are stubs. |
| [public/_headers](public/_headers) | Edge cache rules: static assets immutable, HTML 5 min/1 day, `/s/*` `no-store`. |
| [tailwind.config.mjs](tailwind.config.mjs) | `dirt-*` (orange) and `clay-*` (warm gray) palettes. |
| [tests/](tests/) | Playwright specs: `locale-routing.spec.ts`, `no-external-assets.spec.ts`, `example.spec.ts`. CI: [`.github/workflows/playwright.yml`](.github/workflows/playwright.yml). |

## Notes

- **Launch placeholders (App Store id, social URLs/handles, sponsorship copy) are tracked in [docs/WIRING_TODO.md](docs/WIRING_TODO.md).**
- **No external runtime assets — keep it that way.** No Google Fonts, no Google Analytics, no third-party CDNs (jsdelivr / unpkg / cdnjs / cloudfront). Fonts are self-hosted under `public/fonts/` ([global.css](src/styles/global.css)); no external font CDN. Adding external CDN deps silently breaks mainland-China users.
- **`*.workers.dev` is unreliable from mainland China.** Production must run behind a custom domain; `www.dirtbikechina.com` may want a non-Cloudflare CDN (Aliyun) in front of it.
- **Architecture: `worker/` and `src/` are independently bundled.** Wrangler/esbuild bundles `worker/` separately from the Astro app. Sentinels duplicated across both (e.g. `APP_STORE_URL` in [worker/index.ts](worker/index.ts) and [src/config.ts](src/config.ts)) must be updated in both places.
- **No `@cloudflare/workers-types` dependency.** Minimal inline shapes are used (see the `ASSETS` and `PagesEnv` typings in [worker/_lib/types.ts](worker/_lib/types.ts)). The `PagesEnv` name is a post-migration misnomer kept for diff minimization; it covers the full Worker env surface. Keep this convention unless a richer runtime surface is genuinely needed.
- **`/s/i/:key` fallback ≠ bug.** The route renders a generic "Get DirtBikeX" card on 5 distinct failure modes ([worker/_lib/inviteLookup.ts](worker/_lib/inviteLookup.ts)): `missing_env`, `fetch_threw`, `non_200`, `json_parse_failed`, `bad_shape`. Always check `wrangler tail` to see which fired before assuming a code bug. Discourse responses are edge-cached for 5 minutes — stale data after an invite update is expected.
