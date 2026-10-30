# ADAPTER_ACP — Adapter ACP generik dan DeepSeek Harness (dsh)

Ditulis SEBELUM kode (Sesi 9). Status bukti memakai level `ADAPTER_EVENTS.md`: **Dokumen** (spesifikasi/README resmi), **Sintetis** (dibuat dari dokumen, bukan rekaman). Belum ada **Rekaman** nyata dsh: dsh tidak dijalankan di mesin pengembangan (aturan: hanya di sandbox). Cara merekam: `docs/RUNBOOK_DSH.md`.

## Sumber (dibaca 2026)
- ACP v1: agentclientprotocol.com/protocol/v1/{transports,initialization,session-setup,prompt-turn,tool-calls,schema}
- dsh: github.com/deepseek-ai/deepseek-harness — `packages/acp/acp/README.md`, `apps/cli/README.md`, `docs/user/guide/providers.md`, `SAFETY.md`, `packages/bundle/base/README.md`.
- npm: `@deepseek-ai/dsh` 0.2.1-rc.5 (dist-tag `latest`; `alpha` 0.2.2-alpha.2), `@deepseek-ai/dsh-acp` 0.0.1-rc.1, lisensi MIT. Developer preview, tidak diaudit, perubahan yang memecah kompatibilitas diharapkan → versi di-pin (RUNBOOK).

## Transport dan framing
- stdio; klien meluncurkan `dsh --profile acp` sebagai proses anak. JSON-RPC 2.0, UTF-8, **satu pesan per baris** (`\n`, tanpa newline tertanam). stdout hanya berisi pesan protokol; stderr = log (ditangkap adapter ke log gateway, tidak pernah ke klien).
- Klien tidak boleh menulis apa pun selain pesan ACP ke stdin. Shutdown bersih: tutup stdin, tunggu keluar, lalu bunuh.

## Metode dan notifikasi (nama persis)
| Arah | Nama | Jenis | Dipakai adapter |
|---|---|---|---|
| klien→agent | `initialize` `{protocolVersion:1, clientCapabilities, clientInfo}` → `{protocolVersion, agentCapabilities, agentInfo, authMethods}` | request | ya; `clientCapabilities` dikirim kosong (tanpa fs/terminal/elicitation) |
| klien→agent | `authenticate` | request | hanya bila `authMethods` tidak kosong (dsh: langsung sukses) |
| klien→agent | `session/new` `{cwd (absolut), mcpServers[]}` → `{sessionId, configOptions?}` | request | ya |
| klien→agent | `session/set_config_option` `{sessionId, configId, value}` (`model`, `reasoning_effort`) → `{configOptions}` | request | ya bila `StartRunInput.model` ada |
| klien→agent | `session/prompt` `{sessionId, prompt: ContentBlock[]}` → `{stopReason}` | request (menggantung sepanjang giliran) | ya |
| klien→agent | `session/cancel` `{sessionId}` | notifikasi | ya |
| klien→agent | `$/cancel_request` `{requestId}` | notifikasi | tidak (cadangan; `session/cancel` cukup) |
| klien→agent | `session/close`, `session/list`, `session/resume` | request | `session/close` saat selesai bila `sessionCapabilities.close`; sisanya tidak |
| agent→klien | `session/update` `{sessionId, update:{sessionUpdate, ...}}` | notifikasi | ya |
| agent→klien | `session/request_permission` `{sessionId, toolCall, options[]}` → `{outcome}` | request | ya |
| agent→klien | `fs/*`, `terminal/*`, `elicitation/*` | request | dijawab error `-32601` (tidak diiklankan) |

`stopReason`: `end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, `cancelled`. Kode galat: `-32700/-32600/-32601/-32602/-32603`, `-32000` (auth_required), `-32002` (tidak ditemukan), `-32800` (dibatalkan).

### Varian `sessionUpdate` (Dokumen)
`agent_message_chunk` / `agent_thought_chunk` `{content:{type:'text',text}, messageId?}`; `user_message_chunk`; `tool_call` `{toolCallId,title,kind,status,content?,locations?,rawInput?,rawOutput?}`; `tool_call_update` (id sama, hanya field yang berubah); `plan`; `available_commands_update`; `current_mode_update`; `config_option_update`; `session_info_update`; `usage_update {used,size,cost?}`; `notice`; `compaction_*`. `kind`: read, edit, delete, move, search, execute, think, fetch, switch_mode, other. `status`: pending, in_progress, completed, failed.

### Izin
Agent mengirim `session/request_permission`; opsi `{optionId,name,kind}` dengan `kind` ∈ `allow_once|allow_always|reject_once|reject_always`. Jawaban klien: `{outcome:{outcome:'selected',optionId}}` atau `{outcome:{outcome:'cancelled'}}`. Adapter memilih opsi berdasarkan **kind**, bukan teks/id. Outcome tak dikenal tidak pernah dianggap persetujuan. dsh: pilihan sekali pakai allow/reject.

### Pembatalan
Klien kirim `session/cancel`; WAJIB menjawab semua `session/request_permission` yang menggantung dengan `cancelled`; agent menjawab `session/prompt` dengan `stopReason:'cancelled'` (boleh didahului update). Sesi tetap bisa dipakai. Adapter: jika tak ada balasan dalam `abortGraceMs`, proses dibunuh.

## Yang TIDAK diekspos dsh-acp (Dokumen: README dsh-acp)
Tidak ada: `plan`, mode, perintah, terminal, fs klien, elicitation, `session/load`, fork, SSE-MCP, event subagent. Subagent dsh adalah proses internal; `session/prompt` tetap menggantung sampai mereka selesai. Alat "task dan goal tracking" ada di dalam dsh tetapi tidak dilewatkan lewat ACP.
Akibat:
- **`todo.updated` dan `subagent.updated` tidak ada di kontrak** (`packages/contracts`) dan tidak dikirim dsh → tidak dibuat. Dicatat BACKLOG; bila nanti ACP `plan` muncul, butuh keputusan kontrak.
- **Mode goal/workflow tidak didukung lewat ACP** → batasan, tidak dipalsukan. Klien tidak menawarkannya untuk engine dsh.
- Gambar hanya bila `promptCapabilities.image`; selain itu diabaikan dengan peringatan.

## Pemetaan ACP → event kontrak
| ACP | Event kontrak | Catatan |
|---|---|---|
| `agent_message_chunk` teks | `message.delta {messageId: gateway, text}` | chunk non-teks diabaikan + log |
| `agent_thought_chunk` teks | `reasoning.delta` | |
| `tool_call` | `tool.started {toolCallId = ACP toolCallId, name = name ?? kind ?? 'tool', target}` | target dari `rawInput` (command/path/file_path/url/pattern/query) atau `locations[0].path`, ≤500 char. `tool_call` ulang dengan id sama = update |
| `tool_call_update` dengan teks di `content` | `tool.output {chunk}` | hanya tambahan baru bila teks kumulatif (awalan sama); selain itu seluruh teks; ≤8000 char. Stream `stdout` |
| `tool_call(_update)` status `completed` | `tool.finished ok` | `durationMs` dari jam adapter sejak `tool.started` |
| status `failed` | `tool.finished error` | |
| tool terbuka saat izin ditolak | `tool.finished denied` | |
| tool terbuka saat cancel / proses mati | `cancelled` / `error` | ditutup SEBELUM event error/penutup |
| `session/request_permission` | `approval.requested {approvalId (adapter), kind, detail, cwd, toolCallId}` | kind: `kind` ACP edit/delete/move→`file_write`; fetch→`network`; selain itu `command` |
| balasan pengguna `resolveApproval` | jawaban `selected` + `approval.resolved {decision, remember}` | `allow`→`allow_once` (atau `allow_always` bila remember dan ada); `deny`→`reject_once` (atau `reject_always`); opsi tak ada → `cancelled` agar izin tidak menggantung |
| `usage_update` | dipakai untuk `usage` (token) bila ada; `used` bukan token input/output → tidak dipetakan ke `Usage` | `PromptResponse` dsh tidak memuat usage (Dokumen) |
| `session/prompt` → `end_turn` | `message.completed` + `run.completed {summary}` | |
| `max_tokens` / `max_turn_requests` / `refusal` | `error` (`acp_max_tokens`, `acp_max_turn_requests`, `acp_refusal`) | retryable false |
| `cancelled` setelah `cancel()` | tanpa event penutup (konvensi `ADAPTER_EVENTS.md`) | `cancelled` tak diminta → `error acp_cancelled` retryable |
| galat JSON-RPC pada `session/prompt` | `error` `acp_rpc_<kode>` | `-32000` → `acp_auth_required` |
| proses mati/EOF stdout di tengah run | `error acp_exited` retryable | tool terbuka ditutup `error` |
| tak ada respons dalam batas waktu (init/new/idle) | `error acp_timeout` retryable | proses dibunuh |
| `plan`, `config_option_update`, `current_mode_update`, `available_commands_update`, `session_info_update`, `notice`, `compaction_*`, `user_message_chunk`, nama baru | diabaikan, dicatat lewat `onUnknown` | run tidak gagal |

Adapter tidak menerbitkan `run.status`; gateway yang menulis status terminal (aturan `ADAPTER_EVENTS.md`). Proses mati, timeout, atau putus selalu berakhir pada `error` lalu stream selesai: tidak pernah menggantung. Tidak ada reconnect otomatis: proses `dsh` per run (sesi tidak dilanjutkan, `session/load` tidak didukung); kegagalan ditandai `retryable` dan pengguna/gateway memulai run baru.

## Konfigurasi dan keamanan
- Peluncuran: konfigurasi gateway (`DSH_COMMAND`, `DSH_ARGS`, `DSH_HOME`, `DSH_WORKDIR_ROOT`, batas), bukan klien. Cwd = `<DSH_WORKDIR_ROOT>/<runId>` terisolasi. Docker memasang dsh hanya bila `DSH_VERSION` diisi saat build; `dshdata` menyimpan `/dsh`.
- Model: provider kustom `llm-pi-ai` di `$DSH_HOME/profiles/acp/cordis.patch.yml` (`api: openai-completions`, `baseURL` 9Router `http://127.0.0.1:20128/v1`, `apiKeyEnv: DSH_LLM_API_KEY`). Gateway meneruskan `NINEROUTER_API_KEY` sebagai `DSH_LLM_API_KEY`; kunci hanya di env gateway/VPS, tidak pernah di klien atau berkas repo. Mungkin perlu `compat.supportsDeveloperRole:false`, `maxTokensField:max_tokens` (Dokumen; diverifikasi saat rekaman).
- Proses: pengguna non-root khusus, `ulimit`/systemd (`MemoryMax`, `RuntimeMaxSec`), sandbox bawaan dsh (`workspace-write`), jaringan keluar hanya yang perlu. Detail: RUNBOOK_DSH.md.
- Izin dsh tetap lewat `approval.requested` ke pengguna; tidak ada auto-allow.
