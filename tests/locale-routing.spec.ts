import { test, expect } from '@playwright/test';

async function setStoredLocale(page, locale: string) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate((value) => {
    localStorage.setItem('dbx-locale-pref', value);
    localStorage.setItem('dbx-locale-source', 'manual');
  }, locale);
}

test('header language picker opens the Swedish landing page', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await page.locator('[data-langswitch] summary').click();
  await page.locator('[data-langswitch] [data-locale="sv"]').click();

  await expect(page).toHaveURL(/\/sv\/?$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'sv');
  // The homepage is the world map; its gate title is the SSR'd localized string.
  await expect(page.locator('.wm__gate-title')).toContainText('Besöker 100 dirtbike-banor');
});

test('stored Swedish preference does not redirect Swedish pages recursively', async ({ page }) => {
  await setStoredLocale(page, 'sv');

  await page.goto('/sv/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/\/sv\/?$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'sv');
});

test('repeated Swedish prefixes canonicalize back to the Swedish root', async ({ page }) => {
  await setStoredLocale(page, 'sv');

  await page.goto('/sv/sv/sv/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/\/sv\/?$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'sv');
});
