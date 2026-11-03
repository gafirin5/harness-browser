import { config } from './config.js';
import { pool, queryOne } from './db/pool.js';
import { hashPassword } from './auth/password.js';

async function seed(): Promise<void> {
  const existing = await queryOne<{ id: number }>('SELECT id FROM users WHERE lower(email) = lower($1)', [
    config.admin.email
  ]);
  if (existing) {
    console.log(`[seed] admin sudah ada: ${config.admin.email}`);
    return;
  }
  const hash = await hashPassword(config.admin.password);
  await pool.query(
    `INSERT INTO users (email, password_hash, name, role, is_active)
     VALUES (lower($1), $2, $3, 'ADMIN', true)`,
    [config.admin.email, hash, config.admin.name]
  );
  console.log(`[seed] admin dibuat: ${config.admin.email}`);
}

seed()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error('[seed] gagal:', error);
    await pool.end();
    process.exit(1);
  });
