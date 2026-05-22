# Legal & policy docs — review notes

Concise hand-off for legal counsel and the founder. Drafted 2026-05-22.

> ⚠️ These documents are AI-drafted from market-standard patterns and current law as of May 2026. **They must be reviewed by qualified legal counsel before scaled launch.** Particularly: arbitration provisions, sponsor terms, DSA Article 16 references, and the regional addenda in the privacy policy.

## 1. What was built

Seven public legal/policy pages and one contact page, all wired into the Astro landing page.

| URL | Source file (content) | Source file (route) |
|---|---|---|
| `/terms` | [src/content/legal/terms.en.mdx](src/content/legal/terms.en.mdx) | [src/pages/terms.astro](src/pages/terms.astro) |
| `/privacy` | [src/content/legal/privacy.en.mdx](src/content/legal/privacy.en.mdx) | [src/pages/privacy.astro](src/pages/privacy.astro) |
| `/community-guidelines` | [src/content/legal/community-guidelines.en.mdx](src/content/legal/community-guidelines.en.mdx) | [src/pages/community-guidelines.astro](src/pages/community-guidelines.astro) |
| `/cookies` | [src/content/legal/cookies.en.mdx](src/content/legal/cookies.en.mdx) | [src/pages/cookies.astro](src/pages/cookies.astro) |
| `/dmca` | [src/content/legal/dmca.en.mdx](src/content/legal/dmca.en.mdx) | [src/pages/dmca.astro](src/pages/dmca.astro) |
| `/safety` | [src/content/legal/safety.en.mdx](src/content/legal/safety.en.mdx) | [src/pages/safety.astro](src/pages/safety.astro) |
| `/sponsor-terms` | [src/content/legal/sponsor-terms.en.mdx](src/content/legal/sponsor-terms.en.mdx) | [src/pages/sponsor-terms.astro](src/pages/sponsor-terms.astro) |
| `/contact`, `/zh/contact` | n/a (UI strings only) | [src/pages/contact.astro](src/pages/contact.astro), [src/pages/zh/contact.astro](src/pages/zh/contact.astro) |

Footer wiring: [src/components/Footer.astro](src/components/Footer.astro:22-34). UI strings: [src/i18n/ui.ts](src/i18n/ui.ts).

**Translations of the 5 new legal docs are deferred to counsel review.** Existing `terms.zh-CN.mdx` / `privacy.zh-CN.mdx` (renamed from `*.zh.mdx` during the i18n expansion, see §9) remain the only translated legal docs. The 5 newer docs are EN-only — non-EN locales render the English content with a `<LegalLocaleNotice />` callout declaring English as the authoritative version. Footer entries now use `localizedPath(lang, ...)` so links resolve correctly per locale (also §9).

## 2. Key decisions (with rationale)

| Decision | Choice | Why |
|---|---|---|
| Minimum age | **16+ globally** | Avoids COPPA (US <13) and GDPR-K parental-consent complexity (EU varies 13–16). Simplest international compliance. |
| Geographic strategy | **US-anchored, globally available** | No EU Art. 27 / UK / China rep appointed. Lowest legal lift for early launch. Rights honored on request. |
| Governing law | **Wyoming** | Matches LLC state of formation (per Articles of Organization, filed 2026-05-01). Favorable LLC law, low class-action exposure. |
| Dispute resolution | **AAA Consumer arbitration + class waiver** for US users; mandatory local-court carve-out for EEA/UK/CH consumers | Standard US tech pattern; EU consumer protections preserved as required by mandatory law. |
| Account deletion | **Anonymize** (Discourse default) | Industry norm; preserves thread integrity. Disclosed honestly in Privacy §7. |
| Analytics on website | **Cookieless** (Cloudflare Web Analytics planned) | No EU consent banner required. Cookie policy assumes this. **Must actually be wired up before launch.** |
| iOS analytics & crash | Firebase / Google services (Crashlytics, Analytics, FCM), confirmed in [iOS/App/GoogleService-Info.plist](../../../iOS/App/GoogleService-Info.plist) | Required disclosure in Apple App Store Privacy nutrition label. Website docs use generic phrasing per stack-privacy preference. |
| Sub-processors transparency | **"List available on request"** — no public sub-processor page | Per founder preference, server location & vendor names are not disclosed publicly on the website. Acceptable under GDPR but lower transparency posture than HubSpot-style public list. |
| Server location | Not named publicly | Same preference. Privacy policy uses generic "regions outside the EEA, with adequacy decisions or SCCs" language. Sufficient for GDPR Art. 13(1)(f) minimum. |
| iOS EULA | **Apple default + ToS §19** (no separate EULA file) | ToS §19 contains the Apple App Store Additional Terms (third-party beneficiary clause, etc.). App Store Connect EULA URL should point to `/terms`. |
| Phone number | **None published** | Not required by any major law (CCPA, GDPR, Apple, Wyoming LLC) for this surface. Email + mailing address sufficient. |
| Sponsor relationship | Personally handled by founder team; clearly labeled; reviewed/approved; goes into a labeled forum category | Sponsor Terms drafted as separate doc with B2B + individual creator provisions. |
| Email routing | **Single inbox: `support@dirtbikex.com`** | One person handles all categories at present. The `contact.email.*` category labels are kept in the locale JSONs so per-category aliases can be re-introduced in a single ContactBody edit when the team grows. |

## 3. Placeholders still in the docs

All `[BRACKETED]` tokens have been replaced. The following are intentionally placeholder content (not bracketed) that need real values when ready:

| What | Where | Notes |
|---|---|---|
| WhatsApp number | [ContactBody.astro](src/components/ContactBody.astro) | Shows "Coming soon". Replace with `https://wa.me/<number>` link. |
| Social handles | [ContactBody.astro](src/components/ContactBody.astro) | All `@dirtbikex` with `url: '#'`. Replace `url` with real profile URLs. |
| Last-updated date | Frontmatter of every `.mdx` (`lastUpdated: 2026-05-22`) | Bump when content changes meaningfully. |
| `Section [n]` cross-refs in privacy policy | [privacy.en.mdx](src/content/legal/privacy.en.mdx) | Counsel may want to retitle / renumber. |

## 4. Operational tasks (separate from doc content)

These don't change the docs but need to happen for the docs to actually carry the intended legal effect:

1. ✅ **DONE (2026-05-22):** DMCA Designated Agent registered with U.S. Copyright Office. **USCO Registration `DMCA-1073161`**, agent role "Copyright Manager", registered email `support@dirtbikex.com`, registered phone on file at USCO. Renewal: every 3 years from 2026-05-22. Tracked in [dmca.en.mdx](src/content/legal/dmca.en.mdx).
2. **Sign a DPA with Logto** — their public Trust page doesn't list a standard DPA. Required for GDPR Art. 28 compliance with your identity provider.
3. **Sign DPAs with Brevo (or AWS SES if migrating), Oracle Cloud, Cloudflare, Google (Firebase).** Most have standard SCCs/DPAs available; sign once and file.
4. **Wire up Cloudflare Web Analytics** on the marketing website (Discourse forum already self-reports analytics). The Cookie Policy already says this is the analytics tool.
5. **Confirm the iOS app declares Firebase as a third-party data partner** in App Store Connect Privacy nutrition label. Apple rejects apps that under-declare.
6. **Verify sponsored content actually carries the "Sponsored" label** in the iOS splash and on the website — FTC §255 compliance assumes this. If the iOS team builds without the label, that's a compliance gap.
7. ✅ **DONE (effectively):** Single inbox policy — all legal-doc contact references now point to `support@dirtbikex.com`. Ensure that one address is set up and monitored. If/when the team grows, re-introduce per-category aliases by reversing this consolidation (the `contact.email.*` labels in [src/i18n/locales/](src/i18n/locales/) remain in place for this).

## 5. How to make systematic changes

| Change | Files to touch |
|---|---|
| Update entity address everywhere | Grep `30 N Gould St Ste N` across [src/content/legal/](src/content/legal/) and [src/i18n/ui.ts](src/i18n/ui.ts). 5 files. |
| Change governing law from Wyoming to another state | [terms.en.mdx](src/content/legal/terms.en.mdx) (multiple), [sponsor-terms.en.mdx](src/content/legal/sponsor-terms.en.mdx). Grep `Wyoming`. |
| Change the lastUpdated date on a single doc | Edit `lastUpdated:` in the frontmatter of that one `.mdx`. The site reads it from frontmatter — no other change needed. |
| Add a new legal page | (1) Add `.mdx` in [src/content/legal/](src/content/legal/); (2) Add `.astro` in [src/pages/](src/pages/) following the [terms.astro](src/pages/terms.astro) pattern; (3) Add `footer.legal.<key>` to both `en` and `zh` blocks of [ui.ts](src/i18n/ui.ts); (4) Add the link to [Footer.astro](src/components/Footer.astro). |
| Translate the 5 new docs to Chinese | (1) Create `*.zh.mdx` in [src/content/legal/](src/content/legal/); (2) Create `*.astro` files in [src/pages/zh/](src/pages/zh/) following [src/pages/zh/terms.astro](src/pages/zh/terms.astro) pattern; (3) In [Footer.astro](src/components/Footer.astro), change the 5 hardcoded `href="/foo"` to `href={localizedPath(lang, '/foo')}`. |
| Make sub-processor list public | Create `src/content/legal/subprocessors.en.mdx` with vendor names + countries; add a route page; reference it from privacy §4 and §6. |
| Change contact channels (add Discord, Reddit, etc.) | Edit the `socials` array in [contact.astro](src/pages/contact.astro) + [zh/contact.astro](src/pages/zh/contact.astro); add `contact.social.<key>` strings to both blocks of [ui.ts](src/i18n/ui.ts). |

## 6. Open questions for legal counsel

1. **Wyoming or Delaware?** Wyoming chosen here based on the LLC formation, but if counsel prefers DE for any tech-co reason (familiar caselaw, etc.), there's still time. Single-state grep is straightforward.
2. **Arbitration carve-outs**: The EEA/UK/CH consumer carve-out in [terms.en.mdx §16](src/content/legal/terms.en.mdx) is broad ("another jurisdiction whose mandatory consumer-protection laws…"). Counsel may want to narrow this to specific named countries, or broaden to a generic non-US carve-out.
3. **DSA Article 16/17 commitments** in [dmca.en.mdx](src/content/legal/dmca.en.mdx): tighter procedural obligations than the DMCA. At <50 EU monthly users you fall below Article 14-15 thresholds. Counsel may want to soften the language.
4. **China addendum** in [privacy.en.mdx §D](src/content/legal/privacy.en.mdx): minimum viable; if China is ever intentionally targeted (zh-CN locale already implies some intent), needs PIPL representative appointment & cross-border-transfer security assessment.
5. **EU Art. 27 representative**: not appointed. Reasonable for soft launch; if counsel disagrees, services like Prighter run $300–500/yr.
6. **Sub-processor disclosure posture**: founder prefers "on request" over public list. Counsel should weigh GDPR audit risk.
7. **Marketplace exposure**: forum may include user-to-user transactions. Section 7 of ToS disclaims this. Counsel should review whether the disclaimer is sufficient given the actual extent of marketplace-like activity.
8. **Sponsor Terms §10 indemnity cap**: limited to 12 months of fees, with carve-outs for IP/confidentiality. Standard but worth a look.

## 7. What's intentionally NOT included

- **EULA** as a separate doc — covered by [terms.en.mdx §19](src/content/legal/terms.en.mdx) (Apple App Store Additional Terms). App Store Connect EULA URL → `/terms`.
- **Public sub-processor page** — by founder preference, kept on-request.
- **Cookie consent banner UI** — not needed because analytics will be cookieless. If you later switch to GA or similar, you must add a CMP before EU launch.
- **GDPR Article 27 EU representative** — not appointed; OK for soft launch, revisit as EU users grow.
- **Children's Privacy supplement (COPPA)** — not needed at age 16+.
- **Standalone Data Processing Addendum** — would be needed if DirtBikeX becomes a processor for someone else's controller (e.g., enterprise customers). Not relevant at current model.

## 8. Build / publish

The site builds cleanly via `pnpm build`. All pages generate static HTML and are linked from the footer.

```
/community-guidelines, /contact, /cookies, /dmca, /founders,
/privacy, /safety, /sponsor-terms, /terms
```

After the i18n expansion (§9) each of the above also exists at `/zh-CN/<slug>`, `/zh-TW/<slug>`, and `/ja/<slug>` — 41 routes total. Legacy `/zh/*` URLs 301-redirect to `/zh-CN/*` via [public/_redirects](public/_redirects).

---

## 9. i18n expansion (2026-05-22, extended)

Landing-page locale support grew from 2 (`en`, `zh`) to **4** (`en`, `zh-CN`, `zh-TW`, `ja`) on the first pass, then to **all 20** matching the iOS app and Discourse forum: + ko, de, it, fr, es, ar, da, el, fa-IR, fi, id, nl, pt, tr-TR, th, vi. The Hero's "20 Languages" popover and the LangSwitcher dropdown now list every locale; visiting any non-EN locale URL serves UI strings in that language. **Legal MDX docs remain English-only** for all 20 — the `<LegalLocaleNotice />` banner declares EN as authoritative on every non-EN legal page (decision confirmed by user 2026-05-22).

### Architectural changes

| Change | Files / paths |
|---|---|
| Locale storage moved from a TypeScript mega-object to one JSON per locale (translator-friendly format). All 20 locales now live as separate JSONs; missing keys fall back to EN at runtime. | [src/i18n/locales/](src/i18n/locales/) (20 files) + thin loader at [src/i18n/ui.ts](src/i18n/ui.ts) |
| `getStaticPaths` in the 10 `[lang]/*.astro` pages now consumes a shared `nonEnLocales` const exported from `src/i18n/ui.ts` — adding a 21st locale is a one-line change to that array. | [src/i18n/ui.ts](src/i18n/ui.ts), [src/pages/[lang]/](src/pages/[lang]/) |
| `<html dir="rtl">` emitted for Arabic and Persian via a new `rtlLocales` export. Minimal RTL — text direction flips, layout uses default LTR CSS. Full `[dir="rtl"]` audit deferred. | [src/i18n/ui.ts](src/i18n/ui.ts) `rtlLocales`, [src/layouts/BaseLayout.astro](src/layouts/BaseLayout.astro) |
| Browser auto-redirect matcher extended from 3 locales to all 19 non-EN (Korean, German, Italian, French, Spanish, Arabic, Danish, Greek, Persian, Finnish, Indonesian, Dutch, Portuguese, Turkish, Thai, Vietnamese added). | inline script in [src/layouts/BaseLayout.astro](src/layouts/BaseLayout.astro) |
| LangSwitcher dropdown gained `max-height: 60vh; overflow-y: auto` to keep 20 entries scrollable on small viewports. | [src/styles/landing.css](src/styles/landing.css) |
| Old `/zh/*` routes replaced by `/zh-CN/`, `/zh-TW/`, `/ja/` via a `[lang]/` dynamic directory. Legacy `/zh/*` URLs 301-redirect. | [src/pages/[lang]/](src/pages/[lang]/), [public/_redirects](public/_redirects) |
| Astro 6 `i18n` config in [astro.config.mjs](astro.config.mjs) declares the 4 locales; `<html lang="...">` and `hreflang` alternates emitted automatically from [src/layouts/BaseLayout.astro](src/layouts/BaseLayout.astro). | [astro.config.mjs](astro.config.mjs), [src/layouts/BaseLayout.astro](src/layouts/BaseLayout.astro) |
| Browser-locale auto-redirect on first visit (silent; respects explicit user choice via `localStorage.dbx-locale-pref`). | inline script in [src/layouts/BaseLayout.astro](src/layouts/BaseLayout.astro) |
| `LangSwitcher` is now a dropdown popover ([src/components/LangSwitcher.astro](src/components/LangSwitcher.astro)) — segmented pill couldn't scale past 3 locales cleanly. | [src/components/LangSwitcher.astro](src/components/LangSwitcher.astro) |
| Hero gained a 5th stat: live count of supported app-locales with a hover popover listing native names. Count auto-updates when a new locale is added to `appLocales` in `ui.ts`. | [src/components/Hero.astro](src/components/Hero.astro), [src/i18n/ui.ts](src/i18n/ui.ts) |
| Legal docs render the EN MDX under non-EN locales with a `<LegalLocaleNotice />` banner. `privacy.zh.mdx` → `privacy.zh-CN.mdx` (and `terms.zh.mdx` likewise). | [src/components/LegalLocaleNotice.astro](src/components/LegalLocaleNotice.astro), [src/layouts/LegalLayout.astro](src/layouts/LegalLayout.astro), [src/content/legal/](src/content/legal/) |

### Translation provenance (for counsel)

| Locale | Source of strings | Status |
|---|---|---|
| `en` | Original copy (this team) | Authoritative — used as fallback for all locales |
| `zh-CN` | Original copy (this team, pre-expansion) — renamed from `zh` | Translation in production |
| `zh-TW` | LLM-pass draft from `zh-CN` with Taiwan vocabulary (e.g., 軟體, 影片, 社群). | **Draft — needs native-speaker review before launch** |
| `ja` | LLM-pass draft from EN, marketing-conversational register. | **Draft — needs native-speaker review before launch** |
| `ko` | LLM-pass draft from EN. | **Draft — needs native-speaker review** |
| `de` | LLM-pass draft from EN, "du"-form (informal marketing register). | **Draft — needs native-speaker review** |
| `it` | LLM-pass draft from EN, "tu"-form. | **Draft — needs native-speaker review** |
| `fr` | LLM-pass draft from EN, "tu"-form. | **Draft — needs native-speaker review** |
| `es` | LLM-pass draft from EN, "tú"-form (pan-regional Spanish, avoids "vosotros"). | **Draft — needs native-speaker review** |
| `ar` | LLM-pass draft from EN, Modern Standard Arabic. Page renders with `<html dir="rtl">`. | **Draft — needs native-speaker review (priority for RTL layout QA)** |
| `da` | LLM-pass draft from EN. | **Draft — needs native-speaker review** |
| `el` | LLM-pass draft from EN. | **Draft — needs native-speaker review** |
| `fa-IR` | LLM-pass draft from EN, Persian. Page renders with `<html dir="rtl">`. | **Draft — needs native-speaker review (priority for RTL layout QA)** |
| `fi` | LLM-pass draft from EN. | **Draft — needs native-speaker review** |
| `id` | LLM-pass draft from EN, informal register ("kamu"). | **Draft — needs native-speaker review** |
| `nl` | LLM-pass draft from EN, "je"-form. | **Draft — needs native-speaker review** |
| `pt` | LLM-pass draft from EN, Brazilian Portuguese tone. | **Draft — needs native-speaker review (decide pt-BR vs pt-PT split if Portugal traffic justifies)** |
| `tr-TR` | LLM-pass draft from EN. | **Draft — needs native-speaker review** |
| `th` | LLM-pass draft from EN. Thai has no inter-word spaces; visual word-wrap untested at scale. | **Draft — needs native-speaker review (priority for Thai script rendering QA)** |
| `vi` | LLM-pass draft from EN. | **Draft — needs native-speaker review** |

The LLM-pass translations are confined to **marketing/UI strings only** in `src/i18n/locales/*.json`. **Legal MDX content is NOT translated for any non-EN locale** — every non-EN visit to a legal page renders the EN content with `<LegalLocaleNotice />` declaring EN as authoritative. This is the GitHub / Stripe / Discord pattern; counsel should sign off but it's the lowest-risk default.

**Priority review order** (rough guidance based on translation difficulty + market size): zh-TW, ja, ko, de, fr, es, ar, fa-IR, th — these benefit most from native review. The Germanic / Romance / Nordic clusters (it, pt, nl, da, fi, el, tr-TR, id, vi) typically need only light review for tone.

### What counsel still needs to weigh in on

1. **zh-CN privacy/terms** ([privacy.zh-CN.mdx](src/content/legal/privacy.zh-CN.mdx), [terms.zh-CN.mdx](src/content/legal/terms.zh-CN.mdx)) — already in production. The English version is still authoritative per ToS §1, but the translated version is what mainland users actually read. Worth a parallel-language review before broader China activity.
2. **Whether to add a "translations are informational only" clause** to the EN authoritative version of privacy/terms, making the EN-binding posture explicit in the EN doc itself (rather than only via the notice on translated pages).
3. **Trigger for shipping additional locales' legal docs**: how much EU/JP/KR session share should a locale hit before its privacy/terms get professional translation? Default: don't translate until intentional market entry per [§2](#2-key-decisions-with-rationale) decision row "Geographic strategy".

### Operational follow-ups (i18n-specific)

- Native-speaker review pass on all 18 draft locale JSONs (every locale except `en` and `zh-CN`) before production deploy. Priority order in the table above.
- Confirm `/zh/*` legacy redirect renders in production Cloudflare Worker (verify with `curl -I https://www.dirtbikex.com/zh/contact` post-deploy → `301 → /zh-CN/contact`).
- Visual QA pass on `/ar/` and `/fa-IR/` — minimal RTL only flips text direction; hero chips, popover arrows, and feature cards use directional CSS that may render mirrored-wrong. Full `[dir="rtl"]` CSS audit is a deferred follow-up.
- Visual QA on `/th/` — Thai has no inter-word spaces; the `text-wrap: balance` on hero title may break awkwardly. Mitigate later with `word-break: keep-all` if needed.
- Confirm Cloudflare Worker bundle still compiles and deploys (no Worker changes in this pass — `/api/forum/*.json` endpoints are locale-agnostic).
- Apple App Store badge artwork (`/brand/app-store-badge.svg`) is English-only — request localized badges from Apple's marketing-resources portal before launching in any of the 19 non-EN markets where a localized badge is mandated by the App Store guidelines.
