#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

pnpm test --run packages/web-ui/tests/api/transports/httpTransport.test.ts

cd src-tauri
cargo test transport::web::events_tests --lib
cargo test bounds_slow_rpc_work_per_session_and_across_the_server --lib
cargo test application::queries::tests --lib
cargo test session_cleanup --lib
cargo test runtime_api_clears_browser_preferences_when_a_session_ends --lib
cargo test browser_active_connections_are_isolated_by_session --lib
cargo test crashed_plugin_process_fails_pending_calls_without_hanging --lib
cargo test test_spawn_error_identifies_configured_program --lib
cargo test connection_test_failures_emit_correlated_progress --lib
cargo test runtime::tests --lib
