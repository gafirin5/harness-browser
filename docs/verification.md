# Catatan Verifikasi

Tanggal: 2026-11-03
Lingkungan: Ubuntu 24.04, Node.js 24.19.0, PostgreSQL 16.15, Chromium 93.0.4577.0 (engine branch 4577, setara patch 93.0.4577.107).

## 1. Test Otomatis

```bash
npm test
```

Hasil: **20 test lulus** (auth, lockout, session expiry, ganti password, provider, agent, heartbeat, task lifecycle, dispatcher, konkurensi, biaya, cancel/retry, rekonsiliasi).

Cakupan utama:

- Login sukses/gagal, pesan generik, lockout 5 percobaan, expiry 8 jam idle.
- Ganti password + invalidasi sesi lain.
- Duplikat nama provider/kode agent tanpa membedakan kapital.
- API key tidak bocor di respons; hanya `apiKeyLast4`.
- Konkurensi dispatcher tidak melebihi `max_concurrency`.
- Callback idempoten, transisi final ditolak, biaya `2500 × $0.0020 = $0.0050`.
- Rekonsiliasi memperbaiki counter dan menandai task RUNNING kedaluwarsa FAILED.
- Heartbeat gagal menandai agent OFFLINE.

## 2. Gate Kompatibilitas

```bash
npm run verify
```

| Gate | Hasil |
|------|-------|
| Typecheck shared/API/web | Lulus |
| Sintaks ES2020 (`check-syntax`) | Lulus — 2 file |
| API JS terlarang (`scan-js`) | Lulus |
| CSS terlarang (`scan-css`) | Lulus |
| Kontras WCAG AA (`check-contrast`) | Lulus — 16 pasangan, terendah 4.58:1 |
| Bundel JS awal | **81.1 KB gzip** (batas 150 KB) |

## 3. Smoke Test UI

```bash
BASE_URL=http://localhost:3001 node scripts/e2e-smoke.mjs
BASE_URL=http://localhost:3001 node scripts/e2e-chrome93.mjs
```

Hasil: **lulus di Chrome modern dan Chromium 93**, tanpa error konsol/pageerror.

Alur yang diuji:

1. Login → Dashboard (4 kartu termuat).
2. Provider: buka form tambah.
3. Agent: buka form daftar.
4. Task: validasi prompt < 10 karakter, lalu buat task valid.
5. Detail task: konsol log dan salin log (fallback clipboard).
6. Pemulihan draf prompt dari `localStorage` (EC-002).
7. Pengaturan dan logout.

Pada Chromium 93, `navigator.clipboard` sengaja dihapus sebelum halaman dimuat untuk memaksa jalur `document.execCommand('copy')` (EC-007). Tombol "Salin Log" tetap berhasil tanpa error konsol.

## 4. Latensi Realtime

```bash
USE_CHROME93=1 BASE_URL=http://localhost:3001 node scripts/e2e-realtime.mjs
```

Hasil: kartu **Task Berjalan** berubah dalam **217 ms** setelah task dibuat (target ≤ 2.000 ms).

## 5. Fallback Polling (EC-006)

```bash
BASE_URL=http://localhost:3001 node scripts/e2e-fallback.mjs
```

Hasil: setelah `/api/events/stream` diblokir, banner "beralih ke mode pembaruan berkala" muncul; dalam 4,5 detik tercatat **2 request** `/api/dashboard/summary` (interval 2 detik), tanpa error konsol tak terduga.

## 6. Performa 10.000 Task / 100.000 Log

Seed:

```bash
npm run seed:perf
```

Pengukuran endpoint (PostgreSQL lokal):

| Endpoint | Waktu |
|----------|-------|
| `GET /api/dashboard/summary` | 6,8 ms |
| `GET /api/tasks?page=1` | 7,0 ms |
| `GET /api/tasks?page=500` | 26,6 ms |
| `GET /api/tasks?status=FAILED` | 6,5 ms |

Target NFR-001 (≤ 2 s) terpenuhi dengan margin besar.

## 7. Backup & Restore

```bash
BACKUP_DIR=/tmp/orca-backup ./scripts/backup.sh
pg_restore --no-owner --role=orca -d orca_restore /tmp/orca-backup/orca-*.dump
```

Hasil: dump 1,1 MB; restore ke database bersih menghasilkan 10.007 task dan 100.023 log saat data performa masih ada.

## 8. Quick Tunnel

Aplikasi diuji melalui Cloudflare Quick Tunnel dengan Chromium 93 dan Chrome modern: login, dashboard, provider, agent, task, detail/log, settings, dan logout lulus tanpa error konsol.

Cloudflare Quick Tunnel membuffer SSE, sehingga watchdog 6 detik mengalihkan dashboard ke polling 2 detik. Perilaku ini tervalidasi dengan `BLOCK_SSE=0` pada `scripts/e2e-fallback.mjs`:

```bash
BLOCK_SSE=0 BASE_URL=https://<tunnel>.trycloudflare.com node scripts/e2e-fallback.mjs
```

## 9. Catatan

- Pengujian runtime memakai Chromium 93.0.4577.0. Patch 93.0.4577.107 berada pada branch engine yang sama; verifikasi manual pada build tersebut tetap disarankan sebelum rilis.
- Latensi dan performa diukur pada mesin lokal; angka produksi bergantung pada VPS, jaringan, dan reverse proxy.
- Setelah verifikasi, data performa dihapus dari database pengembangan.
