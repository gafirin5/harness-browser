# Dogfooding: Mengembangkan Dorado dengan Dorado

Dokumen ini dibuat dan disunting melalui **API file Dorado**, bukan dengan editor eksternal.

- Project: `Dorado Self-Host`
- Branch: `agent/dogfood-selfhost`
- Worktree ID: `e54f8b8e5aa04d078ca94093`
- Tanggal: 2026-11-04

## Tujuan

Menguji apakah Dorado dapat dipakai untuk mengembangkan codebase-nya sendiri:

1. membuat project dari repository Dorado,
2. membuat git worktree melalui API Dorado,
3. membuat dan menyunting file melalui file API,
4. menjalankan perintah melalui terminal PTY milik Dorado,
5. memverifikasi perubahan dan commit melalui Git API Dorado.

## Hasil Verifikasi

- [x] File dibuat dan disunting lewat API file Dorado
- [x] Perintah dijalankan lewat terminal PTY Dorado (WebSocket)
- [x] `node --version` berhasil (v24.19.0)
- [x] `npm run typecheck -w @dorado/web` selesai dengan exit code 0
- [x] `npm test -w @dorado/web` lulus: 4 file, 8 test
- [x] Symlink `node_modules` dibersihkan setelah verifikasi
- [x] Perubahan di-stage dan di-commit lewat Git API Dorado

## Catatan

Worktree ini dibuat oleh Dorado dari branch `dorado`. Verifikasi dilakukan dari dalam worktree yang sama, menggunakan terminal dan API milik Dorado sendiri.
