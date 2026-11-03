# Verifikasi M1

Tanggal: 2026-11-03
Lingkungan: Ubuntu 24.04, Node.js 24.19.0, Chromium 93.0.4577.0, cloudflared 2026.10.1.

## Test API

```bash
npm test
```

Hasil: **12 test lulus** — auth/pairing, project/branch, worktree create/delete, terminal create/list/delete, file tree/content/write + path traversal, git stage/commit/push/pull, riwayat sesi, resume sesi dengan mock agent, info runtime, parsing remote GitHub (SSH/HTTPS/git), integrasi GitHub dengan remote non-GitHub (`connected:false`, `NOT_GITHUB`), dan agent tidak dikenal.

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
| Bundel JS awal | **135,2 KB gzip** (batas 150 KB) |
| Bundel total + editor lazy | **237,8 KB gzip** (batas 300 KB) |
| Test API | 12 lulus |

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
8. Buka pencarian terminal dan cari teks, lalu tutup.
9. Buka dialog Info Runtime dan verifikasi data runtime.
10. Buka dialog GitHub pada worktree dengan remote non-GitHub dan verifikasi state "Remote bukan repository GitHub".
11. Buat dan rename file lewat file explorer.
12. Buka command palette (`Ctrl+Shift+P`), cari perintah, lalu tutup dengan Escape.
13. Buka dialog riwayat sesi dan verifikasi pencarian/filter.
14. Buka dialog Share dan buat pairing token.
15. Buka pairing URL di incognito context → auto-login.
16. Nol error konsol/pageerror.

Git push/pull divalidasi melalui test API dengan remote bare lokal; tombol UI tersedia di panel Changes.

Persistensi terminal divalidasi manual: setelah runtime di-restart, sesi tmux tetap hidup, browser attach kembali, dan perintah `echo survived-restart` berhasil dijalankan di sesi yang sama tanpa ada gibberish terminal.

WebSocket berjalan melalui Cloudflare Quick Tunnel; terminal tetap interaktif.

## Batasan yang Diketahui

- Sesi tmux tidak bertahan setelah host reboot (hanya runtime restart).
- Log terminal berupa file append-only tanpa rotasi otomatis.
- Integrasi GitHub read-only; belum ada komentar, review, atau merge dari UI, dan bergantung pada rate limit/token GitHub.
- Belum ada Electron, mobile, cloud relay, Linear, browser/design mode, SSH worktree, atau multi-user.
- Quick tunnel bersifat sementara dan URL berubah saat proses dijalankan ulang.
- Pairing token memberi akses shell penuh; cabut token yang tidak dipakai.