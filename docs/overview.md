# Dorado — Overview

Dokumen ini merangkum gambaran, arsitektur, fitur, dan **peraturan (rules)** yang berlaku di repo Dorado. Untuk panduan deploy lihat [`deployment.md`](deployment.md), dan kontrak worker agent lihat [`agent-protocol.md`](agent-protocol.md).

## Gambaran

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              DORADO                                            │
│        "Agent workspace berbasis web" (terinspirasi Orca, clean-room)          │
│  Kelola project Git → worktree paralel → terminal PTY → jalankan agent CLI     │
│  semuanya dari browser. Target kompatibilitas: CHROMIUM 93.                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Arsitektur

```
        ┌───────────────────────────────────────────────┐
        │              BROWSER (Chromium 93+)            │
        │  React + xterm.js + CodeMirror 5  (apps/web)   │
        └──────────────┬──────────────────┬─────────────┘
                       │ REST (/api/*)    │ WebSocket (/ws/*)
                       ▼                  ▼
        ┌─────────────────────────────────────────────────────┐
        │           RUNTIME (Node + Express + ws)              │
        │                apps/runtime                          │
        ├─────────────────────────────────────────────────────┤
        │  node:sqlite   → projects, worktrees, terminals,     │
        │                  sessions, users, orchestrator, ...  │
        │  git CLI       → worktree / branch / status / diff   │
        │  node-pty      → shell & process agent (via tmux)    │
        │  static server → serve build web                     │
        └───────┬───────────────────────┬─────────────────────┘
                │                       │
                ▼                       ▼
        ┌───────────────┐      ┌──────────────────────┐
        │ tmux 3.2+     │      │  Worker Agent (remote)│
        │ persistensi   │      │  HTTP + callback      │
        │ sesi/terminal │      │  (Orchestrator)       │
        └───────────────┘      └──────────────────────┘
```

Struktur repo:

```
dorado/
├── apps/
│   ├── runtime/      API, SQLite, git, PTY, session, WebSocket   (@dorado/runtime)
│   └── web/          React + xterm UI                             (@dorado/web)
├── packages/
│   └── shared/       tipe & skema zod                             (@dorado/shared)
├── scripts/          tunnel, gate Chrome 93, E2E, backup, restore, dorado-ctl
├── tests/playwright/ E2E Playwright
└── docs/             overview, deployment, agent-protocol, verification
```

## Fitur

- **Autentikasi**: login multi-user (`ADMIN`/`VIEWER`), bcrypt, sesi server-side, 2FA TOTP, audit log, pairing token.
- **Project & Worktree**: tambah project dengan pemindaian repo otomatis, daftar branch, buat worktree, checkpoint (Todo/In progress/In review/Completed).
- **Terminal**: PTY per worktree (xterm.js), multi-pane (≤4), pencarian, tema/font, persistensi tmux.
- **Agent CLI**: 13 preset (OpenCode, Claude Code, Codex, Gemini, Qwen, Aider, Cursor, Crush, Droid, Goose, Amp, Copilot, Kilo) + dialog Kelola Agent (agent kustom di DB). Mode run/resume/interactive.
- **Worktree Racing**: satu prompt di 2–4 agent pada worktree terisolasi, bandingkan diff, merge pemenang, bersihkan yang kalah.
- **Sub-agent CLI `dorado-ctl`**: agent memunculkan sub-agent di worktree terisolasi (env `DORADO_*` + `PATH` otomatis, cap 4/sesi).
- **Triage CI & Issue**: `GET /api/worktrees/:id/checks`, `POST /api/worktrees/:id/fix-ci` (log Actions + review → prompt), `POST /api/projects/:id/from-issue` (GitHub/Linear). Linear key di `settings` (terenkripsi).
- **Multimodal & Profil**: `POST /api/worktrees/:id/attachments` (raw ≤5 MB, `.dorado-attachments/` di-exclude), dikte suara di terminal (Web Speech API), dan `agent_profiles` (env terenkripsi per agent, aktifkan/cooldown otomatis saat rate-limit).
- **Live Preview & Design Mode**: reverse-proxy `ALL /api/preview/:worktreeId/:port/*` (127.0.0.1, GET/HEAD, tolak port runtime), deteksi port `/worktrees/:id/ports`, skrip inspector `/api/preview/inspector.js`.
- **Mobile Companion**: `@media (max-width:768px)` — bottom-nav (Project/Inbox/Aksi/Preview) + sidebar overlay.
- **Tema & Tampilan**: 6 skin via `[data-skin]` (override token CSS) + Appearance Studio; preferensi per-user di `/api/user/preferences`.
- **Plugin/Tema Kustom**: `DATA_DIR/plugins` + `GET /api/plugins`, `GET /api/plugins/styles.css` (tersanitasi), POST/DELETE admin — 0 KB bundle web.
- **AI Draft commit**: `POST /api/git/ai-draft` (deterministik dari status/diff/log) + tombol ✨ di dialog Commit.
- **Dual-View Chat/CLI**: `parseChatBlocks` + `GET /api/terminals/:id/chat-blocks` + toggle Chat|CLI di TerminalPane (best-effort transcript + approval y/n).
- **Pratinjau File & Anotasi**: `GET /api/files/preview` (csv/json/gambar/PDF, CSP override) + dialog pratinjau + anotasi canvas (zero-dep) → kirim ke agent.
- **Browser & SSH**: CLI `dorado-browser` (`inspect` fetch + `screenshot` Chrome headless → unggah via `/api/agent/attachments`); `ssh_tunnels` table + `/api/ssh-tunnels` (CRUD + start/stop/restart, admin) + dialog **SSH Tunnel** → port lokal ikut muncul di Live Preview.
- **File & Editor**: file explorer (buat/rename/hapus, **recursive delete** dengan konfirmasi), editor CodeMirror 5 (lazy), Markdown preview (Mermaid), Quick Open, pencarian kode (ripgrep/`git grep`).
- **Git**: status/diff, stage/unstage, commit, pull/push, Git Graph, Annotate Diff.
- **GitHub**: info repo, PR, issue, review, komentar, merge, tutup issue/PR, label.
- **Orchestrator**: dashboard realtime (SSE), provider LLM (key terenkripsi), worker agent, task queue berprioritas, dispatcher, biaya.
- **Remote Nodes Federation**: kendalikan mesin Dorado lain via reverse WebSocket. Node (sisi yang dikendalikan) melihat identitas controller (nama/URL/versi/id instance) di console + `npm run node:status`.
- **Pembaruan in-place**: `npm run update` / tombol admin "Pembaruan Sistem" → git fetch+ff-merge → `npm ci` → build → restart otomatis (systemd/re-exec). Versi tersentralisasi dari package.json.
- **Penanda versi**: build-info.json per build (versi/commit/tag/waktu), riwayat pembaruan (`DATA_DIR/update-history.jsonl`), dan rilis semver via `npm run release` (bump + CHANGELOG + tag).
- **Produktivitas**: command palette, jump palette, shortcut remap, quick commands, scheduled automations, Agent Dashboard/Inbox, notifikasi, session history, Info Runtime.
- **Infra**: quick tunnel Cloudflare, backup/restore, gate Chrome 93.

## Model Data (SQLite)

```
projects ──< worktrees ──< terminals
                │              └──< sessions (agent_token_hash, parent_session_id)
                ├──< diff_comments
                └──< automations ──< automation_runs
users ──< auth_sessions ──< audit_logs
      ──< inbox_reads / notification_reads / pairing_tokens
providers ──< agents(orchestrator) ──< tasks ──< task_logs ──< task_code_sequences
agent_races ──< agent_race_entries
remote_nodes · settings · admin_credentials · cli_agents · agent_profiles
```

## Konfigurasi Environment

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `7788` | Port runtime |
| `HOST` | `127.0.0.1` | Bind address; gunakan reverse proxy |
| `PUBLIC_BASE_URL` | `http://localhost:7788` | Origin publik; dipakai callback worker dan CSRF |
| `ALLOWED_ORIGINS` | kosong | Origin tambahan yang diizinkan (pisah koma) |
| `DATA_DIR` | `./data` | SQLite, log terminal, worktree |
| `ADMIN_PASSWORD` | `dorado` | Seed awal password admin; wajib diganti di production |
| `SESSION_SECRET` | dev | Minimal 32 karakter; wajib diganti |
| `APP_ENCRYPTION_KEY` | dev | Base64 32 byte; wajib diganti |
| `APP_TIMEZONE` | `Asia/Jakarta` | Batas hari dashboard dan kode task |
| `DORADO_AGENTS` | kosong | Agent tambahan/override (JSON) |
| `PROJECT_SCAN_ROOTS` | kosong | Root pemindaian repo (pisah koma; kosong = HOME) |
| `CONTROLLER_NAME` | hostname | Nama controller yang dikirim ke node |
| `GITHUB_TOKEN` | kosong | Opsional untuk GitHub API |
| `AGENT_*`, `TASK_MAX_DURATION_MS` | — | Konfigurasi orchestrator |

---

## Peraturan (Rules)

### 1. Kompatibilitas Chrome 93 (WAJIB)

```
┌─ GATE ───────────────────────────────────────────────────────────────────────┐
│ check-syntax.mjs : AST harus ES2020 (acorn ecmaVersion 2020)                 │
│ scan-js.mjs      : API JS terlarang                                          │
│ scan-css.mjs     : CSS terlarang (Blink 93)                                  │
│ check-bundle.mjs : initial ≤ 150 KB gzip · total ≤ 350 KB gzip               │
└──────────────────────────────────────────────────────────────────────────────┘

API JS TERLARANG: structuredClone, Array.prototype.findLast/toSorted/at,
  Promise.withResolvers, AbortSignal.timeout, crypto.randomUUID,
  Object.groupBy, Object.hasOwn, Array.fromAsync.

CSS TERLARANG: @layer, @container, @property, :has(), dvh/svh/lvh, oklch(),
  color-mix(), light-dark(), text-wrap:balance, ::view-transition,
  scrollbar-gutter, CSS nesting (& .child).

BUNDLE: initial ≤ 150 KB (kode yang selalu dimuat) · total ≤ 350 KB (termasuk lazy).
  Fitur/panel besar WAJIB lazy-load. xterm di-lazy-load lewat TerminalPane.
```

### 2. CI

```
push (branch apa pun) → GitHub Actions
  verify   : npm run verify (typecheck, lint 0 warning, format, test, build, gate)
  ui-smoke (butuh verify): Chrome 93 E2E + Playwright E2E
```

### 3. Gaya Kode

- ESLint `--max-warnings=0`; variabel/argumen tak terpakai diawali `_`.
- Prettier: `singleQuote`, `semi`, `printWidth 120`, `trailingComma: none`, `arrowParens: always`.

### 4. Keamanan

- Bind `127.0.0.1` default; remote via tunnel/reverse proxy.
- `VIEWER` read-only (mutasi 403, input terminal nonaktif). Admin terakhir tak bisa diturunkan.
- 2FA anti-replay; sesi idle 8 jam, maks 24 jam, cleanup 7 hari.
- Cookie HttpOnly + SameSite=Lax (+Secure di HTTPS).
- CSRF: origin request mutasi & WS harus di `allowedOrigins`/`ALLOWED_ORIGINS`.
- Rate limit: login 15/menit/IP · API 300/menit/IP · callback agent 120/menit.
- Path worktree tidak boleh keluar `DATA_DIR`; file explorer tolak traversal/symlink.
- **Dilarang `child_process.exec`** — gunakan `execFile`/`spawn` dengan argumen array.
- Production guard: runtime menolak start bila `SESSION_SECRET`/`ADMIN_PASSWORD`/`APP_ENCRYPTION_KEY` masih default.

### 5. Agent

- Prioritas id sama: `preset < DORADO_AGENTS < agent kustom (DB)`.
- Prompt placeholder `{{prompt}}`; prompt kosong → mode interaktif (`interactiveArgs`).
- Flag auto-approve tidak dipasang default (opt-in).

### 6. Testing & Git

- Setiap fitur menambah test; `npm run verify` + E2E Chrome 93 + Playwright harus hijau.
- Push: `git push origin dorado && git push origin dorado:main` (CI hijau di keduanya).
- **Clean-room**: tidak menyalin kode/aset dari `stablyai/orca`.

---

## Roadmap "Orca-Parity"

| Phase | Fitur | Status |
|---|---|---|
| 0 | Bundle slimming (lazy xterm, limit total 350 KB) + docs | selesai |
| 1 | Worktree Racing (multi-agent, pilih pemenang, merge) | selesai |
| 2 | Sub-agent CLI `dorado-ctl` | selesai |
| 3 | Live Web Preview + Design Mode DOM inspector | selesai |
| 4 | CI auto-fix, Issue→Worktree, Linear triage | selesai |
| 5 | Multimodal (image drop, voice) + agent profiles/quota | selesai |
| 6 | Mobile companion (responsif ≤768px) | selesai |
| 7 | Tema/skin (6) + layout (orca-studio/zen-focus) + plugin registry | selesai |
| 8 | Dual-view Chat/CLI (transkrip best-effort + approval y/n) | selesai |
| 9 | AI Draft pesan commit/PR (deterministik) | selesai |
| 10 | Pratijau file (CSV/JSON/gambar/PDF) + anotasi gambar | selesai |
| 11 | `dorado-browser` (inspect/screenshot) + SSH port-forwarding | selesai |
| 12 | UI SSH Tunnel + recursive delete file explorer | selesai |
