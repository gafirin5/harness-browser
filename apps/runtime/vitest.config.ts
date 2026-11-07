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
      ALLOWED_ORIGINS: 'https://extra.example.com, https://another.example.com:8443',
      PAIRING_TOKEN_TTL_HOURS: '1',
      DORADO_AGENTS: JSON.stringify([
        {
          id: 'mock',
          name: 'Mock Agent',
          command: process.execPath,
          args: ['-e', "console.log('mock-start'); setInterval(() => {}, 1000)"],
          resumeArgs: ['-e', "console.log('mock-resume'); setInterval(() => {}, 1000)"]
        }
      ])
    }
  }
});
