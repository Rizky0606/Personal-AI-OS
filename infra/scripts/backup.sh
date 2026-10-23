#!/usr/bin/env bash
# Backup harian Personal AI OS: pg_dump + data Hermes + konfigurasi rahasia -> restic -> Oracle Object Storage.
# Dijalankan oleh aios-backup.timer (lihat infra/systemd). Aman dijalankan manual: `sudo infra/scripts/backup.sh`.
#
# Konfigurasi dibaca dari /etc/aios/backup.env (izin 600, TIDAK di repo). Contoh: infra/scripts/backup.env.example.
# Skrip ini tidak pernah mencetak isi file env, kata sandi, atau kunci akses.
set -euo pipefail

ENV_FILE="${AIOS_BACKUP_ENV:-/etc/aios/backup.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a && source "$ENV_FILE" && set +a
fi

log() { printf '%s backup: %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "GAGAL: $*" >&2; ping_kuma down "$*" || true; exit 1; }
need() { [[ -n "${!1:-}" ]] || die "variabel $1 wajib diisi di $ENV_FILE"; }

# Pemantau push Uptime Kuma (opsional): beri tahu berhasil atau gagal tanpa menyertakan rahasia.
ping_kuma() {
  [[ -n "${KUMA_PUSH_URL:-}" ]] || return 0
  curl -fsS -m 10 --retry 2 -o /dev/null "${KUMA_PUSH_URL}?status=$1&msg=$(printf %s "${2:-OK}" | tr -c 'A-Za-z0-9._-' '_')" || true
}

need RESTIC_REPOSITORY
[[ -n "${RESTIC_PASSWORD_FILE:-}${RESTIC_PASSWORD:-}" ]] || die "isi RESTIC_PASSWORD_FILE di $ENV_FILE"
need COMPOSE_DIR            # mis. /srv/personal-ai-os (berisi docker-compose.yml, .env, gateway.env, secrets/)
HERMES_DATA_DIR="${HERMES_DATA_DIR:-}"   # folder data Hermes (memori, skill); kosong = dilewati dengan peringatan
PG_SERVICE="${PG_SERVICE:-postgres}"
PG_USER="${PG_USER:-aios}"
PG_DB="${PG_DB:-aios}"
KEEP_DAILY="${KEEP_DAILY:-7}"; KEEP_WEEKLY="${KEEP_WEEKLY:-4}"; KEEP_MONTHLY="${KEEP_MONTHLY:-6}"

for tool in restic docker; do command -v "$tool" >/dev/null || die "$tool tidak terpasang"; done

# Satu backup pada satu waktu.
exec 9>"${AIOS_BACKUP_LOCK:-/var/lock/aios-backup.lock}" || die "tidak bisa membuat kunci"
flock -n 9 || die "backup lain masih berjalan"

STAGE="$(mktemp -d -p "${TMPDIR:-/var/tmp}" aios-backup.XXXXXX)"
chmod 700 "$STAGE"
trap 'rm -rf "$STAGE"' EXIT

log "dump database $PG_DB"
( cd "$COMPOSE_DIR" && docker compose exec -T "$PG_SERVICE" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc --no-owner ) > "$STAGE/aios.dump" \
  || die "pg_dump gagal"
[[ -s "$STAGE/aios.dump" ]] || die "hasil pg_dump kosong"

PATHS=("$STAGE/aios.dump")
if [[ -n "$HERMES_DATA_DIR" && -d "$HERMES_DATA_DIR" ]]; then
  PATHS+=("$HERMES_DATA_DIR")
else
  log "peringatan: HERMES_DATA_DIR tidak diisi atau tidak ada; data Hermes tidak ikut"
fi
# Rahasia ikut karena restic mengenkripsi seluruh repositori; file yang tidak ada dilewati.
for f in .env gateway.env secrets; do
  [[ -e "$COMPOSE_DIR/$f" ]] && PATHS+=("$COMPOSE_DIR/$f")
done

log "restic backup (${#PATHS[@]} sumber)"
restic backup --tag aios --host "${BACKUP_HOST:-$(hostname)}" --quiet "${PATHS[@]}" || die "restic backup gagal"

log "menerapkan retensi: $KEEP_DAILY harian, $KEEP_WEEKLY mingguan, $KEEP_MONTHLY bulanan"
restic forget --tag aios --prune --quiet \
  --keep-daily "$KEEP_DAILY" --keep-weekly "$KEEP_WEEKLY" --keep-monthly "$KEEP_MONTHLY" \
  || die "restic forget gagal"

# Cek integritas ringan tiap hari (struktur + 2% data); cek penuh dilakukan restore.sh.
restic check --read-data-subset=2% --quiet || die "restic check gagal"

log "selesai"
ping_kuma up OK
