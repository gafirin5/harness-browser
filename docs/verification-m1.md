# Verifikasi M1

Tanggal: 2026-11-05
Lingkungan: Ubuntu 24.04, Node.js 24.19.0, Chromium 93.0.4577.0, cloudflared 2026.10.1.

## Test API

```bash
npm test
```

Hasil: **51 test lulus** — auth/pairing, health check database + header keamanan, ganti password + cabut sesi lain + logout, project/branch, worktree create/delete + checkpoint, terminal create/list/input/delete, file tree/content/write + path traversal, git stage/commit/push/pull, git graph + detail commit, quick commands, komentar diff + resolve, riwayat sesi, hapus/purge sesi, transcript search, resume sesi dengan mock agent, info runtime, parsing remote GitHub (SSH/HTTPS/git), integrasi GitHub dengan remote non-GitHub (`connected:false`, `NOT_GITHUB`, aksi tulis ditolak), pencarian kode (match, case sensitivity, batas hasil, regex invalid), agent tidak dikenal, automations (CRUD + run manual + retry + zona waktu), multi-user & role (viewer read-only, admin menonaktifkan/mereset password viewer, proteksi admin terakhir), 2FA (setup QR, konfirmasi, login wajib kode, anti-replay, reset oleh admin), audit log (login/gagal login/user create + viewer ditolak), serta Orchestrator (provider + API key tidak bocor, agent token/hash + heartbeat, dispatch task, callback idempoten, biaya half-up `2500 × 0.0020 = 0.0050`, idempotency task, cancel/retry, dan kegagalan dispatcher).

Test frontend (Vitest + Testing Library + jsdom):

```bash
npm run test:web
```

Hasil: **50 test lulus** — CommandPalette, SettingsDialog, OrchestratorPanel, AuditDialog, InfoDialog, Modal, QuickOpenDialog, ShortcutsDialog, keyboard Ctrl+Enter, GitGraphPanel, AgentDashboard, QuickCommandsDialog, DiffViewer annotate, HistoryDialog, WorktreeCheckpoint, AutomationsDialog, MarkdownPreview, GitHubDialog write actions, preferensi/keymap terminal, dan keymap global.

## Gate Chrome 93

```bash
npm run verify
```

| Gate | Hasil |
|---|---|
| Typecheck shared/runtime/web | Lulus |
| ESLint (`--max-warnings=0`) | Lulus |
| Prettier (`--check`) | Lulus |
| Sintaks ES2020 | Lulus — semua chunk |
| API JS terlarang | Lulus |
| CSS terlarang | Lulus |
| Bundel JS awal | **144,6 KB gzip** (batas 150 KB) |
| Bundel total + editor & orchestrator lazy | **285,4 KB gzip** (batas 300 KB) |
| Test API | 51 lulus |
| Test frontend (Testing Library) | 50 lulus |
| Playwright E2E | 3 lulus |

## Smoke Chromium 93

Lokal dan melalui Cloudflare Quick Tunnel:

```bash
BASE_URL=http://127.0.0.1:7788 node scripts/e2e-chrome93.mjs
BASE_URL=https://<tunnel>.trycloudflare.com node scripts/e2e-chrome93.mjs
```

Alur yang diuji:

1. Login password → sidebar project.
2. Pilih project dan worktree, ubah checkpoint menjadi **In progress** dan simpan catatan lewat sidebar; verifikasi lewat API.
3. Buat terminal shell, ketik `echo chrome93-ok` lewat WebSocket, verifikasi output di xterm.
4. Buka **Tampilan**, ubah ukuran font terminal, simpan, verifikasi localStorage, lalu klik **Reset**.
5. Buat quick command `echo quick-command-e2e`, jalankan di terminal aktif, verifikasi output, lalu hapus.
6. Buka file `README.md` di CodeMirror, sunting, simpan dengan Ctrl+S, verifikasi isi file.
7. Toggle **Preview** markdown, verifikasi heading hasil edit, lalu kembali ke **Raw**.
8. Panel Changes menampilkan `README.md`; buka diff dan verifikasi baris hasil edit.
9. Tambah komentar inline pada baris diff, verifikasi tersimpan lewat API, resolve/reopen komentar, buka dialog kirim ke agent, lalu hapus komentar.
10. Buka dialog **Cari Kode**, cari `edited by chrome93`, klik hasil, dan verifikasi editor membuka file pada baris yang sesuai.
11. Stage `README.md`, buka modal commit, isi pesan, commit dengan **Ctrl+Enter**, dan verifikasi working tree bersih.
12. Buat terminal kedua dan ketiga, aktifkan multi-pane hingga 3 pane, lalu Unsplit.
13. Buka pencarian terminal dan cari teks, lalu tutup.
14. Buka dialog Info Runtime dan verifikasi data runtime.
15. Buka dialog GitHub pada worktree dengan remote non-GitHub dan verifikasi state "Remote bukan repository GitHub".
16. Buka command palette (`Ctrl+Shift+P`), cari perintah, lalu tutup dengan Escape.
17. Buka daftar shortcut (`Alt+/`), Jump Palette (`Alt+J`), dan Quick Open (`Alt+P`).
18. Buka Git Graph (`Alt+Shift+G`), verifikasi lane/commit, buka detail commit, lalu tutup.
19. Buka **Scheduled Automations**, buat otomasi manual, verifikasi lewat API, lalu hapus.
20. Buat dan rename file lewat file explorer.
21. Buka **Orchestrator**, buat provider lewat form UI, daftarkan agent lewat API, jalankan mock worker, buat task, dan verifikasi task berubah `COMPLETED` dengan biaya `$0.0050`; buka detail task dan konfirmasi log "Task selesai".
22. Buka **Setelan**, cabut sesi lain, verifikasi toast sukses dan sesi browser tetap aktif.
23. Buka dialog riwayat sesi dan verifikasi scope/grup/filter serta pencarian transcript.
24. Buka **Agent Dashboard / Inbox**, verifikasi kolom board dan tab inbox.
25. Buka dialog Share dan buat pairing token.
26. Buka pairing URL di incognito context → auto-login.
27. Nol error konsol/pageerror.

Git push/pull divalidasi melalui test API dengan remote bare lokal; tombol UI tersedia di panel Changes.

## Backup, Restore, dan Performa

Backup SQLite (`VACUUM INTO` + `PRAGMA integrity_check`):

```bash
DATA_DIR=/tmp/dorado-ops BACKUP_DIR=/tmp/dorado-backups npm run backup
PORT=7799 DATA_DIR=/tmp/dorado-restore node scripts/restore.mjs /tmp/dorado-backups/dorado-*.db
```

Hasil uji: backup 200 task / 2.000 log berhasil, restore ke direktori bersih menghasilkan 200 task dan 2.000 log, integrity check `ok`.

Seed performa:

```bash
DATA_DIR=/tmp/dorado-perf node scripts/seed-perf.mjs --tasks=10000 --logs=100000
```

Hasil: seed **10.000 task + 100.000 log dalam ±1,2 detik**. Pengukuran endpoint pada runtime lokal:

| Endpoint | Waktu |
|---|---|
| `GET /api/orchestrator/summary` | ±57 ms |
| `GET /api/orchestrator/tasks?page=1` | ±9 ms |
| `GET /api/orchestrator/tasks?page=500` | ±25 ms |
| `GET /api/orchestrator/tasks?status=FAILED` | ±5 ms |
| `GET /api/orchestrator/tasks/1/logs?limit=100` | ±2 ms |

Angka ini pengukuran lokal, bukan benchmark produksi.

Persistensi terminal divalidasi manual: setelah runtime di-restart, sesi tmux tetap hidup, browser attach kembali, dan perintah `echo survived-restart` berhasil dijalankan di sesi yang sama tanpa ada gibberish terminal.

WebSocket berjalan melalui Cloudflare Quick Tunnel; terminal tetap interaktif.

## Playwright

```bash
npm run test:e2e:playwright
```

Hasil: **3 test lulus** di Chrome sistem — login, command palette, panel Orchestrator, dialog Setelan, dialog Audit Log, validasi form ganti password, serta admin membuat viewer dan login viewer dalam mode read-only. Playwright memakai `channel: chrome`/`CHROME_BIN` sehingga tidak mengunduh browser tambahan; gate Chromium 93 tetap dijalankan oleh script Puppeteer.

## Batasan yang Diketahui

- Sesi tmux tidak bertahan setelah host reboot (hanya runtime restart).
- Log terminal berupa file append-only tanpa rotasi otomatis.
- Integrasi GitHub write (komentar/review/merge) membutuhkan `GITHUB_TOKEN` dengan scope write; tanpa token, aksi tulis ditolak dengan pesan yang jelas dan tetap bergantung pada rate limit GitHub.
- Markdown preview belum mendukung Mermaid/diagram; renderer sengaja dibuat ringan agar bundel tetap kecil. Gambar relatif dilayani lewat `/api/files/raw` (hanya tipe gambar, maksimal 10 MB).
- Pull request/issue GitHub pada UI belum menampilkan daftar komentar atau review yang sudah ada.
- Scheduler automations masih in-process; retry memakai jeda 5 menit maksimal 2 kali dan hanya berlaku untuk run terjadwal.
- Pencarian kode mengikuti `.gitignore`; fallback `git grep` hanya mencari file tracked dan hasil dibatasi 100 match.
- Orchestrator memakai satu admin; worker agent harus dapat dijangkau runtime, dan `AGENT_KEY_DELIVERY=payload` mengirim API key provider ke worker. Gunakan HTTPS/trusted network atau set `none`.
- UI Orchestrator saat ini mendukung create provider/agent, toggle aktif, rotasi token, create/cancel/retry task; edit detail provider/agent belum disediakan.
- Auth mendukung dua role (`ADMIN`/`VIEWER`) dan 2FA TOTP, tetapi belum ada grup/team atau audit log khusus perubahan user. Password admin pertama di-seed dari `ADMIN_PASSWORD` saat database kosong.
- Login lewat **pairing token** tidak meminta kode TOTP; pairing token diperlakukan sebagai kredensial alternatif dan hanya bisa dibuat admin.
- Audit log disimpan tanpa rotasi otomatis; ukuran tumbuh seiring aktivitas. Backup SQLite mencakup tabel ini.
- Belum ada Electron, mobile, cloud relay, Linear, browser/design mode, SSH worktree, atau multi-user.
- Quick tunnel bersifat sementara dan URL berubah saat proses dijalankan ulang.
- Pairing token memberi akses shell penuh; cabut token yang tidak dipakai.