# VERIFICATION — Hasil Fase 0

Tanggal uji: 2026-10-22. Tujuan: memastikan cara integrasi Hermes, omp, dan 9Router sebelum kode dibangun. Tidak ada kode aplikasi yang ditulis.

## Ringkasan status

| Tool | Versi | Cara verifikasi | Status |
| --- | --- | --- | --- |
| omp | 18.12.6 (`omp --version` → `omp/18.12.6`, PC Windows, terpasang via Bun) | Diuji langsung: `omp --mode rpc` di lawan server OpenAI-compatible tiruan | Terverifikasi |
| 9Router | 0.5.59 (npm global di PC ini; rilis terbaru npm: 0.5.104) | Diuji langsung: instance lokal dengan `DATA_DIR` terpisah, port 20199 | Terverifikasi untuk 0.5.59 saja |
| Hermes Agent | Tidak terpasang di PC ini (WSL Ubuntu ada, tanpa Hermes). Rilis terbaru di GitHub: v0.22.4 (2026-10-21) | Hanya dari dokumentasi resmi | **Tidak terverifikasi dengan curl** |

**Penyimpangan dari prompt Fase 0:** prompt meminta pengujian di VPS. Sesi ini berjalan di PC Windows tanpa akses ke VPS, jadi Hermes tidak bisa diuji dan versi di VPS tidak diketahui. Bagian "Yang harus dijalankan di VPS" di akhir dokumen berisi perintah untuk menutup celah itu. Konfigurasi omp di PC ini sudah menunjuk ke sebuah 9Router di VPS (provider `9Router`, model `aisubs/gpt-6-sol`); instance itu sengaja tidak disentuh, supaya tidak memakai kuota atau key asli.

Catatan metode: semua uji omp memakai `PI_CODING_AGENT_DIR` terisolasi dan server tiruan di `127.0.0.1`, jadi tidak ada model asli yang dipanggil dan konfigurasi pengguna tidak berubah.

---

## 1. Hermes Agent

Seluruh isi bagian ini berasal dari dokumentasi resmi (hermes-agent.nousresearch.com, bagian API Server), **bukan dari uji curl**. Semua baris perlu dikonfirmasi di VPS sebelum Fase 6.

### Mengaktifkan

Di `~/.hermes/.env`:

| Variabel | Default | Catatan |
| --- | --- | --- |
| `API_SERVER_ENABLED` | `false` | Harus `true` |
| `API_SERVER_KEY` | wajib | Bearer token; dipakai juga di loopback |
| `API_SERVER_PORT` | `8642` | Sesuai ARCHITECTURE.md |
| `API_SERVER_HOST` | `127.0.0.1` | Biarkan default |
| `API_SERVER_CORS_ORIGINS` | kosong | Biarkan kosong |
| `API_SERVER_MODEL_NAME` | `hermes-agent` (profil default) | Nama model di `/v1/models` |

Jalankan dengan `hermes gateway`; log awal memuat `API server listening on http://127.0.0.1:8642`. Env var menimpa `config.yaml` (`gateway.api_server:`). Auth: `Authorization: Bearer <API_SERVER_KEY>`. Server memberi akses penuh ke toolset, termasuk perintah terminal.

### Endpoint

| Kelompok | Endpoint |
| --- | --- |
| OpenAI-compatible | `POST /v1/chat/completions` (stateless), `POST /v1/responses` (stateful), `GET/DELETE /v1/responses/{id}`, `GET /v1/models`, `GET /v1/capabilities`, `GET /v1/health` dan `GET /health` |
| Hermes-native | `GET /api/model/options`, `GET /health/detailed`, `GET /v1/skills`, `GET /v1/toolsets` |
| Runs | `POST /v1/runs`, `GET /v1/runs/{id}`, `GET /v1/runs/{id}/events` (SSE), `POST /v1/runs/{id}/stop`, `/approval`, `/clarify`, `/resolve-unknown` |
| Jobs | `/api/jobs` (CRUD, pause, resume, run) |
| Sessions | `/api/sessions` (CRUD), `/{id}/messages`, `/{id}/fork`, `/{id}/chat`, `/{id}/chat/stream` |

### Streaming SSE

- `/v1/chat/completions` dengan `"stream": true`: chunk `chat.completion.chunk` (`delta.content`, `delta.reasoning_content`), ditambah event bernama `hermes.tool.progress` untuk progres tool (bisa dimatikan lewat `gateway.platforms.api_server.tool_progress_events: false`).
- `/v1/runs/{id}/events`: `message.delta`, `message.interim`, `tool.started`, `tool.completed`, `subagent.start/complete`, `approval.request`, terminal `run.completed | run.failed | run.cancelled | run.interrupted`.
- `/api/sessions/{id}/chat/stream`: `assistant.delta`, `assistant.commentary`, `tool.started/completed/failed`, terminal `run.*`.
- Keepalive berupa komentar `: keepalive` setelah 10 detik sunyi; parser harus melewati baris berawalan `:`.
- Konten stream bukan tanda sukses. Periksa event terminal atau `finish_reason` (`stop`, `cancelled`, `error`).

### Sesi dan memori per percakapan

| Mekanisme | Fungsi |
| --- | --- |
| Header `X-Hermes-Session-Id` | Kontinuitas transkrip di `/v1/chat/completions` dan `/v1/responses` |
| Field `session_id` | Korelasi run dan pemuatan transkrip di `/v1/runs` |
| `previous_response_id` / `conversation` | Merantai riwayat tersimpan pada `/v1/responses` |
| Header `X-Hermes-Session-Key` | Cakupan memori jangka panjang (maks 256 karakter, tanpa `\r \n \x00`), terpisah dari transkrip |
| Tanpa header | Sesi diturunkan dari hash system prompt + pesan user pertama |

Rekomendasi untuk adapter (belum diuji): gateway menyimpan satu ID sesi per percakapan lalu mengirimnya sebagai `X-Hermes-Session-Id` (atau `session_id` di `/v1/runs`), dan satu nilai tetap sebagai `X-Hermes-Session-Key` agar memori jangka panjang konsisten lintas percakapan. Sesi yang dimiliki permukaan lain (CLI, TUI, pesan) ditolak dengan `409 permission_denied`.

### System prompt dan skills

- Pesan `system` atau field `instructions` dari klien **ditumpuk di atas** system prompt inti Hermes. Tool, memori, dan skill Hermes tetap aktif. Ini cocok dengan rencana "role dan skill disuntik sebagai pesan sistem" di ARCHITECTURE.md.
- Skill dijalankan di sisi server. Klien tidak mengeksekusi tool call. Daftar skill: `GET /v1/skills`; daftar toolset: `GET /v1/toolsets`. Tidak ada parameter request untuk memilih skill tertentu yang terdokumentasi. Skill khusus project harus dikirim sebagai teks di pesan sistem, atau dipasang di folder skill Hermes (`~/.hermes`).

### Contoh request (dari dokumentasi, belum dijalankan)

```bash
curl http://127.0.0.1:8642/v1/models -H "Authorization: Bearer $API_SERVER_KEY"
# {"object":"list","data":[{"id":"hermes-agent", ...}]}

curl http://127.0.0.1:8642/v1/chat/completions \
  -H "Authorization: Bearer $API_SERVER_KEY" -H "Content-Type: application/json" \
  -H "X-Hermes-Session-Id: conv-123" -H "X-Hermes-Session-Key: owner" \
  -d '{"model":"hermes-agent","stream":true,
       "messages":[{"role":"system","content":"<role + skill>"},
                   {"role":"user","content":"Halo"}]}'

curl -X POST http://127.0.0.1:8642/v1/runs/run_abc123/stop -H "Authorization: Bearer $API_SERVER_KEY"
# {"status":"stopping"}
```

### Batas dan hal yang TIDAK didukung (menurut dokumentasi)

- Tidak ada upload file: `file`, `input_file`, `file_id`, dan `data:` non-gambar menghasilkan `400 unsupported_content_type`. Gambar inline didukung.
- `model` kosong atau polos pada chat completions diabaikan kecuali `direct_model_requests: true`; Hermes memakai model dari konfigurasinya sendiri. Pemilih model di UI tidak otomatis mengganti model Hermes.
- Batas run bersamaan: `max_concurrent_runs` default 10, kelebihan mendapat HTTP 429.
- Dokumentasi tidak konsisten soal batas respons tersimpan (100 vs 1000).
- Approval untuk tool berbahaya ada di jalur `/v1/runs` (`approval.request` + `POST .../approval`). Perilaku approval di `/v1/chat/completions` tidak terdokumentasi.
- `GET /v1/health` dan `/health` tidak memakai auth; `/health/detailed` memakai auth.

### Tidak terverifikasi

- Seluruh contoh respons nyata, format persis chunk SSE, dan header yang dikembalikan: Hermes tidak terpasang di mesin ini.
- Versi Hermes yang berjalan di VPS.
- Apakah `/v1/chat/completions` stateless benar-benar memuat ulang transkrip dari `X-Hermes-Session-Id` di versi VPS.
- Perilaku cancel: apakah memutus koneksi SSE menghentikan run (di `/v1/runs` ada `stop` eksplisit, jalur ini yang direkomendasikan).
- Dokumentasi menyebut perubahan breaking Juli 2026 pada routing multi-profil (`/p/<profil>/v1/...` butuh key profil itu); tidak relevan selama satu profil dipakai.

---

## 2. omp

Versi: **18.12.6**. Semua yang tertulis di bagian ini diuji langsung kecuali yang ditandai.

### Transport

- `omp --mode rpc`: JSONL (satu objek JSON per baris) lewat stdin/stdout. Bukan JSON-RPC 2.0.
- Frame pertama:
  ```json
  {"type":"ready","protocolVersion":1,"supportedProtocolVersions":[1,2],"maxFrameBytes":1048576,"maxReassembledFrameBytes":67108864}
  ```
- Negosiasi v2 (diuji, berhasil): `{"id":"p1","type":"negotiate_protocol","protocolVersion":2}` → `{"id":"p1","type":"response","command":"negotiate_protocol","success":true,"data":{"protocolVersion":2}}`. v2 memungkinkan frame besar dipecah jadi `rpc_chunk` (base64); adapter harus merakit ulang. Batas frame stdout 1 MiB tanpa v2.
- Setiap command boleh membawa `id`; respons memantulkannya. `prompt` hanya dikonfirmasi saat diterima; selesainya run ditandai frame `prompt_result`.
- Saat start, omp juga mengirim frame `available_commands_update` dan `extension_ui_request` dengan `method:"setWidget"` (fire-and-forget); adapter harus mengabaikan method yang tidak dikenal.
- Tutup stdin = shutdown bersih (kode keluar 0). Tetap baca stdout sampai proses selesai.

### Daftar command (dari dokumen resmi; yang bertanda ✔ juga diuji)

| Kelompok | Command |
| --- | --- |
| Prompt | `prompt` ✔ (`message`, `images?`, `streamingBehavior?: steer\|followUp`), `steer`, `follow_up`, `abort` ✔, `abort_and_prompt`, `abort_and_restore_queue`, `remove_queued_message`, `promote_queued_message`, `new_session`, `open_session` |
| State | `get_state` ✔, `get_session_stats` ✔, `get_last_assistant_text` ✔, `get_messages`, `get_messages_page`, `get_entries`, `get_tree`, `set_todos`, `get_available_commands`, `set_event_filter`, `set_ask_dialog` |
| Model | `set_model` ✔ (`provider`, `modelId`), `cycle_model`, `get_available_models` ✔ |
| Thinking | `set_thinking_level`, `cycle_thinking_level`, `get_available_thinking_levels` |
| Antrean | `set_steering_mode`, `set_follow_up_mode`, `set_interrupt_mode` |
| Kompaksi/retry | `compact`, `set_auto_compaction`, `set_auto_retry`, `abort_retry` |
| Bash | `bash`, `abort_bash` |
| Sesi | `export_html`, `switch_session`, `branch`, `fork`, `get_branch_messages`, `set_session_name`, `handoff` |
| Lain | host tools (`set_host_tools`, `host_tool_*`), host URI, subagent (`get_subagents`, `cancel_subagent`, `steer_subagent`), login, `live_*` (suara), `btw` |

Contoh respons nyata (dipotong):

```json
{"id":"m2","type":"response","command":"set_model","success":true,"data":{"id":"mock-1","name":"Mock One","api":"openai-completions","provider":"gw","baseUrl":"http://127.0.0.1:18080/v1","contextWindow":32000,"maxTokens":4096, "...":"[dipotong]"}}
{"id":"st","type":"response","command":"get_session_stats","success":true,"data":{"sessionId":"01a162af-…","userMessages":1,"assistantMessages":1,"toolCalls":0,"toolResults":0,"totalMessages":2,"tokens":{"input":5,"output":2,"reasoning":0,"cacheRead":0,"cacheWrite":0,"total":7},"cost":0,"contextUsage":{"tokens":5,"contextWindow":32000,"percent":0.015625}}}
{"id":"ab","type":"response","command":"abort","success":true}
```

### Urutan event satu giliran (nyata)

```
> {"id":"q1","type":"prompt","message":"hello there"}
< {"id":"q1","type":"response","command":"prompt","success":true}
< {"type":"agent_start"}
< {"type":"turn_start"}
< {"type":"message_start","message":{"role":"user","content":[{"type":"text","text":"hello there"}], ...},"messageId":"msg-1"}
< {"type":"message_end", ...user..., "messageId":"msg-1"}
< {"type":"message_start","message":{"role":"assistant","content":[...],"stopReason":"stop", ...},"messageId":"msg-2"}
< {"type":"message_update","assistantMessageEvent":{"type":"text_start"|"text_delta"|"text_end","contentIndex":0,"delta":"po", "partial":{...}},"message":{...}}
< {"type":"message_end", ...assistant..., "messageId":"msg-2"}
< {"type":"turn_end","message":{...},"toolResults":[]}
< {"type":"agent_end","messages":[...],"isTerminal":true,"yielded":true}
< {"type":"prompt_result","id":"q1","agentInvoked":true,"status":"completed","sessionSettled":true}
< {"type":"session_settled"}
```

Catatan untuk adapter: `message_update` membawa seluruh `partial` di setiap delta (payload besar); pakai `set_event_filter` dengan `messageUpdates:"delta"` untuk membuangnya (dari dokumen, belum diuji). Ambil teks dari `assistantMessageEvent.delta`. Giliran selesai di `prompt_result` (`status`: `completed | aborted | error`), bukan di `agent_end` (bisa `isTerminal:false`).

Giliran dengan tool call (nyata): `message_start` assistant berisi `{"type":"toolCall","id":"call_1","name":"bash","arguments":{"command":"…"}}`, lalu `tool_execution_start` (`toolCallId`, `toolName`, `args`), `extension_ui_request` bila perlu approval, lalu `tool_execution_end` (`result.content`, `isError`).

### Approval / izin tool

Tidak ada event approval khusus. Approval dikirim sebagai **`extension_ui_request` dengan `method:"select"`**. Contoh nyata dengan `--approval-mode always-ask`:

```json
< {"type":"extension_ui_request","id":"15aff9a129f2bdac","method":"select","title":"Allow tool: bash\nCommand: echo hi > probe.txt","options":["Approve","Approve bash for this session","Deny"]}
> {"type":"extension_ui_response","id":"15aff9a129f2bdac","value":"Approve"}
< {"type":"tool_execution_end","toolCallId":"call_1","toolName":"bash","result":{"content":[{"type":"text","text":"(no output)"}],...},"isError":false}
```

- Jawaban `"Approve"` → perintah berjalan (file `probe.txt` terbentuk, diperiksa). Jawaban `"Deny"` → `result.text = "Tool call denied by user: bash"`, `isError:true`, file tidak terbentuk (diperiksa).
- Jawaban berupa **teks opsi persis** di `value`. Adapter harus memetakan `allow`/`deny`/`remember` ke teks opsi dari request (jangan hard-code). `remember=true` hanya punya padanan "Approve <tool> for this session" (lingkup sesi); aturan permanen per project/pola perintah (SECURITY_OPS.md) harus disimpan oleh worker sendiri dan dijawab otomatis. Di mode `always-ask-cached`, dokumen menyebut opsi tambahan "Approve File/Directory" dan "Always Approve …" (tidak diuji).
- `title` bergabung: nama tool + detail dalam satu string; tidak ada field terstruktur. Untuk menampilkan di UI, ambil nama tool dari `tool_execution_start` yang mendahuluinya.
- Bila klien menutup stdin saat approval menggantung: tool gagal dengan `RPC client disconnected before extension UI response completed` (nyata). Tanpa UI (`--no-ui`) tool yang butuh approval gagal tertutup (dari dokumen).
- **Default omp adalah `yolo` (semua otomatis disetujui).** Worker WAJIB menyetel `--approval-mode always-ask` (atau `always-ask-cached`) secara eksplisit; jika tidak, aturan approval di SECURITY_OPS.md tidak berlaku. Mode: `always-ask` (read otomatis, write/exec ditanya), `always-ask-cached`, `write` (hanya exec ditanya), `yolo`. `--auto-approve` memaksa yolo.
- Tool `ask` (pertanyaan ke user) hanya aktif setelah `set_ask_dialog` `enabled:true`; menghasilkan `extension_ui_request` `method:"ask"` (dari dokumen, belum diuji).
- Subagent (tool `task`) berjalan headless; panggilan yang butuh prompt ditolak (dari dokumen).

### Provider OpenAI-compatible kustom

File `models.yml` di direktori agent (default `~/.omp/agent/`, atau `$PI_CODING_AGENT_DIR`, atau profil `~/.omp/profiles/<nama>/agent/`). Diuji:

```yaml
providers:
  gw:
    baseUrl: http://127.0.0.1:18080/v1   # produksi: https://<domain>/llm/v1
    apiKey: mock-key-123                  # dibaca dulu sebagai NAMA env var; jika kosong dipakai sebagai literal
    api: openai-completions
    authHeader: true
    models:
      - id: mock-1
        name: Mock One
        reasoning: false
        input: [text]
        contextWindow: 32000
        maxTokens: 4096
```

Hasil: request ke `POST /v1/chat/completions` dengan header `Authorization: Bearer mock-key-123`, body `{model, messages, stream:true, stream_options, store, tools, max_completion_tokens}`. Pilih model lewat `--model gw/mock-1` atau command `set_model`. Untuk server yang punya `/v1/models`, ada opsi `discovery: { type: openai-models-list }` (dari dokumen, belum diuji). Gotcha: bila `apiKey` menunjuk env var yang tidak ada, nilai literalnya dikirim sebagai token.

Rekomendasi untuk worker: tulis `models.yml` ke direktori agent milik worker (bukan repo kerja, bukan `~/.omp` pengguna) dan isi token perangkat lewat env var yang namanya ditaruh di `apiKey`.

### Menyuntik system prompt dan skill tanpa menulis ke repo kerja

| Kebutuhan | Cara | Status |
| --- | --- | --- |
| Menambah teks role | `--append-system-prompt "<teks atau path file>"` | **Diuji**: teks muncul di pesan `system` yang diterima server |
| Mengganti prompt dasar | `--system-prompt <teks>` atau `--system-prompt-template <file>` | Dari dokumen, belum diuji |
| Skill dari folder di luar repo | Overlay config: `--config overlay.yml` berisi `skills.customDirectories: [<dir>]` | **Diuji**: skill `market-research` muncul di daftar skill di system prompt |
| Isolasi state | `PI_CODING_AGENT_DIR=<dir>` atau `--profile <nama>` | Diuji (`PI_CODING_AGENT_DIR`) |
| Sesi di luar repo | `--session-dir <dir>` atau `--no-session` | **Diuji**: repo tetap bersih (`git status` hanya file asli) |
| Direktori kerja | `--cwd <worktree>`, `--add-dir <dir>` | Dari dokumen, belum diuji |
| Batas waktu | `--max-time 30m` | Dari dokumen, belum diuji |

- Skill hanya terdaftar (nama + deskripsi) di prompt; isinya dibaca model lewat `read skill://<nama>` saat perlu. Format: `<root>/<nama>/SKILL.md` dengan frontmatter `name`, `description` (wajib).
- Semua uji tidak membuat file apa pun di repo kerja (tidak ada `.omp/`), baik dengan `--no-session` maupun dengan `--session-dir`.
- **Temuan:** omp otomatis memuat skill dari provider lain di mesin pengguna (di uji ini daftar skill dari `~/.claude` ikut muncul; system prompt naik dari 10.444 ke 17.013 karakter bersama skill tambahan). Untuk run yang dikendalikan aplikasi, gunakan `PI_CODING_AGENT_DIR`/`--profile` terisolasi dan filter skill (`skills.includeSkills`, `--skills <glob>`, atau `--no-skills` lalu hanya `customDirectories`). Ini sengaja tidak diuji lebih jauh; perlu dikunci saat membuat adapter.
- Jalur fallback di ARCHITECTURE.md ("role sebagai pesan sistem pertama lewat RPC") **tidak diperlukan**: `--append-system-prompt` sudah cukup. Tidak ada command RPC untuk mengganti system prompt saat berjalan (tidak ada `set_system_prompt`); prompt tetap selama proses hidup, jadi ganti role = jalankan proses baru atau tambahkan lewat pesan.

### Temuan tambahan saat membangun adapter (Fase 18, omp 18.12.6, Windows)

Direkam ulang dengan omp sungguhan dan server OpenAI-compatible tiruan; transkripnya ada di `packages/adapters/src/__fixtures__/omp/` dan dipakai sebagai fixture tes adapter.

- **`set_event_filter` dengan `messageUpdates:"delta"` ditolak**: `{"success":false,"error":"events must be null or an array of non-empty event type strings"}`. `message_update` tetap membawa objek `partial` berisi seluruh pesan di setiap delta (muatan membengkak seiring panjang jawaban; batas frame 1 MiB tanpa protokol v2). Adapter hanya membaca `assistantMessageEvent.delta`.
- **Percobaan ulang model tidak bisa dimatikan.** Tanpa `set_auto_retry enabled:false` omp mengirim `auto_retry_start` (hingga 10 kali). Dengan itu dimatikan, atau dengan overlay `--config` berisi `retry.enabled:false, retry.maxRetries:0`, omp **tetap mengirim ±12 permintaan ke LLM selama ±40 detik** untuk satu galat HTTP 500 (percobaan ulang di lapisan SDK provider), baru kemudian `prompt_result` `status:"error"` dengan `error:{message,provider,model,retryable,httpStatus}`. Adapter tetap mengirim `set_auto_retry` dan menunggu balasannya sebelum `prompt`.
- **`steer` diantrekan**: omp membalas `response success` dan `queue_update {steering:[...]}`, tetapi teks baru diproses setelah pesan asisten yang sedang mengalir selesai (tidak memotong stream); `prompt_result` hanya satu untuk seluruh rangkaian.
- **`abort`**: `message_end` dengan `stopReason:"aborted"`, `agent_end`, lalu `response` untuk `abort`, lalu `prompt_result status:"aborted"`.
- **Format approval**: `title` = `Allow tool: <nama>\n<detail>` dengan detail `Command: <perintah>` (bash) atau `Path: <path>\nContent:\n<isi>` (write); opsi `["Approve","Approve <tool> for this session","Deny"]`. `tool_execution_start` mendahului `select`. Setelah "Approve bash for this session", panggilan bash berikutnya tidak lagi meminta izin (tanpa `extension_ui_request`). Jawaban Deny menghasilkan `tool_execution_end isError:true` dengan teks "Tool call denied by user".
- `tool_execution_update.partialResult.content` berisi teks **kumulatif** (bukan potongan baru); adapter mengirim hanya tambahannya sebagai `tool.output`.
- **Peluncuran**: `omp.exe` ada di `~/.bun/bin`; pembungkus `.cmd` tidak bisa dijalankan tanpa shell. Worker mencari `omp.exe` di PATH (atau `AIOS_OMP_PATH`). Flag yang terbukti jalan bersama: `--mode rpc --approval-mode always-ask --cwd <dir> --no-session --no-skills --no-extensions --no-lsp --no-title --append-system-prompt <berkas> --model aios/<id>` dengan `PI_CODING_AGENT_DIR` terisolasi berisi `models.yml`. Tidak ada berkas `.omp` yang muncul di repo kerja maupun worktree.

### Yang TIDAK didukung / tidak ada

- Tidak ada command RPC `set_system_prompt`.
- Tidak ada event approval khusus dan tidak ada field terstruktur (tool, argumen, risiko) di approval; hanya `title` teks dan daftar opsi string.
- Tidak ada "remember" permanen per pola perintah dari sisi RPC.
- Bukan JSON-RPC 2.0; input tidak boleh dipecah (satu frame = satu baris).

### Tidak terverifikasi

- `steer`, `follow_up`, `abort` di tengah stream tool nyata (server tiruan membalas instan; hanya respons `abort` saat idle yang diuji).
- `abort_and_prompt`, `compact`, `fork`, `branch`, `open_session`, `set_event_filter`, `rpc_chunk` pada protokol v2 dengan respons besar.
- Perilaku di Linux/VPS (uji hanya Windows).
- Provider memakai token perangkat melalui `/llm/v1` gateway (gateway belum ada); hanya server tiruan yang dipakai.
- Pemakaian `--no-ui` dengan approval.

---

## 3. 9Router

Versi diuji: **0.5.59** (`9router --version`). Versi npm terbaru: 0.5.104; `GET /api/version` melaporkan `hasUpdate:true`. Versi di VPS: **tidak terverifikasi**. Jalankan dengan `--skip-update` untuk mencegah pembaruan otomatis (sesuai aturan "versi dikunci" di SECURITY_OPS.md).

Menjalankan instance uji: `DATA_DIR=<dir> INITIAL_PASSWORD=… REQUIRE_API_KEY=true 9router -p 20199 -H 127.0.0.1 -n --skip-update`. Catatan: **default `-H` adalah `0.0.0.0`**, jadi di VPS wajib `-H 127.0.0.1` (atau firewall) agar tidak publik.

### Autentikasi: dua jalur

| Jalur | Dipakai untuk | Diuji |
| --- | --- | --- |
| Bearer API key | `/v1/*` (chat, audio, embeddings, …) | Ya |
| Cookie `auth_token` dari login dashboard | `/api/*` (keys, combos, usage, providers, settings) | Ya |

- Login: `POST /api/auth/login` `{"password":"…"}` → `{"success":true,"mustChangePassword":false}` + `Set-Cookie: auth_token=…; HttpOnly`. Password awal `INITIAL_PASSWORD` (default dokumentasi: `123456`; **wajib diganti**).
- `/api/*` dengan Bearer API key → **401** (diuji `/api/usage/stats`). Artinya gateway yang ingin membaca kuota/usage harus login dengan password dashboard dan memegang cookie, bukan memakai API key. Simpan sebagai rahasia gateway.

### API key terpisah untuk gateway

```bash
curl -b cj.txt -X POST $B/api/keys -H 'content-type: application/json' -d '{"name":"gateway"}'
# {"key":"sk-5c2…[disamarkan]","name":"gateway","id":"1a57bc08-…","machineId":"5c267762d8ca8147"}
curl -b cj.txt $B/api/keys    # daftar key, isinya {"keys":[{"id","key","name","machineId","isActive","createdAt"}]}
```

- `REQUIRE_API_KEY=true` membuat `POST /v1/chat/completions` tanpa key ditolak: `401 {"error":{"message":"Missing API key","type":"authentication_error","code":"invalid_api_key"}}` (diuji).
- Peringatan: `GET /api/keys` mengembalikan **key lengkap** (disimpan terbaca), jadi cookie dashboard sama sensitifnya dengan semua key.
- Endpoint pencabutan/penonaktifan key (`isActive`) tidak diuji.
- Dokumentasi: `API_KEY_SECRET` adalah rahasia HMAC pembuatan key (default publik `endpoint-proxy-api-key-secret`); **ganti** di VPS.

### `/v1/models` dan combo

- `GET /v1/models` → `{"object":"list","data":[{"id","object":"model","owned_by"}]}`.
- **Tanpa key atau dengan key palsu tetap 200** walau `REQUIRE_API_KEY=true` (diuji). Instance kosong tanpa provider mengembalikan 700 model katalog bawaan, jadi daftar ini **bukan** indikasi model yang benar-benar bisa dipakai. Gateway harus menyaring (mis. dari `GET /api/providers` / hasil uji) atau memakai daftar yang dikurasi sendiri untuk endpoint `/models`.
- Combo dibuat lewat `POST /api/combos` `{"name":"probe-combo","models":["gw/mock-1"]}` → 201, dan muncul di `/v1/models` sebagai `{"id":"probe-combo","object":"model","owned_by":"combo"}` (diuji). `GET /api/combos` menampilkan daftar. Penamaan model non-combo: `<provider>/<model>`.
- Menjalankan combo tanpa kredensial provider gagal: `404 {"error":{"message":"No active credentials for provider: …"}}`. Pemanggilan chat berhasil ke provider nyata **tidak diuji** (tidak ada kredensial di instance uji).

### Kuota dan usage

Diuji dengan cookie dashboard (semua kosong karena instance baru):

| Endpoint | Hasil |
| --- | --- |
| `GET /api/usage/stats` | 200, `{totalRequests, totalPromptTokens, totalCompletionTokens, totalCachedTokens, totalCost, byProvider, byModel, byAccount, byApiKey, …}` |
| `GET /api/usage/history` | 200, bentuk serupa |
| `GET /api/usage/providers` | 200, `{"providers":[]}` |
| `GET /api/usage/request-logs` | 200, `[]` |
| `GET /api/providers` | 200, `{"connections":[]}` |
| `GET /api/version` | 200, `{"currentVersion":"0.5.59","latestVersion":"0.5.104","hasUpdate":true}` |
| `GET /api/usage` | 404 |

`byApiKey` ada, jadi pemakaian per key (mis. per perangkat/gateway) kemungkinan bisa dihitung. Endpoint kuota per akun provider (OAuth/langganan) **tidak terverifikasi**: instance uji tidak punya koneksi provider; dokumentasi hanya menyebut pelacakan kuota di dashboard tanpa nama endpoint.

### STT dan endpoint lain

- Rute yang ada (GET → 405, berarti hanya POST): `/v1/audio/transcriptions`, `/v1/audio/speech`, `/v1/embeddings`, `/v1/responses`, `/v1/messages`, `/v1/images/generations`, `/v1/chat/completions`. `/v1/rerank` → 404.
- STT: `POST /v1/audio/transcriptions` (multipart, `model=whisper-1`, `file=…`) dengan key valid → `400 {"error":{"message":"No credentials for provider: openai",…}}`. Rutenya ada dan meneruskan ke provider `openai` (atau provider STT self-hosted yang dikonfigurasi); **transkripsi sukses tidak diuji** karena tidak ada kredensial. Dokumentasi: provider STT self-hosted memakai `/v1/audio/transcriptions` dengan `baseUrl` penuh.

### Variabel lingkungan penting (dokumentasi)

`DATA_DIR` (default `~/.9router`, DB di `db/data.sqlite`), `INITIAL_PASSWORD`, `JWT_SECRET`, `API_KEY_SECRET`, `REQUIRE_API_KEY`, `ENABLE_REQUEST_LOGS` (log request bisa memuat isi percakapan; biarkan `false`), `AUTH_COOKIE_SECURE`, `HTTP_PROXY`/`HTTPS_PROXY`, `SEARXNG_URL`.

### Yang TIDAK didukung / tidak ditemukan

- API key tidak bisa mengakses `/api/*` (usage, key, combo).
- Tidak ada endpoint `GET /api/usage` tunggal.
- `/v1/models` tidak dilindungi `REQUIRE_API_KEY`.
- `/v1/rerank` tidak ada.

### Tidak terverifikasi

- Chat/streaming sukses melalui 9Router ke model nyata (butuh kredensial provider).
- Rilis 0.5.60–0.5.104: perilaku di atas bisa berubah.
- Cara mencabut/menghapus key lewat API, dan apakah ada pembatasan per key (model, kuota).
- Tunnel publik (`tunnelEnabled` ada di settings); perlu dipastikan mati di VPS sesuai VPS_SETUP.md langkah 5.

---

## 4. Dampak ke dokumen lain

Bila cocok dengan asumsi, tidak ada tindakan. Perbedaan yang perlu dicatat di `docs/BACKLOG.md` pada saat monorepo dibuat (Fase 1):

1. **omp approval:** `AgentAdapter.resolveApproval(id, decision, remember)` di ARCHITECTURE.md harus memetakan keputusan ke teks opsi `select` (bukan boolean). `remember` permanen tidak ada di omp.
2. **omp default yolo:** worker wajib memberi `--approval-mode always-ask`. Tambahkan ke aturan adapter.
3. **omp fallback system prompt tidak diperlukan:** `--append-system-prompt` + `--config` overlay (skill) cukup.
4. **Isolasi state omp:** gunakan direktori agent terpisah dan batasi pemuatan skill pihak ketiga.
5. **9Router `/models`:** daftar tidak bisa dipakai langsung untuk pemilih model; gateway perlu daftar terkurasi.
6. **9Router kuota:** butuh login dashboard (cookie), bukan API key; atur sebagai rahasia gateway terpisah.
7. **9Router bind:** default `0.0.0.0`; pasang `-H 127.0.0.1` di service systemd.

## 5. Yang harus dijalankan di VPS (menutup celah)

Jalankan berurutan dan tempel hasilnya (samarkan key) ke bagian ini, lalu ganti status "Tidak terverifikasi" menjadi terverifikasi:

```bash
# Versi
hermes --version; omp --version; 9router --version; ss -ltnp | grep -E '8642|20128|9119'

# Hermes (API_SERVER_KEY dari ~/.hermes/.env)
curl -s http://127.0.0.1:8642/health
curl -s http://127.0.0.1:8642/v1/models -H "Authorization: Bearer $API_SERVER_KEY"
curl -s http://127.0.0.1:8642/v1/capabilities -H "Authorization: Bearer $API_SERVER_KEY"
curl -s http://127.0.0.1:8642/v1/skills -H "Authorization: Bearer $API_SERVER_KEY" | head -c 800
curl -N http://127.0.0.1:8642/v1/chat/completions -H "Authorization: Bearer $API_SERVER_KEY" \
  -H 'Content-Type: application/json' -H 'X-Hermes-Session-Id: probe-1' \
  -d '{"model":"hermes-agent","stream":true,"messages":[{"role":"system","content":"Jawab satu kata."},{"role":"user","content":"Nama saya Budi."}]}'
# Turn kedua, sesi sama, tanpa mengirim riwayat: apakah Hermes ingat "Budi"?
curl -s http://127.0.0.1:8642/v1/chat/completions -H "Authorization: Bearer $API_SERVER_KEY" \
  -H 'Content-Type: application/json' -H 'X-Hermes-Session-Id: probe-1' \
  -d '{"model":"hermes-agent","messages":[{"role":"user","content":"Siapa nama saya?"}]}'
# Run + stop
curl -s http://127.0.0.1:8642/v1/runs -H "Authorization: Bearer $API_SERVER_KEY" -H 'Content-Type: application/json' \
  -d '{"input":"Hitung sampai 50 pelan-pelan","session_id":"probe-2"}'
# lalu: curl -N .../v1/runs/<run_id>/events dan curl -X POST .../v1/runs/<run_id>/stop

# 9Router (dashboard password, nama service sesuai VPS)
curl -s -c cj.txt -X POST http://127.0.0.1:20128/api/auth/login -H 'content-type: application/json' -d '{"password":"…"}'
curl -s -b cj.txt http://127.0.0.1:20128/api/usage/stats | head -c 600
curl -s -b cj.txt http://127.0.0.1:20128/api/providers | head -c 600
curl -s http://127.0.0.1:20128/v1/chat/completions -H "Authorization: Bearer $GATEWAY_KEY" \
  -H 'content-type: application/json' -d '{"model":"<combo>","stream":true,"messages":[{"role":"user","content":"ping"}]}'
```
