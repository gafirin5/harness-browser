# Tunnel & Akses Publik

Dorado bind ke `127.0.0.1`. Untuk akses dari luar (HP, tim), gunakan tunnel/reverse proxy. Ada dua jenis tunnel Cloudflare:

| | Quick tunnel | Named tunnel |
|---|---|---|
| URL | acak `https://<acak>.trycloudflare.com` | tetap, milik Anda (mis. `https://dorado.domainku.com`) |
| Berubah? | **berubah tiap `cloudflared` di-restart** | tidak pernah |
| Setup | `npm run tunnel` | sekali (butuh domain di Cloudflare) |
| Cocok untuk | uji coba cepat | pemakaian tetap / dibagikan |

> Catatan: restart **runtime** Dorado (`npm run update`) **tidak** mengubah URL tunnel — `cloudflared` proses terpisah. URL quick tunnel hanya berubah bila `cloudflared` (atau host) di-restart.

## Quick tunnel

```bash
npm run tunnel                 # cetak URL + tulis .dorado-tunnel.json
# lalu restart runtime dengan URL tersebut:
PUBLIC_BASE_URL=https://<acak>.trycloudflare.com node apps/runtime/dist/server.js
```

## Named tunnel (URL permanen)

### Opsi A — via token (paling mudah)
1. Cloudflare Zero Trust → **Networks → Tunnels → Create a tunnel**.
2. Tambahkan **Public hostname**: `dorado.domainku.com` → `http://127.0.0.1:7788`.
3. Salin **token**, lalu:

```bash
DORADO_TUNNEL_TOKEN=<token> npm run tunnel:named
```

### Opsi B — via cert (perintah otomatis)
```bash
cloudflared tunnel login                 # sekali, butuh browser
npm run tunnel:setup -- dorado.domainku.com
npm run tunnel:named                     # jalankan named tunnel
```

`tunnel:setup` membuat tunnel `dorado`, menulis DNS record, dan menulis `~/.cloudflared/config.yml`.

### Setelah itu (sekali saja)
```
PUBLIC_BASE_URL=https://dorado.domainku.com
COOKIE_SECURE=true
```

### Auto-start saat boot (systemd)
`/etc/systemd/system/cloudflared-dorado.service`:
```ini
[Unit]
Description=Cloudflare Tunnel (Dorado)
After=network.target

[Service]
User=dorado
ExecStart=/usr/local/bin/cloudflared tunnel run dorado
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared-dorado
```
(Ubuntu: `cloudflared` biasanya di `/usr/bin/cloudflared`; sesuaikan path.)

## Origin & CSRF (tahan perubahan URL)

Runtime menerima request tulis (mutasi) bila `Origin` **sama dengan host request** (Host + `X-Forwarded-Proto`), di samping daftar `PUBLIC_BASE_URL` + `ALLOWED_ORIGINS`. Artinya:

- Ganti URL tunnel/domain **tanpa** mengubah `ALLOWED_ORIGINS` → akses tulis tetap jalan.
- Request cross-site tetap ditolak `403` (diperkuat cookie `SameSite=Lax`).

Jika memakai domain khusus yang berbeda dari Host yang dilihat runtime (mis. beberapa origin sekaligus), daftarkan lewat `ALLOWED_ORIGINS` (pisah koma).
