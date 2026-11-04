# Verifikasi M1

Tanggal: 2026-11-04
Lingkungan: Ubuntu 24.04, Node.js 24.19.0, Chromium 93.0.4577.0, cloudflared 2026.10.1.

## Test API

```bash
npm test
```

Hasil: **19 test lulus** — auth/pairing, project/branch, worktree create/delete, terminal create/list/delete, file tree/content/write + path traversal, git stage/commit/push/pull, riwayat sesi, resume sesi dengan mock agent, info runtime, parsing remote GitHub (SSH/HTTPS/git), integrasi GitHub dengan remote non-GitHub (`connected:false`, `NOT_GITHUB`), pencarian kode (match, case sensitivity, batas hasil, regex invalid), agent tidak dikenal, serta Orchestrator (provider + API key tidak bocor, agent token/hash + heartbeat, dispatch task, callback idempoten, biaya half-up `2500 × 0.0020 = 0.0050`, idempotency task, cancel/retry, dan kegagalan dispatcher).

## Gate Chrome 93

```bash
npm run verify
```

| Gate | Hasil |
|---|---|
| Typecheck shared/runtime/web | Lulus |
| Sintaks ES2020 | Lulus — semua chunk |
| API JS terlarang | Lulus |
| CSS terlarang | Lulus |
| Bundel JS awal | **136,6 KB gzip** (batas 150 KB) |
| Bundel total + editor & orchestrator lazy | **257,7 KB gzip** (batas 300 KB) |
| Test API | 19 lulus |

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
6. Buka dialog **Cari Kode**, cari `edited by chrome93`, klik hasil, dan verifikasi editor membuka file pada baris yang sesuai.
7. Stage `README.md`, buka modal commit, isi pesan, commit, dan verifikasi working tree bersih.
8. Buat terminal kedua dan ketiga, aktifkan multi-pane hingga 3 pane, lalu Unsplit.
9. Buka pencarian terminal dan cari teks, lalu tutup.
10. Buka dialog Info Runtime dan verifikasi data runtime.
11. Buka dialog GitHub pada worktree dengan remote non-GitHub dan verifikasi state "Remote bukan repository GitHub".
12. Buat dan rename file lewat file explorer.
13. Buka **Orchestrator**, buat provider lewat form UI, daftarkan agent lewat API, jalankan mock worker, buat task, dan verifikasi task berubah `COMPLETED` dengan biaya `$0.0050`; buka detail task dan konfirmasi log "Task selesai".
14. Buka command palette (`Ctrl+Shift+P`), cari perintah, lalu tutup dengan Escape.
15. Buka dialog riwayat sesi dan verifikasi pencarian/filter.
16. Buka dialog Share dan buat pairing token.
17. Buka pairing URL di incognito context → auto-login.
18. Nol error konsol/pageerror.

Git push/pull divalidasi melalui test API dengan remote bare lokal; tombol UI tersedia di panel Changes.

Persistensi terminal divalidasi manual: setelah runtime di-restart, sesi tmux tetap hidup, browser attach kembali, dan perintah `echo survived-restart` berhasil dijalankan di sesi yang sama tanpa ada gibberish terminal.

WebSocket berjalan melalui Cloudflare Quick Tunnel; terminal tetap interaktif.

## Batasan yang Diketahui

- Sesi tmux tidak bertahan setelah host reboot (hanya runtime restart).
- Log terminal berupa file append-only tanpa rotasi otomatis.
- Integrasi GitHub read-only; belum ada komentar, review, atau merge dari UI, dan bergantung pada rate limit/token GitHub.
- Pencarian kode mengikuti `.gitignore`; fallback `git grep` hanya mencari file tracked dan hasil dibatasi 100 match.
- Orchestrator memakai satu admin; worker agent harus dapat dijangkau runtime, dan `AGENT_KEY_DELIVERY=payload` mengirim API key provider ke worker. Gunakan HTTPS/trusted network atau set `none`.
- UI Orchestrator saat ini mendukung create provider/agent, toggle aktif, rotasi token, create/cancel/retry task; edit detail provider/agent belum disediakan.
- Belum ada Electron, mobile, cloud relay, Linear, browser/design mode, SSH worktree, atau multi-user.
- Quick tunnel bersifat sementara dan URL berubah saat proses dijalankan ulang.
- Pairing token memberi akses shell penuh; cabut token yang tidak dipakai.