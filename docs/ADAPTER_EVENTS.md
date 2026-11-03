# Event mesin agent → event kontrak

Sumber kebenaran pemetaan adapter (`packages/adapters`). Kontrak ada di `packages/contracts/src/events.ts`. Dokumen ini dibuat di Sesi 2; kolom **Bukti** menyatakan seberapa kuat pemetaan dibuktikan.

| Bukti | Arti |
| --- | --- |
| **Rekaman** | Dibuktikan oleh tes replay terhadap transkrip nyata di `packages/adapters/src/__fixtures__/omp/*.jsonl` (snapshot di `src/__snapshots__/omp.replay.test.ts.snap`). |
| **e2e omp** | Dibuktikan oleh `apps/worker/src/runs/omp.e2e.test.ts` dengan omp 18.13.2 sungguhan dan LLM tiruan. |
| **Dokumen** | Hanya dari dokumentasi/issue resmi, belum ada tangkapan nyata. Tes memakai bentuk payload yang kita susun sendiri dan diberi label itu. |
| **Sintetis** | Urutan frame disusun tangan di tes, dengan bentuk frame dari rekaman. |

## Status rekaman (jujur)

- **omp:** ada. 7 rekaman lama (omp 18.12.6, `docs/VERIFICATION.md`) dan 4 rekaman baru yang saya buat di Sesi 2 dengan omp 18.13.2 + LLM tiruan lokal: `thinking`, `abort-tool`, `todo`, `task-subagent`. Format: baris `<` = keluaran omp, `>` = masukan dari adapter.
- **Hermes: ada, sejak Sesi P5.** 7 rekaman `curl -N` nyata terhadap Hermes 0.22.5 yang berjalan di VPS ini (`127.0.0.1:8642`, bukan simulasi): `packages/adapters/fixtures/hermes/{plain-text,reasoning,tool-success,tool-failure,tool-sequence,cancel-mid-tool,model-override}.sse`. Snapshot otomatis di `src/__snapshots__/hermes.replay.test.ts.snap` (`hermes.replay.test.ts`, 7/7 lulus, tidak lagi skip). Toolset yang aktif di instance ini hanya `terminal`, `file`, `vision`, `skills` (`web`, `browser` dimatikan), jadi semua rekaman tool memakai tool `terminal`; nama tool lain (`web_search`, `browser_*`, dll) di tabel di bawah masih dari dokumentasi/daftar tool umum, belum teramati.

## Event kontrak yang dihasilkan adapter

`AgentEvent` di kontrak: `run.status`, `route.decided`, `message.delta`, `message.completed`, `reasoning.delta`, `reasoning.summary`, `tool.started`, `tool.output`, `tool.finished`, `approval.requested`, `approval.resolved`, `diff.updated`, `checkpoint.created`, `preview.ready`, `research.progress`, `research.source`, `error`, `run.completed`.

- **`todo.updated` dan `subagent.updated` TIDAK ADA di kontrak.** Pemetaannya belum bisa dibuat tanpa menambah jenis event baru, dan sesi ini hanya mengizinkan tambahan field opsional. Datanya terbukti ada di omp (lihat bawah). Butuh keputusan.
- `run.status` tidak dihasilkan adapter. Gateway (`runs/runner.ts`) yang memegang status run dan menulis `run.status` terminal (`completed`, `needs_review`, `failed`, `cancelled`). Adapter hanya mengakhiri aliran: `run.completed` (sukses), `error` (gagal), atau tanpa event penutup bila dibatalkan lewat `cancel`.

### dsh ACP

Adapter dsh menjalankan `dsh --profile acp` di gateway/VPS melalui stdio. Pemetaan lengkap, batasan, permission, cancel, timeout, dan status bukti ada di `docs/ADAPTER_ACP.md`. Fixture dsh saat ini **Sintetis**; belum ada rekaman binary nyata. `dsh` tidak menghasilkan `todo.updated`, `subagent.updated`, plan, mode, atau workflow event. Project run ditolak; project tetap menggunakan omp worker.
- `message.delta`/`reasoning.delta` memakai `messageId` pesan asisten yang dibuat gateway, bukan ID dari mesin.

## omp (`omp --mode rpc`, JSONL)

Frame keluaran omp (`<`). Tipe payload diambil dari seluruh rekaman.

| Frame mentah | Field (tipe) | Event kontrak | Bukti |
| --- | --- | --- | --- |
| `ready` | `protocolVersion` number, `supportedProtocolVersions` array, `maxFrameBytes` number | (pemicu: adapter mengirim `set_auto_retry`, lalu `prompt`) | Rekaman |
| `response` (`command`: prompt, set_auto_retry, steer, abort, get_session_stats) | `id`, `command`, `success` boolean, `data` object | tidak ada; `id: cfg-retry` memicu pengiriman `prompt` | Rekaman |
| `message_update` / `assistantMessageEvent.type = text_delta` | `delta` string, `contentIndex` number, `partial` object | `message.delta` `{messageId, text: delta}` | Rekaman |
| `message_update` / `thinking_delta` | `delta` string, `contentIndex`, `partial` | **`reasoning.delta`** `{messageId, text: delta}` | Rekaman (`thinking`), e2e omp |
| `message_update` / `text_start`, `text_end`, `thinking_start`, `thinking_end` | `contentIndex`, `content` (di `*_end`) | tidak dipetakan (batas blok; tidak dibutuhkan) | Rekaman |
| `message_update` / `toolcall_start`, `toolcall_delta`, `toolcall_end` | `delta` string, `toolCall` object | tidak dipetakan (tool baru terlihat saat `tool_execution_start`) | Rekaman |
| `message_start`, `message_end` | `message` object (`role`, `content`, `usage{input,output,cacheRead,…}`), `messageId` | `message_end` role assistant: usage dijumlahkan untuk `message.completed`/`run.completed`; `lastAssistantText` untuk ringkasan | Rekaman |
| `turn_start`, `turn_end`, `agent_start`, `agent_end`, `session_settled` | `message`, `toolResults`, `isTerminal`, `yielded` | tidak dipetakan | Rekaman |
| `tool_execution_start` | `toolCallId` string, `toolName` string, `args` object | `tool.started` `{toolCallId, name: toolName, target?}`; `target` = `args.command`, `path`, `file_path`, `url`, `pattern`, atau `query` (pertama yang ada, ≤500 karakter) | Rekaman |
| `tool_execution_update` | `toolCallId`, `toolName`, `args`, `partialResult{content[{type:text,text}], details}` | `tool.output` `{toolCallId, chunk, stream:'stdout'}`; `partialResult` kumulatif, jadi yang dikirim hanya tambahannya (maks 8000 karakter) | Rekaman |
| `tool_execution_end` | `toolCallId`, `toolName`, `result{content, details}`, `isError` boolean | `tool.finished` `{toolCallId, status, durationMs}`. `status`: `cancelled` bila `cancel()` sudah dipanggil; selain itu `denied` bila teks hasil `Tool call denied by user…`; `error` bila `isError`; `ok` | Rekaman, e2e omp |
| `extension_ui_request` `method=select` dengan judul `Allow tool: <tool>\n<detail>` | `id`, `title`, `options` array string | `approval.requested` `{approvalId (baru), kind, detail, cwd, toolCallId?}`. `kind`: file_write (write, edit, delete, rm, notebook, patch), network (fetch, web_search, browser, web), selain itu command | Rekaman |
| `extension_ui_request` `method=setWidget` (dan metode lain / judul lain) | `widgetKey` | tidak dipetakan (fire-and-forget) | Rekaman |
| `prompt_result` `status=completed` | `id`, `agentInvoked`, `sessionSettled` boolean | `message.completed` + `run.completed` | Rekaman |
| `prompt_result` `status=aborted` | idem | tanpa event bila `cancel()` sudah dipanggil; selain itu `error omp_aborted` | Rekaman |
| `prompt_result` selain itu | `error{message, httpStatus, retryable}` | `error` `{code: model_http_<status> atau omp_error, message (baris pertama, ≤300), retryable}` | Rekaman (`model-error`) |
| `queue_update` | `steering`, `followUp` array, `liveSteered` number | tidak dipetakan (balasan `steer`) | Rekaman |
| `available_commands_update` | `commands` array | tidak dipetakan | Rekaman |
| `todo_reminder` | `todos[{content,status}]`, `attempt`, `maxAttempts` | **belum dipetakan** (tidak ada event kontrak) | Rekaman (`todo`) |
| frame/tipe lain yang tak dikenal, baris non-JSON | apa pun | diabaikan, run tidak gagal | Sintetis |

Masukan adapter (`>`): `set_auto_retry {enabled:false}`, `prompt {message}`, `steer {message}`, `abort`, `extension_ui_response {id, value}`.

### Todo dan subagen di omp (belum dipetakan ke kontrak)

Direkam dengan omp 18.13.2 (`todo.jsonl`, `task-subagent.jsonl`):

- **Todo** adalah tool biasa bernama `todo` (`args: {op, list|…}`; op: init, start, done, rm, drop, block, unblock, append, view). Statusnya ada di `tool_execution_end.result.details.phases[{name, tasks[{content, status}]}]` dan teks ringkasnya di `result.content`. Hari ini hanya jadi `tool.started`/`tool.finished` (name `todo`). Selama todo masih terbuka omp mengirim `todo_reminder` dan memulai giliran model tambahan (sampai 3 kali): di rekaman `todo` jawaban muncul dua kali.
- **Subagen** adalah tool `task` (`args: {context, tasks[{id, description, task}]}`), dan butuh approval (`Allow tool: task`, kind jatuh ke `command`). Progres ada di `tool_execution_update.partialResult.details.progress[{index, id, agent, status: pending|running, toolCount, requests, tokens, cost, durationMs, recentTools, recentOutput}]` dan `details.async{state, jobId}`. Hari ini hanya `tool.output` berisi teks `Spawned agent …`.
- **Temuan penting:** subagen berjalan async. `prompt_result` datang `status=completed` dengan `sessionSettled=false` sementara subagen masih jalan, lalu adapter mengakhiri run dan mematikan omp. Hasil subagen yang belum selesai terbuang. Belum ditangani (BACKLOG).

### Penalaran

omp mengirim penalaran (`thinking_*`). Terverifikasi dengan rekaman nyata (`thinking.jsonl`) dan e2e: `reasoning.delta` muncul sebelum `message.delta`. Syarat: LLM mengirim `reasoning_content`; model tanpa penalaran tidak menghasilkan event itu.

**`reasoning.summary` (kontrak, Sesi 3):** tidak ada mesin yang mengirimnya. Rekaman omp (`thinking.jsonl`: `thinking_start/delta/end`) tidak memuat ringkasan, dan dokumentasi Hermes hanya menyebut `reasoning_content` (Chat Completions) serta `reasoning_summary_text` (Responses API, tidak dipakai adapter). Adapter tidak mengarang judul; event ini tidak pernah dikirim sampai ada mesin yang menyediakannya. Klien menurunkan judul dari teks penalaran (`buildActivity`).

### Pembatalan

Direkam (`abort-tool.jsonl`) dengan bash berjalan 1,5 dtk lalu `abort`: omp mengirim `tool_execution_end` dengan `isError=true`, lalu satu `tool_execution_update` yang **terlambat** (setelah end), lalu `prompt_result status=aborted`. Adapter:

- `tool.finished` memakai `cancelled` (bukan `error`) karena `cancel()` sudah dipanggil. Sebelum Sesi 2 hasilnya `error` (dibuktikan e2e omp: `status: 'error'` sebelum perbaikan).
- Tool yang masih terbuka saat run berakhir (omp mati, abort tanpa `tool_execution_end`, kegagalan) ditutup oleh adapter: `cancelled` bila dibatalkan, selain itu `error`, dan selalu **sebelum** event `error`/penutup. Kasus tanpa `tool_execution_end` hanya terbukti dengan urutan sintetis; omp sungguhan selalu mengirimnya.
- Cancel saat izin menggantung: izin ditolak dulu supaya abort selesai; tool selesai sebagai `cancelled`, bukan `denied`.
- `run.status` terminal `cancelled` ditulis gateway (tes: `chat.integration.test.ts` "cancel di tengah stream", `coding.integration.test.ts` "cancel"); worker meneruskan `run.status cancelled` setelah event adapter (e2e omp).

## Hermes (`POST /v1/chat/completions`, SSE)

Diverifikasi Sesi P5 dengan 7 rekaman nyata (`curl -N`) terhadap Hermes 0.22.5 di VPS ini. Kolom **Bukti** memakai label **Rekaman** bila teramati di salah satu dari ketujuh berkas; selain itu **Dokumen** (dari `docs/VERIFICATION.md` dan issue #16588, belum pernah teramati).

| Event mentah | Payload | Event kontrak | Bukti |
| --- | --- | --- | --- |
| `data:` chunk `chat.completion.chunk`, `choices[0].delta.content` string | string | `message.delta` | Rekaman (semua berkas) |
| `choices[0].delta.reasoning_content` string | string | `reasoning.delta` | Rekaman (`tool-failure.sse`, `tool-sequence.sse`); **tidak** muncul di `plain-text.sse` maupun `reasoning.sse` (pertanyaan matematika murni tanpa tool) walau diminta berpikir langkah demi langkah. Pola yang teramati: muncul hanya saat giliran itu memanggil tool, dan tidak konsisten (satu dari dua rekaman tool tanpa reasoning: `tool-success.sse`) |
| `choices[0].delta.role` string (`"assistant"`, chunk pembuka) | string | tidak dipetakan (diam-diam diabaikan; benar, tidak ada aksi) | Rekaman (semua berkas) |
| `choices[0].finish_reason` | `stop` (semua rekaman) / `error` / `cancelled` (dari dokumen) | `stop`: lanjut; `error`: `error hermes_error`; `cancelled`: `error hermes_cancelled` | `stop` Rekaman; `error`/`cancelled` Dokumen |
| chunk dengan `usage{prompt_tokens, completion_tokens}` (`stream_options.include_usage`) | number | `usage` di `message.completed` dan `run.completed` | Rekaman (semua berkas); `completion_tokens_details.reasoning_tokens`/`prompt_tokens_details.cached_tokens` tidak pernah muncul di rekaman (Dokumen saja) |
| `data: {"error":{"message"}}` | string | `error hermes_error` | Dokumen |
| `data: [DONE]` | — | penutup normal | Rekaman (semua berkas) |
| `: keepalive` (tiap ~10 dtk tanpa event) | komentar | diabaikan; mereset batas idle | Rekaman |
| `event: hermes.tool.progress` `status: "running"` | `{tool, emoji, label, toolCallId, status}` — **toolCallId selalu ada**, tidak pernah anonim; `emoji` tidak dipakai | `tool.started {toolCallId, name: tool, target: label}` | Rekaman (`tool-success`, `tool-failure`, `tool-sequence`, `cancel-mid-tool`) |
| `event: hermes.tool.progress` `status: "completed"` | `{tool, toolCallId, status}` — **tidak pernah** membawa `output`/`result`, bahkan saat perintah gagal (exit code ≠ 0: `tool-failure.sse`) | `tool.finished {toolCallId, status: 'ok', durationMs}` (jalur `output`/`result` → `tool.output` tidak pernah terpicu di rekaman) | Rekaman (`tool-success`, `tool-failure`, `tool-sequence`) |
| `status` lain (`failed`/`error`/`success`/dll, anonim tanpa `toolCallId`) | — | kode adapter menyediakan jalur ini (`TOOL_FAILED`, ID `hermes-tool-N`) tapi **tidak pernah teramati** | **Belum terverifikasi** (Dokumen/issue #16588 saja) |
| event bernama lain, JSON rusak, bentuk chunk asing (`delta.tool_calls`, dll) | apa pun | diabaikan, tanpa error | Rekaman (`model-override.sse` dan `hermes.test.ts` memverifikasi beberapa bentuk rusak secara sintetis) |

Temuan tambahan dari rekaman:

- **Hermes dapat menggabungkan beberapa perintah shell ke dalam satu panggilan tool.** Diminta menjalankan dua `echo` berurutan, Hermes mengirim SATU pasang `running`/`completed` dengan `label: "echo langkah-satu-p5 + 1 command"` (`tool-sequence.sse`), bukan dua pasang terpisah. Skenario "dua tool berurutan" di rekaman ini membuktikan perilaku Hermes (penggabungan), bukan dua event tool berbeda seperti diasumsikan sebelumnya.
- **Status `hermes.tool.progress` HANYA pernah `running` atau `completed`** di keempat rekaman tool, termasuk saat perintah gagal (exit code 2, `ls` ke folder yang tak ada): Hermes tetap melapor `completed` dan menaruh pesan galat di teks jawaban (`choices[0].delta.content`), bukan di event tool. Jadi "satu tool gagal" di Hermes (level `hermes.tool.progress`) secara praktik terlihat identik dengan "satu tool sukses"; kegagalan hanya terlihat di teks jawaban.
- **Model yang diminta berbeda (`model-override.sse`, body `"model":"gpt-4o-mini"`) dipantulkan apa adanya** di field `model` setiap chunk, tetapi jumlah `prompt_tokens` (7771) identik dengan rekaman `hermes-agent` biasa (7780, `plain-text.sse`) untuk pertanyaan sejenis — konsisten dengan dokumentasi: Hermes mengabaikan `model` klien kecuali `direct_model_requests: true` (tidak diuji; butuh akses config Hermes).

### Penalaran Hermes

**Terverifikasi rekaman (Sesi P5): Hermes di VPS ini MENGIRIM `reasoning_content`** — berbahasa Inggris, walau percakapan dan system prompt berbahasa Indonesia (`"User asks: run terminal command ls /tidak-ada-folder-p5 and write result as-is..."`). Teramati pada 2 dari 4 giliran yang memanggil tool (`tool-failure.sse`, `tool-sequence.sse`); TIDAK teramati pada giliran teks biasa tanpa tool (`plain-text.sse`, `model-override.sse`) maupun pada pertanyaan penalaran matematis tanpa tool yang diulang 2 kali (`reasoning.sse` + 2 percobaan tambahan, lihat REPAIR_LOG P5). Kesimpulan kerja: pada konfigurasi Hermes VPS ini, `reasoning_content` tampak terkait keputusan memanggil tool (bukan kompleksitas soal), dan tidak konsisten (satu dari empat giliran tool, `tool-success.sse`, tidak menghasilkannya). UI tetap menyembunyikan judul penalaran bila event ini tidak datang (P2); perilaku itu sudah benar untuk kasus `tool-success.sse`.

### Pembatalan Hermes

**Terverifikasi rekaman (Sesi P5):** memutus koneksi SSE klien (SIGKILL pada proses `curl`, tanpa TCP FIN yang rapi) **TIDAK menghentikan eksekusi tool di sisi server**. Uji: perintah `sleep 8 && touch <marker>` diminta lewat tool terminal; koneksi klien dibunuh persis setelah event `hermes.tool.progress status:"running"` diterima (sebelum `completed`); berkas marker tetap muncul di sisi server ~8 detik kemudian, membuktikan proses lanjut berjalan tanpa klien. `POST /v1/runs/{id}/stop` **tidak bisa dipakai** untuk menghentikannya dari adapter ini: `/v1/chat/completions` tidak mengembalikan run id apa pun di body maupun header respons (diperiksa dengan `curl -D -`; hanya `X-Hermes-Session-Id` yang dipantulkan). Endpoint `/v1/runs/*` adalah jalur submission terpisah (`POST /v1/runs` dengan `input`/`session_id`) yang adapter ini tidak pakai. **Keputusan dibutuhkan:** menghentikan run Hermes benar-benar di server memerlukan mengganti transport adapter dari `/v1/chat/completions` ke `/v1/runs` (submit + `GET .../events` + `POST .../stop`) — perubahan arsitektur yang lebih besar dari cakupan sesi ini, belum dikerjakan. Sampai ada keputusan, perilaku saat ini (klien berhenti menerima event, tool yang terbuka ditutup `cancelled` di sisi klien, tapi proses asli bisa saja masih berjalan di VPS) dipertahankan dan didokumentasikan sebagai batasan yang diketahui.

## Pemilihan model

| Jalur | Hasil | Bukti |
| --- | --- | --- |
| Klien → gateway (`POST /conversations/:id/messages {model}`) → `run.model` | tersimpan | `chat.integration.test.ts` |
| Gateway → adapter Hermes → body `model` | dikirim persis; tanpa pilihan: `hermes-agent` | `chat.integration.test.ts` (Hermes tiruan) |
| Hermes memakai model itu? | **Tidak terbukti, dan menurut dokumentasi diabaikan** kecuali `direct_model_requests: true` di Hermes. Pemilih model di UI tidak mengganti model Hermes. | Dokumen |
| Gateway → worker (`run.start.model`) → adapter omp | dikirim persis; menggantikan model bawaan role | `coding.integration.test.ts`, `worker-relay.test.ts`, `coordinator.test.ts` |
| omp → `--model aios/<id>` + `models.yml` → LLM | body `model` ke LLM = pilihan | `omp.test.ts` (argumen), `omp.e2e.test.ts` (`llm.requests[0].body.model`) |

## toolCallId dan durasi

- **omp:** `toolCallId` dari LLM (`tool_calls[].id`), identik di `tool_execution_start/update/end` sehingga stabil per panggilan; unik per respons LLM, sehingga konsumen memperlakukannya sebagai unik per run. `durationMs` = selisih jam adapter antara start dan end (omp tidak mengirimnya).
- **Hermes:** lihat bagian pemetaan di atas.

## Cara menambah rekaman

- **omp:** bungkus `OmpTransport` dengan pencatat yang menulis `< <baris stdout>` dan `> <frame yang dikirim>` ke `.jsonl`, jalankan satu skenario lewat adapter terhadap LLM tiruan (`apps/worker/src/testing/mock-llm.ts`, mendukung `reasoning`), taruh di `src/__fixtures__/omp/`, lalu tambahkan skenario dan reaksi klien di `src/omp.replay.test.ts`. Periksa tidak ada path lokal di berkas.
- **Hermes (dilakukan Sesi P5):** rekaman diambil langsung dari Hermes yang berjalan di VPS tempat repo ini berada (`127.0.0.1:8642`, key dari `~/.hermes/.env`), bukan simulasi:
  `curl -N -sS http://127.0.0.1:8642/v1/chat/completions -H "Authorization: Bearer $HK" -H "Content-Type: application/json" -H "X-Hermes-Session-Id: <nama>" -d '{"model":"hermes-agent","stream":true,"stream_options":{"include_usage":true},"messages":[...]}' > packages/adapters/fixtures/hermes/<nama>.sse`
  Skenario yang sudah terekam: teks biasa; dengan penalaran (diminta tapi tidak muncul `reasoning_content`, lihat atas); satu tool sukses; satu tool "gagal" (status tetap `completed`, lihat atas); dua tool berurutan (digabung Hermes jadi satu panggilan); dibatalkan di tengah tool (SIGKILL pada `curl` setelah event `running`, dibuktikan server tetap jalan lewat berkas marker); satu dengan `model` berbeda. Snapshot dibuat otomatis oleh `hermes.replay.test.ts` begitu berkas `*.sse` ada. Diperiksa sebelum commit: tidak ada token/API key di rekaman (header `Authorization` tidak pernah masuk ke body SSE); hanya prompt generik tanpa data pribadi dipakai.

## Yang belum dipetakan (ringkas)

1. `todo.updated`, `subagent.updated`: tidak ada di kontrak (omp punya datanya).
2. omp `todo_reminder`, `queue_update`, batas blok `*_start/*_end`: sengaja tidak dipetakan.
3. Hermes: status `hermes.tool.progress` selain `running`/`completed` (belum teramati), `output`/`result` pada payload completed (belum teramati), toolCallId anonim (belum teramati), `/v1/runs/{id}/events` (jalur lain, tidak dipakai), penghentian run Hermes di sisi server saat koneksi diputus (terbukti TIDAK berhenti via `/v1/chat/completions`; perlu keputusan apakah pindah ke jalur `/v1/runs` untuk benar-benar menghentikannya).
4. Subagen async omp yang belum selesai saat `prompt_result` completed.
