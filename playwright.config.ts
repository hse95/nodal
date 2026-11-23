import { defineConfig } from '@playwright/test';

// Browser smoke tests run against the production build, in the Chrome that is already installed
// on the machine (and on GitHub's runners), so no browser download is needed.
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  // One test at a time on the build machine: two of the tests measure speed (canvas frame rate, an optimizer run)
  // and fail when another test, such as the path-traced render, is using the processor at the same time.
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: 'http://localhost:4173',
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] },
  },
  webServer: { command: 'npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 60_000 },
});
