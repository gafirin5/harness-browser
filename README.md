# Dorado

Dorado adalah **agent workspace berbasis web** yang terinspirasi Orca: kelola project Git, buat worktree paralel, buka terminal PTY, dan jalankan agent CLI — semuanya dari browser. Fokus M1 adalah web + runtime + quick tunnel, dengan target kompatibilitas **Chromium 93**.

Ini adalah implementasi clean-room. Tidak ada kode/aset dari `stablyai/orca` yang disalin.

## Fitur M1

- Login admin (password bcrypt + sesi server-side) dan **pairing token** untuk akses browser lain.
- **Pengaturan keamanan**: ganti password dan cabut sesi browser lain.
- Tambah project dari path repository Git lokal.
- Daftar branch dan pembuatan **git worktree** paralel.
- **Terminal PTY** per worktree dengan xterm.js, resize, replay buffer, dan reconnect.
- **Sesi agent** dengan adapter CLI; M1 mendukung OpenCode.
- **File explorer** dengan buat/rename/hapus, plus editor CodeMirror 5: line numbers, syntax highlighting, lazy-loaded (maksimal 1 MB, proteksi path/symlink).
- Tab terpadu untuk terminal, file, dan diff; indikator file belum disimpan dan Ctrl+S.
- **Multi-pane terminal** hingga empat pane, dengan pemilih terminal per pane.
- **Source control**: status Git per worktree, daftar perubahan, diff staged/unstaged, stage/unstage, commit lokal, serta pull/push ke remote.
- **Riwayat sesi agent**: pencarian judul/prompt, filter status, detail, dan rerun.
- **Pencarian terminal** (`Find` atau `Ctrl+F`) dengan navigasi hasil.
- **Pencarian kode worktree** (`Ctrl+Shift+F` atau tombol **Cari**): ripgrep dengan fallback `git grep`, filter case-sensitive/regex, dan klik hasil untuk melompat ke baris di editor.
- **Notifikasi sesi** saat agent selesai/gagal + penanda unread di sidebar dan judul tab.
- **Info Runtime**: versi, Node, tmux, data directory, agent CLI, dan jumlah data.
- **Integrasi GitHub read-only**: info repository, pull request, dan issue per worktree; link keluar ke GitHub, caching 60 detik, token opsional.
- **Orchestrator terintegrasi**: dashboard realtime (SSE + fallback polling), provider LLM dengan API key terenkripsi, agent worker dengan token/heartbeat, antrean task berprioritas, dispatcher, callback worker, cancel/retry, log, dan perhitungan biaya.
- **Command palette** (`Ctrl+Shift+P` atau `Ctrl+K`): terminal, agent, worktree, split, orchestrator, search, refresh, history, github, info, settings, share.
- **Resume sesi** agent dengan konteks percakapan (OpenCode `--continue`), serta stop sesi berjalan.
- **Persistensi terminal/agent sejati** setelah runtime restart melalui tmux, dengan tombol Restart untuk shell.
- Hentikan sesi, tutup terminal, hapus worktree (dengan proteksi sesi aktif).
- Quick tunnel Cloudflare + pairing URL.
- UI gelap ala IDE agent, sidebar project/worktree/session, tab terminal.
- Gate Chrome 93: ES2020, CSS terlarang, ukuran bundle, smoke Chromium 93.

## Prasyarat

- Node.js 22+ (diuji pada Node 24)
- Git
- **tmux 3.2+** (terminal host untuk persistensi sesi)
- ripgrep (opsional; fallback otomatis ke `git grep`)
- `node-pty` prebuilt/native build (build tools: python3, make, g++)
- OpenCode CLI untuk sesi agent (opsional)
- `cloudflared` untuk quick tunnel (opsional)

## Mulai Cepat

```bash
npm install
cp .env.example .env
# ganti ADMIN_PASSWORD dan SESSION_SECRET

npm run build
npm start
```

Buka `http://127.0.0.1:7788`.

Default `.env.example`:

```
ADMIN_PASSWORD=dorado
PORT=7788
DATA_DIR=./data
```

Data runtime (SQLite, log terminal, worktree) disimpan di `DATA_DIR`. Untuk production, gunakan path di luar repository, misalnya `/var/lib/dorado`.

## Mode Pengembangan

```bash
npm run dev
```

- Runtime: `http://127.0.0.1:7788`
- Vite: `http://127.0.0.1:5174` (proxy `/api` dan `/ws` ke runtime)

## Alur Dasar

1. Login dengan password admin.
2. **+** di sidebar → tambahkan path repo Git.
3. **+ Worktree** → tentukan branch baru dan base ref.
4. **+ Terminal** → shell interaktif di worktree.
5. **Jalankan Agent** → pilih OpenCode, isi prompt, agent berjalan di PTY worktree.
6. **Share** → buat pairing token/URL untuk browser lain.

## Quick Tunnel

```bash
npm run tunnel
```

Script mencetak URL `https://<acak>.trycloudflare.com` dan menulis `.dorado-tunnel.json`. Setelah URL didapat, restart runtime dengan origin tersebut:

```bash
PUBLIC_BASE_URL=https://<acak>.trycloudflare.com node apps/runtime/dist/server.js
```

Pairing URL yang dibuat setelah restart akan memakai domain tunnel. WebSocket juga berjalan melalui tunnel, sehingga terminal tetap interaktif.

> Tunnel publik memberi akses shell ke host ini. Gunakan pairing token, jangan bagikan URL sembarangan, dan hentikan tunnel setelah selesai.

## Orchestrator

Buka tombol **Orchestrator** di topbar atau lewat command palette. Panel berisi:

1. **Dashboard** — kartu agent aktif, task berjalan, task gagal hari ini, biaya hari ini, peringatan, dan aktivitas terbaru. Data diperbarui lewat SSE; jika stream terputus, UI beralih ke polling 2 detik.
2. **Provider** — endpoint LLM, model default, tarif per 1K token, dan API key yang disimpan terenkripsi AES-256-GCM. API key tidak pernah dikembalikan utuh; hanya 4 karakter terakhir.
3. **Agent** — worker agent dengan kode unik, endpoint, provider default, dan batas konkurensi. Token agent ditampilkan sekali saat dibuat/dirotasi.
4. **Task** — antrean berprioritas, dispatcher otomatis, log, cancel, retry, dan detail biaya.

Worker agent menerima `POST /tasks` dengan bearer token lalu mengirim callback ke:

```text
POST /api/orchestrator/agent/tasks/:code/result
Authorization: Bearer <token agent>
```

Untuk pengembangan, jalankan mock worker:

```bash
AGENT_TOKEN=orca_agt_... PORT=9101 node scripts/mock-orchestrator-agent.mjs
```

Lalu daftarkan agent dengan endpoint `http://127.0.0.1:9101`. Callback memakai `PUBLIC_BASE_URL`, jadi saat memakai tunnel pastikan URL publik dapat dijangkau worker.

Konfigurasi penting: `APP_TIMEZONE`, `APP_ENCRYPTION_KEY` (base64 32 byte, wajib diganti di production), `AGENT_DISPATCH_TIMEOUT_MS`, `AGENT_HEALTH_TIMEOUT_MS`, `HEARTBEAT_INTERVAL_MS`, `TASK_MAX_DURATION_MS`, dan `AGENT_KEY_DELIVERY`.

## Integrasi GitHub

Worktree harus memiliki remote `origin` (atau remote pertama) yang mengarah ke `github.com`, baik format SSH (`git@github.com:owner/repo.git`) maupun HTTPS. Buka tombol **GitHub** di topbar atau lewat command palette.

```bash
# Opsional: menaikkan rate limit dan mengakses repository private
GITHUB_TOKEN=ghp_xxx
```

Tanpa token, hanya repository publik yang dapat dibaca dan rate limit GitHub lebih rendah. Integrasi ini read-only: pull request dan issue ditampilkan, lalu dibuka di GitHub untuk aksi lanjutan. Hasil API di-cache 60 detik di memori.

## Arsitektur

```text
Browser (React + xterm.js)
   │ REST + WebSocket
   ▼
Runtime (Node + Express + ws)
   ├── node:sqlite         projects, worktrees, terminals, sessions, tokens
   ├── git CLI             worktree/branch
   ├── node-pty            shell dan agent
   └── static web build
```

Struktur:

```
apps/runtime/   API, SQLite, git, PTY, session, WebSocket
apps/web/       React + xterm UI
packages/shared tipe dan skema zod
scripts/        tunnel, gate Chrome 93, E2E
```

### Protokol Terminal

`WS /ws/terminals/:id`

```json
{ "type": "input", "data": "ls\r" }
{ "type": "resize", "cols": 120, "rows": 32 }
{ "type": "ping" }
```

Server mengirim `replay`, `output`, `exit`, `error`. Output juga ditulis ke `DATA_DIR/logs/<terminal-id>.log` dan disimpan di ring buffer 2 MB untuk replay.

## Chrome 93

```bash
npm run build
node scripts/check-syntax.mjs apps/web/dist
node scripts/scan-js.mjs apps/web/dist
node scripts/scan-css.mjs apps/web/dist
node scripts/check-bundle.mjs apps/web/dist
```

Smoke test dengan Chromium 93:

```bash
PUPPETEER93_DIR=/tmp/puppeteer93 \
BASE_URL=http://127.0.0.1:7788 \
node scripts/e2e-chrome93.mjs
```

Test mencakup login, project/worktree, terminal PTY via WebSocket (mengetik `echo chrome93-ok`), file explorer + editor (buka/sunting/simpan `README.md`), git status + diff, pencarian kode dan lompat ke baris, stage + commit, command palette, terminal multi-pane (3 pane), pencarian terminal, dialog Info, dialog GitHub, orchestrator end-to-end, pengaturan/ganti password/cabut sesi, buat/rename file, dialog riwayat sesi, dialog Share, dan pairing URL auto-login.

## Keamanan

- Runtime bind ke `127.0.0.1` secara default; gunakan tunnel/reverse proxy untuk akses remote.
- Password admin di-hash dengan **bcrypt** dan disimpan di database; password awal di-seed dari `ADMIN_PASSWORD`.
- Sesi disimpan server-side sebagai hash token: idle **8 jam**, maksimal **24 jam**, dapat dicabut, dan otomatis dibersihkan setelah 7 hari.
- Ganti password mencabut semua sesi lain; tersedia juga tombol **Cabut Sesi Lain**.
- Pairing token 32 byte, disimpan sebagai SHA-256, dapat dicabut, dan memiliki masa berlaku.
- Cookie HttpOnly + SameSite=Lax; `Secure` otomatis bila `PUBLIC_BASE_URL` HTTPS.
- Origin check untuk request mutasi dan WebSocket.
- Rate limit: login 15/menit/IP, API umum 300/menit/IP, callback agent 120/menit/agent.
- `/api/health` mengecek database dan mengembalikan 503 bila SQLite tidak siap.
- Header keamanan: CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, dan `Permissions-Policy`.
- Path worktree divalidasi agar tidak keluar dari data directory.
- File explorer dibatasi pada worktree, menolak path traversal/symlink ke luar worktree, dan mengabaikan `.git`, `node_modules`, `dist`, dan folder build.
- Commit/push dari UI memakai remote pertama (utamakan `origin`); pull memakai `--ff-only`. Pastikan user.name/user.email dan kredensial Git host sudah benar.
- Hapus folder hanya diizinkan untuk folder kosong; belum ada recursive delete.
- Pencarian kode dijalankan tanpa shell, memakai `rg`/`git grep` dengan argumen terpisah, mengikuti `.gitignore`, dan membatasi hasil agar payload tetap kecil.
- Terminal adalah shell penuh; hanya berikan akses ke pengguna tepercaya.

## Test

```bash
npm test                 # 22 test API + 5 test frontend (Testing Library)
npm run test:web         # hanya test frontend (Vitest + Testing Library)
npm run lint             # ESLint
npm run format:check
npm run verify           # typecheck + lint + format + test + build + gate Chrome 93
npm run e2e:chrome93     # E2E Chromium 93
npm run test:e2e:playwright  # E2E Playwright (Chrome sistem)
```

Lihat [`docs/verification-m1.md`](docs/verification-m1.md) untuk hasil verifikasi terakhir.

## Operasional

```bash
npm run backup       # snapshot SQLite + integrity check
npm run restore -- ./backups/dorado-YYYYMMDD-HHMMSS.db
npm run seed:perf    # 10.000 task + 100.000 log (butuh build:runtime)
```

Dokumentasi lengkap:

- [`docs/deployment.md`](docs/deployment.md) — systemd, Nginx, backup/restore, health check.
- [`docs/agent-protocol.md`](docs/agent-protocol.md) — kontrak worker agent, callback, cancel, idempotensi.

## Batasan M1

Belum termasuk: Electron desktop, mobile, cloud relay, Linear, browser/design mode, SSH worktree, multi-user, dan recursive delete. Integrasi GitHub bersifat read-only (belum ada komentar, review, atau merge dari UI). Pencarian kode mengikuti `.gitignore`; file ignored/untracked tidak ikut dicari saat memakai fallback `git grep`.

Orchestrator memakai satu admin, worker agent harus dapat dijangkau dari runtime, dan `AGENT_KEY_DELIVERY=payload` mengirim API key provider ke worker (gunakan HTTPS/trusted network atau ubah ke `none`). Arsip otomatis setelah satu tahun belum termasuk MVP.

## Branch Lama

Aplikasi Orca Orchestrator sebelumnya disimpan di branch `gafirin5/dorado` (commit `7c40ab4`, `snapshot: legacy PRD orchestrator before Dorado rebuild`). Branch aktif `dorado` sekarang menggabungkan workspace Dorado dengan modul Orchestrator di satu aplikasi.