# Dorado

Dorado adalah **agent workspace berbasis web** yang terinspirasi Orca: kelola project Git, buat worktree paralel, buka terminal PTY, dan jalankan agent CLI — semuanya dari browser. Fokus M1 adalah web + runtime + quick tunnel, dengan target kompatibilitas **Chromium 93**.

Ini adalah implementasi clean-room. Tidak ada kode/aset dari `stablyai/orca` yang disalin.

## Fitur M1

- Login admin (password) dan **pairing token** untuk akses browser lain.
- Tambah project dari path repository Git lokal.
- Daftar branch dan pembuatan **git worktree** paralel.
- **Terminal PTY** per worktree dengan xterm.js, resize, replay buffer, dan reconnect.
- **Sesi agent** dengan adapter CLI; M1 mendukung OpenCode.
- **File explorer** dengan buat/rename/hapus, plus editor CodeMirror 5: line numbers, syntax highlighting, lazy-loaded (maksimal 1 MB, proteksi path/symlink).
- Tab terpadu untuk terminal, file, dan diff; indikator file belum disimpan dan Ctrl+S.
- **Multi-pane terminal** hingga empat pane, dengan pemilih terminal per pane.
- **Source control**: status Git per worktree, daftar perubahan, diff staged/unstaged, stage/unstage, dan commit lokal.
- **Command palette** (`Ctrl+Shift+P` atau `Ctrl+K`): terminal, agent, worktree, split, refresh, share.
- **Rerun sesi** agent dengan prompt yang sama, serta stop sesi berjalan.
- Hentikan sesi, tutup terminal, hapus worktree (dengan proteksi sesi aktif).
- Quick tunnel Cloudflare + pairing URL.
- UI gelap ala IDE agent, sidebar project/worktree/session, tab terminal.
- Gate Chrome 93: ES2020, CSS terlarang, ukuran bundle, smoke Chromium 93.

## Prasyarat

- Node.js 22+ (diuji pada Node 24)
- Git
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

Test mencakup login, project/worktree, terminal PTY via WebSocket (mengetik `echo chrome93-ok`), file explorer + editor (buka/sunting/simpan `README.md`), git status + diff, stage + commit, command palette, terminal multi-pane (3 pane), buat/rename/hapus file, dialog Share, dan pairing URL auto-login.

## Keamanan

- Runtime bind ke `127.0.0.1` secara default; gunakan tunnel/reverse proxy untuk akses remote.
- Password admin dari environment, dibandingkan dengan timing-safe hash.
- Pairing token 32 byte, disimpan sebagai SHA-256, dapat dicabut, dan memiliki masa berlaku.
- Cookie HttpOnly + SameSite=Lax; `Secure` otomatis bila `PUBLIC_BASE_URL` HTTPS.
- Origin check untuk request mutasi dan WebSocket.
- Path worktree divalidasi agar tidak keluar dari data directory.
- File explorer dibatasi pada worktree, menolak path traversal/symlink ke luar worktree, dan mengabaikan `.git`, `node_modules`, `dist`, dan folder build.
- Commit dari UI hanya commit lokal (belum push); pastikan konfigurasi user.name/user.email Git di host sudah benar.
- Hapus folder hanya diizinkan untuk folder kosong; belum ada recursive delete.
- Terminal adalah shell penuh; hanya berikan akses ke pengguna tepercaya.

## Test

```bash
npm test          # 6 test integrasi API
npm run verify    # typecheck + test + build + gate Chrome 93
npm run e2e:chrome93
```

Lihat [`docs/verification-m1.md`](docs/verification-m1.md) untuk hasil verifikasi terakhir.

## Batasan M1

Belum termasuk: Electron desktop, mobile, cloud relay, GitHub/Linear, editor kode, diff review, browser/design mode, SSH worktree, multi-user, terminal splits, dan persistensi PTY setelah runtime restart.

## Branch Lama

Aplikasi PRD sebelumnya disimpan di branch `legacy/prd-orchestrator` (commit `snapshot: legacy PRD orchestrator before Dorado rebuild`). Branch aktif `dorado` berisi implementasi baru.