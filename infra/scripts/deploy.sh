#!/usr/bin/env bash
# Deploy gateway di VPS: build image arm64, migrasi + restart lewat compose, cek /readyz, rollback bila gagal.
#
#   infra/scripts/deploy.sh                 # deploy HEAD saat ini
#   infra/scripts/deploy.sh --ref v1.0.0    # checkout tag/branch dulu (git fetch + checkout)
#   infra/scripts/deploy.sh --no-backup     # lewati backup sebelum deploy (tidak dianjurkan)
#   infra/scripts/deploy.sh --dry-run       # tampilkan langkah tanpa menjalankan
#
# Alur: (1) backup database, (2) tandai image yang berjalan sebagai :previous, (3) build image baru,
# (4) `docker compose up -d gateway` (kontainer menjalankan migrasi lalu gateway), (5) tunggu /v1/readyz 200,
# (6) gagal di langkah 3-5 -> kembalikan image :previous dan jalankan ulang.
#
# PERHATIAN rollback: yang dikembalikan hanya image. Migrasi database maju saja (tidak ada "down"). Karena itu
# migrasi harus aditif (tambah kolom/tabel, jangan hapus atau ganti nama) selama versi lama masih mungkin dipakai;
# backup langkah 1 adalah jaring pengaman terakhir (infra/scripts/restore.sh untuk mengujinya).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${AIOS_REPO:-$(cd "$HERE/../.." && pwd)}"
COMPOSE_DIR="${COMPOSE_DIR:-$REPO/infra/compose}"
IMAGE="${AIOS_IMAGE:-aios-gateway}"
READY_URL="${READY_URL:-http://127.0.0.1:${PORT:-3000}/v1/readyz}"
READY_TIMEOUT="${READY_TIMEOUT:-120}"
READY_INTERVAL="${READY_INTERVAL:-3}"

REF=""; BACKUP=1; DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="${2:?--ref butuh nama tag atau branch}"; shift 2 ;;
    --no-backup) BACKUP=0; shift ;;
    --dry-run) DRY=1; shift ;;
    *) echo "argumen tidak dikenal: $1" >&2; exit 2 ;;
  esac
done

log() { printf '%s deploy: %s\n' "$(date -u +%FT%TZ)" "$*"; }
run() { if [[ $DRY -eq 1 ]]; then log "[dry-run] $*"; else "$@"; fi; }

for tool in docker git curl; do command -v "$tool" >/dev/null || { log "GAGAL: $tool tidak terpasang"; exit 1; }; done

cd "$REPO"
if [[ -n "$REF" ]]; then
  [[ -z "$(git status --porcelain --untracked-files=no)" ]] || { log "GAGAL: ada perubahan lokal yang belum di-commit; tidak berpindah ke $REF"; exit 1; }
  run git fetch --tags --quiet
  run git checkout --quiet "$REF"
fi
VERSION="$(git describe --tags --always 2>/dev/null || echo tanpa-git)"
log "versi: $VERSION"

# 1. Backup sebelum menyentuh apa pun.
if [[ $BACKUP -eq 1 ]]; then
  log "backup database"
  run bash "$HERE/backup.sh" || { log "GAGAL: backup gagal; deploy dibatalkan (pakai --no-backup bila sengaja)"; exit 1; }
fi

# 2. Simpan image yang sedang berjalan untuk rollback.
HAD_PREVIOUS=0
if docker image inspect "$IMAGE:latest" >/dev/null 2>&1; then
  run docker tag "$IMAGE:latest" "$IMAGE:previous"
  HAD_PREVIOUS=1
else
  log "belum ada image sebelumnya; rollback otomatis tidak tersedia"
fi

rollback() {
  log "ROLLBACK: $1"
  if [[ $HAD_PREVIOUS -eq 1 ]]; then
    docker tag "$IMAGE:previous" "$IMAGE:latest"
    (cd "$COMPOSE_DIR" && docker compose up -d --no-build gateway) || log "peringatan: gagal menjalankan ulang image sebelumnya"
    log "image sebelumnya dijalankan ulang; periksa 'docker compose logs gateway'"
  else
    log "tidak ada image sebelumnya untuk dikembalikan"
  fi
  exit 1
}

# 3. Build (arm64 native di VPS).
log "build image $IMAGE:latest"
if [[ $DRY -eq 0 ]]; then
  (cd "$COMPOSE_DIR" && docker compose build gateway) || rollback "build gagal"
else
  log "[dry-run] docker compose build gateway"
fi

# 4. Migrasi + restart (kontainer menjalankan `node dist/db/migrate.js && node dist/main.js`).
log "menjalankan gateway"
if [[ $DRY -eq 0 ]]; then
  (cd "$COMPOSE_DIR" && docker compose up -d gateway) || rollback "docker compose up gagal"
else
  log "[dry-run] docker compose up -d gateway"
fi

# 5. Tunggu siap. /readyz 200 = Postgres, Hermes, 9Router, SearXNG terjangkau.
if [[ $DRY -eq 1 ]]; then log "[dry-run] menunggu $READY_URL"; log "selesai (dry-run)"; exit 0; fi
log "menunggu $READY_URL (maks. ${READY_TIMEOUT}s)"
deadline=$((SECONDS + READY_TIMEOUT))
while (( SECONDS < deadline )); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$READY_URL" || true)"
  if [[ "$code" == "200" ]]; then
    log "siap: gateway $VERSION berjalan"
    exit 0
  fi
  sleep "$READY_INTERVAL"
done
rollback "/readyz tidak 200 dalam ${READY_TIMEOUT} detik (terakhir: ${code:-tanpa jawaban})"
