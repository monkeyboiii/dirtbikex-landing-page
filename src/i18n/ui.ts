import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import de from './locales/de.json';
import it from './locales/it.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import ar from './locales/ar.json';
import da from './locales/da.json';
import el from './locales/el.json';
import faIR from './locales/fa-IR.json';
import fi from './locales/fi.json';
import id from './locales/id.json';
import nl from './locales/nl.json';
import pt from './locales/pt.json';
import trTR from './locales/tr-TR.json';
import th from './locales/th.json';
import vi from './locales/vi.json';
import sv from './locales/sv.json';

/**
 * Locales the landing-page site is routed for — full parity with the
 * iOS app and Discourse forum. `name` is the English label (shown in
 * admin contexts); `native` is the user-facing label rendered in the
 * LangSwitcher dropdown, footer locale row, and Hero language popover.
 *
 * Translation coverage varies — see [LEGAL_REVIEW.md](../../LEGAL_REVIEW.md)
 * §9 for per-locale draft/review status. Strings missing from a locale
 * fall back to `en` via `useTranslations()`.
 */
export const languages = {
  'en':    { name: 'English',               native: 'English'  },
  'zh-CN': { name: 'Chinese (Simplified)',  native: '简体中文' },
  'zh-TW': { name: 'Chinese (Traditional)', native: '繁體中文' },
  'ja':    { name: 'Japanese',              native: '日本語'   },
  'ko':    { name: 'Korean',                native: '한국어'   },
  'de':    { name: 'German',                native: 'Deutsch'  },
  'it':    { name: 'Italian',               native: 'Italiano' },
  'fr':    { name: 'French',                native: 'Français' },
  'es':    { name: 'Spanish',               native: 'Español'  },
  'ar':    { name: 'Arabic',                native: 'العربية'  },
  'da':    { name: 'Danish',                native: 'Dansk'    },
  'el':    { name: 'Greek',                 native: 'Ελληνικά' },
  'fa-IR': { name: 'Persian',               native: 'فارسی'    },
  'fi':    { name: 'Finnish',               native: 'Suomi'    },
  'id':    { name: 'Indonesian',            native: 'Bahasa Indonesia' },
  'nl':    { name: 'Dutch',                 native: 'Nederlands' },
  'pt':    { name: 'Portuguese',            native: 'Português' },
  'tr-TR': { name: 'Turkish',               native: 'Türkçe'   },
  'th':    { name: 'Thai',                  native: 'ไทย'      },
  'vi':    { name: 'Vietnamese',            native: 'Tiếng Việt' },
  'sv':    { name: 'Swedish',               native: 'Svenska' },
} as const;

export const defaultLang = 'en' as const;
export type Lang = keyof typeof languages;
export type UIKey = keyof typeof en;

/**
 * Per-locale string dictionaries. Missing keys fall back to EN via
 * `useTranslations()` (see [./utils.ts](./utils.ts)). Locales with empty
 * `{}` dictionaries render entirely in EN until their JSON is populated.
 */
export const ui: Record<Lang, Partial<Record<UIKey, string>>> = {
  'en':    en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'ja':    ja,
  'ko':    ko,
  'de':    de,
  'it':    it,
  'fr':    fr,
  'es':    es,
  'ar':    ar,
  'da':    da,
  'el':    el,
  'fa-IR': faIR,
  'fi':    fi,
  'id':    id,
  'nl':    nl,
  'pt':    pt,
  'tr-TR': trTR,
  'th':    th,
  'vi':    vi,
  'sv':    sv,
};

/** Non-default locales — used for `getStaticPaths` across [lang]/ pages. */
export const nonEnLocales: readonly Exclude<Lang, 'en'>[] = (
  Object.keys(languages) as Lang[]
).filter((l): l is Exclude<Lang, 'en'> => l !== 'en');

/** Locales that need `<html dir="rtl">`. */
export const rtlLocales: readonly Lang[] = ['ar', 'fa-IR'];

/**
 * Full set of locales the iOS app + Discourse forum support. Mirrors
 * the keys of `languages` above (kept as a separate array because the
 * Hero language popover needs ordered iteration). The Hero stat number
 * `{appLocales.length}` updates automatically when a locale is added.
 */
export const appLocales = [
  { code: 'en',    native: 'English'    },
  { code: 'zh-CN', native: '简体中文'   },
  { code: 'zh-TW', native: '繁體中文'   },
  { code: 'ja',    native: '日本語'     },
  { code: 'ko',    native: '한국어'     },
  { code: 'de',    native: 'Deutsch'    },
  { code: 'it',    native: 'Italiano'   },
  { code: 'fr',    native: 'Français'   },
  { code: 'es',    native: 'Español'    },
  { code: 'ar',    native: 'العربية'    },
  { code: 'da',    native: 'Dansk'      },
  { code: 'el',    native: 'Ελληνικά'   },
  { code: 'fa-IR', native: 'فارسی'      },
  { code: 'fi',    native: 'Suomi'      },
  { code: 'id',    native: 'Bahasa Indonesia' },
  { code: 'nl',    native: 'Nederlands' },
  { code: 'pt',    native: 'Português'  },
  { code: 'tr-TR', native: 'Türkçe'     },
  { code: 'th',    native: 'ไทย'        },
  { code: 'vi',    native: 'Tiếng Việt' },
  { code: 'sv',    native: 'Svenska'    },
] as const;
