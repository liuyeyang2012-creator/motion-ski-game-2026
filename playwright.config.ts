import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
})
