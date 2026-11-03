# Deployment & Operasional

## 1. Prasyarat

- Node.js 20+ (disarankan 20 LTS)
- PostgreSQL 14+ (disarankan 16)
- Nginx atau reverse proxy lain (opsional bila TLS/domain diperlukan)
- Chrome 93.0.4577.107 pada workstation admin

## 2. Konfigurasi Environment

Salin `.env.example` menjadi `.env` di root aplikasi.

| Variabel | Wajib | Default | Catatan |
|----------|-------|---------|---------|
| `NODE_ENV` | ya | `development` | Set `production` saat deploy |
| `PORT` | tidak | `3001` | Port internal API |
| `PUBLIC_BASE_URL` | ya | `http://localhost:5173` | URL publik; dipakai untuk callback agent dan validasi Origin |
| `EXTRA_ALLOWED_ORIGINS` | tidak | kosong | Daftar origin tambahan dipisah koma (mis. akses via IP) |
| `APP_TIMEZONE` | tidak | `Asia/Jakarta` | Batas "hari ini" dan kode task |
| `DATABASE_URL` | ya | — | `postgres://user:pass@host:5432/orca` |
| `SESSION_SECRET` | ya | — | Minimal 32 byte acak |
| `APP_ENCRYPTION_KEY` | ya | — | Base64 dari 32 byte: `openssl rand -base64 32` |
| `COOKIE_SECURE` | ya | `false` | `true` bila HTTPS |
| `BCRYPT_COST` | tidak | `10` | 10-14 |
| `AGENT_DISPATCH_TIMEOUT_MS` | tidak | `5000` | Timeout dispatch |
| `AGENT_HEALTH_TIMEOUT_MS` | tidak | `5000` | Timeout heartbeat |
| `HEARTBEAT_INTERVAL_MS` | tidak | `30000` | Interval heartbeat |
| `TASK_MAX_DURATION_MS` | tidak | `3600000` | Batas eksekusi task |
| `AGENT_KEY_DELIVERY` | tidak | `payload` | `payload` atau `none` |
| `LOG_LEVEL` | tidak | `info` | Level pino |

Contoh membuat secret:

```bash
openssl rand -base64 32   # APP_ENCRYPTION_KEY
openssl rand -hex 32      # SESSION_SECRET
```

Aplikasi menolak start bila secret default dipakai pada `NODE_ENV=production`.

## 3. Build & Migrasi

```bash
npm ci
npm run build
npm run migrate:prod
npm run seed:admin:prod   # sekali saja
```

`npm run build` menghasilkan:

- `apps/api/dist` — API
- `apps/web/dist` — aset frontend
- `packages/shared/dist` — tipe dan util bersama

## 4. systemd

`/etc/systemd/system/orca.service`:

```ini
[Unit]
Description=Orca Agent Orchestrator
After=network.target postgresql.service

[Service]
Type=simple
User=orca
WorkingDirectory=/opt/orca
EnvironmentFile=/opt/orca/.env
ExecStart=/usr/bin/node apps/api/dist/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/backups/orca

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now orca
sudo systemctl status orca
```

## 5. Nginx + SSE

SSE membutuhkan buffering nonaktif dan timeout panjang.

```nginx
server {
    listen 443 ssl http2;
    server_name orca.example.com;

    ssl_certificate     /etc/letsencrypt/live/orca.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/orca.example.com/privkey.pem;

    client_max_body_size 1m;

    location /api/events/stream {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        add_header X-Accel-Buffering no;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Set `PUBLIC_BASE_URL=https://orca.example.com` dan `COOKIE_SECURE=true` saat memakai TLS.

## 6. Backup

`scripts/backup.sh` menjalankan `pg_dump` format custom dan menghapus backup lebih tua dari 30 hari.

```bash
sudo install -m 750 scripts/backup.sh /opt/orca/scripts/backup.sh
sudo mkdir -p /var/backups/orca
sudo chown orca:orca /var/backups/orca
```

Systemd timer `orca-backup.timer`:

```ini
[Unit]
Description=Backup harian Orca
Requires=orca-backup.service

[Timer]
OnCalendar=*-*-* 02:15:00
Persistent=true

[Install]
WantedBy=timers.target
```

`orca-backup.service`:

```ini
[Unit]
Description=Backup database Orca

[Service]
Type=oneshot
User=orca
EnvironmentFile=/opt/orca/.env
ExecStart=/opt/orca/scripts/backup.sh
```

Aktifkan:

```bash
sudo systemctl enable --now orca-backup.timer
```

### Restore

```bash
# 1. Hentikan aplikasi
sudo systemctl stop orca

# 2. Buat database bersih
sudo -u postgres dropdb --if-exists orca_restore
sudo -u postgres createdb -O orca orca_restore

# 3. Restore
pg_restore --no-owner --role=orca -d orca_restore /var/backups/orca/orca-YYYYMMDDTHHMMSSZ.dump

# 4. Arahkan DATABASE_URL ke orca_restore, jalankan migrasi, lalu start
npm run migrate
sudo systemctl start orca
```

Uji restore minimal sekali sebelum rilis dan setelah perubahan skema besar.

## 7. Upgrade

1. Backup database.
2. `git pull` / deploy artefak baru.
3. `npm ci && npm run build`.
4. `npm run migrate:prod` (migrasi harus backward compatible).
5. `sudo systemctl restart orca`.
6. Verifikasi `/api/health`, login, dan dashboard.

## 8. Checklist Keamanan

- [ ] `SESSION_SECRET` dan `APP_ENCRYPTION_KEY` bukan nilai default, disimpan di secret manager.
- [ ] HTTPS aktif dan `COOKIE_SECURE=true`.
- [ ] `PUBLIC_BASE_URL` sesuai origin yang dipakai browser.
- [ ] Port PostgreSQL tidak terbuka ke publik.
- [ ] Backup terenkripsi/di direktori terbatas dan retensi 30 hari.
- [ ] Log tidak memuat API key, token agent, atau password.
- [ ] Rotasi token agent bila ada dugaan kebocoran.
- [ ] `AGENT_KEY_DELIVERY=none` bila worker memiliki kredensial LLM sendiri.

## 9. Quick Tunnel (Demo)

Untuk akses sementara tanpa DNS/TLS sendiri:

```bash
cloudflared tunnel --url http://127.0.0.1:3001 --no-autoupdate
```

Setelah URL `https://<acak>.trycloudflare.com` muncul, jalankan API dengan origin tersebut:

```bash
PORT=3001 \
PUBLIC_BASE_URL=https://<acak>.trycloudflare.com \
EXTRA_ALLOWED_ORIGINS=https://<acak>.trycloudflare.com \
COOKIE_SECURE=false \
node apps/api/dist/server.js
```

Catatan:

- Quick tunnel bersifat sementara dan URL berubah setiap proses dijalankan ulang.
- **Cloudflare Quick Tunnel saat ini membuffer SSE** (cloudflared issue #1449). Frontend memiliki watchdog 6 detik dan otomatis beralih ke polling 2 detik, sehingga dashboard tetap ter-update.
- Akses langsung/localhost tetap memakai SSE normal.
- Jangan memakai kredensial default pada tunnel publik. Ganti password Admin terlebih dahulu dan pertimbangkan membatasi akses.
- `COOKIE_SECURE=true` dapat dipakai bila hanya mengakses lewat HTTPS; gunakan `false` bila ingin tetap bisa login lewat `http://localhost:3001`.

## 10. Troubleshooting

| Gejala | Penyebab umum | Tindakan |
|--------|---------------|----------|
| Dashboard tidak update | Proxy mem-buffer SSE | Pastikan `proxy_buffering off` dan route SSE terpisah |
| Login berhasil tetapi aksi ditolak 403 | Origin tidak cocok dengan `PUBLIC_BASE_URL` | Samakan origin atau tambahkan `EXTRA_ALLOWED_ORIGINS` |
| Agent langsung OFFLINE | `/health` tidak merespons 2xx dalam 5 s | Periksa endpoint, token, dan firewall |
| Task tetap QUEUED | Kapasitas agent penuh atau OFFLINE | Periksa `active_tasks_count`, `max_concurrency`, status agent |
| Task RUNNING selamanya | Worker tidak callback | Cek `TASK_MAX_DURATION_MS`; rekonsiliasi akan menandai FAILED |
| 422 saat callback | Body tidak sesuai skema | Lihat `docs/agent-protocol.md` |
