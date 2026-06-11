# dirtbikex-landing-page

Astro 6 + Tailwind static site for `www.dirtbikex.com`, plus a `/s/i/:key` invite-landing route. Bilingual (EN / ZH). Deployed as a single Cloudflare **Worker (Static Assets)** — `dist/` is served via the `ASSETS` binding, dynamic routes are handled in [worker/index.ts](worker/index.ts).

## Setup

```bash
pnpm install
```

Create a `.dev.vars` at the repo root (gitignored) with the runtime env the [worker](worker/_lib/inviteLookup.ts) reads:

```ini
FORUM_BASE=https://forum.dirtbikechina.com
FORUM_INVITE_QUERY_ID=2
FORUM_API_USERNAME=system
FORUM_API_KEY=<discourse-api-key>
```

`FORUM_API_KEY` is the one secret — never commit it. The other three are mirrored from [wrangler.jsonc](wrangler.jsonc) for parity with deployed environments.

---

## Workflow

### Dev — Astro only (fast iteration on Astro pages)

```bash
pnpm dev      # http://localhost:4321
```

Hot-reload for the marketing site. Does **not** run the Worker, so `/s/i/:key` is unavailable here.

### Dev — full Worker (needed to exercise `/s/i/:key`)

```bash
pnpm build && pnx wrangler dev   # http://localhost:8787
```

Serves built `dist/` + the Worker handler. `.dev.vars` is auto-loaded. Restart after every `pnpm build`.

### Preview — staging Worker against the China forum

```bash
pnpm build:dev                                    # SITE_URL → dirtbikechina.com
pnx wrangler deploy --env preview            # deploys Worker `dirtbikex-landing-page-preview`
pnx wrangler secret put FORUM_API_KEY --env preview   # one-time per env
```

Lands at `dirtbikex-landing-page-preview.<account>.workers.dev`. Use this URL to validate against `forum.dirtbikechina.com` before touching prod.

### Prod — canonical Worker against the production forum

```bash
pnpm build:prod                                   # SITE_URL → dirtbikex.com
pnx wrangler deploy --env=""                 # top-level env; bind custom domain via dashboard
pnx wrangler secret put FORUM_API_KEY --env=""   # one-time
```

`--env=""` is Wrangler's explicit "use the top-level config" — required because multiple envs are defined.

Custom domains (`www.dirtbikex.com` canonical, `dirtbikex.com` → www redirect) are wired in the Cloudflare dashboard under the Worker's *Settings → Triggers → Custom Domains*.

### Debug — tail deployed logs

```bash
pnx wrangler tail --env=""           # prod
pnx wrangler tail --env preview      # preview
```

[inviteLookup.ts](worker/_lib/inviteLookup.ts) emits a `console.error('lookupInvite:<reason>', …)` on every failure path — tail surfaces which branch fired (`missing_env`, `non_200`, `bad_shape`, etc.) when a deployed invite renders the fallback card.

---

## Project structure

- [worker/index.ts](worker/index.ts) — Worker entrypoint: `/s/i/:key` handler, everything else falls through to `ASSETS`
- [worker/_lib/](worker/_lib/) — Discourse lookup, share-landing renderer, types (pure code, portable)
- [src/pages/](src/pages/) — Astro routes: `/` (en), `/zh/` (zh), legal pages mirrored
- [src/i18n/ui.ts](src/i18n/ui.ts) — single source of truth for UI strings
- [src/components/](src/components/) — Header, Hero, Features, FAQ, Footer, LangSwitcher
- [src/content/legal/](src/content/legal/) — privacy/terms MDX (en/zh)
- [public/_headers](public/_headers) — edge cache rules (assets immutable, HTML 5min/1day, share `/s/*` 60s)
- [tailwind.config.mjs](tailwind.config.mjs) — `dirt-*` (orange) and `clay-*` (warm gray) palettes

## Notes

- **Launch placeholders (App Store id, social URLs/handles, sponsorship copy) are tracked in [docs/WIRING_TODO.md](docs/WIRING_TODO.md).**
- **No external runtime assets — keep it that way.** No Google Fonts, no Google Analytics, no third-party CDNs (jsdelivr / unpkg / cdnjs / cloudfront). System-font stack only. Adding any of these silently breaks mainland-China users.
- **`*.workers.dev` is unreliable from mainland China.** Production must run behind a custom domain; `www.dirtbikechina.com` may want a non-Cloudflare CDN (Aliyun) in front of it.
- **`worker/` cannot import from `src/`.** The Worker is bundled separately by Wrangler/esbuild. Sentinels duplicated across both (e.g. `APP_STORE_URL` in [worker/index.ts](worker/index.ts) and [src/config.ts](src/config.ts)) must be updated in both places.
- **No `@cloudflare/workers-types` dependency.** Minimal inline shapes are used (see the `ASSETS` and `PagesEnv` typings). Keep this convention unless a richer runtime surface is genuinely needed. The `PagesEnv` name is a post-migration misnomer kept for diff minimization.
- **`/s/i/:key` fallback ≠ bug.** The route renders a generic "Get DirtBikeX" card on 5 distinct failure modes ([worker/_lib/inviteLookup.ts](worker/_lib/inviteLookup.ts)): `missing_env`, `fetch_threw`, `non_200`, `json_parse_failed`, `bad_shape`. Always check `wrangler tail` to see which fired before assuming a code bug. Discourse responses are edge-cached for 5 minutes — stale data after an invite update is expected.
