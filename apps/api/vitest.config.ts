import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://orca:orca@127.0.0.1:5432/orca_test',
      PUBLIC_BASE_URL: 'http://127.0.0.1:3001',
      APP_TIMEZONE: 'Asia/Jakarta',
      LOG_LEVEL: 'silent',
      BCRYPT_COST: '10'
    },
    setupFiles: ['./test/setup.ts']
  }
});
