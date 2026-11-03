# Protokol Worker Agent v1

Dokumen ini adalah kontrak antara Orca (orchestrator) dan worker agent. Orchestrator bertindak sebagai **control plane**: tidak memanggil provider LLM, tidak mengeksekusi prompt, dan tidak menyimpan output agent selain yang dilaporkan melalui callback.

## 1. Autentikasi

- Saat agent didaftarkan, Orca membuat token `orca_agt_<64 hex>` dan menampilkannya **sekali**.
- Orca menyimpan hash SHA-256 untuk memverifikasi request masuk dan versi terenkripsi untuk request keluar.
- Semua request memakai header:

```
Authorization: Bearer orca_agt_...
```

- Token dapat dirotasi melalui `POST /api/agents/:id/rotate-token`. Token lama langsung tidak berlaku.

## 2. Endpoint yang Harus Disediakan Worker

`agents.endpoint_url` adalah base URL. Orca menambahkan path berikut.

### 2.1 `GET /health`

Response sukses:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{ "status": "ok", "version": "1.0.0" }
```

- Timeout 5 detik, tanpa retry.
- Kegagalan/timeout menandai agent `OFFLINE` dan mengisi `agents.last_error`.
- Heartbeat dijalankan setiap 30 detik.

### 2.2 `POST /tasks`

Header:

```
Authorization: Bearer <token>
Content-Type: application/json
Idempotency-Key: TSK-YYYYMMDD-NNNN
```

Body:

```json
{
  "schema": "orca.task.v1",
  "task": {
    "code": "TSK-20261103-0001",
    "title": "Refactor modul auth",
    "prompt": "Instruksi lengkap...",
    "priority": 2,
    "created_at": "2026-11-03T03:10:00.000Z"
  },
  "provider": {
    "type": "LITELLM",
    "base_url": "https://llm.internal/v1",
    "model": "gpt-4o-mini",
    "api_key": "sk-..."
  },
  "callback": {
    "url": "https://orca.example.com/api/agent/tasks/TSK-20261103-0001/result"
  },
  "deadline_at": "2026-11-03T04:10:00.000Z"
}
```

Response yang diterima:

```http
HTTP/1.1 202 Accepted
Content-Type: application/json

{ "accepted": true, "worker_task_id": "internal-id" }
```

Aturan:

- **Wajib idempoten** terhadap `Idempotency-Key`. Bila kode yang sama sudah diterima, balas `202` dengan `"duplicate": true` tanpa mengeksekusi ulang.
- Respons non-2xx dianggap penolakan; task ditandai `FAILED` dan tidak di-retry otomatis.
- Timeout dispatch 5 detik (`AGENT_DISPATCH_TIMEOUT_MS`).
- `provider.api_key` hanya dikirim bila `AGENT_KEY_DELIVERY=payload`. Set `none` bila agent dikonfigurasi dengan kredensial sendiri.

### 2.3 `POST /tasks/:code/cancel`

Body:

```json
{ "reason": "Dibatalkan oleh admin" }
```

- Best-effort, timeout 5 detik.
- Task di Orca tetap `CANCELLED` meskipun worker tidak dapat dihubungi.
- Worker sebaiknya menghentikan eksekusi dan tidak mengirim callback `COMPLETED` setelah pembatalan.

## 3. Callback Hasil

Orca menyediakan:

### `POST /api/agent/tasks/:code/result`

Header:

```
Authorization: Bearer <token>
Content-Type: application/json
```

Sukses:

```json
{
  "status": "COMPLETED",
  "token_used": 2500,
  "result": "Ringkasan output opsional"
}
```

Gagal:

```json
{
  "status": "FAILED",
  "token_used": 0,
  "error": { "message": "Worker crash saat menjalankan perintah" }
}
```

Aturan:

| Kondisi | Perilaku |
|---------|----------|
| `COMPLETED` tanpa `token_used` | `422 VALIDATION_ERROR` |
| `FAILED` tanpa `error.message` | `422 VALIDATION_ERROR` |
| Task belum `RUNNING` | `422 INVALID_TRANSITION` |
| Task sudah final dengan status sama | `200 { "noop": true }` |
| Task final dengan status berbeda | `422 INVALID_TRANSITION` |
| Token agent tidak cocok dengan task | `403 FORBIDDEN` |

Biaya dihitung di server:

```
cost_usd = round_half_up(cost_per_1k_snapshot × token_used / 1000)
```

`cost_per_1k_snapshot` disalin dari provider saat task dibuat, sehingga perubahan tarif tidak memengaruhi task lama.

## 4. Siklus Hidup

```text
QUEUED ──dispatcher──> RUNNING ──callback────────> COMPLETED
   │                       │
   │                       ├──callback gagal─────> FAILED
   │                       ├──timeout eksekusi───> FAILED
   │                       └──admin cancel───────> CANCELLED
   └──admin cancel────────────────────────────────> CANCELLED
```

- `QUEUED → RUNNING` hanya oleh dispatcher.
- `RUNNING → COMPLETED/FAILED` hanya oleh callback agent atau timeout server.
- `→ CANCELLED` hanya oleh Admin.
- Status final tidak dapat berubah. Retry membuat task baru dengan `retry_of_task_id`.

## 5. Timeout

| Parameter | Default | Arti |
|-----------|---------|------|
| `AGENT_DISPATCH_TIMEOUT_MS` | 5000 | Batas waktu POST /tasks |
| `AGENT_HEALTH_TIMEOUT_MS` | 5000 | Batas waktu GET /health |
| `HEARTBEAT_INTERVAL_MS` | 30000 | Interval heartbeat |
| `TASK_MAX_DURATION_MS` | 3600000 | Batas eksekusi sebelum task ditandai FAILED oleh rekonsiliasi |

## 6. Keamanan

- Gunakan HTTPS bila `AGENT_KEY_DELIVERY=payload`; API key provider melewati jaringan.
- Jangan menulis API key, token agent, atau prompt ke log worker.
- Batasi endpoint agent ke jaringan privat/terpercaya.
- Rotasi token agent bila terjadi dugaan kebocoran.
- Callback diverifikasi berdasarkan token agent dan kepemilikan task.
