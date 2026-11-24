//! Migrations for already-persisted connection data — rewriting values on
//! disk that a previous version of the app saved incorrectly. Each migration
//! is path-based (no `AppHandle` dependency) so it can run from both the GUI
//! process's Tauri commands and the standalone `--mcp` server process, which
//! reads and (as of the SSL-mode migration below) writes the same
//! `connections.json` but has no Tauri context.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::drivers::driver_trait::SqlDialect;
use crate::drivers::registry as driver_registry;
use crate::models::SavedConnection;
use crate::persistence;
/// The SSL mode dropdown used to branch on `driver === "postgres"` literally
/// (issue #614), so a postgres-dialect driver with a different id (e.g. the
/// standalone PostgreSQL plugin, id `"postgresql"`) offered MySQL-style
/// underscored `ssl_mode` values instead of Postgres-style hyphenated ones.
/// The plugin's own TLS check only recognizes the hyphenated spelling, so a
/// connection saved with the wrong-family value connects in cleartext with no
/// error. Fixing the dropdown only stops *new* saves from getting the wrong
/// value — this rewrites values already persisted before the fix shipped.
///
/// Maps a stale MySQL-style `ssl_mode` value to its Postgres-style
/// equivalent. Returns `None` for a value that isn't one of the stale
/// MySQL-style spellings (including values already correct, or driver-
/// specific values like ClickHouse's `"disable"`/`"require"`, which happen to
/// already be spelled correctly in both families and need no rewrite).
pub(crate) fn stale_postgres_ssl_mode_replacement(value: &str) -> Option<&'static str> {
    match value {
        "disabled" => Some("disable"),
        "preferred" => Some("prefer"),
        "required" => Some("require"),
        "verify_ca" => Some("verify-ca"),
        "verify_identity" => Some("verify-full"),
        _ => None,
    }
}

/// Rewrites `conn.params.ssl_mode` in place if `conn`'s driver resolves (via
/// `dialects`) to the postgres SQL dialect and its stored value is a stale
/// MySQL-style spelling. A driver whose manifest doesn't declare
/// `sql_dialect` (`None`, or absent from the map because it never resolved)
/// is treated as NOT postgres — deliberately not defaulted, unlike the
/// splitter's own historical postgres-default, because this migration must
/// distinguish "explicitly postgres" from "unspecified" to avoid rewriting a
/// driver's SSL value based on a guess.
/// Pure and synchronous so it can be exercised directly in tests without a
/// live driver registry. Returns whether a rewrite happened.
pub(crate) fn migrate_connection_ssl_mode_in_place(
    conn: &mut SavedConnection,
    dialects: &HashMap<String, Option<SqlDialect>>,
) -> bool {
    let is_postgres_dialect = dialects
        .get(&conn.params.driver)
        .copied()
        .flatten()
        .is_some_and(|d| d == SqlDialect::Postgres);
    if !is_postgres_dialect {
        return false;
    }
    let Some(stale) = conn.params.ssl_mode.as_deref() else {
        return false;
    };
    let Some(replacement) = stale_postgres_ssl_mode_replacement(stale) else {
        return false;
    };
    conn.params.ssl_mode = Some(replacement.to_string());
    true
}

/// True if `connections.json` changed since `content_before` was captured —
/// i.e. another process wrote a concurrent edit while this migration was
/// computing its own rewrite. Pure and synchronous so the concurrency guard
/// itself can be tested without touching the driver registry or the
/// filesystem beyond what the caller already read.
///
/// Content comparison (not mtime) is used deliberately: some filesystems
/// have coarse (1-second) mtime resolution, which wouldn't reliably detect
/// two writes landing within the same second.
pub(crate) fn connections_file_changed_concurrently(
    content_before: &str,
    content_now: &str,
) -> bool {
    content_before != content_now
}

/// Migrates already-persisted `ssl_mode` values on postgres-dialect
/// connections from the stale MySQL-style spelling to the Postgres-style
/// spelling the plugin actually understands. Idempotent — a no-op once
/// every affected connection has been rewritten.
///
/// Path-based, no `AppHandle` — callable from both the GUI process (wrapped
/// by `commands::migrate_postgres_ssl_mode_spelling`, which additionally
/// invalidates the connection cache) and the standalone `--mcp` server
/// process, which has no Tauri context and no cache to invalidate.
///
/// Returns `Ok(true)` only once the rewrite has actually been committed to
/// disk — `Ok(false)` covers both "nothing needed migrating" and "a
/// migration was computed but skipped because the file changed concurrently"
/// (see the concurrency note below).
///
/// # Concurrency
///
/// This is the first write path the `--mcp` process exercises against
/// `connections.json` — previously read-only there. The GUI app enforces
/// single-instance, but MCP clients (Claude Desktop, Cursor, etc.) spawn
/// `tabularis --mcp` as an independent subprocess that can run at the same
/// time as the GUI, and this repo's connection persistence layer has no file
/// locking anywhere. To avoid silently clobbering a concurrent GUI edit made
/// while this function is mid read-modify-write, the file's raw content is
/// compared immediately before writing (`connections_file_changed_concurrently`);
/// if it changed since this function's own read, the migration is skipped
/// for this run rather than overwritten. This is safe because the migration
/// is idempotent and self-terminating — the next process to load
/// connections (GUI reopen, or MCP's next startup) will see the still-stale
/// value and retry.
pub async fn migrate_postgres_ssl_mode_spelling_at_path(conn_path: &Path) -> Result<bool, String> {
    if !conn_path.exists() {
        return Ok(false); // Nothing to migrate
    }

    let content_before = persistence::with_connections_file_exclusive(|| {
        fs::read_to_string(conn_path).map_err(|e| e.to_string())
    })?;
    let mut conn_file = persistence::parse_connections_file(&content_before)?;

    // Resolve each distinct non-builtin driver id's dialect once, not once
    // per connection — the registry lookup is async and connections commonly
    // share a driver.
    let mut dialects: HashMap<String, Option<SqlDialect>> = HashMap::new();
    for conn in &conn_file.connections {
        let driver_id = &conn.params.driver;
        if dialects.contains_key(driver_id) {
            continue;
        }
        if let Some(driver) = driver_registry::get_driver(driver_id).await {
            dialects.insert(
                driver_id.clone(),
                driver.manifest().capabilities.sql_dialect,
            );
        }
    }

    let mut migrated_count = 0usize;
    for conn in conn_file.connections.iter_mut() {
        if migrate_connection_ssl_mode_in_place(conn, &dialects) {
            migrated_count += 1;
        }
    }

    if migrated_count == 0 {
        return Ok(false); // No migration needed
    }

    eprintln!(
        "[Migration] Rewriting stale ssl_mode spelling on {} postgres-dialect connection(s)",
        migrated_count
    );
    persistence::with_connections_file_exclusive(|| {
        let content_now = fs::read_to_string(conn_path).map_err(|e| e.to_string())?;
        if connections_file_changed_concurrently(&content_before, &content_now) {
            eprintln!(
                "[Migration] connections.json changed concurrently — skipping this run, will retry next launch"
            );
            return Ok(false);
        }
        persistence::write_connections_file(conn_path, &conn_file)?;
        Ok(true)
    })
}

/// The built-in driver id being removed and the plugin id that replaces it.
/// Once the built-in driver is deleted from the codebase, any saved
/// connection still on `"postgres"` can no longer open (`registry::get_driver`
/// returns `None`), so every such connection is force-flipped to
/// `"postgresql"` at launch — no dismissible nudge, no `undoMigration`, no
/// live fallback. This is the one-directional rewrite that makes removal safe.
const FORCE_MIGRATABLE_PAIRS: &[(&str, &str)] = &[("postgres", "postgresql")];

/// Rewrites `conn.params.driver` in place from a built-in id slated for
/// removal to its replacement plugin id. Pure and synchronous so it can be
/// exercised directly in tests without a live driver registry. Returns
/// whether a rewrite happened.
pub(crate) fn migrate_connection_driver_id_in_place(
    conn: &mut SavedConnection,
    pairs: &[(&str, &str)],
) -> bool {
    for &(from, to) in pairs {
        if conn.params.driver == from {
            conn.params.driver = to.to_string();
            return true;
        }
    }
    false
}

/// Force-migrates already-persisted `driver` ids on saved connections from a
/// built-in driver that is being removed to its replacement plugin. Unlike
/// the opt-in `useBuiltinDriverMigration` flow, this runs automatically at
/// launch (no user click, no dismissible banner). There is no
/// `undoMigration` — the built-in driver is gone, so flipping back is not
/// possible.
///
/// Path-based, no `AppHandle` — callable from both the GUI process (wrapped
/// by `commands::migrate_builtin_driver_ids`, which invalidates the
/// connection cache) and the standalone `--mcp` server process. Idempotent —
/// a no-op once every affected connection has been rewritten. Uses the same
/// concurrency guard as [`migrate_postgres_ssl_mode_spelling_at_path`].
///
/// Returns `Ok(true)` only once the rewrite has been committed to disk;
/// `Ok(false)` covers "nothing needed migrating" and "skipped because the
/// file changed concurrently" (see the concurrency note on
/// [`migrate_postgres_ssl_mode_spelling_at_path`]).
///
/// # Known limitation
///
/// The concurrent-edit check narrows the race with another writer but does not
/// close it. The read, the re-read that compares against it, and the save are
/// three separate steps. The in-process file lock covers only the save, and it
/// cannot reach a second process (the GUI and `--mcp` do not share it). An edit
/// that another process commits between the re-read and the save is replaced
/// by the migrated snapshot. The window is short (the `eprintln!` between the
/// check and the save is its main cost), only opens on a launch where a
/// `postgres` connection still needs rewriting, and needs a simultaneous edit
/// from another process, so it is accepted rather than closed. Closing it
/// would take a cross-process file lock (or a compare-and-swap commit) held by
/// every `connections.json` writer.
pub async fn migrate_builtin_driver_ids_at_path(conn_path: &Path) -> Result<bool, String> {
    if !conn_path.exists() {
        return Ok(false); // Nothing to migrate
    }

    let content_before = fs::read_to_string(conn_path).map_err(|e| e.to_string())?;
    let mut conn_file = persistence::parse_connections_file(&content_before)?;

    let mut migrated_count = 0usize;
    for conn in conn_file.connections.iter_mut() {
        if migrate_connection_driver_id_in_place(conn, FORCE_MIGRATABLE_PAIRS) {
            migrated_count += 1;
        }
    }

    if migrated_count == 0 {
        return Ok(false); // No migration needed
    }

    // Bail if another process (e.g. the GUI) saved a concurrent edit while
    // we were computing the migration above — don't blindly overwrite it.
    let content_now = fs::read_to_string(conn_path).map_err(|e| e.to_string())?;
    if connections_file_changed_concurrently(&content_before, &content_now) {
        eprintln!(
            "[Migration] connections.json changed concurrently — skipping this run, will retry next launch"
        );
        return Ok(false);
    }

    eprintln!(
        "[Migration] Force-migrating {} connection(s) from built-in postgres driver to postgresql plugin",
        migrated_count
    );
    persistence::save_connections_file(conn_path, &conn_file)?;
    Ok(true)
}
