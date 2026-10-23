#!/usr/bin/env bash
# Uji restore: ambil snapshot restic terbaru, pulihkan dump ke database SEMENTARA, periksa isinya, lalu hapus.
# Tidak pernah menyentuh database produksi. Jalankan minimal sebulan sekali (aios-restore-test.timer).
#
#   restore.sh                 # snapshot terbaru, database sementara dihapus setelah diperiksa
#   restore.sh --snapshot ID   # snapshot tertentu
#   restore.sh --keep          # biarkan database sementara (nama dicetak) untuk diperiksa manual
#   restore.sh --target-dir D  # juga pulihkan file lain (Hermes, .env) ke folder D, bukan ke tempat asal
set -euo pipefail

ENV_FILE="${AIOS_BACKUP_ENV:-/etc/aios/backup.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a && source "$ENV_FILE" && set +a
fi

log() { printf '%s restore: %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "GAGAL: $*" >&2; ping_kuma down "$*" || true; exit 1; }
ping_kuma() {
  [[ -n "${KUMA_RESTORE_PUSH_URL:-}" ]] || return 0
  curl -fsS -m 10 --retry 2 -o /dev/null "${KUMA_RESTORE_PUSH_URL}?status=$1&msg=$(printf %s "${2:-OK}" | tr -c 'A-Za-z0-9._-' '_')" || true
}

SNAPSHOT=latest; KEEP=0; TARGET_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --snapshot) SNAPSHOT="${2:?--snapshot butuh ID}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --target-dir) TARGET_DIR="${2:?--target-dir butuh folder}"; shift 2 ;;
    *) die "argumen tidak dikenal: $1" ;;
  esac
done

[[ -n "${RESTIC_REPOSITORY:-}" ]] || die "RESTIC_REPOSITORY wajib diisi di $ENV_FILE"
[[ -n "${COMPOSE_DIR:-}" ]] || die "COMPOSE_DIR wajib diisi di $ENV_FILE"
PG_SERVICE="${PG_SERVICE:-postgres}"; PG_USER="${PG_USER:-aios}"; PG_DB="${PG_DB:-aios}"
for tool in restic docker; do command -v "$tool" >/dev/null || die "$tool tidak terpasang"; done

WORK="$(mktemp -d -p "${TMPDIR:-/var/tmp}" aios-restore.XXXXXX)"
chmod 700 "$WORK"
TMP_DB="aios_restore_$(date -u +%Y%m%d%H%M%S)"
[[ "$TMP_DB" != "$PG_DB" ]] || die "nama database sementara bentrok dengan produksi"

psql_exec() { ( cd "$COMPOSE_DIR" && docker compose exec -T "$PG_SERVICE" psql -v ON_ERROR_STOP=1 -U "$PG_USER" "$@" ); }
cleanup() {
  rm -rf "$WORK"
  if [[ "$KEEP" -eq 0 ]]; then
    psql_exec -d postgres -c "DROP DATABASE IF EXISTS \"$TMP_DB\"" >/dev/null 2>&1 || log "peringatan: database sementara $TMP_DB belum terhapus"
  fi
}
trap cleanup EXIT

log "memulihkan snapshot $SNAPSHOT dari restic"
restic restore "$SNAPSHOT" --tag aios --target "$WORK" --quiet || die "restic restore gagal"
DUMP="$(find "$WORK" -name aios.dump -type f | head -n1)"
[[ -n "$DUMP" && -s "$DUMP" ]] || die "aios.dump tidak ada di snapshot"

log "membuat database sementara $TMP_DB"
psql_exec -d postgres -c "CREATE DATABASE \"$TMP_DB\"" >/dev/null || die "gagal membuat database sementara"
( cd "$COMPOSE_DIR" && docker compose exec -T "$PG_SERVICE" pg_restore -U "$PG_USER" -d "$TMP_DB" --no-owner --exit-on-error ) < "$DUMP" \
  || die "pg_restore gagal"

# Pemeriksaan isi: tabel inti ada, migrasi tercatat, dan jumlah baris dicetak untuk dibandingkan dengan produksi.
TABLES="devices conversations messages runs run_events tasks schedules research_jobs"
log "memeriksa tabel inti"
for t in $TABLES; do
  count="$(psql_exec -d "$TMP_DB" -At -c "SELECT count(*) FROM \"$t\"" 2>/dev/null)" || die "tabel $t tidak ada di hasil restore"
  log "  $t: $count baris"
done
migrations="$(psql_exec -d "$TMP_DB" -At -c "SELECT count(*) FROM drizzle.__drizzle_migrations" 2>/dev/null)" || die "tabel migrasi tidak ada"
[[ "$migrations" -gt 0 ]] || die "tidak ada migrasi tercatat"
log "migrasi tercatat: $migrations"

if [[ -n "$TARGET_DIR" ]]; then
  mkdir -p "$TARGET_DIR"
  find "$WORK" -mindepth 1 -maxdepth 1 ! -name aios.dump -exec cp -a {} "$TARGET_DIR"/ \;
  chmod -R go-rwx "$TARGET_DIR"
  log "file lain dipulihkan ke $TARGET_DIR"
fi

[[ "$KEEP" -eq 1 ]] && log "database sementara dipertahankan: $TMP_DB"
log "restore berhasil"
ping_kuma up OK
