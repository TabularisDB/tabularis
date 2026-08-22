#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $0 <assets|headless|all> <path-to-deb-or-AppImage>" >&2
  exit 2
}

mode=${1:-}
artifact=${2:-}
case "$mode" in
  assets|headless|all) ;;
  *) usage ;;
esac
[[ -f "$artifact" ]] || usage
artifact=$(realpath "$artifact")

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
source_web_root="$repo_root/packages/web-ui/dist"
extract_root=$(mktemp -d)
server_pid=

cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$extract_root"
}
trap cleanup EXIT

case "$artifact" in
  *.deb)
    member=$(ar t "$artifact" | awk '/^data\.tar/{ print; exit }')
    [[ -n "$member" ]] || { echo "The deb does not contain a data archive" >&2; exit 1; }
    case "$member" in
      *.gz) tar_args=(-xz) ;;
      *.xz) tar_args=(-xJ) ;;
      *.zst) tar_args=(--zstd -x) ;;
      *) tar_args=(-x) ;;
    esac
    ar p "$artifact" "$member" | tar "${tar_args[@]}" -C "$extract_root"
    package_root="$extract_root"
    ;;
  *.AppImage)
    chmod +x "$artifact"
    (cd "$extract_root" && "$artifact" --appimage-extract >/dev/null)
    package_root="$extract_root/squashfs-root"
    ;;
  *) usage ;;
esac

binary="$package_root/usr/bin/tabularis"
web_root="$package_root/usr/lib/tabularis/web-ui"

verify_assets() {
  [[ -x "$binary" ]] || { echo "Packaged Tabularis executable is missing" >&2; exit 1; }
  [[ -f "$web_root/index.html" ]] || { echo "Packaged Web UI index is missing" >&2; exit 1; }
  [[ -n "$(find "$web_root/assets" -type f -print -quit 2>/dev/null)" ]] || {
    echo "Packaged Web UI assets are missing" >&2
    exit 1
  }
  cmp "$source_web_root/index.html" "$web_root/index.html"
}

smoke_headless() {
  verify_assets

  local port log response
  port=$(node -e 'const net=require("node:net");const server=net.createServer();server.listen(0,"127.0.0.1",()=>{console.log(server.address().port);server.close();});')
  log="$extract_root/headless.log"
  mkdir -p "$extract_root/home" "$extract_root/config" "$extract_root/data"

  (
    cd /
    unset DISPLAY WAYLAND_DISPLAY XDG_SESSION_TYPE
    HOME="$extract_root/home" \
      XDG_CONFIG_HOME="$extract_root/config" \
      XDG_DATA_HOME="$extract_root/data" \
      "$binary" --web --no-open --port "$port" >"$log" 2>&1
  ) &
  server_pid=$!

  response=
  for _ in $(seq 1 120); do
    response=$(curl -fsS "http://127.0.0.1:$port/healthz" 2>/dev/null || true)
    [[ "$response" == "ok" ]] && break
    if ! kill -0 "$server_pid" 2>/dev/null; then
      cat "$log" >&2
      echo "Packaged Tabularis exited before becoming healthy" >&2
      exit 1
    fi
    sleep 0.25
  done
  [[ "$response" == "ok" ]] || { cat "$log" >&2; echo "Headless health check timed out" >&2; exit 1; }
}

case "$mode" in
  assets) verify_assets ;;
  headless) smoke_headless ;;
  all) verify_assets; smoke_headless ;;
esac
