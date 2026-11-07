/**
 * Normalisasi daftar origin tambahan dari env `ALLOWED_ORIGINS` (dipisah koma).
 *
 * Setiap entri diubah ke bentuk origin (`scheme://host[:port]`) agar cocok dengan
 * header `Origin` yang dikirim browser. Entri kosong atau yang bukan URL absolut
 * diabaikan supaya salah ketik tidak membuat runtime gagal start.
 */
export function parseAllowedOrigins(raw: string): string[] {
  const origins: string[] = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      origins.push(new URL(trimmed).origin);
    } catch {
      // Abaikan entri yang tidak dapat diurai sebagai URL absolut.
    }
  }
  return origins;
}
