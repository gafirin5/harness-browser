# Protokol Worker Agent (Dorado Orchestrator)

Versi: 1.0

Runtime Dorado adalah **control plane**. Worker agent menerima task, memanggil provider LLM sendiri, lalu mengirim callback hasil. Orchestrator tidak memanggil LLM secara langsung.

## Autentikasi

- Saat agent didaftarkan, Dorado membuat token `orca_agt_<hex>` dan menampilkannya **sekali**.
- Dorado menyimpan hash token, bukan token mentah.
- Setiap request Dorado → worker dan worker → Dorado memakai header:

```http
Authorization: Bearer orca_agt_...
```

- Callback hanya diterima untuk task milik agent pemilik token.

## Endpoint yang Harus Disediakan Worker

`endpoint_url` agent diperlakukan sebagai base URL.

### GET `/health`

Timeout: 5 detik. Tanpa retry.

Respons sukses:

```json
{ "status": "ok", "version": "1.0" }
```

Selain 2xx atau timeout, agent ditandai `OFFLINE` dan tidak menerima dispatch baru.

### POST `/tasks`

Header:

```http
Authorization: Bearer orca_agt_...
Content-Type: application/json
Idempotency-Key: TSK-YYYYMMDD-NNNN
```

Body:

```json
{
  "schema": "orca.task.v1",
  "task": {
    "code": "TSK-20261104-0001",
    "title": "Refactor modul auth",
    "prompt": "Instruksi lengkap ...",
    "priority": 2,
    "created_at": "2026-11-04T03:10:00.000Z"
  },
  "provider": {
    "type": "LITELLM",
    "base_url": "https://llm.internal/v1",
    "model": "gpt-4o-mini",
    "api_key": "<api key jika AGENT_KEY_DELIVERY=payload>"
  },
  "callback": {
    "url": "https://dorado.example.com/api/orchestrator/agent/tasks/TSK-20261104-0001/result"
  },
  "deadline_at": "2026-11-04T04:10:00.000Z"
}
```

Respons yang diterima:

```json
{ "accepted": true, "worker_task_id": "..." }
```

Worker **wajib idempoten** terhadap `Idempotency-Key`. Jika kode task yang sama diterima lagi, balas `202` dengan `"duplicate": true` dan jangan eksekusi ulang.

### POST `/tasks/:code/cancel`

Body:

```json
{ "reason": "Dibatalkan oleh admin" }
```

Timeout 5 detik, best-effort. Di sisi Dorado task tetap menjadi `CANCELLED` meskipun worker tidak dapat dihubungi.

## Callback Hasil

Dorado menyediakan:

```http
POST /api/orchestrator/agent/tasks/:code/result
Authorization: Bearer orca_agt_...
Content-Type: application/json
```

Body sukses:

```json
{
  "status": "COMPLETED",
  "tokenUsed": 2500,
  "result": "Ringkasan output opsional"
}
```

Body gagal:

```json
{
  "status": "FAILED",
  "tokenUsed": 0,
  "error": { "message": "Pesan error 1-2000 karakter" }
}
```

Aturan:

- Hanya `RUNNING → COMPLETED` atau `RUNNING → FAILED`.
- `COMPLETED` wajib menyertakan `tokenUsed` bilangan bulat ≥ 0.
- `FAILED` wajib menyertakan `error.message`.
- Callback idempoten: task final dengan status sama membalas `200 { "data": { "noop": true } }`; status berbeda → `422 INVALID_TRANSITION`.
- `tokenUsed` dikalikan snapshot tarif provider saat task dibuat; pembulatan half-up 4 desimal.
- Task yang melewati `TASK_MAX_DURATION_MS` ditandai `FAILED` oleh rekonsiliasi.

## Status Task

```text
QUEUED → RUNNING → COMPLETED
                 ↘ FAILED
QUEUED/RUNNING → CANCELLED
FAILED/CANCELLED → retry → QUEUED (task baru)
```

## Timeout dan Kegagalan

| Situasi | Perilaku Dorado |
|---|---|
| `/health` timeout 5 detik | Agent `OFFLINE`, tidak menerima dispatch baru |
| Dispatch timeout 5 detik / non-2xx | Task `FAILED`, log `ERROR` |
| Kegagalan konektivitas saat dispatch | Agent dapat ditandai `OFFLINE` |
| Callback tidak datang | Rekonsiliasi menandai `FAILED` setelah batas durasi |
| Callback ganda | Idempoten, tidak menambah log baru |
| Callback untuk task `CANCELLED` | `409`/`422`, status tidak berubah |

## Contoh Mock Worker

```bash
npm run build:runtime
AGENT_TOKEN=orca_agt_... PORT=9101 node scripts/mock-orchestrator-agent.mjs
```

Mock worker merespons `/health`, menerima `/tasks`, mengirim callback `COMPLETED` dengan 2.500 token, dan menerima pembatalan. Daftarkan agent di UI dengan endpoint `http://127.0.0.1:9101`.

## Catatan Keamanan

- Gunakan HTTPS atau jaringan tepercaya; token dan API key provider dapat dikirim ke worker.
- Set `AGENT_KEY_DELIVERY=none` bila API key tidak boleh meninggalkan orchestrator.
- Rotasi token agent dari UI jika token bocor.
- Jangan log header `Authorization`, API key, atau token. Dorado tidak mengembalikan API key utuh.
- Callback memakai `PUBLIC_BASE_URL`, jadi URL tersebut harus dapat dijangkau worker.