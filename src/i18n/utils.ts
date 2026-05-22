import { ui, defaultLang, languages, type Lang, type UIKey } from './ui';

const localeCodes: readonly string[] = Object.keys(languages);

export function getLangFromUrl(url: URL): Lang {
  const [, segment] = url.pathname.split('/');
  if (segment && localeCodes.includes(segment)) {
    return segment as Lang;
  }
  return defaultLang;
}

export function useTranslations(lang: Lang) {
  return function t(
    key: UIKey,
    vars: Record<string, string | number> = {},
  ): string {
    let str: string = ui[lang][key] ?? ui[defaultLang][key] ?? key;
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`{${k}}`, 'g'), String(v));
    }
    return str;
  };
}

export function localizedPath(lang: Lang, path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (lang === defaultLang) return clean;
  return `/${lang}${clean === '/' ? '' : clean}`;
}

export function switchLangPath(currentUrl: URL, target: Lang): string {
  const path = currentUrl.pathname;
  const segments = path.split('/').filter(Boolean);
  const stripped =
    segments[0] && localeCodes.includes(segments[0])
      ? '/' + segments.slice(1).join('/')
      : path;
  const normalized = stripped === '' ? '/' : stripped;
  return localizedPath(target, normalized);
}
