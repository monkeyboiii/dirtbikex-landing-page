import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: process.env.SITE_URL ?? 'https://www.dirtbikex.com',
  output: 'static',
  integrations: [tailwind(), mdx(), sitemap()],
  i18n: {
    defaultLocale: 'en',
    locales: [
      'en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'it', 'fr', 'es',
      'ar', 'da', 'el', 'fa-IR', 'fi', 'id', 'nl', 'pt', 'tr-TR', 'th', 'vi',
    ],
    routing: {
      prefixDefaultLocale: false,
      redirectToDefaultLocale: false,
    },
  },
});
