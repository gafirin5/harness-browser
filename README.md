# Orca — Legacy-Compatible Agent Orchestrator

Aplikasi web desktop-first untuk mengatur penugasan AI agent, perutean provider LLM, antrean task, dan pemantauan log eksekusi. Frontend dibangun agar berjalan pada **Google Chrome 93.0.4577.107 (64-bit)** tanpa sintaks ES2022+ atau CSS modern yang tidak didukung.

## Fitur MVP

- Autentikasi Admin dengan sesi server-side, lockout 5 percobaan, dan expiry 8 jam idle.
- Dashboard orkestrasi: kartu ringkasan, peringatan agent OFFLINE/task FAILED, aktivitas terbaru.
- Manajemen provider LLM: endpoint, model, API key terenkripsi AES-256-GCM, tarif token.
- Manajemen agent pekerja: kode unik, endpoint, provider default, batas konkurensi, heartbeat 30 s.
- Orkestrasi task: antrean berprioritas, dispatcher, callback agent, log append-only, cancel, retry.
- Realtime SSE dengan fallback polling 2 detik.
- Perhitungan biaya `token_used / 1000 × snapshot tarif` dengan pembulatan half-up 4 desimal.

## Stack

| Layer | Teknologi |
|-------|-----------|
| Backend | Node.js 20+, Express 4, TypeScript, PostgreSQL 14+ |
| Frontend | React 18, Vite 5, Tailwind CSS 3.4, TypeScript |
| Test | Vitest + Supertest, Puppeteer smoke test |
| Deploy | Satu proses Node + reverse proxy opsional |

## Persyaratan

- Node.js 20 atau lebih baru
- PostgreSQL 14 atau lebih baru
- Chrome 93 untuk verifikasi kompatibilitas (opsional saat pengembangan)

## Mulai Cepat

```bash
# 1. Instal dependensi
npm install

# 2. Siapkan database (termasuk database test)
#    Alternatif: `docker compose up -d` (PostgreSQL 16 + orca_test otomatis)
createdb -O orca orca
createdb -O orca orca_test
cp .env.example .env
# sesuaikan DATABASE_URL dan secret di .env

# 3. Migrasi + admin awal
npm run migrate
npm run seed:admin

# 4. Jalankan API (port 3001) dan frontend (port 5173)
npm run dev
```

Buka `http://localhost:5173`. Kredensial default dari `.env.example`:

```
email:    admin@orca.local
password: admin12345
```

> Ganti `ADMIN_PASSWORD`, `SESSION_SECRET`, dan `APP_ENCRYPTION_KEY` sebelum produksi.

## Build Produksi

```bash
npm run build
npm run migrate:prod
NODE_ENV=production PUBLIC_BASE_URL=https://orca.example.com npm run start
```

`migrate:prod` dan `seed:admin:prod` menjalankan artefak JavaScript hasil build, sehingga tidak membutuhkan `tsx` di server produksi.

API melayani file statis dari `apps/web/dist` dan seluruh endpoint `/api`. Migrasi dijalankan terpisah sebelum restart:

```bash
npm run migrate
```

## Perintah

| Perintah | Fungsi |
|----------|--------|
| `npm run dev` | Build shared package, lalu jalankan API + Vite |
| `npm run build` | Build shared, API, dan frontend |
| `npm run migrate` | Jalankan migrasi SQL |
| `npm run seed:admin` | Buat akun Admin awal |
| `npm test` | Test integrasi API (PostgreSQL `orca_test`) |
| `npm run test:e2e` | Smoke test UI dengan Chrome modern |
| `npm run test:chrome93` | Smoke test UI dengan Chromium 93 |
| `npm run test:realtime` | Ukur latensi pembaruan SSE (target ≤ 2 s) |
| `npm run test:fallback` | Simulasikan SSE putus dan verifikasi polling 2 s |
| `npm run seed:perf` | Seed 10.000 task + 100.000 log untuk uji performa |
| `npm run seed:e2e` | Siapkan provider/agent + mock agent untuk CI |
| `npm run backup` | Backup PostgreSQL harian ke `BACKUP_DIR` |
| `npm run typecheck` | Typecheck seluruh workspace |
| `npm run verify` | Typecheck, test, build, scan JS/CSS, cek ukuran bundel |
| `node scripts/e2e-smoke.mjs` | Smoke test UI dengan Chrome modern |
| `node scripts/mock-agent.mjs` | Worker agent tiruan untuk pengembangan |

## Mock Agent

Setelah mendaftarkan agent melalui UI, salin token yang ditampilkan sekali, lalu:

```bash
AGENT_TOKEN=orca_agt_... PORT=9101 MOCK_DELAY_MS=1200 node scripts/mock-agent.mjs
```

Mock agent merespons `/health`, menerima `/tasks`, mengirim callback `COMPLETED` dengan 2.500 token, dan menerima `/tasks/:code/cancel`.

## Kompatibilitas Chrome 93

Target build:

- JavaScript `es2020` / `chrome93` (Vite + esbuild).
- CSS diproses untuk Blink 93; tanpa `@layer`, `:has()`, `@container`, `dvh/svh`, `oklch()`, `color-mix()`, atau CSS nesting.
- Tanpa API `structuredClone`, `Array.findLast`, `Promise.withResolvers`, `AbortSignal.timeout`, `crypto.randomUUID`, dan sejenisnya.

Gate otomatis:

```bash
npm run build
node scripts/check-syntax.mjs apps/web/dist   # parse ES2020
node scripts/scan-js.mjs apps/web/dist        # API JS terlarang
node scripts/scan-css.mjs apps/web/dist       # aturan CSS terlarang
node scripts/check-contrast.mjs               # WCAG AA token warna
node scripts/check-bundle.mjs apps/web/dist   # <= 150 KB gzip
```

Smoke test UI memakai Chrome yang tersedia:

```bash
CHROME_BIN=/path/to/chrome BASE_URL=http://localhost:3001 node scripts/e2e-smoke.mjs
```

Untuk Chromium 93 (diuji pada 93.0.4577.0, engine branch 4577 yang sama dengan 93.0.4577.107):

```bash
# puppeteer@10.2 + Chromium 93 tersedia di direktori ini
PUPPETEER93_DIR=/tmp/puppeteer93 BASE_URL=http://localhost:3001 node scripts/e2e-chrome93.mjs

# pengukuran latensi SSE (target <= 2 detik)
USE_CHROME93=1 BASE_URL=http://localhost:3001 node scripts/e2e-realtime.mjs
```

Bila binary Chrome 93 tidak tersedia, gate statis tetap membuktikan tidak ada sintaks/CSS terlarang, tetapi verifikasi runtime harus dilakukan manual pada build 93.0.4577.107.

## Dokumentasi

- [`docs/agent-protocol.md`](docs/agent-protocol.md) — kontrak HTTP worker agent.
- [`docs/deployment.md`](docs/deployment.md) — systemd, Nginx, backup, dan restore.
- [`docs/verification.md`](docs/verification.md) — hasil test, kompatibilitas Chrome 93, performa, dan backup/restore.

## Struktur

```
apps/api       API, dispatcher, heartbeat, SSE, migrasi
apps/web       React SPA
packages/shared  Tipe, skema zod, rumus biaya, konstanta status
scripts        Gate kompatibilitas, mock agent, E2E, backup
docs           Protokol agent dan operasional
```

## Batasan MVP

- Satu peran pengguna (`ADMIN`).
- Worker agent memanggil provider LLM sendiri; orchestrator adalah control plane.
- Tidak ada eksekusi kode di browser, multi-tenant, pembayaran, atau DAG workflow.
- Arsip otomatis setelah 1 tahun belum termasuk MVP; data disimpan dan di-backup.
