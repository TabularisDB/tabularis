#!/usr/bin/env bash
# Build the debug app with the in-app WebDriver server, start tauri-wd and open
# a session on the real app. macOS only.
#
#   SKIP_BUILD=1  reuse the last build (only when the branch has not changed)
#   RUN_DIR=...   where session state, backups and screenshots go
set -euo pipefail

[ "$(uname)" = Darwin ] || { echo "macOS only"; exit 1; }

ROOT=$(git rev-parse --show-toplevel)
HERE=$(cd "$(dirname "$0")" && pwd)
RUN_DIR=${RUN_DIR:-${TMPDIR:-/tmp}/tabularis-run}
CFG="$HOME/Library/Application Support/tabularis"
mkdir -p "$RUN_DIR"

# Debug builds read and write the user's real config dir. Back it up once per
# run so down.sh can put it back.
if [ ! -d "$RUN_DIR/cfg-backup" ]; then
  mkdir -p "$RUN_DIR/cfg-backup"
  for f in config.json connections.dev.json; do
    [ -f "$CFG/$f" ] && cp "$CFG/$f" "$RUN_DIR/cfg-backup/"
  done
fi

command -v tauri-wd >/dev/null || {
  echo "tauri-wd missing: cargo install tauri-webdriver-automation --version 0.1.3 --locked"
  exit 1
}
[ -d "$ROOT/e2e/node_modules" ] || (cd "$ROOT/e2e" && pnpm install --frozen-lockfile)

# `tauri build --debug` embeds the current dist/ in the binary (served from
# tauri://localhost), so no Vite server is needed. A plain `cargo build` would
# ship whatever stale dist/ is on disk.
if [ "${SKIP_BUILD:-0}" != 1 ]; then
  (cd "$ROOT" && pnpm tauri build --debug --no-bundle -- --features e2e-testing)
fi

# The binary lands in cargo's target dir, which may be redirected globally
# (~/.cargo/config.toml target-dir), not in src-tauri/target.
TARGET=$(cd "$ROOT/src-tauri" && cargo metadata --format-version 1 --no-deps |
  python3 -I -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')
BIN="$TARGET/debug/tabularis"
[ -x "$BIN" ] || { echo "binary not found: $BIN"; exit 1; }

if ! curl -s 127.0.0.1:4444/status >/dev/null 2>&1; then
  nohup tauri-wd --port 4444 >"$RUN_DIR/tauri-wd.log" 2>&1 &
  for _ in $(seq 1 30); do
    curl -s 127.0.0.1:4444/status >/dev/null 2>&1 && break
    sleep 1
  done
fi

# webdriverio resolves from e2e/node_modules, so the driver scripts run from e2e/.
cp "$HERE/start.mjs" "$ROOT/e2e/.drv-start.mjs"
cp "$HERE/act.mjs" "$ROOT/e2e/.drv-act.mjs"
cp "$HERE/helpers.js" "$RUN_DIR/helpers.js"

[ -x "$RUN_DIR/wid" ] || swiftc -O "$HERE/wid.swift" -o "$RUN_DIR/wid"

(cd "$ROOT/e2e" && node .drv-start.mjs "$BIN" "$RUN_DIR/sid")
echo "RUN_DIR=$RUN_DIR"
