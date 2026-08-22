#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${TABULARIS_E2E_RUNTIME_DIR:-$ROOT_DIR/web-ui-project/.runtime/e2e}"
RUNTIME_DIR="$(python3 -c 'import os, sys; print(os.path.abspath(sys.argv[1]))' "$RUNTIME_DIR")"
if [[ "$RUNTIME_DIR" == "/" || "$RUNTIME_DIR" == "$ROOT_DIR" || "$RUNTIME_DIR" == "$HOME" ]]; then
  echo "Refusing to clear unsafe E2E runtime directory: $RUNTIME_DIR" >&2
  exit 1
fi
PORT="${TABULARIS_E2E_PORT:-18080}"
CONFIG_HOME="$RUNTIME_DIR/config"
DATA_HOME="$RUNTIME_DIR/data"
APP_CONFIG_DIR="$CONFIG_HOME/tabularis"
APP_DATA_DIR="$DATA_HOME/tabularis"
LAUNCH_URL_FILE="${TABULARIS_E2E_LAUNCH_URL_FILE:-$RUNTIME_DIR/launch-url}"
SQLITE_PATH="${TABULARIS_E2E_SQLITE_PATH:-$RUNTIME_DIR/tabularis-e2e.sqlite}"
FIXTURE_PLUGINS="$ROOT_DIR/web-ui-project/e2e/fixtures/plugins"

rm -rf "$RUNTIME_DIR"
mkdir -p "$APP_CONFIG_DIR" "$APP_DATA_DIR/plugins" "$RUNTIME_DIR/home" "$RUNTIME_DIR/bin"
cp -R "$FIXTURE_PLUGINS"/. "$APP_DATA_DIR/plugins/"

cat >"$APP_CONFIG_DIR/config.json" <<'JSON'
{
  "activeExternalDrivers": ["e2e-driver", "e2e-ui-extension"],
  "showWelcome": false,
  "checkForUpdates": false,
  "autoCheckUpdatesOnStartup": false,
  "pingInterval": 0
}
JSON

python3 - "$SQLITE_PATH" <<'PY'
import sqlite3
import sys

connection = sqlite3.connect(sys.argv[1])
connection.execute(
    "CREATE TABLE IF NOT EXISTS tabularis_web_e2e "
    "(id INTEGER PRIMARY KEY, value VARCHAR(64))"
)
connection.commit()
connection.close()
PY

cat >"$RUNTIME_DIR/bin/xdg-open" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" >"$TABULARIS_E2E_LAUNCH_URL_FILE"
SH
chmod +x "$RUNTIME_DIR/bin/xdg-open"
rm -f "$LAUNCH_URL_FILE"

export HOME="$RUNTIME_DIR/home"
export XDG_CONFIG_HOME="$CONFIG_HOME"
export XDG_DATA_HOME="$DATA_HOME"
export TABULARIS_E2E_LAUNCH_URL_FILE="$LAUNCH_URL_FILE"
export BROWSER="$RUNTIME_DIR/bin/xdg-open"
export PATH="$RUNTIME_DIR/bin:$PATH"

exec "$ROOT_DIR/src-tauri/target/debug/tabularis" \
  --web \
  --host 127.0.0.1 \
  --port "$PORT" \
  --web-root "$ROOT_DIR/packages/web-ui/dist"
