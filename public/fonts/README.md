# Self-hosted fonts

Drop the following WOFF2 files into this directory. `@font-face` declarations in [src/styles/global.css](../../src/styles/global.css) reference them; while files are absent the stack falls back cleanly to Noto Sans SC → system stack (per `tailwind.config.mjs` fontFamily declarations).

| File | Source | Subset |
|---|---|---|
| `bricolage-grotesque-variable.woff2` | https://github.com/ateliertriay/bricolage | Latin Extended, `wght` 400–800, `opsz` 12–96 |
| `geist-variable.woff2` | https://github.com/vercel/geist-font | Latin Extended, `wght` 300–800 |
| `geist-mono-variable.woff2` | https://github.com/vercel/geist-font | Latin Extended, `wght` 400–700 |
| `noto-sans-sc-400.woff2` | https://github.com/notofonts/noto-cjk | GB2312 (~6800 chars), weight 400 |
| `noto-sans-sc-600.woff2` | https://github.com/notofonts/noto-cjk | GB2312, weight 600 |
| `noto-sans-sc-800.woff2` | https://github.com/notofonts/noto-cjk | GB2312, weight 800 |

## Subsetting tools

- **Bricolage / Geist / Geist Mono**: pre-subsetted Latin Extended releases are published on GitHub.
- **Noto Sans SC**: requires `pyftsubset` (fonttools) or `cn-font-split`. Example:
  ```bash
  pyftsubset NotoSansSC-Regular.ttf \
    --unicodes="U+4E00-9FFF,U+3000-303F,U+FF00-FFEF" \
    --flavor=woff2 \
    --output-file=noto-sans-sc-400.woff2
  ```

**No external CDNs** (Google Fonts, jsdelivr, etc.) — see [README.md](../../README.md) Notes for the mainland-China reachability constraint.
