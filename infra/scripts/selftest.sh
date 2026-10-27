#!/usr/bin/env bash
# Uji mandiri backup.sh dan restore.sh dengan docker, restic, flock, dan curl palsu (tanpa VPS, tanpa jaringan).
# Memeriksa urutan perintah, retensi, penanganan gagal, dan bahwa restore tidak menyentuh database produksi.
#   infra/scripts/selftest.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
STUBS="$ROOT/bin"; mkdir -p "$STUBS"
LOG="$ROOT/calls.log"
FAILURES=0

pass() { printf '  ok   %s\n' "$1"; }
fail() { printf '  GAGAL %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
expect_log() { grep -qE -- "$1" "$LOG" && pass "$2" || fail "$2 (tidak ada: $1)"; }
expect_no_log() { grep -qE -- "$1" "$LOG" && fail "$2 (ada: $1)" || pass "$2"; }

# --- perintah palsu -------------------------------------------------------------------------------------------
cat > "$STUBS/flock" <<'EOS'
#!/usr/bin/env bash
exit 0
EOS
cat > "$STUBS/curl" <<'EOS'
#!/usr/bin/env bash
echo "curl $*" >> "$STUB_LOG"
[[ "$*" == *http_code* ]] && printf '%s' "${STUB_READY:-200}"
exit 0
EOS
cat > "$STUBS/git" <<'EOS'
#!/usr/bin/env bash
echo "git $*" >> "$STUB_LOG"
case "$1" in
  describe) echo v1.0.0 ;;
  ls-remote) for t in ${STUB_TAGS:-v1.0.0}; do printf 'abc123	refs/tags/%s
' "$t"; done ;;
  status) [[ "${STUB_DIRTY:-0}" == 1 ]] && echo ' M arsip.ts' ;;
esac
exit 0
EOS
cat > "$STUBS/sudo" <<'EOS'
#!/usr/bin/env bash
echo "sudo $*" >> "$STUB_LOG"
[[ "${STUB_SUDO_FAIL:-0}" == 1 ]] && exit 1
exit 0
EOS
cat > "$STUBS/fake-deploy" <<'EOS'
#!/usr/bin/env bash
echo "deploy $*" >> "$STUB_LOG"
[[ "${STUB_DEPLOY_FAIL:-0}" == 1 ]] && exit 1
exit 0
EOS
cat > "$STUBS/restic" <<'EOS'
#!/usr/bin/env bash
echo "restic $* [kompresi=${RESTIC_COMPRESSION:-tidak}]" >> "$STUB_LOG"
case "$1" in
  cat) [[ "${STUB_REPO_V1:-0}" == 1 ]] && echo '{"version": 1}' || echo '{"version": 2, "id": "x"}' ;;
  restore)
    target=""; while [[ $# -gt 0 ]]; do [[ "$1" == "--target" ]] && target="$2"; shift; done
    mkdir -p "$target/stage" "$target/hermes"
    [[ "${STUB_NO_DUMP:-0}" == 1 ]] || echo "DUMP" > "$target/stage/aios.dump"
    echo "memori" > "$target/hermes/memory.db"
    ;;
esac
EOS
cat > "$STUBS/docker" <<'EOS'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
args="$*"
case "$args" in
  *"image inspect"*) [[ "${STUB_NO_IMAGE:-0}" == 1 ]] && exit 1 ;;
  *"compose build"*) [[ "${STUB_BUILD_FAIL:-0}" == 1 ]] && exit 1 ;;
  *"postgres --version"*) echo "postgres (PostgreSQL) 16.4" ;;
  *"images searxng"*) echo '[{"Tag":"2026.10.1-abc"}]' ;;
  *pg_dump*) [[ "${STUB_EMPTY_DUMP:-0}" == 1 ]] || echo "PGDMP-isi" ;;
  *pg_restore*) cat >/dev/null ;;
  *__drizzle_migrations*) echo "${STUB_MIGRATIONS:-3}" ;;
  *"SELECT count"*)
    if [[ -n "${STUB_MISSING_TABLE:-}" && "$args" == *"\"$STUB_MISSING_TABLE\""* ]]; then exit 1; fi
    echo 5 ;;
esac
exit 0
EOS
cat > "$STUBS/omp" <<'EOS'
#!/usr/bin/env bash
echo "omp v${STUB_OMP:-18.12.6}"
EOS
cat > "$STUBS/9router" <<'EOS'
#!/usr/bin/env bash
echo "0.5.59"
EOS
cat > "$STUBS/node" <<'EOS'
#!/usr/bin/env bash
echo "v22.12.0"
EOS
chmod +x "$STUBS"/*

cat > "$ROOT/backup.env" <<EOF
RESTIC_REPOSITORY=s3:https://contoh.example/bucket
RESTIC_PASSWORD_FILE=$ROOT/pw
AWS_ACCESS_KEY_ID=AKIA-RAHASIA-ID
AWS_SECRET_ACCESS_KEY=RAHASIA-KUNCI-SANGAT-PANJANG
COMPOSE_DIR=$ROOT/compose
HERMES_DATA_DIR=$ROOT/hermes
KUMA_PUSH_URL=http://127.0.0.1:3001/api/push/abc
KUMA_RESTORE_PUSH_URL=http://127.0.0.1:3001/api/push/xyz
EOF
mkdir -p "$ROOT/compose/secrets" "$ROOT/hermes"
echo x > "$ROOT/pw"; echo A=1 > "$ROOT/compose/.env"; echo B=2 > "$ROOT/compose/gateway.env"

run() {
  : > "$LOG"
  PATH="$STUBS:$PATH" STUB_LOG="$LOG" AIOS_BACKUP_ENV="$ROOT/backup.env" AIOS_BACKUP_LOCK="$ROOT/lock" TMPDIR="$ROOT" \
    bash "$@" > "$ROOT/out.txt" 2>&1
}

echo "backup.sh"
run "$HERE/backup.sh"; code=$?
[[ $code -eq 0 ]] && pass "berhasil (kode 0)" || { fail "kode keluar $code"; cat "$ROOT/out.txt"; }
expect_log 'docker compose exec -T postgres pg_dump -U aios -d aios -Fc -Z0' "pg_dump format custom tanpa kompresi internal"
expect_log 'restic backup .*[kompresi=max]' "restic mengompres dengan zstd max (repo v2)"
expect_log 'restic backup --tag aios' "restic backup bertag"
expect_log 'restic backup .*aios\.dump' "dump ikut dicadangkan"
expect_log "restic backup .*$ROOT/hermes" "data Hermes ikut"
expect_log 'restic backup .*compose/\.env' ".env ikut"
expect_log 'restic backup .*compose/gateway\.env' "gateway.env ikut"
expect_log 'restic backup .*compose/secrets' "secrets ikut"
expect_log 'restic forget --tag aios --prune --quiet --keep-within 31d --keep-last 1' "retensi 31 hari, backup terakhir selalu ada"
expect_log 'restic check' "cek integritas"
expect_log 'curl .*api/push/abc\?status=up' "ping Kuma berhasil"
grep -q "RAHASIA" "$ROOT/out.txt" && fail "keluaran memuat rahasia" || pass "keluaran bebas rahasia"
[[ -z "$(ls "$ROOT" | grep aios-backup)" ]] && pass "folder sementara dibersihkan" || fail "folder sementara tersisa"

echo "backup.sh: repo restic v1 (tanpa kompresi)"
STUB_REPO_V1=1 run "$HERE/backup.sh"; code=$?
[[ $code -eq 0 ]] && pass "tetap berhasil" || fail "kode keluar $code"
expect_log 'restic backup .*[kompresi=tidak]' "tanpa kompresi di repo v1"
grep -q 'upgrade_repo_v2' "$ROOT/out.txt" && pass "menyarankan upgrade repo" || fail "tidak ada saran upgrade"

echo "backup.sh: dump kosong"
STUB_EMPTY_DUMP=1 run "$HERE/backup.sh"; code=$?
[[ $code -ne 0 ]] && pass "gagal (kode $code)" || fail "seharusnya gagal"
expect_no_log 'restic backup' "tidak mencadangkan dump kosong"
expect_log 'curl .*api/push/abc\?status=down' "ping Kuma gagal"

echo "backup.sh: konfigurasi kurang"
sed -i '/^RESTIC_REPOSITORY/d' "$ROOT/backup.env"
run "$HERE/backup.sh"; code=$?
[[ $code -ne 0 ]] && grep -q "RESTIC_REPOSITORY" "$ROOT/out.txt" && pass "menolak tanpa RESTIC_REPOSITORY" || fail "tidak menolak"
echo 'RESTIC_REPOSITORY=s3:https://contoh.example/bucket' >> "$ROOT/backup.env"

echo "restore.sh"
run "$HERE/restore.sh"; code=$?
[[ $code -eq 0 ]] && pass "berhasil (kode 0)" || { fail "kode keluar $code"; cat "$ROOT/out.txt"; }
expect_log 'restic restore latest --tag aios --target' "memulihkan snapshot terbaru"
expect_log 'CREATE DATABASE "aios_restore_' "membuat database sementara"
expect_log 'pg_restore -U aios -d aios_restore_' "pg_restore ke database sementara"
expect_log 'SELECT count\(\*\) FROM "run_events"' "memeriksa tabel inti"
expect_log 'DROP DATABASE IF EXISTS "aios_restore_' "database sementara dihapus"
expect_no_log 'pg_restore -U aios -d aios( |$)' "pg_restore tidak ke produksi"
expect_no_log 'DROP DATABASE .*"aios"' "tidak menghapus produksi"
expect_no_log 'CREATE DATABASE "aios"' "tidak membuat ulang produksi"
expect_log 'curl .*api/push/xyz\?status=up' "ping Kuma restore"
grep -q "RAHASIA" "$ROOT/out.txt" && fail "keluaran memuat rahasia" || pass "keluaran bebas rahasia"

echo "restore.sh: --keep dan --target-dir"
run "$HERE/restore.sh" --keep --target-dir "$ROOT/pulih"; code=$?
[[ $code -eq 0 ]] && pass "berhasil" || fail "kode keluar $code"
expect_no_log 'DROP DATABASE' "database sementara dipertahankan"
[[ -f "$ROOT/pulih/hermes/memory.db" ]] && pass "data Hermes dipulihkan ke folder tujuan" || fail "data Hermes tidak dipulihkan"
probe="$ROOT/probe"; mkdir "$probe"; chmod 700 "$probe"
if [[ "$(stat -c %a "$probe")" == 700 ]]; then
  [[ "$(stat -c %a "$ROOT/pulih")" == 700 ]] && pass "folder tujuan hanya bisa dibaca pemilik" || fail "izin folder tujuan terlalu longgar"
else
  echo "  lewati: filesystem tidak menghormati chmod (mis. Windows)"
fi

echo "restore.sh: tabel hilang"
STUB_MISSING_TABLE=tasks run "$HERE/restore.sh"; code=$?
[[ $code -ne 0 ]] && grep -q 'tabel tasks tidak ada' "$ROOT/out.txt" && pass "gagal dengan pesan tabel" || fail "tidak mendeteksi tabel hilang"
expect_log 'DROP DATABASE IF EXISTS "aios_restore_' "database sementara tetap dibersihkan setelah gagal"
expect_log 'curl .*api/push/xyz\?status=down' "ping Kuma gagal"

echo "restore.sh: snapshot tanpa dump"
STUB_NO_DUMP=1 run "$HERE/restore.sh"; code=$?
[[ $code -ne 0 ]] && grep -q 'aios.dump tidak ada' "$ROOT/out.txt" && pass "menolak snapshot tanpa dump" || fail "tidak menolak"

echo "check-versions.sh"
cat > "$ROOT/VERSIONS.md" <<'EOV'
<!-- versions:begin -->
omp=18.12.6
9router=0.5.59
hermes=
searxng=2026.10.1-abc
postgres=16
node=22
<!-- versions:end -->
EOV
run_check() { : > "$LOG"; PATH="$STUBS:$PATH" STUB_LOG="$LOG" VERSIONS_FILE="$ROOT/VERSIONS.md" COMPOSE_DIR="$ROOT/compose" bash "$HERE/check-versions.sh" "$@" > "$ROOT/out.txt" 2>&1; }
run_check; code=$?
# hermes tidak terpasang dan tidak dikunci: hanya dilaporkan.
grep -qE '^omp +18.12.6 +18.12.6 +OK' "$ROOT/out.txt" && pass "omp cocok" || fail "omp tidak cocok"
grep -qE '^postgres +16 +16.4 +OK' "$ROOT/out.txt" && pass "kunci awalan (16 cocok 16.4)" || fail "kunci awalan"
grep -qE '^node +22 +22.12.0 +OK' "$ROOT/out.txt" && pass "node cocok" || fail "node"
grep -qE '^hermes .*TIDAK TERPASANG' "$ROOT/out.txt" && pass "hermes tak terpasang dilaporkan" || fail "hermes"
[[ $code -eq 0 ]] && pass "tanpa selisih: kode 0" || { fail "kode keluar $code"; cat "$ROOT/out.txt"; }
STUB_OMP=18.13.0 run_check; code=$?
grep -qE '^omp +18.12.6 +18.13.0 +BERBEDA' "$ROOT/out.txt" && pass "selisih terdeteksi" || fail "selisih tidak terdeteksi"
[[ $code -eq 1 ]] && pass "selisih: kode 1" || fail "kode keluar $code"
STUB_OMP=18.13.0 run_check --lenient; code=$?
[[ $code -eq 0 ]] && pass "--lenient: kode 0" || fail "lenient kode $code"

echo "deploy.sh"
mkdir -p "$ROOT/repo"
run_deploy() {
  : > "$LOG"
  PATH="$STUBS:$PATH" STUB_LOG="$LOG" AIOS_BACKUP_ENV="$ROOT/backup.env" AIOS_BACKUP_LOCK="$ROOT/lock" TMPDIR="$ROOT" \
    AIOS_REPO="$ROOT/repo" COMPOSE_DIR="$ROOT/compose" READY_TIMEOUT=3 READY_INTERVAL=1 AIOS_OUTBOX="$ROOT/outbox" \
    bash "$HERE/deploy.sh" "$@" > "$ROOT/out.txt" 2>&1
}
run_deploy; code=$?
[[ $code -eq 0 ]] && pass "berhasil (kode 0)" || { fail "kode keluar $code"; cat "$ROOT/out.txt"; }
expect_log 'restic backup --tag aios' "backup dijalankan sebelum deploy"
expect_log 'docker tag aios-gateway:latest aios-gateway:previous' "image berjalan ditandai :previous"
expect_log 'docker compose build gateway' "build image"
[[ -d "$ROOT/outbox" ]] && pass "folder kiriman dibuat sebelum compose" || fail "folder kiriman tidak dibuat"
expect_log 'docker compose up -d gateway' "gateway dijalankan (migrasi di kontainer)"
expect_log 'curl .*v1/readyz' "menunggu /readyz"
expect_no_log 'docker tag aios-gateway:previous aios-gateway:latest' "tanpa rollback saat berhasil"
grep -q "gateway v1.0.0 berjalan" "$ROOT/out.txt" && pass "melaporkan versi" || fail "versi tidak dilaporkan"

echo "deploy.sh: /readyz gagal -> rollback"
STUB_READY=503 run_deploy --no-backup; code=$?
[[ $code -eq 1 ]] && pass "gagal (kode 1)" || fail "kode keluar $code"
expect_log 'docker tag aios-gateway:previous aios-gateway:latest' "image sebelumnya dikembalikan"
expect_log 'docker compose up -d --no-build gateway' "image sebelumnya dijalankan ulang"
grep -q "ROLLBACK" "$ROOT/out.txt" && pass "rollback dicatat" || fail "rollback tidak dicatat"

echo "deploy.sh: build gagal -> image baru tidak dijalankan"
STUB_BUILD_FAIL=1 run_deploy --no-backup; code=$?
[[ $code -eq 1 ]] && pass "gagal (kode 1)" || fail "kode keluar $code"
expect_no_log 'docker compose up -d gateway$' "image baru tidak dijalankan"
expect_log 'docker tag aios-gateway:previous aios-gateway:latest' "rollback setelah build gagal"

echo "deploy.sh: backup gagal, tanpa image lama, --ref, dry-run"
STUB_EMPTY_DUMP=1 run_deploy; code=$?
[[ $code -eq 1 ]] && pass "backup gagal: deploy dibatalkan" || fail "kode keluar $code"
expect_no_log 'docker compose build' "tidak build bila backup gagal"
STUB_NO_IMAGE=1 STUB_READY=503 run_deploy --no-backup; code=$?
[[ $code -eq 1 ]] && grep -q "tidak ada image sebelumnya" "$ROOT/out.txt" && pass "tanpa image lama: gagal jujur, tanpa rollback palsu" || fail "perilaku tanpa image lama"
run_deploy --no-backup --ref v1.0.0; code=$?
[[ $code -eq 0 ]] && pass "--ref berhasil" || fail "--ref kode $code"
expect_log 'git checkout --quiet v1.0.0' "checkout ke ref"
STUB_DIRTY=1 run_deploy --no-backup --ref v1.0.0; code=$?
[[ $code -eq 1 ]] && grep -q "perubahan lokal" "$ROOT/out.txt" && pass "menolak pindah ref bila ada perubahan lokal" || fail "tidak menolak ref saat dirty"
run_deploy --dry-run --no-backup; code=$?
[[ $code -eq 0 ]] && pass "dry-run berhasil" || fail "dry-run kode $code"
expect_no_log '^docker compose (build|up)' "dry-run tidak menjalankan docker compose"

echo "auto-deploy.sh"
run_auto() {
  : > "$LOG"
  PATH="$STUBS:$PATH" STUB_LOG="$LOG" AIOS_REPO="$ROOT/repo" AIOS_DEPLOY_STATE="$ROOT/ad-state"     AIOS_DEPLOY_CMD="$STUBS/fake-deploy" bash "$HERE/auto-deploy.sh" "$@" > "$ROOT/out.txt" 2>&1
}
rm -rf "$ROOT/ad-state"
STUB_TAGS="v1.0.0 v1.0.9 v1.0.10" run_auto; code=$?
[[ $code -eq 0 ]] && pass "versi baru: berhasil" || { fail "kode keluar $code"; cat "$ROOT/out.txt"; }
expect_log 'sudo -n systemctl start aios-backup.service' "backup dijalankan lebih dulu"
expect_log 'deploy --ref v1.0.10 --no-backup' "tag terbaru dipilih urut versi (v1.0.10 > v1.0.9)"
[[ "$(cat "$ROOT/ad-state/deployed")" == "v1.0.10" ]] && pass "versi terpasang dicatat" || fail "status deployed salah"
STUB_TAGS="v1.0.0 v1.0.10" run_auto; code=$?
expect_no_log '^deploy ' "versi sama: tidak deploy lagi"
STUB_TAGS="v1.0.0 v1.0.10 v1.0.11" STUB_DEPLOY_FAIL=1 run_auto; code=$?
[[ $code -eq 1 ]] && pass "deploy gagal: kode 1" || fail "kode keluar $code"
[[ "$(cat "$ROOT/ad-state/failed")" == "v1.0.11" ]] && pass "tag gagal dicatat" || fail "status failed salah"
[[ "$(cat "$ROOT/ad-state/deployed")" == "v1.0.10" ]] && pass "versi terpasang tetap v1.0.10" || fail "deployed berubah"
STUB_TAGS="v1.0.0 v1.0.10 v1.0.11" run_auto; code=$?
[[ $code -eq 0 ]] && expect_no_log '^deploy ' "tag yang pernah gagal tidak diulang" || fail "kode keluar $code"
STUB_TAGS="v1.0.0 v1.0.10 v1.0.12" run_auto; code=$?
expect_log 'deploy --ref v1.0.12 --no-backup' "tag lebih baru dicoba setelah yang gagal"
rm -rf "$ROOT/ad-state"
STUB_TAGS="v1.0.1" STUB_SUDO_FAIL=1 run_auto; code=$?
[[ $code -eq 1 ]] && pass "backup tidak jalan: dibatalkan" || fail "kode keluar $code"
expect_no_log '^deploy ' "tanpa backup tidak deploy"
echo "loadtest.mjs"
if node --test "$HERE/make-latest-json.test.mjs" > "$ROOT/out.txt" 2>&1; then pass "latest.json updater"; else fail "uji make-latest-json"; cat "$ROOT/out.txt"; fi
if node --test "$HERE/loadtest.test.mjs" > "$ROOT/out.txt" 2>&1; then pass "fungsi ringkasan CPU/memori"; else fail "uji fungsi loadtest"; cat "$ROOT/out.txt"; fi
if node "$HERE/loadtest.mjs" --mock --interval-ms 200 --out "$ROOT/load.json" > "$ROOT/out.txt" 2>&1; then
  grep -q '"completed"' "$ROOT/load.json" && pass "alur 5 run + riset terhadap server palsu" || fail "hasil tidak berisi status completed"
else
  fail "loadtest --mock gagal"; cat "$ROOT/out.txt"
fi
grep -q 'mock-access' "$ROOT/out.txt" && fail "token tercetak" || pass "token tidak tercetak"

echo
if [[ $FAILURES -eq 0 ]]; then echo "SEMUA LULUS"; else echo "$FAILURES pemeriksaan gagal"; exit 1; fi
