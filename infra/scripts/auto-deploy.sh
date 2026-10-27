#!/usr/bin/env bash
# Deploy otomatis gateway di VPS: bila ada tag rilis vX.Y.Z yang lebih baru dari yang terpasang, jalankan deploy.sh.
# Tag rilis dibuat workflow "Build dan Rilis" hanya setelah CI lulus, jadi adanya tag berarti tes lulus.
# Dijalankan timer systemd (infra/systemd/aios-deploy.timer) sebagai pengguna pemilik repo dan anggota grup docker.
#
#   infra/scripts/auto-deploy.sh            # cek lalu deploy bila ada versi baru
#   infra/scripts/auto-deploy.sh --check    # hanya cetak versi terpasang dan versi terbaru
#
# Aturan: tidak pernah turun versi; deploy yang gagal (rollback) tidak diulang untuk tag yang sama sampai ada
# tag yang lebih baru atau berkas status dihapus; backup dibuat lebih dulu dan deploy dibatalkan bila gagal.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${AIOS_REPO:-$(cd "$HERE/../.." && pwd)}"
STATE_DIR="${AIOS_DEPLOY_STATE:-$HOME/.aios-deploy}"
BACKUP_UNIT="${AIOS_BACKUP_UNIT:-aios-backup.service}"
DEPLOY="${AIOS_DEPLOY_CMD:-$HERE/deploy.sh}"

log() { printf '%s auto-deploy: %s\n' "$(date -u +%FT%TZ)" "$*"; }
mkdir -p "$STATE_DIR"

# Satu proses saja; timer berikutnya tidak menumpuk di atas deploy yang masih berjalan.
exec 9>"$STATE_DIR/lock"
flock -n 9 || { log "deploy lain sedang berjalan"; exit 0; }

cd "$REPO"
latest="$(git ls-remote --tags --refs origin 'v*' | sed 's#.*refs/tags/##' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n1 || true)"
[[ -n "$latest" ]] || { log "tidak ada tag rilis di origin"; exit 0; }

deployed="$(cat "$STATE_DIR/deployed" 2>/dev/null || git describe --tags --abbrev=0 2>/dev/null || true)"
failed="$(cat "$STATE_DIR/failed" 2>/dev/null || true)"
log "terpasang: ${deployed:-tidak diketahui}, terbaru: $latest"
[[ "${1:-}" == "--check" ]] && exit 0

if [[ -n "$deployed" && "$(printf '%s\n%s\n' "$deployed" "$latest" | sort -V | tail -n1)" == "$deployed" ]]; then
  log "sudah yang terbaru"; exit 0
fi
if [[ "$failed" == "$latest" ]]; then
  log "$latest pernah gagal di-deploy; dilewati (hapus $STATE_DIR/failed untuk mencoba lagi)"; exit 0
fi

log "versi baru $latest: backup lalu deploy"
if ! sudo -n systemctl start "$BACKUP_UNIT"; then
  log "GAGAL: backup tidak berjalan (perlu sudo tanpa kata sandi untuk systemctl); deploy dibatalkan"
  exit 1
fi
if "$DEPLOY" --ref "$latest" --no-backup; then
  echo "$latest" > "$STATE_DIR/deployed"
  rm -f "$STATE_DIR/failed"
  log "selesai: $latest berjalan"
else
  echo "$latest" > "$STATE_DIR/failed"
  log "GAGAL: deploy $latest tidak berhasil (deploy.sh sudah rollback bila bisa); lihat 'journalctl -u aios-deploy'"
  exit 1
fi
