# Runbook: Hermes memakai tool `aios_tools` lewat MCP

Langkah pemilik untuk menyambungkan chat umum (Hermes, `api_server` di `127.0.0.1:8642`) ke server MCP gateway `aios_tools` di `http://127.0.0.1:3000/v1/mcp` (slice 4, `docs/DESIGN_MCP_TOOLS.md` bagian 19). Kode tidak pernah mengubah config Hermes; semua langkah di bawah dilakukan pemilik di VPS.

Yang didapat Hermes: `web_search`, `web_read`, `memory_list`, `space_search`, `schedule_list`, dan usulan `memory_propose`, `schedule_propose`. Tanpa `task_list`/`task_propose` (Hermes tidak terikat project). Usulan tetap menunggu pemilik (Memori dan Jadwal di desktop, layar Usulan agent di Android).

## Prasyarat

- Gateway versi yang memuat slice 4 sudah terpasang dan `MCP_TOOLS_ENABLED=true` di `gateway.env` (tanpa ini `/v1/mcp` 404).
- Gateway mendengarkan `127.0.0.1:3000` di host yang sama dengan Hermes (`network_mode: host`). Token Hermes **hanya** diterima dari alamat soket loopback dan **tanpa** header `X-Forwarded-For`/`X-Real-IP`/`Forwarded`; lewat nginx (domain publik) ditolak `403 hermes_not_local`.

## 1. Buat token dan hash

Jalankan di VPS, di shell yang tidak dicatat ke riwayat bersama. Token tidak pernah dicetak:

```sh
umask 077
TOKEN=$(openssl rand -hex 32)
HASH=$(printf %s "$TOKEN" | sha256sum | cut -d' ' -f1)
echo "${#TOKEN} ${#HASH}"   # harus: 64 64
```

## 2. Hash ke `gateway.env`, lalu restart gateway

Di folder compose produksi (tempat `gateway.env`), isi baris yang sudah ada di contoh (`infra/compose/gateway.env.example`):

```sh
# ganti nilai lama bila ada; jangan menulis TOKEN di sini
grep -q '^MCP_HERMES_TOKEN_SHA256=' gateway.env \
  && sed -i "s/^MCP_HERMES_TOKEN_SHA256=.*/MCP_HERMES_TOKEN_SHA256=$HASH/" gateway.env \
  || echo "MCP_HERMES_TOKEN_SHA256=$HASH" >> gateway.env
docker compose up -d gateway
```

Gateway menolak start bila nilainya bukan 64 heks (`ConfigError` menyebut nama variabel, tidak pernah nilainya). Kosong = principal Hermes mati.

## 3. Token ke `~/.hermes/.env`

```sh
# printf adalah builtin bash: token tidak muncul di argumen proses (ps), berbeda dengan sed/echo eksternal
sed -i '/^AIOS_MCP_TOKEN=/d' ~/.hermes/.env
printf 'AIOS_MCP_TOKEN=%s\n' "$TOKEN" >> ~/.hermes/.env
chmod 600 ~/.hermes/.env
unset TOKEN HASH
```

## 4. Blok config Hermes (`~/.hermes/config.yaml`)

Tambahkan server MCP (nilai `${AIOS_MCP_TOKEN}` diambil Hermes dari `~/.hermes/.env`; `protocol: legacy` supaya Hermes langsung memakai handshake `initialize` tanpa mencoba `server/discover`):

```yaml
mcp_servers:
  aios_tools:
    url: "http://127.0.0.1:3000/v1/mcp"
    headers:
      Authorization: "Bearer ${AIOS_MCP_TOKEN}"
    protocol: legacy
    timeout: 30
    connect_timeout: 10
    tools:
      include:
        [web_search, web_read, memory_list, space_search, schedule_list, memory_propose, schedule_propose]
```

**Jangan** memakai `trust: untrusted`: adapter gateway memanggil Hermes lewat `/v1/chat/completions` yang tidak bisa menjawab persetujuan, jadi panggilan yang tergerbang akan menggantung. Keamanan tulis ditegakkan gateway (tool tulis hanya membuat usulan).

Batasi ke `api_server` saja (keputusan pemilik #1). Tanpa nama server di daftar sebuah platform, Hermes menggabungkan **semua** server MCP aktif ke platform itu (`hermes_cli/tools_config.py` `_merge_mcp_servers`), jadi:

```yaml
platform_toolsets:
  api_server: [hermes-api-server, aios_tools]
  # Tambahkan no_mcp ke setiap daftar platform lain yang sudah ada, mis.:
  # telegram: [<isi yang sudah ada>, no_mcp]
```

Di VPS hari ini `platform_toolsets` berisi `cli`, `discord`, `google_chat`, `homeassistant`, `qqbot`, `signal`, `slack`, `teams`, `telegram`, `whatsapp`, `yuanbao` (tanpa `api_server`); tambahkan `no_mcp` ke masing-masing daftar itu tanpa mengubah isi lainnya.

Gateway Hermes yang berjalan (`hermes gateway run`) mengawasi `config.yaml` dan menyambungkan entri baru dalam sekitar satu menit tanpa restart (dokumentasi Hermes `website/docs/user-guide/features/mcp.md`, "watches config.yaml"). **[INFERENSI]** nilai `${AIOS_MCP_TOKEN}` dibaca saat koneksi dibuat; bila token diganti, jalankan `/reload-mcp` atau restart gateway Hermes supaya header baru dipakai.

## 5. Verifikasi

1. Gateway menerima token dari loopback (tanpa mencetak token):

   ```sh
   AIOS_MCP_TOKEN=$(sed -n 's/^AIOS_MCP_TOKEN=//p' ~/.hermes/.env)
   # header dibaca curl dari process substitution, jadi token tidak muncul di argumen proses
   auth() { printf 'Authorization: Bearer %s\n' "$AIOS_MCP_TOKEN"; }
   curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/v1/mcp \
     -H @<(auth) -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'            # 200
   curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/v1/mcp \
     -H @<(auth) -H 'x-forwarded-for: 1.2.3.4' \
     -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'   # 403
   unset AIOS_MCP_TOKEN; unset -f auth
   ```

2. Hermes melihat server: `hermes mcp list` dan `hermes mcp test aios_tools` (tool yang terdaftar: `mcp__aios_tools__<tool>`).
3. Di chat umum (desktop/Android), minta "cari di web …" atau "jadwalkan ringkasan berita tiap pagi". Langkahnya tampil sebagai web/"Membuat usulan" di Aktivitas; usulan jadwal muncul di Jadwal (desktop) dan layar Usulan agent (Android) dengan agent "Hermes".
4. Audit tanpa isi: `audit_log` berisi `mcp.tool_called` dengan sasaran `hermes tool:<nama> ok|error` dan `actor_device_id` kosong.
5. Platform lain (mis. Telegram) tidak melihat `aios_tools`: setiap daftar di `platform_toolsets` selain `api_server` memuat `no_mcp`.

## Batas dan perilaku

- Anggaran Hermes per jam (jam berjalan, bukan per run): 60 `web_search`, 60 `web_read`, 120 baca data (4× anggaran satu run). Rate limit HTTP 60 permintaan/menit untuk seluruh Hermes.
- `web_read` hanya URL dari hasil `web_search` Hermes di jam yang sama atau URL di pesan pemilik chat umum 30 menit terakhir.
- `memory_propose`: kutipan wajib muncul apa adanya di pesan pemilik chat umum 30 menit terakhir.
- Usulan dari Hermes tidak punya run/percakapan (`runId`/`conversationId` null); batas yang berlaku hanya 10 per jenis per hari dan `PENDING_MAX` memori.

## Rollback

Urutan mana pun aman; masing-masing langkah sendiri sudah mematikan jalur Hermes:

1. Hapus blok `mcp_servers.aios_tools` (atau `enabled: false`) dan `aios_tools` dari `platform_toolsets.api_server` di `~/.hermes/config.yaml`; Hermes memutus koneksi dalam sekitar satu menit.
2. Kosongkan `MCP_HERMES_TOKEN_SHA256=` di `gateway.env` lalu `docker compose up -d gateway`: token apa pun dari Hermes dijawab 401.
3. Hapus `AIOS_MCP_TOKEN` dari `~/.hermes/.env`.

Rotasi token = langkah 1–3 di atas dengan token baru (hash baru di `gateway.env`, restart gateway, token baru di `.env` Hermes, `/reload-mcp`).

## Bukti kompatibilitas (tanpa menyentuh Hermes produksi)

Klien MCP Python milik Hermes sendiri (paket `mcp` 2.3.0, `mcp-types` 2.3.0, `httpx2` 2.15.1 dari venv Python 3.14.9 yang dipakai proses `hermes gateway run`; dibaca saja dengan `python -I -B`) dijalankan terhadap gateway tes lokal di port bebas dengan principal Hermes menyala, meniru jalur Hermes (preflight `HEAD`→`GET`, `httpx2.AsyncClient` dengan `Authorization` dan `mcp-protocol-version`, `streamable_http_client`, `ClientSession`):

- preflight `HEAD 405`, `GET 405` (lolos: hanya 2xx non-MCP yang ditolak Hermes);
- `initialize` → `protocolVersion 2025-11-25`, `serverInfo.name aios_tools`, `capabilities.tools.listChanged false`;
- `tools/list` → 7 tool (tanpa `task_list`/`task_propose`), `readOnlyHint` true untuk baca, false untuk usulan;
- `tools/call schedule_list` berhasil; `task_list` → galat protokol "Tool tidak dikenal"; `schedule_propose` membuat usulan `agent: hermes`, `runId: null`; cron salah → `isError`.

Belum terverifikasi: Hermes produksi sungguhan dengan config di atas (langkah pemilik), dan nama tool di event `hermes.tool.progress` (`mcp__aios_tools__<tool>` **[INFERENSI]**, lihat bagian 14 desain).
