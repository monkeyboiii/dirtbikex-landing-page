# Legal & policy docs — review notes

Concise hand-off for legal counsel and the founder. Drafted 2026-05-22.

> ⚠️ These documents are AI-drafted from market-standard patterns and current law as of May 2026. **They must be reviewed by qualified legal counsel before scaled launch.** Particularly: arbitration provisions, sponsor terms, DSA Article 16 references, and the regional addenda in the privacy policy.

## 1. What was built

Seven public legal/policy pages and one contact page, all wired into the Astro landing page.

| URL | Source file (content) | Source file (route) |
|---|---|---|
| `/terms` | [src/content/legal/terms.en.mdx](../src/content/legal/terms.en.mdx) | [src/pages/terms.astro](../src/pages/terms.astro) |
| `/privacy` | [src/content/legal/privacy.en.mdx](../src/content/legal/privacy.en.mdx) | [src/pages/privacy.astro](../src/pages/privacy.astro) |
| `/community-guidelines` | [src/content/legal/community-guidelines.en.mdx](../src/content/legal/community-guidelines.en.mdx) | [src/pages/community-guidelines.astro](../src/pages/community-guidelines.astro) |
| `/cookies` | [src/content/legal/cookies.en.mdx](../src/content/legal/cookies.en.mdx) | [src/pages/cookies.astro](../src/pages/cookies.astro) |
| `/dmca` | [src/content/legal/dmca.en.mdx](../src/content/legal/dmca.en.mdx) | [src/pages/dmca.astro](../src/pages/dmca.astro) |
| `/safety` | [src/content/legal/safety.en.mdx](../src/content/legal/safety.en.mdx) | [src/pages/safety.astro](../src/pages/safety.astro) |
| `/sponsor-terms` | [src/content/legal/sponsor-terms.en.mdx](../src/content/legal/sponsor-terms.en.mdx) | [src/pages/sponsor-terms.astro](../src/pages/sponsor-terms.astro) |
| `/contact` | n/a (UI strings only) | [src/pages/contact.astro](../src/pages/contact.astro) (locale-routed via `[lang]/`) |

Footer wiring: [src/components/Footer.astro](../src/components/Footer.astro) lines 34-53. UI strings: [src/i18n/ui.ts](../src/i18n/ui.ts).

**All legal MDX is EN-only.** Non-EN locales serve the English content with a `<LegalLocaleNotice />` callout declaring English as the authoritative version ([src/components/LegalLocaleNotice.astro](../src/components/LegalLocaleNotice.astro)). Footer entries use `localizedPath(lang, ...)` so links resolve correctly per locale. The two zh-CN stubs (`privacy.zh-CN.mdx`, `terms.zh-CN.mdx`) are slated for removal as a code cleanup (no legal content changes needed).

## 2. Key decisions (with rationale)

| Decision | Choice | Why |
|---|---|---|
| Minimum age | **16+ globally** | Avoids COPPA (US <13) and GDPR-K parental-consent complexity (EU varies 13–16). Simplest international compliance. |
| Geographic strategy | **US-anchored, globally available** | No EU Art. 27 / UK / China rep appointed. Lowest legal lift for early launch. Rights honored on request. |
| Governing law | **Wyoming** | Matches LLC state of formation (per Articles of Organization, filed 2026-05-01). Favorable LLC law, low class-action exposure. |
| Dispute resolution | **AAA Consumer arbitration + class waiver** for US users; mandatory local-court carve-out for EEA/UK/CH consumers | Standard US tech pattern; EU consumer protections preserved as required by mandatory law. |
| Account deletion | **Anonymize** (Discourse default) | Industry norm; preserves thread integrity. Disclosed honestly in Privacy §7. |
| Analytics on website | **Cookieless** (Cloudflare Web Analytics planned) | No EU consent banner required. Cookie policy assumes this. **Must actually be wired up before launch.** |
| iOS analytics & crash | Firebase / Google services (Crashlytics, Analytics, FCM), confirmed in the iOS repo's `iOS/App/GoogleService-Info.plist` | Required disclosure in Apple App Store Privacy nutrition label. Website docs use generic phrasing per stack-privacy preference. |
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
| WhatsApp number | [ContactBody.astro](../src/components/ContactBody.astro) | Shows "Coming soon". Replace with `https://wa.me/<number>` link. |
| Social handles | [ContactBody.astro](../src/components/ContactBody.astro) | All `@dirtbikex` with `url: '#'`. Replace `url` with real profile URLs. |
| Last-updated date | Frontmatter of every `.mdx` (`lastUpdated: 2026-05-22`) | Bump when content changes meaningfully. |
| `Section [n]` cross-refs in privacy policy | [privacy.en.mdx](../src/content/legal/privacy.en.mdx) | Counsel may want to retitle / renumber. |

## 4. Operational tasks (separate from doc content)

These don't change the docs but need to happen for the docs to actually carry the intended legal effect:

1. ✅ **DONE (2026-05-22):** DMCA Designated Agent registered with U.S. Copyright Office. **USCO Registration `DMCA-1073161`**, agent role "Copyright Manager", registered email `support@dirtbikex.com`, registered phone on file at USCO. Renewal: every 3 years from 2026-05-22. Tracked in [dmca.en.mdx](../src/content/legal/dmca.en.mdx).
2. **Sign a DPA with Logto** — their public Trust page doesn't list a standard DPA. Required for GDPR Art. 28 compliance with your identity provider.
3. **Sign DPAs with Brevo (or AWS SES if migrating), Oracle Cloud, Cloudflare, Google (Firebase).** Most have standard SCCs/DPAs available; sign once and file.
4. **Wire up Cloudflare Web Analytics** on the marketing website (Discourse forum already self-reports analytics). The Cookie Policy already says this is the analytics tool.
5. **Confirm the iOS app declares Firebase as a third-party data partner** in App Store Connect Privacy nutrition label. Apple rejects apps that under-declare.
6. **Verify sponsored content actually carries the "Sponsored" label** in the iOS splash and on the website — FTC §255 compliance assumes this. If the iOS team builds without the label, that's a compliance gap.
7. ✅ **DONE (effectively):** Single inbox policy — all legal-doc contact references now point to `support@dirtbikex.com`. Ensure that one address is set up and monitored. If/when the team grows, re-introduce per-category aliases by reversing this consolidation (the `contact.email.*` labels in [src/i18n/locales/](../src/i18n/locales/) remain in place for this).

## 5. How to make systematic changes

| Change | Files to touch |
|---|---|
| Update entity address everywhere | Grep `30 N Gould St Ste N` across [src/content/legal/](../src/content/legal/) and [src/i18n/ui.ts](../src/i18n/ui.ts). Legal MDX (5 files) + locale JSONs (21 files). |
| Change governing law from Wyoming to another state | [terms.en.mdx](../src/content/legal/terms.en.mdx) (multiple), [sponsor-terms.en.mdx](../src/content/legal/sponsor-terms.en.mdx). Grep `Wyoming`. |
| Change the lastUpdated date on a single doc | Edit `lastUpdated:` in the frontmatter of that one `.mdx`. The site reads it from frontmatter — no other change needed. |
| Add a new legal page | (1) Add `.mdx` in [src/content/legal/](../src/content/legal/); (2) Add `.astro` in [src/pages/](../src/pages/) following the [terms.astro](../src/pages/terms.astro) pattern; (3) Add `footer.legal.<key>` to locale JSONs in [src/i18n/locales/](../src/i18n/locales/); (4) Add the link to [Footer.astro](../src/components/Footer.astro). |
| Translate a legal doc to another language | (1) Create `*.zh-CN.mdx` (or appropriate locale) in [src/content/legal/](../src/content/legal/); (2) Add a locale route under [src/pages/[lang]/](../src/pages/%5Blang%5D/) following the existing `[lang]/terms.astro` pattern; (3) Remove the `<LegalLocaleNotice />` from that route for the translated locale. |
| Make sub-processor list public | Create `src/content/legal/subprocessors.en.mdx` with vendor names + countries; add a route page; reference it from privacy §4 and §6. |
| Change contact channels (add Discord, Reddit, etc.) | Edit the `socials` array in [ContactBody.astro](../src/components/ContactBody.astro); add `contact.social.<key>` strings to locale JSONs in [src/i18n/locales/](../src/i18n/locales/). |

## 6. Open questions for legal counsel

1. **Wyoming or Delaware?** Wyoming chosen here based on the LLC formation, but if counsel prefers DE for any tech-co reason (familiar caselaw, etc.), there's still time. Single-state grep is straightforward.
2. **Arbitration carve-outs**: The EEA/UK/CH consumer carve-out in [terms.en.mdx §16](../src/content/legal/terms.en.mdx) is broad ("another jurisdiction whose mandatory consumer-protection laws…"). Counsel may want to narrow this to specific named countries, or broaden to a generic non-US carve-out.
3. **DSA Article 16/17 commitments** in [dmca.en.mdx](../src/content/legal/dmca.en.mdx): tighter procedural obligations than the DMCA. At <50 EU monthly users you fall below Article 14-15 thresholds. Counsel may want to soften the language.
4. **China addendum** in [privacy.en.mdx §D](../src/content/legal/privacy.en.mdx): minimum viable; if China is ever intentionally targeted (zh-CN locale already implies some intent), needs PIPL representative appointment & cross-border-transfer security assessment.
5. **EU Art. 27 representative**: not appointed. Reasonable for soft launch; if counsel disagrees, services like Prighter run $300–500/yr.
6. **Sub-processor disclosure posture**: founder prefers "on request" over public list. Counsel should weigh GDPR audit risk.
7. **Marketplace exposure**: forum may include user-to-user transactions. Section 7 of ToS disclaims this. Counsel should review whether the disclaimer is sufficient given the actual extent of marketplace-like activity.
8. **Sponsor Terms §10 indemnity cap**: limited to 12 months of fees, with carve-outs for IP/confidentiality. Standard but worth a look.
9. **App Review 1.2 additions (2026-07-24)**: [terms.en.mdx §5](../src/content/legal/terms.en.mdx) gained three paragraphs for the App Store rejection — a zero-tolerance statement, an unauthorized-advertising/commercial-solicitation clause (with recommendation/private-sale carve-outs), and a reporting/blocking/enforcement paragraph committing to **review of objectionable-content reports within 24 hours** with removal + suspension/termination. The 24-hour SLA is a binding operational promise Apple requires verbatim; counsel should review scope (it is limited to "reports of objectionable content", not all support mail). Blocking is described as hiding content from the blocking user's view only — matching actual app behavior (viewer-level Discourse ignore). `lastUpdated` bumped to 2026-07-24; §18's 30-day-notice clause treated as a clarification at pre-launch scale.

## 7. What's intentionally NOT included

- **EULA** as a separate doc — covered by [terms.en.mdx §19](../src/content/legal/terms.en.mdx) (Apple App Store Additional Terms). App Store Connect EULA URL → `/terms`.
- **Public sub-processor page** — by founder preference, kept on-request.
- **Cookie consent banner UI** — not needed because analytics will be cookieless. If you later switch to GA or similar, you must add a CMP before EU launch.
- **GDPR Article 27 EU representative** — not appointed; OK for soft launch, revisit as EU users grow.
- **Children's Privacy supplement (COPPA)** — not needed at age 16+.
- **Standalone Data Processing Addendum** — would be needed if DirtBikeX becomes a processor for someone else's controller (e.g., enterprise customers). Not relevant at current model.

## 8. Build / publish

The site deploys as a Cloudflare Worker via `pnpm build:prod && pnpm wrangler deploy`. All legal pages generate at build time and are linked from the footer.

```
/community-guidelines, /contact, /cookies, /dmca, /founders,
/privacy, /safety, /sponsor-terms, /terms
```

Each slug also exists under all 21 locale prefixes (e.g. `/zh-CN/<slug>`, `/de/<slug>`, etc.). Legacy `/zh/*` URLs 301-redirect to `/zh-CN/*` via [public/_redirects](../public/_redirects).

---

## 9. i18n and legal-page policy

**Legal MDX is EN-only.** All 21 locales serve the English legal content; non-EN routes render the same EN MDX with a `<LegalLocaleNotice />` banner ([src/components/LegalLocaleNotice.astro](../src/components/LegalLocaleNotice.astro)) declaring English as the authoritative language. This is the GitHub / Stripe / Discord pattern.

UI strings (marketing copy, navigation, footer labels) are localized per-locale in [src/i18n/locales/](../src/i18n/locales/) — these are separate from legal content and are not subject to the EN-only constraint.

The two legacy zh-CN legal stubs ([src/content/legal/privacy.zh-CN.mdx](../src/content/legal/privacy.zh-CN.mdx), [src/content/legal/terms.zh-CN.mdx](../src/content/legal/terms.zh-CN.mdx)) are slated for removal as a code cleanup; the EN originals are and remain authoritative.

### What counsel still needs to weigh in on

1. **zh-CN privacy/terms stubs** — currently in the repo but superseded by the EN-only policy. Worth a parallel-language review before broader China activity, then remove the stubs.
2. **Whether to add a "translations are informational only" clause** to the EN authoritative version of privacy/terms, making the EN-binding posture explicit in the EN doc itself (rather than only via the notice on non-EN pages).
3. **Trigger for shipping professional legal translations**: how much EU/JP/KR session share should a locale hit before its privacy/terms get professional translation? Default: don't translate until intentional market entry per [§2](#2-key-decisions-with-rationale) decision row "Geographic strategy".
