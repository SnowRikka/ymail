import { defineConfig, devices } from '@playwright/test';

const port = 3000;

export default defineConfig({
  testDir: './mail-server/apps/webmail/tests/e2e',
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm --filter webmail exec next dev --hostname 127.0.0.1 --port ${port}`,
    env: {
      PLAYWRIGHT_TEST: '1',
    },
    port,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
