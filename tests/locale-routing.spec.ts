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
  await expect(page.locator('.hero__title')).toContainText('Dirt bike-communityt');
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
