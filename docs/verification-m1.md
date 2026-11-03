# Verifikasi M1

Tanggal: 2026-11-03
Lingkungan: Ubuntu 24.04, Node.js 24.19.0, Chromium 93.0.4577.0, cloudflared 2026.10.1.

## Test API

```bash
npm test
```

Hasil: **6 test lulus** — auth/pairing, project/branch, worktree create/delete, terminal create/list/delete, file tree/content/write + path traversal, agent tidak dikenal.

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
| Bundel JS | **123,6 KB gzip** (batas 150 KB) |
| Test API | 6 lulus |

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
4. Buka file `README.md` di file explorer, sunting, simpan dengan Ctrl+S, verifikasi isi file.
5. Buka dialog Share dan buat pairing token.
6. Buka pairing URL di incognito context → auto-login.
7. Nol error konsol/pageerror.

WebSocket berjalan melalui Cloudflare Quick Tunnel; terminal tetap interaktif.

## Batasan yang Diketahui

- PTY tidak bertahan setelah runtime restart; terminal/sesi lama ditandai exited/failed.
- Log terminal berupa file append-only tanpa rotasi otomatis.
- Belum ada Electron, mobile, cloud relay, editor, diff review, GitHub/Linear, SSH, atau terminal split.
- Quick tunnel bersifat sementara dan URL berubah saat proses dijalankan ulang.
- Pairing token memberi akses shell penuh; cabut token yang tidak dipakai.