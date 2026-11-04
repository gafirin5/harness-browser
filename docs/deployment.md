# Deployment & Operasional Dorado

Panduan menjalankan Dorado di host Linux dengan satu proses Node, SQLite, dan tmux.

## Prasyarat

- Node.js 22+ (diuji Node 24)
- Git
- tmux 3.2+
- ripgrep (opsional; fallback `git grep`)
- Build tools untuk `node-pty` (`python3`, `make`, `g++`) bila prebuilt tidak tersedia
- cloudflared (opsional, untuk quick tunnel)
- Reverse proxy Nginx/Caddy (disarankan untuk akses publik)

## Build

```bash
npm ci
npm run build
```

`npm run build` menghasilkan:

```text
apps/runtime/dist/   API + dispatcher + scheduler
apps/web/dist/       frontend statis
packages/shared/dist/
```

## Konfigurasi Environment

Salin `.env.example` menjadi `.env` dan sesuaikan.

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `7788` | Port runtime |
| `HOST` | `127.0.0.1` | Bind address; gunakan reverse proxy |
| `PUBLIC_BASE_URL` | `http://localhost:7788` | Origin publik; dipakai callback worker dan CSRF |
| `DATA_DIR` | `./data` | SQLite, log terminal, worktree |
| `ADMIN_PASSWORD` | `dorado` | Seed awal password admin (`admin`); wajib diganti di production |
| `SESSION_SECRET` | dev | Minimal 32 karakter; wajib diganti |
| `APP_ENCRYPTION_KEY` | dev | Base64 32 byte; wajib diganti, dipakai enkripsi API key provider |
| `PAIRING_TOKEN_TTL_HOURS` | `168` | Masa berlaku pairing token |
| `COOKIE_SECURE` | otomatis | `true` untuk HTTPS |
| `APP_TIMEZONE` | `Asia/Jakarta` | Batas hari dashboard dan kode task |
| `AGENT_DISPATCH_TIMEOUT_MS` | `5000` | Timeout dispatch ke worker |
| `AGENT_HEALTH_TIMEOUT_MS` | `5000` | Timeout heartbeat |
| `HEARTBEAT_INTERVAL_MS` | `30000` | Interval heartbeat |
| `TASK_MAX_DURATION_MS` | `3600000` | Batas eksekusi task |
| `AGENT_KEY_DELIVERY` | `payload` | `payload` atau `none` |
| `GITHUB_TOKEN` | kosong | Opsional untuk GitHub API |

Generate secret produksi:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # APP_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))" # SESSION_SECRET
```

## Menjalankan

```bash
PUBLIC_BASE_URL=https://dorado.example.com \
COOKIE_SECURE=true \
NODE_ENV=production \
node apps/runtime/dist/server.js
```

Buka `PUBLIC_BASE_URL`. Login memakai username `admin` dan `ADMIN_PASSWORD` hanya saat database belum memiliki user; setelah itu ganti password dari **Setelan**.

Role yang tersedia:

- `ADMIN` — akses penuh, termasuk user management dan pairing token.
- `VIEWER` — read-only: mutasi HTTP ditolak `403`, input/resize terminal dinonaktifkan, tetapi dashboard, file, git, dan orchestrator tetap dapat dilihat.

Admin dapat menambah user, mereset password, dan menonaktifkan user dari **Setelan → Pengguna**. Sistem menolak menonaktifkan atau menurunkan admin terakhir.

## Systemd

`/etc/systemd/system/dorado.service`:

```ini
[Unit]
Description=Dorado Agent Workspace
After=network.target

[Service]
Type=simple
User=dorado
Group=dorado
WorkingDirectory=/opt/dorado
EnvironmentFile=/opt/dorado/.env
ExecStart=/usr/bin/node /opt/dorado/apps/runtime/dist/server.js
Restart=on-failure
RestartSec=3
TimeoutStopSec=15
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/dorado
StateDirectory=dorado

[Install]
WantedBy=multi-user.target
```

Pastikan `DATA_DIR=/var/lib/dorado`, lalu:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dorado
sudo systemctl status dorado
```

## Nginx Reverse Proxy

```nginx
server {
  listen 443 ssl http2;
  server_name dorado.example.com;

  ssl_certificate     /etc/letsencrypt/live/dorado.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/dorado.example.com/privkey.pem;

  client_max_body_size 2m;

  location / {
    proxy_pass http://127.0.0.1:7788;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }

  location /api/orchestrator/events {
    proxy_pass http://127.0.0.1:7788;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
  }
}
```

WebSocket terminal membutuhkan header `Upgrade`/`Connection` seperti di atas. SSE orchestrator membutuhkan `proxy_buffering off`.

## Health Check

```bash
curl -fsS https://dorado.example.com/api/health
```

Respons `200` berarti runtime dan SQLite siap. `503` berarti database tidak dapat diakses.

## Backup

Script membuat snapshot SQLite konsisten dengan `VACUUM INTO` dan menjalankan `PRAGMA integrity_check`.

```bash
DATA_DIR=/var/lib/dorado BACKUP_DIR=/var/backups/dorado npm run backup
```

Retensi default 30 hari; ubah dengan `BACKUP_RETENTION_DAYS`.

Contoh systemd timer harian:

`/etc/systemd/system/dorado-backup.service`:

```ini
[Unit]
Description=Dorado SQLite backup

[Service]
Type=oneshot
User=dorado
WorkingDirectory=/opt/dorado
Environment=DATA_DIR=/var/lib/dorado
Environment=BACKUP_DIR=/var/backups/dorado
ExecStart=/usr/bin/node /opt/dorado/scripts/backup.mjs
```

`/etc/systemd/system/dorado-backup.timer`:

```ini
[Unit]
Description=Daily Dorado backup

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

Aktifkan dengan `systemctl enable --now dorado-backup.timer`.

## Restore

Hentikan runtime terlebih dahulu.

```bash
sudo systemctl stop dorado
DATA_DIR=/var/lib/dorado node scripts/restore.mjs /var/backups/dorado/dorado-YYYYMMDD-HHMMSS.db
sudo systemctl start dorado
```

Script akan:

1. Memeriksa `PRAGMA integrity_check` pada file backup.
2. Menolak restore bila port runtime masih terbuka (kecuali `FORCE=1`).
3. Menyimpan database lama sebagai `dorado.pre-restore-<timestamp>.db`.
4. Mengganti database dan menghapus `-wal`/`-shm` lama.
5. Memverifikasi database hasil restore.

## Seed Performa

Untuk pengujian lokal, bukan production:

```bash
npm run build:runtime
DATA_DIR=/tmp/dorado-perf node scripts/seed-perf.mjs --tasks=10000 --logs=100000
```

Lalu jalankan runtime dengan `DATA_DIR=/tmp/dorado-perf` di port terpisah dan ukur endpoint dashboard/task.

## Log dan Diagnostik

- Log runtime ke stdout/journald: `journalctl -u dorado -f`.
- Log terminal: `$DATA_DIR/logs/<terminal-id>.log`.
- Sesi tmux: `$DATA_DIR/tmux.sock` (`tmux -S ... list-sessions`).
- Info runtime: tombol **Info** di UI atau `GET /api/info`.
- Health: `GET /api/health`.

## Checklist Keamanan

- [ ] `ADMIN_PASSWORD` bukan default saat pertama kali deploy.
- [ ] `SESSION_SECRET` dan `APP_ENCRYPTION_KEY` diganti dan disimpan aman.
- [ ] 2FA TOTP diaktifkan untuk akun admin dari **Setelan**.
- [ ] Pairing token hanya dibuat bila diperlukan; token ini tidak meminta kode TOTP.
- [ ] Audit log diperiksa berkala untuk login gagal dan perubahan user/2FA.
- [ ] HTTPS aktif dan `COOKIE_SECURE=true`.
- [ ] Runtime bind `127.0.0.1`, hanya reverse proxy yang publik.
- [ ] Backup harian berjalan dan restore pernah diuji.
- [ ] Pairing token yang tidak dipakai dicabut.
- [ ] `AGENT_KEY_DELIVERY=none` bila worker tidak tepercaya.
- [ ] Worker agent memakai HTTPS/trusted network.

## Upgrade

```bash
sudo systemctl stop dorado
npm ci
npm run build
sudo systemctl start dorado
curl -fsS https://dorado.example.com/api/health
```

Skema SQLite dibuat otomatis dengan `CREATE TABLE IF NOT EXISTS`; tetap lakukan backup sebelum upgrade.