import bcrypt from 'bcryptjs';
import { config } from '../config.js';

const DUMMY_HASH = bcrypt.hashSync('orca-dummy-password', 10);

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.bcryptCost);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Dipakai saat email tidak ditemukan agar waktu respons mirip dengan kasus password salah. */
export async function burnPasswordCheck(plain: string): Promise<void> {
  await bcrypt.compare(plain, DUMMY_HASH);
}
