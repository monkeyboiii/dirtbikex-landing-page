import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Browser specs only. tests/unit/*.test.ts is pure logic run by `pnpm test:unit` under
     node --test; Playwright's default testMatch would otherwise collect it as a browser
     spec, run it three times, and — with PLAYWRIGHT_BASE_URL unset — boot `astro dev` to
     do it. See docs/TRAIL_OVERLAP_MODULE.md. */
  testMatch: '**/*.spec.ts',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    // Worker-served routes (share cards, /lineage/*) only exist on a deployed
    // environment, so the asset check has to be able to point at one.
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4321',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  // Only boot the dev server when the run actually targets it. Pointing
  // PLAYWRIGHT_BASE_URL at a deployed environment and still starting `astro dev`
  // put vite, esbuild and chromium on the same two cores as the whole staging
  // stack — which is how a verification run rebooted the box on 2026-08-18.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:4321',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
