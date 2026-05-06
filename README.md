# dirtbikex-landing-page

Astro 6 + Tailwind static site for `www.dirtbikex.com`. Bilingual (EN / ZH). Hosted on Cloudflare Pages via git integration.

## Develop

```bash
pnpm install
pnpm dev      # http://localhost:4321
```

## Build

```bash
pnpm build    # outputs dist/
pnpm preview  # local preview of dist/
```

## Cloudflare Pages settings

- Build command: `pnpm build`
- Output directory: `dist`
- Install command: `pnpm install --frozen-lockfile`
- Node version: `20` (set `NODE_VERSION=20` env)
- Custom domains: `www.dirtbikex.com` (canonical), `dirtbikex.com` (apex → www redirect)

## Project structure

- `src/i18n/ui.ts` — single source of truth for UI strings (en/zh)
- `src/components/` — Header, Hero, Features, FAQ, Footer, LangSwitcher
- `src/pages/` — `/` (en), `/zh/` (zh), legal pages mirrored
- `src/content/legal/*.{en,zh}.mdx` — privacy/terms placeholder copy
- `tailwind.config.mjs` — `dirt-*` (orange/amber) and `clay-*` (warm gray) palettes
