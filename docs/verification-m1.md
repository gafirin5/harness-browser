# Verifikasi M1

Tanggal: 2026-11-03
Lingkungan: Ubuntu 24.04, Node.js 24.19.0, Chromium 93.0.4577.0, cloudflared 2026.10.1.

## Test API

```bash
npm test
```

Hasil: **8 test lulus** — auth/pairing, project/branch, worktree create/delete, terminal create/list/delete, file tree/content/write + path traversal, git stage/commit/push/pull, riwayat sesi, resume sesi dengan mock agent, agent tidak dikenal.

## Gate Chrome 93

```bash
npm run verify
```

| Gate | Hasil |
|---|---|
| Typecheck shared/runtime/web | Lulus |
| Sintaks ES2020 | Lulus — 3 file |
| API JS terlarang | Lulus |
| CSS terlarang | Lulus |
| Bundel JS awal | **129,4 KB gzip** (batas 150 KB) |
| Bundel total + editor lazy | **232,0 KB gzip** (batas 300 KB) |
| Test API | 8 lulus |

## Smoke Chromium 93

Lokal dan melalui Cloudflare Quick Tunnel:

```bash
BASE_URL=http://127.0.0.1:7788 node scripts/e2e-chrome93.mjs
BASE_URL=https://<tunnel>.trycloudflare.com node scripts/e2e-chrome93.mjs
```

Alur yang diuji:

1. Login password → sidebar project.
2. Pilih project dan worktree.
3. Buat terminal shell, ketik `echo chrome93-ok` lewat WebSocket, verifikasi output di xterm.
4. Buka file `README.md` di CodeMirror, sunting, simpan dengan Ctrl+S, verifikasi isi file.
5. Panel Changes menampilkan `README.md`; buka diff dan verifikasi baris hasil edit.
6. Stage `README.md`, buka modal commit, isi pesan, commit, dan verifikasi working tree bersih.
7. Buat terminal kedua dan ketiga, aktifkan multi-pane hingga 3 pane, lalu Unsplit.
8. Buat, rename, dan hapus file lewat file explorer.
9. Buka command palette (`Ctrl+Shift+P`), cari perintah, lalu tutup dengan Escape.
10. Buka dialog riwayat sesi dan verifikasi pencarian/filter.
11. Buka dialog Share dan buat pairing token.
12. Buka pairing URL di incognito context → auto-login.
13. Nol error konsol/pageerror.

Git push/pull divalidasi melalui test API dengan remote bare lokal; tombol UI tersedia di panel Changes.

Replay log terminal setelah restart divalidasi manual: terminal menampilkan `persisted-ok` setelah runtime di-restart, dan tombol Restart memulihkan shell.

WebSocket berjalan melalui Cloudflare Quick Tunnel; terminal tetap interaktif.

## Batasan yang Diketahui

- PTY tidak bertahan setelah runtime restart; terminal/sesi lama ditandai exited/failed.
- Log terminal berupa file append-only tanpa rotasi otomatis.
- Belum ada Electron, mobile, cloud relay, editor, diff review, GitHub/Linear, SSH, atau terminal split.
- Quick tunnel bersifat sementara dan URL berubah saat proses dijalankan ulang.
- Pairing token memberi akses shell penuh; cabut token yang tidak dipakai.