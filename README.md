# Dorado

Dorado adalah **agent workspace berbasis web** yang terinspirasi Orca: kelola project Git, buat worktree paralel, buka terminal PTY, dan jalankan agent CLI — semuanya dari browser. Fokus M1 adalah web + runtime + quick tunnel, dengan target kompatibilitas **Chromium 93**.

Ini adalah implementasi clean-room. Tidak ada kode/aset dari `stablyai/orca` yang disalin.

## Fitur M1

- Login multi-user (`ADMIN`/`VIEWER`) dengan password bcrypt + sesi server-side, plus **pairing token** untuk akses browser lain.
- **2FA TOTP**: aktifkan lewat QR authenticator, wajibkan kode 6 digit saat login, dan reset 2FA oleh admin.
- **Audit log**: riwayat login/gagal login, logout, perubahan password, 2FA, user management, dan pairing token (admin saja).
- **Pengaturan keamanan**: ganti password, cabut sesi browser lain, kelola user, dan atur 2FA. Viewer bersifat read-only.
- Tambah project dari path repository Git lokal, dengan **penemuan otomatis**: pindai folder proyek untuk mendeteksi repository Git, pilih lewat daftar + autocomplete, atau ketik path manual.
- Daftar branch dan pembuatan **git worktree** paralel.
- **Terminal PTY** per worktree dengan xterm.js, resize, replay buffer, dan reconnect.
- **Sesi agent** dengan adapter CLI multi-agent: preset bawaan untuk OpenCode, Claude Code, OpenAI Codex, Gemini CLI, Qwen Code, Aider, Cursor Agent, Crush, Factory Droid, Goose, Amp, GitHub Copilot CLI, dan Kilo Code — plus dialog **Kelola Agent** untuk menambah/mengubah agent kustom (command, args, resume args).
- **Worktree Racing**: jalankan satu prompt di 2–4 agent pada worktree terisolasi, bandingkan diff (file/+/-), lalu merge pemenang ke base branch dalam satu klik dan bersihkan worktree yang kalah.
- **Sub-agent CLI (`dorado-ctl`)**: agent yang berjalan di terminal bisa memunculkan sub-agent di worktree terisolasi dan memantau status/diff-nya (env `DORADO_*` + `PATH` disuntik otomatis, cap konkurensi per sesi).
- **Triage CI & Issue**: perbaiki kegagalan GitHub Actions otomatis (ambil log gagal + umpan balik review → prompt agent), dan buat worktree dari issue **GitHub/Linear** dalam satu klik (Linear key disimpan terenkripsi).
- **Multimodal & Profil**: lampirkan gambar/file (tombol 📎, drag-drop, atau tempel) yang disimpan di `.dorado-attachments/` worktree + dikirim sebagai `@path` ke agent; **dikte suara** ke terminal (Web Speech API, Chrome 93); **profil agent** (env/akun berganti) dengan badge cooldown otomatis saat terdeteksi rate-limit.
- **Live Preview & Design Mode**: pratinjau app yang jalan di worktree lewat reverse-proxy (`/api/preview/:worktreeId/:port`), deteksi port otomatis, dan **pengambil elemen DOM** (klik elemen → kirim selector + computed styles + HTML ke terminal agent). Proxy hanya 127.0.0.1 (GET/HEAD), menolak port runtime.
- **Mobile Companion**: tata letak responsif (`≤768px`) dengan bottom-nav (Project/Inbox/Aksi/Preview) dan sidebar sebagai overlay — nyaman diakses lewat tunnel dari ponsel.
- **Tema & Tampilan**: 6 skin warna (Dorado Gold, Orca Dark, Tokyo Night, Catppuccin, Matrix Term, Daylight Frost) lewat **Tampilan & Tema**; preferensi per-user tersimpan di perangkat + server (`/api/user/preferences`), palet terminal ikut menyesuaikan.
- **Plugin & Tema Kustom**: pasang tema/plugin dari `DATA_DIR/plugins` (admin) lewat Appearance Studio; CSS dimuat dinamis via `/api/plugins/styles.css` (tersanitasi, **0 KB tambahan** ke bundle web).
- **AI Draft commit**: tombol **✨ Draft AI** di dialog Commit menyusun judul + isi commit dari perubahan (tipe/scope terdeteksi otomatis; deterministik, tanpa perlu LLM).
- **Dual-View Chat/CLI**: tombol **Chat | CLI** di terminal agent — tampilan transkrip rapi (`parseChatBlocks`, buang ANSI) + tombol persetujuan **y/n** saat terdeteksi prompt; xterm tetap ter-mount sehingga kembali ke CLI tanpa kehilangan scrollback.
- **Pratinjau File & Anotasi**: pratinjau **CSV/TSV** (tabel sticky-header), **JSON**, **gambar**, dan **PDF** (`GET /api/files/preview`); **anotasi gambar** (kotak/pena/panah/teks + undo) di HTML5 canvas → unggah PNG & kirim `@path` ke agent.
- **Browser & SSH Forwarding (`dorado-browser`)**: CLI di dalam terminal agent untuk `inspect` (fetch struktur halaman) dan `screenshot` (Chrome headless sistem) — PNG diunggah ke worktree via `/api/agent/attachments`. **Tunnel SSH** (dialog **SSH Tunnel**, admin) memforward port remote ke `127.0.0.1` lokal (start/stop/restart) dan otomatis tampil di daftar port Live Preview.
- **File explorer** dengan buat/rename/hapus, plus editor CodeMirror 5: line numbers, syntax highlighting, lazy-loaded (maksimal 1 MB, proteksi path/symlink).
- Tab terpadu untuk terminal, file, dan diff; indikator file belum disimpan dan Ctrl+S.
- **Multi-pane terminal** hingga empat pane, dengan pemilih terminal per pane.
- **Source control**: status Git per worktree, daftar perubahan, diff staged/unstaged, stage/unstage, commit lokal, serta pull/push ke remote.
- **Riwayat sesi agent**: pencarian judul/prompt, filter status, detail, dan rerun.
- **Pencarian terminal** (`Find` atau `Ctrl+F`) dengan navigasi hasil.
- **Pencarian kode worktree** (`Ctrl+Shift+F` atau tombol **Cari**): ripgrep dengan fallback `git grep`, filter case-sensitive/regex, dan klik hasil untuk melompat ke baris di editor.
- **Notifikasi sesi** saat agent selesai/gagal + penanda unread di sidebar dan judul tab.
- **Info Runtime**: versi, Node, tmux, data directory, agent CLI, jumlah data, dan tombol **Salin Ringkasan**.
- **Integrasi GitHub read-only**: info repository, pull request, dan issue per worktree; link keluar ke GitHub, caching 60 detik, token opsional.
- **Orchestrator terintegrasi**: dashboard realtime (SSE + fallback polling), provider LLM dengan API key terenkripsi, agent worker dengan token/heartbeat, antrean task berprioritas, dispatcher, callback worker, cancel/retry, log, dan perhitungan biaya.
- **Command palette** (`Ctrl+Shift+P` atau `Ctrl+K`): terminal, agent, worktree, split, orchestrator, search, refresh, history, github, info, kelola agent, settings, share.
- **Quick Open** (`Alt+P`) untuk melompat ke file berdasarkan nama, dan **Jump Palette** (`Alt+J`) untuk pindah cepat antar project, worktree, terminal, file, dan diff.
- **Shortcut keyboard** (`Alt+/` untuk daftar lengkap): shortcut global bisa di-remap dari dialog, mendeteksi konflik, plus **Ctrl+Enter** untuk submit form/dialog mana pun.
- **Sesi agent interaktif tanpa prompt awal**: buka agent lalu ketik instruksi langsung di terminal agent.
- **Git Graph** (`Alt+Shift+G` atau tombol **Graph** di project): riwayat commit project dengan lane graph, ref branch/tag, detail commit, dan daftar file yang berubah.
- **Quick Commands**: simpan perintah global/project, lalu jalankan di terminal aktif, salin, edit, atau hapus dari dialog **Commands**.
- **Agent Dashboard / Inbox**: papan **Needs You / Working / Done / Idle**, filter project, buka atau resume sesi, serta inbox notifikasi sesi dan kegagalan automation dengan status belum dibaca yang tersimpan per user di server.
- **Annotate Diff**: komentar inline per baris diff yang tersimpan di runtime, resolve/reopen, lalu kirim batch komentar dari satu atau beberapa file ke agent sebagai prompt review.
- **Session History++**: scope worktree/project/semua, filter status/agent, grup project/agent, detail CWD dan prompt pertama, salin session ID/resume command, restart sesi, hapus sesi/terminal agent, hapus massal sesi nonaktif, dan pencarian transcript dari log terminal.
- **Worktree Checkpoints**: status **Todo / In progress / In review / Completed** dan catatan per worktree, bisa diubah dari sidebar, API admin, atau oleh agent lewat token sesi (`PATCH /api/agent/worktree`).
- **Markdown Preview**: toggle **Preview/Raw** untuk file `.md` dengan heading, list, tabel, diagram alir Mermaid bawaan (flowchart/graph), gambar (termasuk path relatif), link aman, dan daftar isi otomatis (renderer lazy-loaded).
- **Scheduled Automations**: buat prompt agent berjadwal (manual, preset 5m–24h, atau cron sederhana), aktif/nonaktif, run now, riwayat eksekusi, zona waktu `APP_TIMEZONE`, retry otomatis saat gagal, dan lock scheduler untuk mencegah run ganda.
- **GitHub write actions**: komentar PR/issue, review **Comment/Approve/Request changes**, merge, tutup issue/PR, atur label, dan lihat diskusi/review dari dialog GitHub (butuh `GITHUB_TOKEN` dengan scope write).
- **Terminal polish**: link HTTP(S) bisa diklik, salin seleksi lewat context menu atau keymap, reset terminal, serta tema/font/ukuran dan keymap cari/salin yang tersimpan di localStorage.
- **Remote Nodes Federation** (`Alt+N` atau tombol **Nodes** di topbar): kendalikan mesin/server Dorado lain dari satu Controller via koneksi reverse WebSocket aman (tembus NAT/Firewall), monitoring status online dan latensi realtime, pendaftaran node one-liner, rotasi token, dan dropdown node switcher di sidebar. Node (sisi yang dikendalikan) juga **melihat controller-nya**: identitas controller (nama, URL, versi, id instance) tampil di console node dan lewat `npm run node:status`.
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
# Daftar root (pisah koma) untuk pemindaian repository; kosongkan untuk memakai HOME
PROJECT_SCAN_ROOTS=
```

Data runtime (SQLite, log terminal, worktree) disimpan di `DATA_DIR`. Untuk production, gunakan path di luar repository, misalnya `/var/lib/dorado`.

Penemuan repository memindai `PROJECT_SCAN_ROOTS` (pisah koma) secara rekursif (kedalaman terbatas) dan melewati folder seperti `node_modules`, `.venv`, `dist`, `build`, dan `.cache`. Bila kosong, pemindaian dimulai dari `$HOME`.

## Mode Pengembangan

```bash
npm run dev
```

- Runtime: `http://127.0.0.1:7788`
- Vite: `http://127.0.0.1:5174` (proxy `/api` dan `/ws` ke runtime)

## Alur Dasar

1. Login dengan username (default `admin`) dan password.
2. **+** di sidebar → klik **Pindai Repository** untuk mendeteksi repo Git secara otomatis (atau ketik path manual).
3. **+ Worktree** → tentukan branch baru dan base ref.
4. **+ Terminal** → shell interaktif di worktree.
5. **Jalankan Agent** → pilih agent CLI (lihat di bawah), lalu agent berjalan di PTY worktree.
6. **Share** → buat pairing token/URL untuk browser lain.

## Agent CLI

Dorado mengenali beberapa agent CLI sekaligus dan menampilkan status **terpasang/tidak** otomatis (berdasarkan `command`). Preset bawaan: OpenCode, Claude Code, OpenAI Codex, Gemini CLI, Qwen Code, Aider, Cursor Agent, Crush, Factory Droid, Goose, Amp, GitHub Copilot CLI, dan Kilo Code.

Setiap preset memiliki tiga mode: **run** (non-interaktif dengan `{{prompt}}`), **resume** (lanjutkan sesi terakhir), dan **interactive** (dibuka tanpa prompt). Dari UI, sesi agent dibuka secara interaktif; mode run/resume dipakai oleh automasi dan tombol **Lanjutkan**.

Kelola agent lewat dialog **Kelola Agent** (command palette "Kelola Agent" atau tombol di Info Runtime), atau lewat env `DORADO_AGENTS`:

```bash
# Tambah agent baru atau override preset dengan id yang sama.
DORADO_AGENTS=[{"id":"my-agent","name":"My Agent","command":"my-agent","args":["run","{{prompt}}"],"resumeArgs":["run","--continue","{{prompt}}"],"interactiveArgs":[]}]
```

Urutan prioritas saat `id` sama: **preset < `DORADO_AGENTS` < agent kustom (dialog)**. Hapus agent kustom untuk kembali ke preset.

> Flag auto-approve (mis. `--yes-always`, `--auto`, `--dangerously-skip-permissions`, `--full-auto`) tidak dipasang default demi keamanan. Tambahkan sendiri lewat `DORADO_AGENTS` atau dialog Kelola Agent bila automation perlu berjalan tanpa konfirmasi.

## Quick Tunnel

```bash
npm run tunnel
```

Script mencetak URL `https://<acak>.trycloudflare.com` dan menulis `.dorado-tunnel.json`. Setelah URL didapat, restart runtime dengan origin tersebut:

```bash
PUBLIC_BASE_URL=https://<acak>.trycloudflare.com node apps/runtime/dist/server.js
```

Pairing URL yang dibuat setelah restart akan memakai domain tunnel. WebSocket juga berjalan melalui tunnel, sehingga terminal tetap interaktif.

> URL quick tunnel **berubah tiap `cloudflared` di-restart** (tapi tetap selama prosesnya hidup). Untuk hostname permanen, pakai **named tunnel** (butuh domain Cloudflare): lihat [`docs/tunnel.md`](docs/tunnel.md) — `npm run tunnel:setup -- dorado.domainku.com` + `npm run tunnel:named`, lalu set `PUBLIC_BASE_URL=https://dorado.domainku.com`.

Runtime menerima request tulis dari **origin apa pun yang sama dengan Host request** (Host + `X-Forwarded-Proto`), jadi pergantian URL tunnel/domain tidak memutus akses tulis. Cross-site tetap ditolak (403). Origin tambahan bisa didaftarkan via `ALLOWED_ORIGINS`.

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

## Remote Nodes

Controller mengendalikan mesin Dorado lain lewat koneksi **reverse WebSocket** (tembus NAT/Firewall). Buka **Nodes** (`Alt+N`) → buat node → salin perintah one-liner, contoh:

```bash
DORADO_CONTROLLER_URL="wss://<controller>/ws/nodes/connect" \
DORADO_NODE_TOKEN="dnode_..." \
npm run node
```

Saat terhubung, node menampilkan **controller yang mengendalikannya** di console:

```
[dorado-node] Controller: Kantor Jakarta (https://…trycloudflare.com) v0.1.0 id=ctrl_… host=…
```

Cek kapan saja lewat perintah status (membaca state file `~/.dorado-node/state.json`, dapat diubah via `DORADO_NODE_STATE_FILE`):

```bash
npm run node:status
```

Identitas controller (nama + URL + versi + id instance) dikirim controller pada saat handshake `node.hello`; id instance disimpan stabil di tabel `settings`. Nama controller diatur lewat env `CONTROLLER_NAME` (default: hostname).

## Pembaruan

Dorado bisa memperbarui dirinya **in-place** dari checkout git (tanpa clone ulang):

```bash
npm run update
```

Perintah ini: `git fetch` → `git merge --ff-only origin/<branch>` → `npm ci` → `npm run build`, lalu **restart otomatis** (lihat di bawah). Setelah update, versi baru langsung aktif.

Dari UI: **Setelan**-dari-Info Runtime atau command palette **Pembaruan Sistem** (admin) — cek commit baru dan tombol **Update Sekarang**, lengkap dengan log.

Restart setelah update:
- Bila `UPDATE_RESTART_CMD` di-set (mis. `systemctl restart dorado`) → menjalankan perintah itu.
- Bila kosong → runtime **re-exec prosesnya sendiri** (detached), sesi tmux/terminal tetap hidup.

Konfigurasi: `UPDATE_ENABLED`, `UPDATE_MODE=git`, `UPDATE_BRANCH` (default `dorado`), `UPDATE_REMOTE` (default `origin`), `UPDATE_RESTART_CMD`. Update ditolak bila working tree kotor; `npm run update` dan endpoint `/api/update` hanya untuk **admin**.

## Penanda Versi & Rilis

Setiap build meninggalkan **penanda versi** (`apps/runtime/dist/build-info.json`): versi, commit, tag, dan waktu build.

```bash
npm run version:show   # tampilkan penanda versi terpasang
npm run update         # git fetch + ff-merge + build + restart
```

Saat memakai git tag (semver), rilis baru dibuat dengan:

```bash
npm run release -- patch     # atau minor | major | 0.2.0 [--push]
```

Perintah ini: bump versi (root + workspace), perbarui `CHANGELOG.md`, commit
`chore(release): vX.Y.Z`, lalu tag `vX.Y.Z` (dan push bila `--push`).

Versi terpasang ditampilkan di **Info Runtime** dan dialog **Pembaruan Sistem**,
termasuk **Riwayat Pembaruan** (`DATA_DIR/update-history.jsonl`). Rollback darurat:
`git checkout vX.Y.Z && npm ci && npm run build`.

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
- Password user di-hash dengan **bcrypt** dan disimpan di database; admin pertama di-seed dari `ADMIN_PASSWORD` dengan username `admin`.
- Role: **ADMIN** dapat melakukan semua aksi; **VIEWER** hanya bisa membaca (mutasi HTTP ditolak 403 dan input terminal dinonaktifkan).
- User management hanya untuk admin; aksi menonaktifkan/menurunkan admin terakhir ditolak.
- **2FA TOTP** opsional per user: secret disimpan terenkripsi, kode diverifikasi dengan window 1 langkah, dan kode yang sudah dipakai ditolak (anti-replay).
- **Audit log** menyimpan aktor, aksi, target, detail, IP, dan waktu; hanya admin yang dapat membacanya. Password, token, dan secret tidak dicatat.
- Sesi disimpan server-side sebagai hash token: idle **8 jam**, maksimal **24 jam**, dapat dicabut, dan otomatis dibersihkan setelah 7 hari.
- Ganti password mencabut semua sesi lain; tersedia juga tombol **Cabut Sesi Lain**.
- Pairing token 32 byte, disimpan sebagai SHA-256, dapat dicabut, dan memiliki masa berlaku.
- Cookie HttpOnly + SameSite=Lax; `Secure` otomatis bila `PUBLIC_BASE_URL` HTTPS.
- Origin check untuk request mutasi dan WebSocket. Selain `PUBLIC_BASE_URL` dan varian localhost, origin tambahan dapat didaftarkan lewat `ALLOWED_ORIGINS` (pisah koma), mis. saat memakai URL tunnel.
- Rate limit: login 15/menit/IP, API umum 300/menit/IP, callback agent 120/menit/agent.
- `/api/health` mengecek database dan mengembalikan 503 bila SQLite tidak siap.
- Header keamanan: CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, dan `Permissions-Policy`.
- Path worktree divalidasi agar tidak keluar dari data directory.
- File explorer dibatasi pada worktree, menolak path traversal/symlink ke luar worktree, dan mengabaikan `.git`, `node_modules`, `dist`, dan folder build.
- Commit/push dari UI memakai remote pertama (utamakan `origin`); pull memakai `--ff-only`. Pastikan user.name/user.email dan kredensial Git host sudah benar.
- Hapus folder kosong langsung; folder tidak kosong memerlukan konfirmasi **hapus rekursif** (`?recursive=1`). Path yang diabaikan (`.git`, `node_modules`, `dist`, dll.) tetap ditolak.
- Pencarian kode dijalankan tanpa shell, memakai `rg`/`git grep` dengan argumen terpisah, mengikuti `.gitignore`, dan membatasi hasil agar payload tetap kecil.
- Terminal adalah shell penuh; hanya berikan akses ke pengguna tepercaya.

## Test

```bash
npm test                 # 60 test backend (API/integrasi) + 59 test frontend (Testing Library)
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

Belum termasuk: Electron desktop, mobile, cloud relay, Linear, browser/design mode, SSH worktree, dan multi-tenant. Pencarian kode mengikuti `.gitignore`; file ignored/untracked tidak ikut dicari saat memakai fallback `git grep`.

Orchestrator memakai satu admin, worker agent harus dapat dijangkau dari runtime, dan `AGENT_KEY_DELIVERY=payload` mengirim API key provider ke worker (gunakan HTTPS/trusted network atau ubah ke `none`). Arsip otomatis setelah satu tahun belum termasuk MVP.

## Branch Lama

Aplikasi Orca Orchestrator sebelumnya disimpan di branch `gafirin5/dorado` (commit `7c40ab4`, `snapshot: legacy PRD orchestrator before Dorado rebuild`). Branch aktif `dorado` sekarang menggabungkan workspace Dorado dengan modul Orchestrator di satu aplikasi.