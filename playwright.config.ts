import { defineConfig } from '@playwright/test';

// End-to-end tests run against the production build (`vite preview`), so the real CSP, the
// minified blob worker and the service worker are what gets tested. Set PW_CHANNEL=msedge or
// PW_CHANNEL=chrome to use an installed browser instead of Playwright's bundled Chromium.
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    channel: process.env.PW_CHANNEL || undefined,
    permissions: ['clipboard-read', 'clipboard-write'],
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
