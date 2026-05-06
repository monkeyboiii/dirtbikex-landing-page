import { ui, defaultLang, type Lang, type UIKey } from './ui';

export function getLangFromUrl(url: URL): Lang {
  const [, segment] = url.pathname.split('/');
  if (segment in ui) return segment as Lang;
  return defaultLang;
}

export function useTranslations(lang: Lang) {
  return function t(key: UIKey, vars: Record<string, string | number> = {}) {
    let str: string = ui[lang][key] ?? ui[defaultLang][key];
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
    segments[0] && segments[0] in ui ? '/' + segments.slice(1).join('/') : path;
  const normalized = stripped === '' ? '/' : stripped;
  return localizedPath(target, normalized);
}
