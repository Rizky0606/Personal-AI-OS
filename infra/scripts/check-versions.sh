#!/usr/bin/env bash
# Membandingkan versi tool yang terpasang di VPS dengan yang terkunci di infra/VERSIONS.md
# (blok antara <!-- versions:begin --> dan <!-- versions:end -->).
#   check-versions.sh            # tabel; kode keluar 1 bila ada yang berbeda atau tidak terpasang
#   check-versions.sh --lenient  # kode keluar 0 walau ada yang berbeda (hanya melaporkan)
# Hanya membaca; tidak mengubah apa pun. Tidak mencetak rahasia.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSIONS_FILE="${VERSIONS_FILE:-$HERE/../VERSIONS.md}"
COMPOSE_DIR="${COMPOSE_DIR:-/srv/personal-ai-os}"
LENIENT=0; [[ "${1:-}" == "--lenient" ]] && LENIENT=1

[[ -f "$VERSIONS_FILE" ]] || { echo "GAGAL: $VERSIONS_FILE tidak ada" >&2; exit 2; }

lock() { sed -n '/<!-- versions:begin -->/,/<!-- versions:end -->/p' "$VERSIONS_FILE" | grep -E "^$1=" | head -n1 | cut -d= -f2- | tr -d '[:space:]'; }
first_version() { grep -oE '[0-9]+(\.[0-9]+)+' | head -n1; }

installed() {
  case "$1" in
    omp)      command -v omp >/dev/null && omp --version 2>/dev/null | first_version ;;
    9router)  command -v 9router >/dev/null && 9router --version 2>/dev/null | first_version ;;
    hermes)   command -v hermes >/dev/null && hermes --version 2>/dev/null | first_version ;;
    node)     command -v node >/dev/null && node --version 2>/dev/null | first_version ;;
    postgres) command -v docker >/dev/null && (cd "$COMPOSE_DIR" 2>/dev/null && docker compose exec -T postgres postgres --version 2>/dev/null) | first_version ;;
    searxng)  command -v docker >/dev/null && (cd "$COMPOSE_DIR" 2>/dev/null && docker compose images searxng --format '{{.Tag}}' 2>/dev/null) | head -n1 ;;
  esac
}

# Kunci boleh berupa awalan ("16" cocok dengan 16.4; "22" dengan 22.12.0).
matches() { [[ "$2" == "$1" || "$2" == "$1".* ]]; }

printf '%-10s %-14s %-14s %s\n' TOOL TERKUNCI TERPASANG STATUS
bad=0
for tool in omp 9router hermes searxng postgres node; do
  want="$(lock "$tool")"; have="$(installed "$tool" || true)"
  if [[ -z "$have" ]]; then status="TIDAK TERPASANG"; [[ -n "$want" ]] && bad=1
  elif [[ -z "$want" ]]; then status="BELUM DIKUNCI (catat $have di VERSIONS.md)"
  elif matches "$want" "$have"; then status="OK"
  else status="BERBEDA"; bad=1; fi
  printf '%-10s %-14s %-14s %s\n' "$tool" "${want:--}" "${have:--}" "$status"
done

if [[ $bad -ne 0 && $LENIENT -eq 0 ]]; then exit 1; fi
exit 0
