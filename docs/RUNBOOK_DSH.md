# Runbook dsh ACP

`dsh` adalah developer preview, tidak diaudit. Jalankan hanya di sandbox VPS. Jangan jadikan engine default.

## Instalasi

1. Pin versi image gateway:

```bash
DSH_VERSION=0.2.1-rc.5 docker compose build gateway
```

2. Salin `gateway.env.example` menjadi `gateway.env`, permission `chmod 600`.
3. Isi `NINEROUTER_API_KEY`. Jangan isi provider key di klien atau repo.
4. Aktifkan dsh hanya dengan `DSH_COMMAND=/usr/local/bin/dsh`.
5. Verifikasi konfigurasi di sandbox:

```bash
docker compose run --rm gateway dsh --dump-config
```

Profile ACP wajib memiliki provider `llm-pi-ai`, API OpenAI-compatible, base URL `http://127.0.0.1:20128/v1`, dan `apiKeyEnv: DSH_LLM_API_KEY`.

## Isolasi dan batas

- Compose menjalankan gateway sebagai user `node`, bukan root.
- `/dsh/home` dan `/dsh/work` berada pada volume `dshdata`.
- Setiap run mendapat cwd terpisah di `DSH_WORKDIR_ROOT/<runId>`.
- Set `DSH_MAX_MEMORY_MB`, `DSH_RUN_TIMEOUT_MS`, `DSH_IDLE_TIMEOUT_MS`, `DSH_APPROVAL_TIMEOUT_MS`.
- Jangan expose Hermes, 9Router, Postgres, SearXNG, atau dsh port. Semua bind ke localhost; hanya reverse proxy yang publik.
- dsh tidak menerima project run. Project tetap memakai omp melalui worker Windows.

## Operasi

Daftar engine:

```bash
curl -fsS http://127.0.0.1:3000/v1/engines -H "Authorization: Bearer $TOKEN"
```

Log stderr dsh masuk log gateway. `GET /engines` harus menunjukkan `dsh` dengan `available: true` hanya saat binary dan konfigurasi tersedia.

Saat shutdown gateway, active dsh process dihentikan. Untuk stop manual:

```bash
docker compose stop gateway
docker compose start gateway
```

## Update dan rollback

Pin versi baru, build ulang, lalu smoke test `--dump-config`, `/readyz`, `/engines`, satu prompt sandbox. Rollback dengan mengembalikan `DSH_VERSION` ke versi sebelumnya dan rebuild.

Untuk mematikan engine tanpa mengubah image, kosongkan `DSH_COMMAND`, recreate gateway, lalu pilih Hermes/omp. Jangan menghapus volume sebelum backup konfigurasi yang diperlukan.

## Verifikasi minimum

```bash
docker compose config
curl -fsS http://127.0.0.1:3000/v1/readyz
curl -fsS http://127.0.0.1:3000/v1/engines -H "Authorization: Bearer $TOKEN"
```

Rekaman ACP nyata belum tersedia. Fixture adapter di `packages/adapters/src/__fixtures__/dsh` sintetis dan tidak membuktikan kompatibilitas binary dsh.
