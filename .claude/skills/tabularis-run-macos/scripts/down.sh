#!/usr/bin/env bash
# Close the session, stop the app and tauri-wd, restore the user's config.
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel)
RUN_DIR=${RUN_DIR:-${TMPDIR:-/tmp}/tabularis-run}
CFG="$HOME/Library/Application Support/tabularis"

[ -f "$RUN_DIR/sid" ] && curl -s -X DELETE "127.0.0.1:4444/session/$(cat "$RUN_DIR/sid")" >/dev/null
pkill -f "target/debug/tabularis"
pkill -f "tauri-wd --port 4444"

if [ -d "$RUN_DIR/cfg-backup" ]; then
  cp "$RUN_DIR/cfg-backup/"* "$CFG/" && echo "config restored"
  rm -rf "$RUN_DIR/cfg-backup"
fi
rm -f "$ROOT/e2e/.drv-start.mjs" "$ROOT/e2e/.drv-act.mjs" "$RUN_DIR/sid"
