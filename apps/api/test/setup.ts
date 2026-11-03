import { afterAll, beforeAll, beforeEach } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import { pool, query } from '../src/db/pool.js';
import { hashPassword } from '../src/auth/password.js';
import { clearRateLimits } from '../src/lib/rate-limit.js';

export const TEST_ADMIN = {
  email: 'admin@orca.local',
  password: 'admin12345',
  name: 'Test Admin'
};

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await query(
    'TRUNCATE task_logs, tasks, task_code_sequences, agents, providers, sessions, users RESTART IDENTITY CASCADE'
  );
  const hash = await hashPassword(TEST_ADMIN.password);
  await query(
    `INSERT INTO users (email, password_hash, name, role, is_active)
     VALUES ($1, $2, $3, 'ADMIN', true)`,
    [TEST_ADMIN.email, hash, TEST_ADMIN.name]
  );
  clearRateLimits();
});

afterAll(async () => {
  await pool.end();
});
