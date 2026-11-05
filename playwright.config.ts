import { defineConfig } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 7790);
const dataDir = process.env.PLAYWRIGHT_DATA_DIR ?? `/tmp/dorado-playwright-${Date.now()}`;

export default defineConfig({
  testDir: './tests/playwright',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    viewport: { width: 1366, height: 768 },
    trace: 'retain-on-failure',
    ...(process.env.CHROME_BIN ? { launchOptions: { executablePath: process.env.CHROME_BIN } } : { channel: 'chrome' })
  },
  webServer: {
    command: 'node apps/runtime/dist/server.js',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      ADMIN_PASSWORD: 'playwright-password',
      SESSION_SECRET: 'playwright-session-secret-0123456789abcdef0123456789abcdef',
      COOKIE_SECURE: 'false',
      PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      APP_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      DORADO_AGENTS: JSON.stringify([
        {
          id: 'mock',
          name: 'Mock Agent',
          command: process.execPath,
          args: ['-e', 'setInterval(() => {}, 1000)']
        }
      ])
    }
  }
});
