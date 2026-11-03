import { defineConfig } from 'vitest/config';

const dataDir = `/tmp/dorado-test-${process.pid}-${Date.now()}`;

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATA_DIR: dataDir,
      ADMIN_PASSWORD: 'test-password',
      SESSION_SECRET: 'test-session-secret-0123456789abcdef0123456789abcdef',
      PUBLIC_BASE_URL: 'http://127.0.0.1:7788',
      PAIRING_TOKEN_TTL_HOURS: '1'
    }
  }
});