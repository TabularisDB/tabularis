#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/web-ui-project/e2e/docker-compose.yml"
MANAGED_DATABASES="${TABULARIS_E2E_MANAGED_DATABASES:-0}"

cd "$ROOT_DIR"

cleanup() {
  if [[ "$MANAGED_DATABASES" != "1" ]]; then
    docker compose -f "$COMPOSE_FILE" down --volumes --remove-orphans
  fi
}
trap cleanup EXIT

if [[ "$MANAGED_DATABASES" != "1" ]]; then
  docker compose -f "$COMPOSE_FILE" up --detach --wait
fi

pnpm typecheck:web-e2e

if [[ "${TABULARIS_E2E_SKIP_BUILD:-0}" != "1" ]]; then
  pnpm --filter @tabularis/web-ui build
  cargo build --manifest-path src-tauri/Cargo.toml
fi

if [[ -z "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" && -x /usr/bin/chromium ]]; then
  export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
fi

pnpm exec playwright test \
  --config web-ui-project/e2e/playwright.config.ts \
  "$@"
