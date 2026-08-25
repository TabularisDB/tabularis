use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::task::AbortHandle;
use urlencoding::encode;
use uuid::Uuid;

use crate::credential_cache;
use crate::keychain_utils;
use crate::models::{
    BatchStatementResult, ColumnDefinition, ConnectionGroup, ConnectionParams, ConnectionsFile,
    ExplainQueryOutput, ExportPayload, ForeignKey, Index, K8sConnection, K8sConnectionInput, QueryResult,
    RoutineInfo, RoutineParameter, SavedConnection, SshConnection, SshConnectionInput, SshTestParams,
    TableColumn, TableInfo, TestConnectionRequest, TriggerInfo,
};
use crate::persistence;

// Constants
/// Resolve the driver from the registry or return a descriptive error.
async fn driver_for(
    id: &str,
) -> Result<std::sync::Arc<dyn crate::drivers::driver_trait::DatabaseDriver>, String> {
    crate::drivers::registry::get_driver(id)
        .await
        .ok_or_else(|| format!("Unsupported driver: {}", id))
}

const DEFAULT_MYSQL_PORT: u16 = 3306;
const DEFAULT_POSTGRES_PORT: u16 = 5432;

/// Per-slot collection of abort handles for in-flight cancellable tasks.
/// Used by `QueryCancellationState`, `ExportCancellationState`, and
/// `DumpCancellationState`.
pub(crate) type AbortHandleMap = HashMap<String, Vec<Arc<AbortHandle>>>;

/// Tracks abort handles for in-flight queries keyed by connection id. A
/// slot can hold multiple handles when the UI fires several queries (or
/// an EXPLAIN alongside a query) against the same connection concurrently
/// — `cancel_query` must abort all of them, not just the most recent.
pub struct QueryCancellationState {
    pub handles: Arc<Mutex<AbortHandleMap>>,
}

impl Default for QueryCancellationState {
    fn default() -> Self {
        Self {
            handles: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

/// Push `handle` into the slot for `key`, first pruning any handles that
/// have already finished so the Vec does not grow unboundedly across many
/// sequential queries on the same connection.
pub(crate) fn register_abort_handle(
    handles: &Mutex<AbortHandleMap>,
    key: String,
    handle: Arc<AbortHandle>,
) {
    let mut guard = handles.lock().unwrap();
    let entry = guard.entry(key).or_default();
    entry.retain(|h| !h.is_finished());
    entry.push(handle);
}

/// Remove the specific handle (matched by Arc identity) that a completing
/// task registered, so it cannot fire on a future query that happens to
/// reuse the same slot.
pub(crate) fn unregister_abort_handle(
    handles: &Mutex<AbortHandleMap>,
    key: &str,
    handle: &Arc<AbortHandle>,
) {
    let mut guard = handles.lock().unwrap();
    if let Some(entry) = guard.get_mut(key) {
        entry.retain(|h| !Arc::ptr_eq(h, handle));
        if entry.is_empty() {
            guard.remove(key);
        }
    }
}

// --- Persistence Helpers ---

pub async fn expand_ssh_connection_params<R: Runtime>(
    app: &AppHandle<R>,
    params: &ConnectionParams,
) -> Result<ConnectionParams, String> {
    crate::application::tunnels::expand_connection_params(
        &app.state::<crate::runtime::RuntimeContext>(),
        params,
    )
}

/// Check if a string option is empty or contains only whitespace.
#[inline]
#[cfg(test)]
fn is_empty_or_whitespace(s: &Option<String>) -> bool {
    s.as_ref().map(|p| p.trim().is_empty()).unwrap_or(true)
}

/// Reject a connection attempt under AWS IAM auth when neither the raw form
/// payload nor the expanded params (after SSH/K8s expansion) carry an RDS
/// auth token. Both `test_connection` and `list_databases` run this guard
/// before any pool / driver work so the user gets an actionable message
/// instead of the opaque "Access denied" the server returns on an empty
/// password.
fn require_iam_token(
    iam_auth: bool,
    request_password: Option<&str>,
    expanded_password: Option<&str>,
) -> Result<(), String> {
    if iam_auth
        && request_password.unwrap_or("").is_empty()
        && expanded_password.unwrap_or("").is_empty()
    {
        return Err(
            "AWS IAM authentication is enabled but the password field is empty. \
             Paste the output of `aws rds generate-db-auth-token` into the \
             password field and try again. Tokens expire every 15 minutes."
                .to_string(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod require_iam_token_tests {
    use super::require_iam_token;

    #[test]
    fn rejects_iam_with_both_passwords_empty() {
        // The primary case: ad-hoc connection, IAM enabled, nothing in the
        // form and nothing from the keychain.
        let err = require_iam_token(true, None, None).unwrap_err();
        assert!(err.contains("AWS IAM authentication is enabled"));
        assert!(err.contains("15 minutes"));
    }

    #[test]
    fn rejects_iam_with_empty_string_passwords() {
        // Empty strings (rather than None) must also fail — sqlx stamps
        // "" as a deliberate "user pressed Enter" password.
        let err = require_iam_token(true, Some(""), Some("")).unwrap_err();
        assert!(err.contains("AWS IAM authentication is enabled"));
    }

    #[test]
    fn allows_iam_when_request_password_present() {
        // A freshly pasted RDS auth token in the form is enough; the
        // expanded (post-SSH/K8s) value is irrelevant.
        require_iam_token(true, Some("fake-token"), None).unwrap();
    }

    #[test]
    fn allows_iam_when_expanded_password_present() {
        // The expanded value can also satisfy the guard (e.g. an SSH tunnel
        // wrapper injected it).
        require_iam_token(true, None, Some("fake-token")).unwrap();
    }

    #[test]
    fn non_iam_always_passes() {
        // Without IAM, an empty password is the caller's problem; the
        // helper must never reject on its own.
        require_iam_token(false, None, None).unwrap();
        require_iam_token(false, Some(""), Some("")).unwrap();
    }
}

pub fn resolve_connection_params(params: &ConnectionParams) -> Result<ConnectionParams, String> {
    crate::application::tunnels::resolve_expanded_connection_params(params, None)
}

#[cfg(test)]
fn resolve_k8s_params(params: &ConnectionParams) -> Result<ConnectionParams, String> {
    crate::application::tunnels::resolve_expanded_connection_params(params, None)
}

/// Resolve connection params and set connection_id for stable pooling
pub fn resolve_connection_params_with_id(
    params: &ConnectionParams,
    connection_id: &str,
) -> Result<ConnectionParams, String> {
    let mut resolved = resolve_connection_params(params)?;
    resolved.connection_id = Some(connection_id.to_string());
    Ok(resolved)
}

pub fn get_config_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }
    Ok(crate::paths::resolve_connections_path(&config_dir))
}

pub fn get_ssh_config_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }
    Ok(config_dir.join("ssh_connections.json"))
}

fn runtime_connection_uri(params: &ConnectionParams) -> Option<&str> {
    params
        .connection_uri
        .as_deref()
        .filter(|value| !value.trim().is_empty())
}

/// A connection URI embeds credentials, so it may only be persisted behind the
/// OS keychain. Refuse the save rather than silently downgrading to plaintext.
fn validate_connection_uri_persistence(params: &ConnectionParams) -> Result<(), String> {
    if runtime_connection_uri(params).is_some() && !params.save_in_keychain.unwrap_or(false) {
        return Err("Connection URIs must be stored in the OS keychain".to_string());
    }
    Ok(())
}

/// Write the secret first, then persist `connections.json`. If persistence
/// fails the secret is restored to its previous value so the keychain never
/// drifts from the file.
fn persist_secret_change(
    apply: impl FnOnce() -> Result<(), String>,
    persist: impl FnOnce() -> Result<(), String>,
    rollback: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    apply()?;
    match persist() {
        Ok(()) => Ok(()),
        Err(error) => match rollback() {
            Ok(()) => Err(error),
            // Report both: the rollback error alone would hide why the save
            // failed in the first place.
            Err(rollback_error) => Err(format!("{error} ({rollback_error})")),
        },
    }
}

/// `change` is `None` to leave the stored URI untouched, `Some(Some(uri))` to
/// write it, and `Some(None)` to clear it.
fn persist_connection_uri_change(
    cache: &credential_cache::CredentialCache,
    connection_id: &str,
    stored_in_keychain: bool,
    change: Option<Option<&str>>,
    persist: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let Some(value) = change else {
        return persist();
    };
    let previous_keychain = stored_in_keychain
        .then(|| keychain_utils::get_connection_uri(connection_id))
        .transpose()
        .map_err(|_| "Failed to read the stored connection URI from the OS keychain".to_string())?;
    let previous_cache = cache
        .connection_uris
        .lock()
        .unwrap()
        .get(connection_id)
        .cloned();

    persist_secret_change(
        || {
            if let Some(value) = value {
                keychain_utils::set_connection_uri(connection_id, value)?;
                credential_cache::set_connection_uri_cached(cache, connection_id, value);
            } else {
                keychain_utils::delete_connection_uri(connection_id)?;
                credential_cache::invalidate_connection_uri(cache, connection_id);
            }
            Ok(())
        },
        persist,
        || {
            let keychain_result = match previous_keychain.as_deref() {
                Some(value) => keychain_utils::set_connection_uri(connection_id, value),
                None => keychain_utils::delete_connection_uri(connection_id),
            };
            let mut entries = cache.connection_uris.lock().unwrap();
            match (&keychain_result, previous_cache) {
                // Only re-pin the old value once the keychain actually holds it
                // again. If the restore failed, drop the entry so the next read
                // consults the keychain instead of trusting a stale copy.
                (Ok(()), Some(entry)) => _ = entries.insert(connection_id.to_string(), entry),
                (Ok(()), None) | (Err(_), _) => _ = entries.remove(connection_id),
            }
            keychain_result.map_err(|_| "Failed to roll back the stored connection URI".to_string())
        },
    )
}

/// Strip the URI out of the params that go to `connections.json`, leaving only
/// the marker that says a keychain entry exists.
fn params_for_persistence(
    params: &ConnectionParams,
    connection_uri_in_keychain: bool,
) -> ConnectionParams {
    let mut persisted = params.clone();
    persisted.connection_uri = None;
    persisted.connection_uri_in_keychain = connection_uri_in_keychain.then_some(true);
    persisted
}

/// Re-attach the URI a saved connection needs at runtime, from the session
/// cache or the keychain.
fn restore_runtime_connection_uri(
    cache: &credential_cache::CredentialCache,
    connection_id: &str,
    params: &mut ConnectionParams,
) -> Result<(), String> {
    if runtime_connection_uri(params).is_some() {
        return Ok(());
    }

    let stored_in_keychain = params.connection_uri_in_keychain.unwrap_or(false);
    match credential_cache::get_connection_uri_cached(cache, connection_id, stored_in_keychain) {
        Ok(Some(connection_uri)) => {
            params.connection_uri = Some(connection_uri);
            Ok(())
        }
        Ok(None) if stored_in_keychain => {
            Err("Stored connection URI is unavailable in the OS keychain".to_string())
        }
        Ok(None) => Ok(()),
        Err(_) => Err("Failed to read the stored connection URI from the OS keychain".to_string()),
    }
}

pub fn find_connection_by_id<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
) -> Result<SavedConnection, String> {
    let conn_cache =
        app.state::<std::sync::Arc<crate::connection_cache::ConnectionCache>>();

    let mut conn = match conn_cache.lookup(id) {
        crate::connection_cache::CacheLookup::Hit(c) => c,
        crate::connection_cache::CacheLookup::Miss => {
            return Err("Connection not found".to_string())
        }
        crate::connection_cache::CacheLookup::Cold => {
            let path = get_config_path(app)?;
            let conn_file = persistence::load_connections_file(&path).unwrap_or_default();
            conn_cache.populate(&conn_file.connections);
            conn_file
                .connections
                .into_iter()
                .find(|c| c.id == id)
                .ok_or_else(|| "Connection not found".to_string())?
        }
    };

    let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
    restore_runtime_connection_uri(&cache, &conn.id, &mut conn.params)?;

    // Load passwords from keychain via the in-memory cache (warm hit = lookup,
    // cold miss = keychain call + cache). Skip IAM-auth connections: their
    // 15-min tokens must come from the `password` field, never the keychain,
    // so a stale token from an older release can't be surfaced in the modal.
    if conn.params.save_in_keychain.unwrap_or(false)
        && !conn.params.use_iam_auth.unwrap_or(false)
    {
        match credential_cache::get_db_password_cached(&cache, &conn.id) {
            Ok(pwd) => conn.params.password = Some(pwd),
            Err(e) => eprintln!(
                "[Keyring Error] Failed to get DB password for {}: {}",
                conn.id, e
            ),
        }
        if conn.params.ssh_enabled.unwrap_or(false) {
            if let Ok(ssh_pwd) = credential_cache::get_ssh_password_cached(&cache, &conn.id) {
                if !ssh_pwd.trim().is_empty() {
                    conn.params.ssh_password = Some(ssh_pwd);
                }
            }
            if let Ok(ssh_passphrase) =
                credential_cache::get_ssh_key_passphrase_cached(&cache, &conn.id)
            {
                if !ssh_passphrase.trim().is_empty() {
                    conn.params.ssh_key_passphrase = Some(ssh_passphrase);
                }
            }
        }
    }

    Ok(conn)
}

/// Merge a list of incoming groups into an existing list, preserving hierarchy
/// and repairing any `parent_id` that points to a group id not present in the
/// union (i.e. neither in the existing list nor in the incoming batch).
///
/// Behaviour:
/// - Existing groups with the same id are overwritten by the incoming one
///   (so renames / re-ordering / new parent_id from the JSON win).
/// - Missing parents are demoted to root (`parent_id = None`) rather than
///   being rejected, so a partially-malformed JSON still imports successfully
///   and the user keeps most of their tree.
/// - The merge is idempotent: running it twice on the same input is a no-op.
pub(crate) fn merge_groups(existing: &mut Vec<ConnectionGroup>, incoming: Vec<ConnectionGroup>) {
    for new_group in incoming {
        if let Some(existing_group) = existing.iter_mut().find(|g| g.id == new_group.id) {
            *existing_group = new_group;
        } else {
            existing.push(new_group);
        }
    }

    // Build the set of every group id we now have (post-merge) so we can
    // detect parent_ids that no longer point anywhere. Collected into an
    // owned set to release the immutable borrow before we mutate existing.
    let known_ids: std::collections::HashSet<String> =
        existing.iter().map(|g| g.id.clone()).collect();
    for g in existing.iter_mut() {
        if let Some(parent) = g.parent_id.as_deref() {
            if !known_ids.contains(parent) {
                g.parent_id = None;
            }
        }
    }
}

/// Write the connections file and invalidate the in-memory connection cache so
/// the next `find_connection_by_id` call re-reads fresh data from disk.
/// Normalizes and validates a connection environment value. Empty selects
/// "unclassified" (`None`); anything else must be one of the known tiers.
fn validate_environment(env: Option<String>) -> Result<Option<String>, String> {
    match env.as_deref() {
        None | Some("") => Ok(None),
        Some("development" | "staging" | "production") => Ok(env),
        Some(other) => Err(format!("Invalid environment: {other}")),
    }
}

pub(crate) fn save_connections_and_invalidate<R: Runtime>(
    app: &AppHandle<R>,
    path: &std::path::Path,
    file: &crate::models::ConnectionsFile,
) -> Result<(), String> {
    persistence::save_connections_file(path, file)?;
    app.state::<std::sync::Arc<crate::connection_cache::ConnectionCache>>()
        .invalidate();
    Ok(())
}

// --- Commands ---

#[tauri::command]
pub async fn get_connection_by_id<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<SavedConnection, String> {
    find_connection_by_id(&app, &id)
}

#[tauri::command]
pub async fn get_schemas<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<Vec<String>, String> {
    crate::application::metadata::get_schemas(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
    )
    .await
}

#[tauri::command]
pub async fn get_available_databases<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<Vec<String>, String> {
    crate::application::metadata::get_available_databases(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
    )
    .await
}

#[tauri::command]
pub async fn set_selected_databases<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    mut databases: Vec<String>,
) -> Result<(), String> {
    if databases.is_empty() {
        return Err("Database selection cannot be empty".to_string());
    }
    if databases.iter().any(|db| db.trim().is_empty()) {
        return Err("Database names cannot be empty".to_string());
    }

    log::info!(
        "Persisting database selection for connection {}: {} database(s)",
        connection_id,
        databases.len()
    );

    let path = get_config_path(&app)?;
    let mut conn_file = persistence::load_connections_file(&path)?;

    let conn = conn_file
        .connections
        .iter_mut()
        .find(|c| c.id == connection_id)
        .ok_or("Connection not found")?;

    conn.params.database = if databases.len() == 1 {
        crate::models::DatabaseSelection::Single(databases.remove(0))
    } else {
        crate::models::DatabaseSelection::Multiple(databases)
    };

    save_connections_and_invalidate(&app, &path, &conn_file)
}

#[tauri::command]
pub async fn get_routines<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<RoutineInfo>, String> {
    crate::application::metadata::get_routines(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_routine_parameters<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    routine_name: String,
    schema: Option<String>,
) -> Result<Vec<RoutineParameter>, String> {
    crate::application::database_objects::get_routine_parameters(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        routine_name,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_routine_definition<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    routine_name: String,
    routine_type: String, // "PROCEDURE" or "FUNCTION" - mainly for MySQL SHOW CREATE
    schema: Option<String>,
) -> Result<String, String> {
    crate::application::database_objects::get_routine_definition(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        routine_name,
        routine_type,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn build_routine_call_sql<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    routine_name: String,
    routine_type: String,
    args: Vec<crate::models::RoutineCallArg>,
    schema: Option<String>,
) -> Result<String, String> {
    crate::application::database_objects::build_routine_call_sql(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        routine_name,
        routine_type,
        args,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_routine_create_template<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    routine_type: String,
    schema: Option<String>,
) -> Result<String, String> {
    crate::application::database_objects::get_routine_create_template(
        &app.state::<crate::runtime::RuntimeContext>(),
        &connection_id,
        routine_type,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_routine_edit_script<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    routine_name: String,
    routine_type: String,
    schema: Option<String>,
) -> Result<String, String> {
    crate::application::database_objects::get_routine_edit_script(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        routine_name,
        routine_type,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn drop_routine<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    routine_name: String,
    routine_type: String,
    schema: Option<String>,
) -> Result<(), String> {
    crate::application::database_objects::drop_routine(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        routine_name,
        routine_type,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_schema_snapshot<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<crate::models::TableSchema>, String> {
    crate::application::metadata::get_schema_snapshot(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_ai_schema_context<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    schema: Option<String>,
) -> Result<String, String> {
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    let driver = driver_for(&saved_conn.params.driver).await?;
    let identifier_quote = driver.manifest().capabilities.identifier_quote.as_str();
    let context = driver
        .get_ai_schema_context(
            &params,
            schema.as_deref(),
            crate::ai_schema_context::DEFAULT_MAX_TABLES,
        )
        .await?;

    Ok(crate::ai_schema_context::format_for_prompt(
        &context,
        identifier_quote,
    ))
}

#[tauri::command]
pub async fn save_connection<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    params: ConnectionParams,
    detect_json_in_text_columns: Option<bool>,
    environment: Option<String>,
) -> Result<SavedConnection, String> {
    log::info!("Saving new connection: {}", name);
    validate_connection_uri_persistence(&params)?;

    let path = get_config_path(&app)?;
    let mut conn_file = persistence::load_connections_file(&path).unwrap_or_default();

    let id = Uuid::new_v4().to_string();
    let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
    let connection_uri = runtime_connection_uri(&params).map(str::to_owned);
    let mut params_to_save = params_for_persistence(&params, connection_uri.is_some());

    if params.save_in_keychain.unwrap_or(false) {
        log::debug!("Storing passwords in keychain for connection: {}", name);
        if let Some(pwd) = &params.password {
            keychain_utils::set_db_password(&id, pwd)?;
            credential_cache::set_db_password_cached(&cache, &id, pwd);
        }
        if params.ssh_enabled.unwrap_or(false) {
            if let Some(ssh_pwd) = &params.ssh_password {
                keychain_utils::set_ssh_password(&id, ssh_pwd)?;
                credential_cache::set_ssh_password_cached(&cache, &id, ssh_pwd);
            }
            if let Some(ssh_passphrase) = &params.ssh_key_passphrase {
                if !ssh_passphrase.trim().is_empty() {
                    keychain_utils::set_ssh_key_passphrase(&id, ssh_passphrase)?;
                    credential_cache::set_ssh_key_passphrase_cached(&cache, &id, ssh_passphrase);
                }
            }
        }
        params_to_save.password = None;
        params_to_save.ssh_password = None;
        params_to_save.ssh_key_passphrase = None;
    }

    let new_conn = SavedConnection {
        id: id.clone(),
        name: name.clone(),
        params: params_to_save,
        group_id: None,
        sort_order: None,
        detect_json_in_text_columns,
        appearance: None,
        tag_ids: None,
        environment: validate_environment(environment)?,
    };
    conn_file.connections.push(new_conn.clone());
    persist_connection_uri_change(
        &cache,
        &id,
        false,
        connection_uri.as_deref().map(Some),
        || save_connections_and_invalidate(&app, &path, &conn_file),
    )?;

    log::info!("Connection saved successfully: {} (ID: {})", name, id);

    let mut returned_conn = new_conn;
    returned_conn.params = params; // Return with password for frontend state
    Ok(returned_conn)
}

#[tauri::command]
pub async fn delete_connection<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    log::info!("Deleting connection: {}", id);

    let path = get_config_path(&app)?;
    if !path.exists() {
        return Ok(());
    }

    let mut conn_file = persistence::load_connections_file(&path)?;

    let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
    let uri_stored_in_keychain = conn_file
        .connections
        .iter()
        .find(|c| c.id == id)
        .and_then(|c| c.params.connection_uri_in_keychain)
        .unwrap_or(false);

    // Capture the appearance before retain so we can cascade-delete the icon file.
    let appearance_to_delete = conn_file
        .connections
        .iter()
        .find(|c| c.id == id)
        .and_then(|c| c.appearance.clone());

    let initial_count = conn_file.connections.len();
    conn_file.connections.retain(|c| c.id != id);
    let deleted = conn_file.connections.len() < initial_count;

    // Attempt to remove passwords from keychain (ignore if not found)
    keychain_utils::delete_db_password(&id).ok();
    keychain_utils::delete_ssh_password(&id).ok();
    keychain_utils::delete_ssh_key_passphrase(&id).ok();
    persist_connection_uri_change(&cache, &id, uri_stored_in_keychain, Some(None), || {
        save_connections_and_invalidate(&app, &path, &conn_file)
    })?;
    // Invalidate the in-memory cache for this connection
    credential_cache::invalidate_all_for_connection(&cache, &id);

    // Cascade-delete the custom icon file if the connection used one.
    if let Ok(app_data) = app.path().app_data_dir() {
        let _ = crate::connection_appearance::cascade_delete_if_image(
            &app_data,
            appearance_to_delete.as_ref(),
        );
    }

    // Clean up query history for this connection
    if let Err(e) = crate::query_history::remove_history_for_connection(&app, &id).await {
        log::warn!("Failed to remove query history for connection {}: {}", id, e);
    }

    if deleted {
        log::info!("Connection deleted successfully: {}", id);
    } else {
        log::warn!("Connection not found for deletion: {}", id);
    }

    Ok(())
}

#[tauri::command]
pub async fn update_connection<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    name: String,
    params: ConnectionParams,
    detect_json_in_text_columns: Option<bool>,
    environment: Option<String>,
) -> Result<SavedConnection, String> {
    validate_connection_uri_persistence(&params)?;
    let path = get_config_path(&app)?;
    let mut conn_file = persistence::load_connections_file(&path)?;

    let conn_idx = conn_file
        .connections
        .iter()
        .position(|c| c.id == id)
        .ok_or("Connection not found")?;

    let existing_uri_in_keychain = conn_file.connections[conn_idx]
        .params
        .connection_uri_in_keychain
        .unwrap_or(false);
    // A stored URI belongs to the driver that produced it. Switching drivers
    // must drop it rather than hand one driver's credentials to another.
    let same_driver = conn_file.connections[conn_idx].params.driver == params.driver;
    let connection_uri = runtime_connection_uri(&params).map(str::to_owned);
    // The frontend sends the URI back only when the user retyped it. An edit
    // that leaves the field untouched must keep the stored secret; an edit that
    // explicitly clears the marker must delete it.
    let preserve_stored_uri = connection_uri.is_none()
        && same_driver
        && params.save_in_keychain.unwrap_or(false)
        && existing_uri_in_keychain
        && params.connection_uri_in_keychain != Some(false);
    let uri_change = match connection_uri.as_deref() {
        Some(value) => Some(Some(value)),
        None if preserve_stored_uri => None,
        None => Some(None),
    };
    let mut params_to_save =
        params_for_persistence(&params, connection_uri.is_some() || preserve_stored_uri);

    let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
    if params.save_in_keychain.unwrap_or(false) {
        if let Some(pwd) = &params.password {
            keychain_utils::set_db_password(&id, pwd)?;
            credential_cache::set_db_password_cached(&cache, &id, pwd);
        }
        if params.ssh_enabled.unwrap_or(false) {
            if let Some(ssh_pwd) = &params.ssh_password {
                keychain_utils::set_ssh_password(&id, ssh_pwd)?;
                credential_cache::set_ssh_password_cached(&cache, &id, ssh_pwd);
            }
            if let Some(ssh_passphrase) = &params.ssh_key_passphrase {
                if !ssh_passphrase.trim().is_empty() {
                    keychain_utils::set_ssh_key_passphrase(&id, ssh_passphrase)?;
                    credential_cache::set_ssh_key_passphrase_cached(&cache, &id, ssh_passphrase);
                }
            }
        } else {
            keychain_utils::delete_ssh_password(&id).ok();
            keychain_utils::delete_ssh_key_passphrase(&id).ok();
            credential_cache::invalidate_ssh_password(&cache, &id);
            credential_cache::invalidate_ssh_key_passphrase(&cache, &id);
        }
        params_to_save.password = None;
        params_to_save.ssh_password = None;
        params_to_save.ssh_key_passphrase = None;
    } else {
        keychain_utils::delete_db_password(&id).ok();
        keychain_utils::delete_ssh_password(&id).ok();
        keychain_utils::delete_ssh_key_passphrase(&id).ok();
        // The connection URI is cleared by its own transaction below, which
        // needs the previous cache entry intact to roll back.
        credential_cache::invalidate_db_password(&cache, &id);
        credential_cache::invalidate_ssh_password(&cache, &id);
        credential_cache::invalidate_ssh_key_passphrase(&cache, &id);
    }

    // Preserve existing group_id and sort_order from the original connection
    let original_group_id = conn_file.connections[conn_idx].group_id.clone();
    let original_sort_order = conn_file.connections[conn_idx].sort_order;
    let original_db_selection = conn_file.connections[conn_idx].params.database.clone();
    // Preserve user's appearance customization across edits
    let original_appearance = conn_file.connections[conn_idx].appearance.clone();
    // Tags are managed by set_connection_tags; preserve them across edits.
    let original_tag_ids = conn_file.connections[conn_idx].tag_ids.clone();

    let updated = SavedConnection {
        id: id.clone(),
        name,
        params: params_to_save,
        group_id: original_group_id,
        sort_order: original_sort_order,
        detect_json_in_text_columns,
        appearance: original_appearance,
        tag_ids: original_tag_ids,
        environment: validate_environment(environment)?,
    };

    conn_file.connections[conn_idx] = updated.clone();

    persist_connection_uri_change(&cache, &id, existing_uri_in_keychain, uri_change, || {
        save_connections_and_invalidate(&app, &path, &conn_file)
    })?;

    // On single→multi transition, associate existing favorites/history (with no
    // database set) to the original single database name.
    if let Some(previous_db) = crate::models::single_db_before_multi_transition(
        &original_db_selection,
        &params.database,
    ) {
        if let Err(e) = crate::saved_queries::backfill_missing_database_for_connection(
            &app,
            &id,
            &previous_db,
        ) {
            log::warn!(
                "Failed to backfill saved query database for {}: {}",
                id,
                e
            );
        }
        if let Err(e) = crate::query_history::backfill_missing_database_for_connection(
            &app,
            &id,
            &previous_db,
        )
        .await
        {
            log::warn!(
                "Failed to backfill query history database for {}: {}",
                id,
                e
            );
        }
    }

    let mut returned_conn = updated;
    returned_conn.params = params;
    Ok(returned_conn)
}

/// Pure, testable core of `set_connection_appearance`.
/// Mutates `file` in place; does not touch disk or Tauri state.
fn set_appearance_impl(
    file: &mut ConnectionsFile,
    id: &str,
    appearance: Option<crate::models::ConnectionAppearance>,
) -> Result<(), String> {
    let conn = file
        .connections
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or("Connection not found")?;
    conn.appearance = appearance;
    Ok(())
}

#[tauri::command]
pub async fn set_connection_appearance<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    appearance: Option<crate::models::ConnectionAppearance>,
) -> Result<(), String> {
    let path = get_config_path(&app)?;
    let mut conn_file = persistence::load_connections_file(&path)?;
    set_appearance_impl(&mut conn_file, &id, appearance)?;
    save_connections_and_invalidate(&app, &path, &conn_file)?;
    Ok(())
}

#[tauri::command]
pub async fn duplicate_connection<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<SavedConnection, String> {
    let path = get_config_path(&app)?;
    let mut conn_file = persistence::load_connections_file(&path)?;

    let original_idx = conn_file
        .connections
        .iter()
        .position(|c| c.id == id)
        .ok_or("Connection not found")?;
    let mut original = conn_file.connections[original_idx].clone();

    let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();

    // Same IAM-auth guard as `find_connection_by_id`: never copy a stale RDS
    // auth token into a duplicated connection.
    if original.params.save_in_keychain.unwrap_or(false)
        && !original.params.use_iam_auth.unwrap_or(false)
    {
        if let Ok(pwd) = credential_cache::get_db_password_cached(&cache, &original.id) {
            original.params.password = Some(pwd);
        }
        if original.params.ssh_enabled.unwrap_or(false) {
            if let Ok(ssh_pwd) = credential_cache::get_ssh_password_cached(&cache, &original.id) {
                if !ssh_pwd.trim().is_empty() {
                    original.params.ssh_password = Some(ssh_pwd);
                }
            }
            if let Ok(ssh_passphrase) =
                credential_cache::get_ssh_key_passphrase_cached(&cache, &original.id)
            {
                if !ssh_passphrase.trim().is_empty() {
                    original.params.ssh_key_passphrase = Some(ssh_passphrase);
                }
            }
        }
    }

    let new_id = Uuid::new_v4().to_string();
    let mut new_params = original.params.clone();

    // Save passwords to new keychain entries if enabled
    if new_params.save_in_keychain.unwrap_or(false) {
        if let Some(pwd) = &new_params.password {
            keychain_utils::set_db_password(&new_id, pwd)?;
            credential_cache::set_db_password_cached(&cache, &new_id, pwd);
        }
        if new_params.ssh_enabled.unwrap_or(false) {
            if let Some(ssh_pwd) = &new_params.ssh_password {
                keychain_utils::set_ssh_password(&new_id, ssh_pwd)?;
                credential_cache::set_ssh_password_cached(&cache, &new_id, ssh_pwd);
            }
            if let Some(ssh_passphrase) = &new_params.ssh_key_passphrase {
                if !ssh_passphrase.trim().is_empty() {
                    keychain_utils::set_ssh_key_passphrase(&new_id, ssh_passphrase)?;
                    credential_cache::set_ssh_key_passphrase_cached(
                        &cache,
                        &new_id,
                        ssh_passphrase,
                    );
                }
            }
        }
        new_params.password = None;
        new_params.ssh_password = None;
        new_params.ssh_key_passphrase = None;
    }

    // Copy the icon file so the duplicate owns its own copy.
    // If the original has an Image icon, the duplicate must not share the same file path —
    // deleting either connection would otherwise cascade-delete the shared file and break
    // the other connection's icon. We copy the file; on failure we drop the icon rather
    // than sharing the path.
    let new_appearance = {
        let mut app_earance = original.appearance.clone();
        if let Some(ref mut a) = app_earance {
            if let Some(crate::models::IconOverride::Image { ref path }) = a.icon.clone() {
                if let Ok(app_data) = app.path().app_data_dir() {
                    match crate::connection_appearance::copy_icon_for_duplicate(&app_data, path, &new_id) {
                        Ok(new_path) => {
                            a.icon = Some(crate::models::IconOverride::Image { path: new_path });
                        }
                        Err(_) => {
                            // Couldn't copy — drop the icon to avoid sharing
                            a.icon = None;
                            if a.accent_color.is_none() {
                                app_earance = None;
                            }
                        }
                    }
                } else {
                    // Can't determine app_data_dir — drop icon to avoid sharing
                    a.icon = None;
                    if a.accent_color.is_none() {
                        app_earance = None;
                    }
                }
            }
        }
        app_earance
    };

    let new_conn = SavedConnection {
        id: new_id,
        name: format!("{} (Copy)", original.name),
        params: new_params,
        group_id: original.group_id.clone(), // Copy to same group as original
        sort_order: None,                    // Will be placed at end of group
        detect_json_in_text_columns: original.detect_json_in_text_columns,
        appearance: new_appearance,
        tag_ids: original.tag_ids.clone(),
        // Normalize rather than fail: an invalid on-disk value must not
        // block duplication, the copy just becomes "unclassified".
        environment: validate_environment(original.environment.clone()).unwrap_or(None),
    };

    conn_file.connections.push(new_conn.clone());

    save_connections_and_invalidate(&app, &path, &conn_file)?;

    let mut returned_conn = new_conn;
    // Return with passwords for frontend consistency
    if returned_conn.params.save_in_keychain.unwrap_or(false) {
        // We can just use the values from `original.params` as they are identical (unless we cleared them in new_params)
        // Actually original.params holds the clear text now.
        returned_conn.params.password = original.params.password;
        returned_conn.params.ssh_password = original.params.ssh_password;
        returned_conn.params.ssh_key_passphrase = original.params.ssh_key_passphrase;
    }

    Ok(returned_conn)
}

#[tauri::command]
pub async fn get_connections<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<SavedConnection>, String> {
    // Run migrations if needed
    migrate_ssh_connections(&app).await.ok();
    migrate_postgres_ssl_mode_spelling(&app).await.ok();

    let path = get_config_path(&app)?;
    crate::application::connections::load_connections(&path)
}

// ==================== SSH Connection Management ====================

/// Migrates old embedded SSH connections to separate SSH connection entries
async fn migrate_ssh_connections<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let conn_path = get_config_path(app)?;
    if !conn_path.exists() {
        return Ok(()); // Nothing to migrate
    }

    // Load connections using persistence (handles both old and new formats)
    let mut conn_file = persistence::load_connections_file(&conn_path)?;
    let connections = &conn_file.connections;

    // Check if any connections have old embedded SSH params
    let needs_migration = connections
        .iter()
        .any(|c| c.params.ssh_enabled.unwrap_or(false) && c.params.ssh_connection_id.is_none());

    if !needs_migration {
        return Ok(()); // No migration needed
    }

    eprintln!("[Migration] Starting SSH connections migration...");

    let ssh_path = get_ssh_config_path(app)?;
    let mut ssh_connections: Vec<SshConnection> = if ssh_path.exists() {
        let ssh_content = fs::read_to_string(&ssh_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&ssh_content).unwrap_or_default()
    } else {
        Vec::new()
    };

    let mut migrated_connections = Vec::new();
    let mut ssh_connection_map: HashMap<String, String> = HashMap::new(); // (ssh_key -> ssh_id)

    for mut conn in conn_file.connections.clone() {
        if conn.params.ssh_enabled.unwrap_or(false) && conn.params.ssh_connection_id.is_none() {
            // Extract SSH params
            if let (Some(host), Some(user)) = (&conn.params.ssh_host, &conn.params.ssh_user) {
                let port = conn.params.ssh_port.unwrap_or(22);
                let key_file = conn.params.ssh_key_file.clone().unwrap_or_default();

                // Create unique key for this SSH config
                let ssh_key = format!("{}:{}:{}:{}", host, port, user, key_file);

                // Check if we already created an SSH connection for this config
                let ssh_id = if let Some(existing_id) = ssh_connection_map.get(&ssh_key) {
                    existing_id.clone()
                } else {
                    // Create new SSH connection
                    let new_ssh_id = Uuid::new_v4().to_string();
                    let ssh_name = format!("{}@{}", user, host);

                    // Migrate credentials from connection keychain to SSH keychain
                    if conn.params.save_in_keychain.unwrap_or(false) {
                        if let Ok(ssh_pwd) = keychain_utils::get_ssh_password(&conn.id, &conn.name)
                        {
                            if !ssh_pwd.trim().is_empty() {
                                keychain_utils::set_ssh_password(&new_ssh_id, &ssh_pwd).ok();
                            }
                        }
                        if let Ok(ssh_pass) =
                            keychain_utils::get_ssh_key_passphrase(&conn.id, &conn.name)
                        {
                            if !ssh_pass.trim().is_empty() {
                                keychain_utils::set_ssh_key_passphrase(&new_ssh_id, &ssh_pass).ok();
                            }
                        }
                    }

                    let new_ssh_conn = SshConnection {
                        id: new_ssh_id.clone(),
                        name: ssh_name,
                        host: host.clone(),
                        port,
                        user: user.clone(),
                        auth_type: Some(if !key_file.is_empty() {
                            "ssh_key".to_string()
                        } else {
                            "password".to_string()
                        }),
                        password: None,
                        key_file: if key_file.is_empty() {
                            None
                        } else {
                            Some(key_file.clone())
                        },
                        key_passphrase: None,
                        allow_passphrase_prompt: None,
                        save_in_keychain: conn.params.save_in_keychain,
                    };

                    ssh_connections.push(new_ssh_conn);
                    ssh_connection_map.insert(ssh_key, new_ssh_id.clone());
                    new_ssh_id
                };

                // Update connection to reference the SSH connection
                conn.params.ssh_connection_id = Some(ssh_id);
                // Clear old embedded SSH params
                conn.params.ssh_host = None;
                conn.params.ssh_port = None;
                conn.params.ssh_user = None;
                conn.params.ssh_password = None;
                conn.params.ssh_key_file = None;
                conn.params.ssh_key_passphrase = None;
            }
        }

        migrated_connections.push(conn);
    }

    // Save migrated SSH connections
    let ssh_json = serde_json::to_string_pretty(&ssh_connections).map_err(|e| e.to_string())?;
    fs::write(ssh_path, ssh_json).map_err(|e| e.to_string())?;

    // Save migrated connections using new format (preserving groups)
    conn_file.connections = migrated_connections;
    save_connections_and_invalidate(app, &conn_path, &conn_file)?;

    eprintln!(
        "[Migration] Successfully migrated {} SSH connections",
        ssh_connections.len()
    );
    Ok(())
}

// ==================== PostgreSQL Plugin SSL Mode Migration ====================
//
// The shared, path-based migration logic lives in `connection_migrations`
// (also callable from the standalone `--mcp` server process, which has no
// `AppHandle`). This is a thin wrapper: resolve the path, run the shared
// core, and invalidate the connection cache only if it actually rewrote
// something.

/// Migrates already-persisted `ssl_mode` values on postgres-dialect
/// connections (driver id other than the builtin `"postgres"`) from the
/// stale MySQL-style spelling to the Postgres-style spelling the plugin
/// actually understands. Idempotent — a no-op once every affected
/// connection has been rewritten. See
/// `connection_migrations::migrate_postgres_ssl_mode_spelling_at_path` for
/// the full rationale, including the concurrency guard against a race with
/// the `--mcp` process's own call to the same function.
async fn migrate_postgres_ssl_mode_spelling<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let conn_path = get_config_path(app)?;
    let migrated =
        crate::connection_migrations::migrate_postgres_ssl_mode_spelling_at_path(&conn_path)
            .await?;
    if migrated {
        app.state::<std::sync::Arc<crate::connection_cache::ConnectionCache>>()
            .invalidate();
    }
    Ok(())
}

#[tauri::command]
pub async fn get_ssh_connections<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<SshConnection>, String> {
    crate::application::tunnels::get_ssh_connections(
        &app.state::<crate::runtime::RuntimeContext>(),
        true,
    )
}

#[tauri::command]
pub async fn save_ssh_connection<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    ssh: SshConnectionInput,
) -> Result<SshConnection, String> {
    crate::application::tunnels::save_ssh_connection(
        &app.state::<crate::runtime::RuntimeContext>(),
        name,
        ssh,
        true,
    )
}

#[tauri::command]
pub async fn update_ssh_connection<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    name: String,
    ssh: SshConnectionInput,
) -> Result<SshConnection, String> {
    crate::application::tunnels::update_ssh_connection(
        &app.state::<crate::runtime::RuntimeContext>(),
        id,
        name,
        ssh,
        true,
    )
}

#[tauri::command]
pub async fn delete_ssh_connection<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<(), String> {
    crate::application::tunnels::delete_ssh_connection(
        &app.state::<crate::runtime::RuntimeContext>(),
        &id,
    )
}

#[tauri::command]
pub async fn test_ssh_connection<R: Runtime>(
    app: AppHandle<R>,
    ssh: SshTestParams,
) -> Result<String, String> {
    crate::application::tunnels::test_ssh_connection(
        &app.state::<crate::runtime::RuntimeContext>(),
        ssh,
        None,
    )
    .await
}

// ---------------------------------------------------------------------------
// Kubernetes Connections
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_k8s_connections<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<K8sConnection>, String> {
    crate::application::tunnels::get_k8s_connections(
        &app.state::<crate::runtime::RuntimeContext>(),
    )
}

#[tauri::command]
pub async fn save_k8s_connection<R: Runtime>(
    app: AppHandle<R>,
    k8s: K8sConnectionInput,
) -> Result<K8sConnection, String> {
    crate::application::tunnels::save_k8s_connection(
        &app.state::<crate::runtime::RuntimeContext>(),
        k8s,
    )
}

#[tauri::command]
pub async fn update_k8s_connection<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    k8s: K8sConnectionInput,
) -> Result<K8sConnection, String> {
    crate::application::tunnels::update_k8s_connection(
        &app.state::<crate::runtime::RuntimeContext>(),
        id,
        k8s,
    )
}

#[tauri::command]
pub async fn delete_k8s_connection<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<(), String> {
    crate::application::tunnels::delete_k8s_connection(
        &app.state::<crate::runtime::RuntimeContext>(),
        &id,
    )
}

#[tauri::command]
pub async fn test_k8s_connection_cmd<R: Runtime>(
    _app: AppHandle<R>,
    context: String,
    namespace: String,
    kubectl_path: Option<String>,
    kubeconfig_path: Option<String>,
) -> Result<String, String> {
    let options = crate::k8s_tunnel::K8sCommandOptions::new(kubectl_path, kubeconfig_path);
    crate::k8s_tunnel::test_k8s_connection(&context, &namespace, &options)
}

#[tauri::command]
pub async fn get_k8s_contexts_cmd<R: Runtime>(
    _app: AppHandle<R>,
    kubectl_path: Option<String>,
    kubeconfig_path: Option<String>,
) -> Result<Vec<String>, String> {
    let options = crate::k8s_tunnel::K8sCommandOptions::new(kubectl_path, kubeconfig_path);
    crate::k8s_tunnel::get_k8s_contexts(&options)
}

#[tauri::command]
pub async fn get_k8s_namespaces_cmd<R: Runtime>(
    _app: AppHandle<R>,
    context: String,
    kubectl_path: Option<String>,
    kubeconfig_path: Option<String>,
) -> Result<Vec<String>, String> {
    let options = crate::k8s_tunnel::K8sCommandOptions::new(kubectl_path, kubeconfig_path);
    crate::k8s_tunnel::get_k8s_namespaces(&context, &options)
}

#[tauri::command]
pub async fn get_k8s_resources_cmd<R: Runtime>(
    _app: AppHandle<R>,
    context: String,
    namespace: String,
    resource_type: String,
    kubectl_path: Option<String>,
    kubeconfig_path: Option<String>,
) -> Result<Vec<String>, String> {
    let options = crate::k8s_tunnel::K8sCommandOptions::new(kubectl_path, kubeconfig_path);
    crate::k8s_tunnel::get_k8s_resources(&context, &namespace, &resource_type, &options)
}

#[tauri::command]
pub async fn get_k8s_resource_ports_cmd<R: Runtime>(
    _app: AppHandle<R>,
    context: String,
    namespace: String,
    resource_type: String,
    resource_name: String,
    kubectl_path: Option<String>,
    kubeconfig_path: Option<String>,
) -> Result<Vec<u16>, String> {
    let options = crate::k8s_tunnel::K8sCommandOptions::new(kubectl_path, kubeconfig_path);
    crate::k8s_tunnel::get_k8s_resource_ports(
        &context,
        &namespace,
        &resource_type,
        &resource_name,
        &options,
    )
}

#[tauri::command]
pub async fn validate_k8s_path_cmd<R: Runtime>(
    _app: AppHandle<R>,
    path: String,
    kind: String,
) -> Result<(), String> {
    crate::k8s_tunnel::validate_k8s_path(&path, &kind)
}

/// Expand K8s connection params by loading saved config and creating/reusing a tunnel.
pub async fn expand_k8s_connection_params<R: Runtime>(
    app: &AppHandle<R>,
    params: &ConnectionParams,
) -> Result<ConnectionParams, String> {
    let runtime = app.state::<crate::runtime::RuntimeContext>();
    let expanded = crate::application::tunnels::expand_connection_params(&runtime, params)?;
    if !expanded.k8s_enabled.unwrap_or(false) {
        return Ok(expanded);
    }
    crate::application::tunnels::resolve_expanded_connection_params(&expanded, None)
}

#[tauri::command]
pub async fn test_connection<R: Runtime>(
    app: AppHandle<R>,
    request: TestConnectionRequest,
) -> Result<String, String> {
    log::info!(
        "Testing connection to database: {}",
        request.params.database
    );
    let progress_id = request.progress_id.as_deref();

    let mut expanded_params = expand_ssh_connection_params(&app, &request.params)
        .await
        .map_err(|e| emit_test_failure(&app, progress_id, "resolve", e))?;
    expanded_params = expand_k8s_connection_params(&app, &expanded_params)
        .await
        .map_err(|e| emit_test_failure(&app, progress_id, "resolve", e))?;

    // AWS RDS IAM auth tokens are short-lived (15 min) and must come from the
    // password field on every test/connect, never from the keychain. Skip the
    // keychain fallback so a stale token can't be reused.
    let iam_auth = expanded_params.use_iam_auth.unwrap_or(false);

    // IAM auth needs an RDS auth token right now. Without this guard the
    // builder accepts an empty password, the server replies with the opaque
    // "Access denied (using password: YES)", and the user can't tell whether
    // the token is missing, wrong, or expired.
    require_iam_token(
        iam_auth,
        request.params.password.as_deref(),
        expanded_params.password.as_deref(),
    )
    .map_err(|e| emit_test_failure(&app, progress_id, "resolve", e))?;

    if !iam_auth && request.params.password.is_none() && expanded_params.password.is_none() {
        let saved_conn = match &request.connection_id {
            Some(id) => find_connection_by_id(&app, id).ok(),
            None => None,
        };
        expanded_params.password =
            resolve_test_connection_password(&request.params, saved_conn.as_ref(), |conn_id| {
                keychain_utils::get_db_password(conn_id, "")
            });
    }

    // Reconnecting to a saved connection sends the on-disk params, which never
    // carry the URI — restore it the same way the password is restored above.
    // An inline URI (the ephemeral Test Connection flow) always wins.
    if runtime_connection_uri(&expanded_params).is_none() {
        if let Some(conn_id) = &request.connection_id {
            let cache = app.state::<std::sync::Arc<credential_cache::CredentialCache>>();
            restore_runtime_connection_uri(&cache, conn_id, &mut expanded_params)
                .map_err(|e| emit_test_failure(&app, progress_id, "resolve", e))?;
        }
    }

    let ssh_enabled = expanded_params.ssh_enabled.unwrap_or(false);
    let k8s_enabled = expanded_params.k8s_enabled.unwrap_or(false);
    let tunnel_step = if ssh_enabled {
        Some("sshTunnel")
    } else if k8s_enabled {
        Some("k8sForward")
    } else {
        None
    };

    if ssh_enabled {
        emit_test_progress(
            &app,
            progress_id,
            "sshTunnel",
            "start",
            Some(format!(
                "{}@{}:{}",
                expanded_params.ssh_user.as_deref().unwrap_or("?"),
                expanded_params.ssh_host.as_deref().unwrap_or("?"),
                expanded_params.ssh_port.unwrap_or(22)
            )),
        );
    } else if k8s_enabled {
        emit_test_progress(
            &app,
            progress_id,
            "k8sForward",
            "start",
            expanded_params.k8s_resource_name.clone(),
        );
    }

    let resolved_params = if let Some(conn_id) = &request.connection_id {
        resolve_connection_params_with_id(&expanded_params, conn_id)
    } else {
        resolve_connection_params(&expanded_params)
    }
    .map_err(|e| emit_test_failure(&app, progress_id, tunnel_step.unwrap_or("resolve"), e))?;
    log::debug!(
        "Test connection params: Host={:?}, Port={:?}",
        resolved_params.host,
        resolved_params.port
    );

    if let Some(step) = tunnel_step {
        emit_test_progress(
            &app,
            progress_id,
            step,
            "ok",
            resolved_params.port.map(|port| format!("127.0.0.1:{port}")),
        );
    }

    let drv = driver_for(&resolved_params.driver)
        .await
        .map_err(|e| emit_test_failure(&app, progress_id, "resolve", e))?;

    let db_target = match (expanded_params.host.as_deref(), expanded_params.port) {
        (Some(host), Some(port)) => format!("{host}:{port}"),
        (Some(host), None) => host.to_string(),
        _ => expanded_params.database.to_string(),
    };
    emit_test_progress(&app, progress_id, "dbConnect", "start", Some(db_target));

    // For file-based drivers, verify the database file exists before attempting connection
    if drv.manifest().capabilities.file_based {
        let db_path = if resolved_params.driver == "sqlite" {
            crate::sqlite_database::expand_sqlite_filename(resolved_params.database.primary())
        } else {
            PathBuf::from(resolved_params.database.primary())
        };
        if !db_path.exists() {
            let err = format!("Database file not found: {}", resolved_params.database);
            return Err(emit_test_failure(&app, progress_id, "dbConnect", err));
        }
    }

    drv.test_connection(&resolved_params).await.map_err(|e| {
        log::warn!(
            "Connection test failed for database {}: {e}",
            request.params.database
        );
        emit_test_failure(&app, progress_id, "dbConnect", e)
    })?;

    emit_test_progress(&app, progress_id, "dbConnect", "ok", None);
    log::info!(
        "Connection test successful for database: {}",
        request.params.database
    );
    Ok("Connection successful!".to_string())
}

/// Emits one step of a connection test's live progress log. A no-op when the
/// caller did not request progress (no id).
fn emit_test_progress<R: Runtime>(
    app: &AppHandle<R>,
    progress_id: Option<&str>,
    step: &str,
    status: &str,
    detail: Option<String>,
) {
    let Some(id) = progress_id else { return };
    let _ = app.emit(
        "connection-test-progress",
        serde_json::json!({
            "id": id,
            "step": step,
            "status": status,
            "detail": detail,
        }),
    );
}

/// Emits a failed step and passes the error through, for use in `map_err`.
fn emit_test_failure<R: Runtime>(
    app: &AppHandle<R>,
    progress_id: Option<&str>,
    step: &str,
    error: String,
) -> String {
    emit_test_progress(app, progress_id, step, "error", Some(error.clone()));
    error
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::DatabaseSelection;

    fn base_params() -> ConnectionParams {
        ConnectionParams {
            driver: "mysql".to_string(),
            host: Some("localhost".to_string()),
            port: Some(3306),
            username: Some("root".to_string()),
            database: DatabaseSelection::Single("testdb".to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn persisted_params_never_contain_the_connection_uri() {
        let sentinel = "mongodb+srv://fixture-user:fixture-password@cluster.example.invalid/app";
        let params = ConnectionParams {
            connection_uri: Some(sentinel.to_string()),
            save_in_keychain: Some(true),
            ..base_params()
        };

        let persisted = params_for_persistence(&params, true);
        let json = serde_json::to_string(&persisted).expect("serialize persisted params");

        assert_eq!(persisted.connection_uri, None);
        assert_eq!(persisted.connection_uri_in_keychain, Some(true));
        assert!(!json.contains(sentinel));
        assert!(!json.contains("fixture-password"));
    }

    #[test]
    fn a_connection_uri_cannot_be_saved_outside_the_keychain() {
        let params = ConnectionParams {
            connection_uri: Some("mongodb+srv://cluster.example.invalid/app".to_string()),
            save_in_keychain: Some(false),
            ..base_params()
        };

        assert!(validate_connection_uri_persistence(&params).is_err());
        assert!(validate_connection_uri_persistence(&base_params()).is_ok());
    }

    #[test]
    fn a_blank_connection_uri_is_treated_as_absent() {
        let params = ConnectionParams {
            connection_uri: Some("   ".to_string()),
            save_in_keychain: Some(false),
            ..base_params()
        };

        assert_eq!(runtime_connection_uri(&params), None);
        assert!(validate_connection_uri_persistence(&params).is_ok());
    }

    #[test]
    fn restores_the_exact_connection_uri_from_the_session_cache() {
        let cache = credential_cache::CredentialCache::default();
        let sentinel =
            "mongodb+srv://fixture-user:fixture-password@cluster.example.invalid/app?x=a%2Fb";
        credential_cache::set_connection_uri_cached(&cache, "conn-1", sentinel);
        let mut params = base_params();

        restore_runtime_connection_uri(&cache, "conn-1", &mut params)
            .expect("restore cached connection URI");

        assert_eq!(params.connection_uri.as_deref(), Some(sentinel));
    }

    #[test]
    fn params_saved_before_the_uri_field_existed_remain_usable() {
        let cache = credential_cache::CredentialCache::default();
        let mut params = base_params();

        restore_runtime_connection_uri(&cache, "legacy-conn", &mut params)
            .expect("legacy params remain usable");

        assert_eq!(params.connection_uri, None);
        assert_eq!(params.host.as_deref(), Some("localhost"));
    }

    #[test]
    fn deleting_a_connection_clears_its_cached_uri() {
        let cache = credential_cache::CredentialCache::default();
        credential_cache::set_connection_uri_cached(
            &cache,
            "conn-1",
            "mongodb+srv://cluster.example.invalid/app",
        );

        credential_cache::invalidate_all_for_connection(&cache, "conn-1");

        assert_eq!(
            credential_cache::get_connection_uri_cached(&cache, "conn-1", false).unwrap(),
            None
        );
    }

    #[test]
    fn a_failed_persist_rolls_the_stored_uri_back() {
        let rolled_back = std::cell::Cell::new(false);

        let error = persist_secret_change(
            || Ok(()),
            || Err("fictional connections.json failure".to_string()),
            || {
                rolled_back.set(true);
                Ok(())
            },
        )
        .unwrap_err();

        assert_eq!(error, "fictional connections.json failure");
        assert!(rolled_back.get());
    }

    fn saved_conn(id: &str, password: Option<&str>, save_in_keychain: bool) -> SavedConnection {
        SavedConnection {
            id: id.to_string(),
            name: "Test".to_string(),
            params: ConnectionParams {
                password: password.map(|p| p.to_string()),
                save_in_keychain: Some(save_in_keychain),
                ..base_params()
            },
            group_id: None,
            sort_order: None,
            detect_json_in_text_columns: None,
            appearance: None,
            tag_ids: None,
            environment: None,
        }
    }

    /// Regression test: update_connection must not wipe appearance.
    ///
    /// The bug was that the struct literal used `appearance: None`, which destroyed
    /// any accent color or custom icon the user had previously set.  The fix reads
    /// `original_appearance` from the existing record and forwards it to the updated
    /// struct — exactly the same pattern already used for `group_id` / `sort_order`.
    ///
    /// Because `update_connection` requires a live Tauri `AppHandle` we cannot call
    /// it in a unit test.  Instead we verify the preservation pattern directly: build
    /// an "existing" SavedConnection with appearance set, clone its appearance field,
    /// and assert it survives into the replacement struct unchanged.
    #[test]
    fn update_connection_preserves_appearance() {
        use crate::models::{ConnectionAppearance, IconOverride};

        let existing = SavedConnection {
            id: "conn-1".to_string(),
            name: "Old Name".to_string(),
            params: base_params(),
            group_id: Some("group-a".to_string()),
            sort_order: Some(3),
            detect_json_in_text_columns: None,
            appearance: Some(ConnectionAppearance {
                accent_color: Some("#ff0000".to_string()),
                icon: Some(IconOverride::Emoji { value: "🐘".to_string() }),
            }),
            tag_ids: None,
            environment: None,
        };

        // Simulate the pattern used in update_connection after the fix.
        let original_appearance = existing.appearance.clone();

        let updated = SavedConnection {
            id: existing.id.clone(),
            name: "New Name".to_string(),
            params: base_params(),
            group_id: existing.group_id.clone(),
            sort_order: existing.sort_order,
            detect_json_in_text_columns: None,
            appearance: original_appearance,
            tag_ids: None,
            environment: None,
        };

        let app = updated.appearance.as_ref().expect("appearance must be preserved");
        assert_eq!(app.accent_color.as_deref(), Some("#ff0000"));
        assert!(matches!(&app.icon, Some(IconOverride::Emoji { value }) if value == "🐘"));
    }

    /// Helper: build a minimal ConnectionsFile with one connection.
    fn one_conn_file(id: &str, appearance: Option<crate::models::ConnectionAppearance>) -> ConnectionsFile {
        let conn = SavedConnection {
            id: id.to_string(),
            name: "Test".to_string(),
            params: base_params(),
            group_id: None,
            sort_order: None,
            detect_json_in_text_columns: None,
            appearance,
            tag_ids: None,
            environment: None,
        };
        ConnectionsFile {
            groups: vec![],
            connections: vec![conn],
            tags: vec![],
        }
    }

    #[test]
    fn set_connection_appearance_updates_existing() {
        use crate::models::{ConnectionAppearance, IconOverride};

        let mut file = one_conn_file("conn-1", None);
        let new_appearance = ConnectionAppearance {
            accent_color: Some("#00ff00".to_string()),
            icon: Some(IconOverride::Emoji { value: "🦀".to_string() }),
        };

        set_appearance_impl(&mut file, "conn-1", Some(new_appearance)).unwrap();

        let app = file.connections[0].appearance.as_ref().expect("appearance must be set");
        assert_eq!(app.accent_color.as_deref(), Some("#00ff00"));
        assert!(matches!(&app.icon, Some(IconOverride::Emoji { value }) if value == "🦀"));
    }

    #[test]
    fn set_connection_appearance_clears_with_none() {
        use crate::models::{ConnectionAppearance, IconOverride};

        let existing_appearance = ConnectionAppearance {
            accent_color: Some("#ff0000".to_string()),
            icon: Some(IconOverride::Pack { id: "server".to_string() }),
        };
        let mut file = one_conn_file("conn-2", Some(existing_appearance));

        set_appearance_impl(&mut file, "conn-2", None).unwrap();

        assert!(file.connections[0].appearance.is_none());
    }

    #[test]
    fn set_connection_appearance_errors_on_missing_id() {
        let mut file = one_conn_file("conn-real", None);

        let result = set_appearance_impl(&mut file, "conn-does-not-exist", None);

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Connection not found");
    }

    #[test]
    fn test_resolve_password_prefers_request() {
        let mut params = base_params();
        params.password = Some("from_request".to_string());
        let result = resolve_test_connection_password(&params, None, |_| Ok("kc".to_string()));
        assert_eq!(result, Some("from_request".to_string()));
    }

    #[test]
    fn test_resolve_password_from_keychain() {
        let params = base_params();
        let saved = saved_conn("id1", None, true);
        let result =
            resolve_test_connection_password(&params, Some(&saved), |_| Ok("kc".to_string()));
        assert_eq!(result, Some("kc".to_string()));
    }

    #[test]
    fn test_resolve_password_from_saved_when_not_keychain() {
        let params = base_params();
        let saved = saved_conn("id1", Some("stored"), false);
        let result =
            resolve_test_connection_password(&params, Some(&saved), |_| Ok("kc".to_string()));
        assert_eq!(result, Some("stored".to_string()));
    }

    #[test]
    fn test_resolve_password_fallback_to_saved_when_keychain_empty() {
        let params = base_params();
        let saved = saved_conn("id1", Some("stored"), true);
        let result =
            resolve_test_connection_password(&params, Some(&saved), |_| Ok("  ".to_string()));
        assert_eq!(result, Some("stored".to_string()));
    }

    mod build_connection_url_tests {
        use super::*;

        fn create_params(
            driver: &str,
            host: &str,
            port: Option<u16>,
            username: &str,
            password: Option<&str>,
            database: &str,
        ) -> ConnectionParams {
            ConnectionParams {
                driver: driver.to_string(),
                host: Some(host.to_string()),
                port,
                username: Some(username.to_string()),
                password: password.map(|p| p.to_string()),
                database: DatabaseSelection::Single(database.to_string()),
                ..Default::default()
            }
        }

        #[tokio::test]
        async fn test_mysql_url_basic() {
            let params = create_params(
                "mysql",
                "localhost",
                Some(3306),
                "root",
                Some("secret"),
                "testdb",
            );
            let url = build_connection_url(&params).await.unwrap();
            assert_eq!(url, "mysql://root:secret@localhost:3306/testdb");
        }

        #[tokio::test]
        async fn test_postgres_url_basic() {
            let params = create_params(
                "postgres",
                "localhost",
                Some(5432),
                "postgres",
                Some("secret"),
                "testdb",
            );
            let url = build_connection_url(&params).await.unwrap();
            assert_eq!(url, "postgres://postgres:secret@localhost:5432/testdb");
        }

        #[tokio::test]
        async fn test_sqlite_url() {
            let params = create_params("sqlite", "", None, "", None, "/path/to/db.sqlite");
            let url = build_connection_url(&params).await.unwrap();
            assert_eq!(url, "sqlite:///path/to/db.sqlite");
        }

        #[tokio::test]
        async fn test_url_encoding_special_chars() {
            let params = create_params(
                "mysql",
                "localhost",
                Some(3306),
                "user@domain",
                Some("pass#word"),
                "mydb",
            );
            let url = build_connection_url(&params).await.unwrap();
            assert!(url.contains("user%40domain"));
            assert!(url.contains("pass%23word"));
        }

        #[tokio::test]
        async fn test_default_ports() {
            let mysql_params = create_params("mysql", "localhost", None, "root", None, "testdb");
            let pg_params =
                create_params("postgres", "localhost", None, "postgres", None, "testdb");

            let mysql_url = build_connection_url(&mysql_params).await.unwrap();
            let pg_url = build_connection_url(&pg_params).await.unwrap();

            assert!(mysql_url.contains(":3306/"));
            assert!(pg_url.contains(":5432/"));
        }

        #[tokio::test]
        async fn test_no_password() {
            let params = create_params("mysql", "localhost", Some(3306), "root", None, "testdb");
            let url = build_connection_url(&params).await.unwrap();
            assert_eq!(url, "mysql://root@localhost:3306/testdb");
        }

        #[tokio::test]
        async fn test_unsupported_driver() {
            let params = create_params("mongodb", "localhost", Some(27017), "user", None, "testdb");
            let result = build_connection_url(&params).await;
            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), "Unsupported driver");
        }

        #[tokio::test]
        async fn test_remote_host() {
            let params = create_params(
                "postgres",
                "db.example.com",
                Some(5432),
                "admin",
                Some("pass"),
                "production",
            );
            let url = build_connection_url(&params).await.unwrap();
            assert!(url.contains("db.example.com"));
            assert!(!url.contains("localhost"));
        }
    }

    mod resolve_ssh_password_tests {
        use super::*;
        use crate::models::SshConnection;

        fn create_ssh_conn(
            id: &str,
            password: Option<&str>,
            save_in_keychain: bool,
        ) -> SshConnection {
            SshConnection {
                id: id.to_string(),
                name: "Test".to_string(),
                host: "localhost".to_string(),
                port: 22,
                user: "root".to_string(),
                auth_type: Some("password".to_string()),
                password: password.map(|p| p.to_string()),
                key_file: None,
                key_passphrase: None,
                allow_passphrase_prompt: None,
                save_in_keychain: Some(save_in_keychain),
            }
        }

        #[test]
        fn test_ssh_password_prefers_request() {
            let result = resolve_ssh_test_password(
                Some("from_request"),
                Some("conn_id"),
                |_| None,
                |_| Ok("kc".to_string()),
            );
            assert_eq!(result, Some("from_request".to_string()));
        }

        #[test]
        fn test_ssh_password_from_keychain() {
            let saved = create_ssh_conn("id1", None, true);
            let result = resolve_ssh_test_password(
                None,
                Some("id1"),
                |_| Some(saved.clone()),
                |_| Ok("kc".to_string()),
            );
            assert_eq!(result, Some("kc".to_string()));
        }

        #[test]
        fn test_ssh_password_from_saved_when_not_keychain() {
            let saved = create_ssh_conn("id1", Some("stored"), false);
            let result = resolve_ssh_test_password(
                None,
                Some("id1"),
                |_| Some(saved.clone()),
                |_| Ok("kc".to_string()),
            );
            assert_eq!(result, Some("stored".to_string()));
        }

        #[test]
        fn test_ssh_password_fallback_to_saved_when_keychain_empty() {
            let saved = create_ssh_conn("id1", Some("stored"), true);
            let result = resolve_ssh_test_password(
                None,
                Some("id1"),
                |_| Some(saved.clone()),
                |_| Ok("  ".to_string()),
            );
            assert_eq!(result, Some("stored".to_string()));
        }

        #[test]
        fn test_ssh_password_returns_none_when_no_id() {
            let result = resolve_ssh_test_password(
                None,
                None,
                |_| panic!("should not be called"),
                |_| panic!("should not be called"),
            );
            assert_eq!(result, None);
        }

        #[test]
        fn test_ssh_password_prefers_request_over_keychain() {
            let saved = create_ssh_conn("id1", None, true);
            let result = resolve_ssh_test_password(
                Some("request_pwd"),
                Some("id1"),
                |_| Some(saved.clone()),
                |_| Ok("kc".to_string()),
            );
            assert_eq!(result, Some("request_pwd".to_string()));
        }

        #[test]
        fn test_ssh_empty_request_password_is_used() {
            let saved = create_ssh_conn("id1", None, true);
            let result = resolve_ssh_test_password(
                Some("   "),
                Some("id1"),
                |_| Some(saved.clone()),
                |_| Ok("kc".to_string()),
            );
            // Empty password from request should be used, not keychain
            assert_eq!(result, Some("   ".to_string()));
        }

        #[test]
        fn test_ssh_returns_none_when_no_password_anywhere() {
            let saved = create_ssh_conn("id1", None, false);
            let result = resolve_ssh_test_password(
                None,
                Some("id1"),
                |_| Some(saved.clone()),
                |_| Ok("".to_string()),
            );
            assert_eq!(result, None);
        }
    }

    mod apply_inline_ssh_secret_fallback_tests {
        use super::*;

        fn params_with_ssh(
            password: Option<&str>,
            passphrase: Option<&str>,
        ) -> ConnectionParams {
            ConnectionParams {
                ssh_password: password.map(|p| p.to_string()),
                ssh_key_passphrase: passphrase.map(|p| p.to_string()),
                ..Default::default()
            }
        }

        #[test]
        fn fills_both_secrets_from_saved_params() {
            let params = params_with_ssh(Some("pwd"), Some("phrase"));
            let (password, passphrase) =
                apply_inline_ssh_secret_fallback(None, None, &params);
            assert_eq!(password, Some("pwd".to_string()));
            assert_eq!(passphrase, Some("phrase".to_string()));
        }

        #[test]
        fn resolved_secrets_keep_priority_over_saved() {
            let params = params_with_ssh(Some("saved_pwd"), Some("saved_phrase"));
            let (password, passphrase) = apply_inline_ssh_secret_fallback(
                Some("request_pwd".to_string()),
                Some("request_phrase".to_string()),
                &params,
            );
            assert_eq!(password, Some("request_pwd".to_string()));
            assert_eq!(passphrase, Some("request_phrase".to_string()));
        }

        #[test]
        fn blank_saved_secrets_are_ignored() {
            let params = params_with_ssh(Some("   "), Some(""));
            let (password, passphrase) =
                apply_inline_ssh_secret_fallback(None, None, &params);
            assert_eq!(password, None);
            assert_eq!(passphrase, None);
        }

        #[test]
        fn fills_only_missing_secret() {
            let params = params_with_ssh(Some("saved_pwd"), Some("saved_phrase"));
            let (password, passphrase) = apply_inline_ssh_secret_fallback(
                Some("request_pwd".to_string()),
                None,
                &params,
            );
            assert_eq!(password, Some("request_pwd".to_string()));
            assert_eq!(passphrase, Some("saved_phrase".to_string()));
        }
    }

    mod is_empty_or_whitespace_tests {
        use super::*;

        #[test]
        fn test_none_is_empty() {
            assert!(is_empty_or_whitespace(&None));
        }

        #[test]
        fn test_empty_string_is_empty() {
            assert!(is_empty_or_whitespace(&Some("".to_string())));
        }

        #[test]
        fn test_whitespace_only_is_empty() {
            assert!(is_empty_or_whitespace(&Some("   ".to_string())));
        }

        #[test]
        fn test_tab_newline_is_empty() {
            assert!(is_empty_or_whitespace(&Some("\t\n  ".to_string())));
        }

        #[test]
        fn test_content_is_not_empty() {
            assert!(!is_empty_or_whitespace(&Some("content".to_string())));
        }

        #[test]
        fn test_content_with_whitespace_is_not_empty() {
            assert!(!is_empty_or_whitespace(&Some("  content  ".to_string())));
        }
    }

    mod resolve_connection_params_tests {
        use super::*;

        fn create_ssh_params(
            ssh_host: &str,
            ssh_port: u16,
            ssh_user: &str,
            remote_host: &str,
            remote_port: u16,
        ) -> ConnectionParams {
            ConnectionParams {
                driver: "mysql".to_string(),
                host: Some(remote_host.to_string()),
                port: Some(remote_port),
                username: Some("dbuser".to_string()),
                password: Some("dbpass".to_string()),
                database: DatabaseSelection::Single("testdb".to_string()),
                ssh_enabled: Some(true),
                ssh_host: Some(ssh_host.to_string()),
                ssh_port: Some(ssh_port),
                ssh_user: Some(ssh_user.to_string()),
                ssh_key_file: Some("/home/user/.ssh/id_rsa".to_string()),
                ..Default::default()
            }
        }

        #[tokio::test]
        async fn test_non_ssh_params_unchanged() {
            let params = base_params();
            let result = resolve_connection_params(&params).unwrap();
            assert_eq!(result.host, Some("localhost".to_string()));
            assert_eq!(result.port, Some(3306));
        }

        #[tokio::test]
        async fn test_ssh_params_require_host() {
            let mut params = create_ssh_params("jump.server", 22, "admin", "db.internal", 3306);
            params.ssh_host = None;
            let result = resolve_connection_params(&params);
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("SSH Host"));
        }

        #[tokio::test]
        async fn test_ssh_params_require_user() {
            let mut params = create_ssh_params("jump.server", 22, "admin", "db.internal", 3306);
            params.ssh_user = None;
            let result = resolve_connection_params(&params);
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("SSH User"));
        }
    }

    mod resolve_k8s_params_tests {
        use super::*;

        fn create_k8s_params(
            context: &str,
            namespace: &str,
            resource_type: &str,
            resource_name: &str,
            port: u16,
        ) -> ConnectionParams {
            ConnectionParams {
                driver: "mysql".to_string(),
                host: Some("localhost".to_string()),
                port: Some(3306),
                username: Some("root".to_string()),
                database: DatabaseSelection::Single("testdb".to_string()),
                k8s_enabled: Some(true),
                k8s_context: Some(context.to_string()),
                k8s_namespace: Some(namespace.to_string()),
                k8s_resource_type: Some(resource_type.to_string()),
                k8s_resource_name: Some(resource_name.to_string()),
                k8s_port: Some(port),
                ..Default::default()
            }
        }

        #[test]
        fn test_k8s_and_ssh_mutual_exclusion() {
            let mut params = create_k8s_params("my-ctx", "default", "service", "my-db", 3306);
            params.ssh_enabled = Some(true);
            params.ssh_host = Some("jump.host".to_string());
            let result = resolve_connection_params(&params);
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("cannot both be enabled"));
        }

        #[test]
        fn test_k8s_requires_context() {
            let mut params = create_k8s_params("my-ctx", "default", "service", "my-db", 3306);
            params.k8s_context = None;
            let result = resolve_k8s_params(&params);
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("K8s context"));
        }

        #[test]
        fn test_k8s_requires_namespace() {
            let mut params = create_k8s_params("my-ctx", "default", "service", "my-db", 3306);
            params.k8s_namespace = None;
            let result = resolve_k8s_params(&params);
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("K8s namespace"));
        }

        #[test]
        fn test_k8s_requires_resource_type() {
            let mut params = create_k8s_params("my-ctx", "default", "service", "my-db", 3306);
            params.k8s_resource_type = None;
            let result = resolve_k8s_params(&params);
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("K8s resource type"));
        }

        #[test]
        fn test_k8s_requires_resource_name() {
            let mut params = create_k8s_params("my-ctx", "default", "service", "my-db", 3306);
            params.k8s_resource_name = None;
            let result = resolve_k8s_params(&params);
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("K8s resource name"));
        }

        #[test]
        fn test_k8s_requires_port() {
            let mut params = create_k8s_params("my-ctx", "default", "service", "my-db", 3306);
            params.k8s_port = None;
            let result = resolve_k8s_params(&params);
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("K8s port"));
        }
    }

    mod url_encoding_edge_cases {
        use super::*;

        #[tokio::test]
        async fn test_unicode_username() {
            let mut params = base_params();
            params.username = Some("用户".to_string());
            let url = build_connection_url(&params).await.unwrap();
            // URL should contain percent-encoded UTF-8
            assert!(url.contains("%E7%94%A8%E6%88%B7"));
        }

        #[tokio::test]
        async fn test_password_with_colon() {
            let mut params = base_params();
            params.password = Some("pass:word".to_string());
            let url = build_connection_url(&params).await.unwrap();
            assert!(url.contains("pass%3Aword"));
        }

        #[tokio::test]
        async fn test_password_with_at_sign() {
            let mut params = base_params();
            params.password = Some("pass@word".to_string());
            let url = build_connection_url(&params).await.unwrap();
            assert!(url.contains("pass%40word"));
        }

        #[tokio::test]
        async fn test_password_with_slash() {
            let mut params = base_params();
            params.password = Some("pass/word".to_string());
            let url = build_connection_url(&params).await.unwrap();
            assert!(url.contains("pass%2Fword"));
        }

        #[tokio::test]
        async fn test_empty_username_and_password() {
            let mut params = base_params();
            params.username = None;
            params.password = None;
            let url = build_connection_url(&params).await.unwrap();
            assert_eq!(url, "mysql://@localhost:3306/testdb");
        }

        #[tokio::test]
        async fn test_host_with_port_in_url() {
            let mut params = base_params();
            params.host = Some("192.168.1.100".to_string());
            params.port = Some(33060);
            let url = build_connection_url(&params).await.unwrap();
            assert!(url.contains("192.168.1.100:33060"));
        }
    }

    mod cancellation_state {
        use super::super::{
            cancel_query_impl, register_abort_handle, unregister_abort_handle,
            QueryCancellationState,
        };
        use std::sync::Arc;
        use std::time::Duration;

        async fn spawn_sleeper() -> tokio::task::JoinHandle<()> {
            tokio::spawn(async { tokio::time::sleep(Duration::from_secs(10)).await })
        }

        #[tokio::test]
        async fn registers_multiple_handles_under_same_slot() {
            let state = QueryCancellationState::default();
            let task_a = spawn_sleeper().await;
            let task_b = spawn_sleeper().await;
            let handle_a = Arc::new(task_a.abort_handle());
            let handle_b = Arc::new(task_b.abort_handle());

            register_abort_handle(&state.handles, "conn-1".into(), handle_a);
            register_abort_handle(&state.handles, "conn-1".into(), handle_b);

            assert_eq!(
                state.handles.lock().unwrap().get("conn-1").unwrap().len(),
                2
            );

            task_a.abort();
            task_b.abort();
            let _ = task_a.await;
            let _ = task_b.await;
        }

        #[tokio::test]
        async fn cancel_aborts_all_handles_in_slot() {
            let state = QueryCancellationState::default();
            let task_a = spawn_sleeper().await;
            let task_b = spawn_sleeper().await;
            register_abort_handle(
                &state.handles,
                "conn-1".into(),
                Arc::new(task_a.abort_handle()),
            );
            register_abort_handle(
                &state.handles,
                "conn-1".into(),
                Arc::new(task_b.abort_handle()),
            );

            let drained = state
                .handles
                .lock()
                .unwrap()
                .remove("conn-1")
                .unwrap_or_default();
            for h in &drained {
                h.abort();
            }

            assert!(task_a.await.unwrap_err().is_cancelled());
            assert!(task_b.await.unwrap_err().is_cancelled());
        }

        #[tokio::test]
        async fn unregister_only_removes_matching_handle() {
            let state = QueryCancellationState::default();
            let task_a = spawn_sleeper().await;
            let task_b = spawn_sleeper().await;
            let handle_a = Arc::new(task_a.abort_handle());
            let handle_b = Arc::new(task_b.abort_handle());

            register_abort_handle(&state.handles, "conn-1".into(), handle_a.clone());
            register_abort_handle(&state.handles, "conn-1".into(), handle_b.clone());

            unregister_abort_handle(&state.handles, "conn-1", &handle_a);

            {
                let remaining = state.handles.lock().unwrap();
                let slot = remaining.get("conn-1").expect("slot kept while B in flight");
                assert_eq!(slot.len(), 1);
                assert!(Arc::ptr_eq(&slot[0], &handle_b));
            }

            task_a.abort();
            task_b.abort();
            let _ = task_a.await;
            let _ = task_b.await;
        }

        #[tokio::test]
        async fn unregister_drops_empty_slot() {
            let state = QueryCancellationState::default();
            let task = spawn_sleeper().await;
            let handle = Arc::new(task.abort_handle());

            register_abort_handle(&state.handles, "conn-1".into(), handle.clone());
            unregister_abort_handle(&state.handles, "conn-1", &handle);

            assert!(state.handles.lock().unwrap().get("conn-1").is_none());

            task.abort();
            let _ = task.await;
        }

        #[tokio::test]
        async fn register_prunes_finished_handles() {
            let state = QueryCancellationState::default();

            let finished_task = tokio::spawn(async {});
            let finished_handle = Arc::new(finished_task.abort_handle());
            let _ = finished_task.await;
            assert!(finished_handle.is_finished());

            register_abort_handle(&state.handles, "conn-1".into(), finished_handle);

            let live_task = spawn_sleeper().await;
            let live_handle = Arc::new(live_task.abort_handle());
            register_abort_handle(&state.handles, "conn-1".into(), live_handle.clone());

            {
                let guard = state.handles.lock().unwrap();
                let slot = guard.get("conn-1").unwrap();
                assert_eq!(slot.len(), 1);
                assert!(Arc::ptr_eq(&slot[0], &live_handle));
            }

            live_task.abort();
            let _ = live_task.await;
        }

        #[tokio::test]
        async fn cancel_query_returns_err_when_no_slot() {
            let state = QueryCancellationState::default();
            let err = cancel_query_impl(&state, "conn-1").unwrap_err();
            assert_eq!(err, "No running query found");
        }

        #[tokio::test]
        async fn cancel_query_aborts_every_handle_in_slot() {
            let state = QueryCancellationState::default();
            let task_a = spawn_sleeper().await;
            let task_b = spawn_sleeper().await;
            register_abort_handle(
                &state.handles,
                "conn-1".into(),
                Arc::new(task_a.abort_handle()),
            );
            register_abort_handle(
                &state.handles,
                "conn-1".into(),
                Arc::new(task_b.abort_handle()),
            );

            cancel_query_impl(&state, "conn-1").unwrap();

            assert!(task_a.await.unwrap_err().is_cancelled());
            assert!(task_b.await.unwrap_err().is_cancelled());
            assert!(state.handles.lock().unwrap().get("conn-1").is_none());
        }

        #[tokio::test]
        async fn cancel_query_aborts_query_and_explain_sharing_the_slot() {
            let state = QueryCancellationState::default();
            let query_task = spawn_sleeper().await;
            let explain_task = spawn_sleeper().await;
            register_abort_handle(
                &state.handles,
                "conn-1".into(),
                Arc::new(query_task.abort_handle()),
            );
            register_abort_handle(
                &state.handles,
                "conn-1".into(),
                Arc::new(explain_task.abort_handle()),
            );

            cancel_query_impl(&state, "conn-1").unwrap();

            assert!(query_task.await.unwrap_err().is_cancelled());
            assert!(explain_task.await.unwrap_err().is_cancelled());
            assert!(state.handles.lock().unwrap().get("conn-1").is_none());
        }
    }

    // -------------------------------------------------------------------
    // Cascade-delete helpers
    // -------------------------------------------------------------------

    fn group(id: &str, parent: Option<&str>) -> ConnectionGroup {
        ConnectionGroup {
            id: id.to_string(),
            name: id.to_string(),
            collapsed: false,
            sort_order: 0,
            parent_id: parent.map(|p| p.to_string()),
        }
    }

    fn conn(id: &str, group_id: Option<&str>) -> SavedConnection {
        let mut c = saved_conn(id, None, false);
        c.group_id = group_id.map(|g| g.to_string());
        c
    }

    #[test]
    fn collect_group_subtree_returns_root_only_for_leaf() {
        let groups = vec![group("a", None), group("b", None)];
        let subtree = crate::models::collect_group_subtree(&groups, "a");
        assert_eq!(subtree, std::collections::HashSet::from(["a".to_string()]));
    }

    #[test]
    fn collect_group_subtree_walks_full_descendant_chain() {
        // Tree:
        //   root
        //   ├── child1
        //   │   └── grand1
        //   │       └── great1
        //   └── child2
        //   other (unrelated)
        let groups = vec![
            group("root", None),
            group("child1", Some("root")),
            group("grand1", Some("child1")),
            group("great1", Some("grand1")),
            group("child2", Some("root")),
            group("other", None),
        ];
        let subtree = crate::models::collect_group_subtree(&groups, "root");
        assert_eq!(
            subtree,
            std::collections::HashSet::from([
                "root".to_string(),
                "child1".to_string(),
                "grand1".to_string(),
                "great1".to_string(),
                "child2".to_string(),
            ])
        );
        assert!(!subtree.contains("other"));
    }

    #[test]
    fn collect_group_subtree_for_subgroup_does_not_include_siblings() {
        // Tree:
        //   root
        //   ├── keep
        //   └── drop
        let groups = vec![
            group("root", None),
            group("keep", Some("root")),
            group("drop", Some("root")),
        ];
        let subtree = crate::models::collect_group_subtree(&groups, "drop");
        assert_eq!(subtree, std::collections::HashSet::from(["drop".to_string()]));
        assert!(!subtree.contains("root"));
        assert!(!subtree.contains("keep"));
    }

    #[test]
    fn collect_group_subtree_for_unknown_id_is_singleton() {
        let groups = vec![group("a", None)];
        let subtree = crate::models::collect_group_subtree(&groups, "missing");
        assert_eq!(subtree, std::collections::HashSet::from(["missing".to_string()]));
    }

    #[test]
    fn cascade_delete_removes_parent_descendants_and_connections() {
        // Mirrors what the command does after the helper returns: groups
        // and connections not in the subtree must survive untouched.
        let groups = vec![
            group("root", None),
            group("child", Some("root")),
            group("grand", Some("child")),
            group("sibling", None),
        ];
        let connections = vec![
            conn("c1", Some("root")),
            conn("c2", Some("child")),
            conn("c3", Some("grand")),
            conn("c4", Some("sibling")),
            conn("c5", None),
        ];
        let to_delete = crate::models::collect_group_subtree(&groups, "root");

        let groups_after: Vec<_> = groups
            .iter()
            .filter(|g| !to_delete.contains(&g.id))
            .cloned()
            .collect();
        let conns_after: Vec<_> = connections
            .iter()
            .filter(|c| !c.group_id.as_ref().is_some_and(|g| to_delete.contains(g)))
            .cloned()
            .collect();

        assert_eq!(groups_after, vec![group("sibling", None)]);
        assert_eq!(
            conns_after.iter().map(|c| c.id.clone()).collect::<Vec<_>>(),
            vec!["c4".to_string(), "c5".to_string()],
        );
    }

    #[test]
    fn cascade_delete_subgroup_leaves_parent_and_other_subgroups_alone() {
        let groups = vec![
            group("root", None),
            group("keep", Some("root")),
            group("drop", Some("root")),
            group("grand", Some("drop")),
        ];
        let connections = vec![
            conn("c1", Some("root")),
            conn("c2", Some("drop")),
            conn("c3", Some("grand")),
            conn("c4", Some("keep")),
        ];
        let to_delete = crate::models::collect_group_subtree(&groups, "drop");

        let groups_after: Vec<_> = groups
            .iter()
            .filter(|g| !to_delete.contains(&g.id))
            .cloned()
            .collect();
        let conns_after: Vec<_> = connections
            .iter()
            .filter(|c| !c.group_id.as_ref().is_some_and(|g| to_delete.contains(g)))
            .cloned()
            .collect();

        assert_eq!(
            groups_after,
            vec![group("root", None), group("keep", Some("root"))],
        );
        assert_eq!(
            conns_after.iter().map(|c| c.id.clone()).collect::<Vec<_>>(),
            vec!["c1".to_string(), "c4".to_string()],
        );
    }
}

#[tauri::command]
pub async fn list_databases<R: Runtime>(
    app: AppHandle<R>,
    request: TestConnectionRequest,
) -> Result<Vec<String>, String> {
    let mut expanded_params = expand_ssh_connection_params(&app, &request.params).await?;
    expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;

    let iam_auth = expanded_params.use_iam_auth.unwrap_or(false);

    // IAM auth needs an RDS auth token right now; skip the keychain fallback
    // so a stale token can't be reused, and fail fast with an actionable
    // message if none was supplied.
    require_iam_token(
        iam_auth,
        request.params.password.as_deref(),
        expanded_params.password.as_deref(),
    )?;

    if !iam_auth && request.params.password.is_none() && expanded_params.password.is_none() {
        let saved_conn = match &request.connection_id {
            Some(id) => find_connection_by_id(&app, id).ok(),
            None => None,
        };
        expanded_params.password =
            resolve_test_connection_password(&request.params, saved_conn.as_ref(), |conn_id| {
                keychain_utils::get_db_password(conn_id, "")
            });
    }

    // Reconnecting to a saved connection sends the on-disk params, which never
    // carry the URI — restore it the same way the password is restored above.
    // An inline URI (the ephemeral Test Connection flow) always wins.
    if runtime_connection_uri(&expanded_params).is_none() {
        if let Some(conn_id) = &request.connection_id {
            let cache = app.state::<std::sync::Arc<credential_cache::CredentialCache>>();
            restore_runtime_connection_uri(&cache, conn_id, &mut expanded_params)?;
        }
    }

    let resolved_params = if let Some(conn_id) = &request.connection_id {
        resolve_connection_params_with_id(&expanded_params, conn_id)?
    } else {
        resolve_connection_params(&expanded_params)?
    };

    #[cfg(debug_assertions)]
    log::debug!(
        "[List Databases] Resolved Params: Host={:?}, Port={:?}, Username={:?}",
        resolved_params.host,
        resolved_params.port,
        resolved_params.username,
    );

    let drv = driver_for(&resolved_params.driver).await?;
    drv.get_databases(&resolved_params).await
}

#[tauri::command]
pub async fn get_tables<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<TableInfo>, String> {
    crate::application::metadata::get_tables(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_columns<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table_name: String,
    schema: Option<String>,
) -> Result<Vec<TableColumn>, String> {
    crate::application::metadata::get_columns(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        table_name,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_foreign_keys<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table_name: String,
    schema: Option<String>,
) -> Result<Vec<ForeignKey>, String> {
    crate::application::metadata::get_foreign_keys(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        table_name,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_indexes<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table_name: String,
    schema: Option<String>,
) -> Result<Vec<Index>, String> {
    crate::application::metadata::get_indexes(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        table_name,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn delete_record<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table: String,
    pk_map: std::collections::HashMap<String, serde_json::Value>,
    schema: Option<String>,
    database: Option<String>,
) -> Result<u64, String> {
    crate::application::records::delete_record(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        table,
        pk_map,
        schema,
        database,
    )
    .await
}

#[tauri::command]
pub async fn update_record<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table: String,
    pk_map: std::collections::HashMap<String, serde_json::Value>,
    col_name: String,
    new_val: serde_json::Value,
    schema: Option<String>,
    database: Option<String>,
) -> Result<u64, String> {
    crate::application::records::update_record(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        table,
        pk_map,
        col_name,
        new_val,
        schema,
        database,
    )
    .await
}

#[tauri::command]
pub async fn save_blob_to_file<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table: String,
    col_name: String,
    pk_map: std::collections::HashMap<String, serde_json::Value>,
    file_path: String,
    schema: Option<String>,
) -> Result<(), String> {
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.save_blob_to_file(
        &params,
        &table,
        &col_name,
        &pk_map,
        schema.as_deref(),
        &file_path,
    )
    .await
}

#[tauri::command]
pub async fn fetch_blob<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table: String,
    col_name: String,
    pk_map: std::collections::HashMap<String, serde_json::Value>,
    schema: Option<String>,
    database: Option<String>,
) -> Result<crate::application::records::BlobFetchResponse, String> {
    crate::application::records::fetch_blob(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        table,
        col_name,
        pk_map,
        schema,
        database,
        crate::application::records::BlobFetchPolicy::Inline,
    )
    .await
}

/// Fetches a BLOB column from the database and returns it as a data: URL for image preview.
/// Same query logic as save_blob_to_file but returns the data in-memory instead of writing to disk.
#[tauri::command]
pub async fn fetch_blob_as_data_url<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table: String,
    col_name: String,
    pk_map: std::collections::HashMap<String, serde_json::Value>,
    schema: Option<String>,
    database: Option<String>,
) -> Result<String, String> {
    crate::application::records::fetch_blob_as_data_url(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        table,
        col_name,
        pk_map,
        schema,
        database,
    )
    .await
}

/// Detects the MIME type of base64-encoded binary data using magic-byte analysis
/// and returns the canonical blob wire format: "BLOB:<size>:<mime>:<base64>".
/// Called by the frontend after the user selects a file to upload.
#[tauri::command]
pub fn detect_blob_mime(base64_data: String) -> Result<String, String> {
    crate::application::records::detect_blob_mime(&base64_data)
}

/// Prepares a file for BLOB upload by returning only metadata and a file reference.
/// The actual file content is NOT transferred over IPC, avoiding massive string allocations.
/// The file content will be read directly from disk when needed (e.g., during INSERT/UPDATE).
/// Returns a special "BLOB_FILE_REF" format that includes file path, size, and MIME type.
#[tauri::command]
pub async fn load_blob_from_file<R: Runtime>(
    app: AppHandle<R>,
    file_path: String,
) -> Result<String, String> {
    use std::io::Read;

    // Read max_blob_size from configuration
    let max_blob_size = crate::config::get_max_blob_size(&app);

    tokio::task::spawn_blocking(move || -> Result<String, String> {
        let mut file = std::fs::File::open(&file_path)
            .map_err(|e| format!("Failed to open file: {}", e))?;

        // Get file size
        let metadata = file.metadata()
            .map_err(|e| format!("Failed to get file metadata: {}", e))?;
        let file_size = metadata.len();

        // Validate file size against maximum allowed
        if file_size > max_blob_size {
            return Err(format!(
                "File size ({} bytes / {:.2}MB) exceeds maximum allowed size ({} bytes / {}MB). Please choose a smaller file.",
                file_size,
                file_size as f64 / (1024.0 * 1024.0),
                max_blob_size,
                max_blob_size / (1024 * 1024)
            ));
        }

        // Read first chunk for MIME detection (only 8KB)
        let header_size = std::cmp::min(8192, file_size as usize);
        let mut header = vec![0u8; header_size];
        file.read_exact(&mut header)
            .map_err(|e| format!("Failed to read file header: {}", e))?;

        // Detect MIME type
        let mime = infer::get(&header)
            .map(|k| k.mime_type())
            .unwrap_or("application/octet-stream");

        // Return a file reference instead of actual content
        // Format: "BLOB_FILE_REF:<size>:<mime>:<filepath>"
        Ok(format!("BLOB_FILE_REF:{}:{}:{}", file_size, mime, file_path))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Detects the MIME type from a small base64-encoded header (first ~8KB).
/// Returns only the MIME type string — the frontend constructs the wire format
/// locally, avoiding a full round-trip of the entire file over IPC.
#[tauri::command]
pub fn detect_mime_type(header_base64: String) -> Result<String, String> {
    crate::application::records::detect_mime_type(&header_base64)
}

/// Gets file statistics (size and MIME type) without reading the entire file.
/// Used after streaming upload to construct the final wire format.
#[tauri::command]
pub fn get_file_stats(file_path: String) -> Result<serde_json::Value, String> {
    use std::io::Read;

    let mut file =
        std::fs::File::open(&file_path).map_err(|e| format!("Failed to open file: {}", e))?;

    let metadata = file
        .metadata()
        .map_err(|e| format!("Failed to get file metadata: {}", e))?;
    let file_size = metadata.len();

    // Read first chunk for MIME detection
    let header_size = std::cmp::min(8192, file_size as usize);
    let mut header = vec![0u8; header_size];
    file.read_exact(&mut header)
        .map_err(|e| format!("Failed to read file header: {}", e))?;

    let mime = infer::get(&header)
        .map(|k| k.mime_type())
        .unwrap_or("application/octet-stream");

    Ok(serde_json::json!({
        "size": file_size,
        "mime": mime,
    }))
}

/// Reads a file from disk and returns it as a base64-encoded data URL.
/// Used for image preview of BLOB_FILE_REF values without requiring frontend FS permissions.
/// Only available for image files; returns an error for non-image MIME types.
#[tauri::command]
pub async fn read_file_as_data_url(file_path: String) -> Result<String, String> {
    use base64::Engine;
    use std::io::Read;

    tokio::task::spawn_blocking(move || -> Result<String, String> {
        let mut file =
            std::fs::File::open(&file_path).map_err(|e| format!("Failed to open file: {}", e))?;

        let metadata = file
            .metadata()
            .map_err(|e| format!("Failed to get file metadata: {}", e))?;
        let file_size = metadata.len() as usize;

        // Read full file
        let mut bytes = Vec::with_capacity(file_size);
        file.read_to_end(&mut bytes)
            .map_err(|e| format!("Failed to read file: {}", e))?;

        // Detect MIME type from header
        let mime = infer::get(&bytes)
            .map(|k| k.mime_type())
            .unwrap_or("application/octet-stream");

        if !mime.starts_with("image/") {
            return Err(format!("Not an image file: {}", mime));
        }

        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        Ok(format!("data:{};base64,{}", mime, b64))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn insert_record<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table: String,
    data: std::collections::HashMap<String, serde_json::Value>,
    schema: Option<String>,
    database: Option<String>,
) -> Result<u64, String> {
    crate::application::records::insert_record(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        table,
        data,
        schema,
        database,
    )
    .await
}

#[cfg(test)]
pub(crate) fn cancel_query_impl(
    state: &QueryCancellationState,
    connection_id: &str,
) -> Result<(), String> {
    crate::application::queries::cancel_registered_queries(
        state,
        None,
        connection_id,
        None,
    )
}

#[tauri::command]
pub async fn cancel_query(
    state: State<'_, QueryCancellationState>,
    connection_id: String,
) -> Result<(), String> {
    crate::application::queries::cancel_query(&state, None, &connection_id, None)
}

#[tauri::command]
pub async fn execute_query<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, QueryCancellationState>,
    connection_id: String,
    query: String,
    limit: Option<u32>,
    page: Option<u32>,
    schema: Option<String>,
) -> Result<QueryResult, String> {
    crate::application::queries::execute_query(
        &app.state::<crate::runtime::RuntimeContext>(),
        &state,
        crate::application::queries::QueryRequestScope::DESKTOP,
        crate::application::queries::QueryResponsePolicy::Unbounded,
        connection_id,
        query,
        limit,
        page,
        schema,
    )
    .await
}

/// Runs a sequence of statements that share a single physical database
/// connection. Use this — not multiple parallel `execute_query` calls —
/// whenever statements depend on connection-local session state
/// (`SET @var`, `LAST_INSERT_ID()` / `LASTVAL()`, `BEGIN`/`COMMIT`,
/// `TEMPORARY TABLE`, `PREPARE`/`EXECUTE`, `SET FOREIGN_KEY_CHECKS = 0`).
///
/// The whole batch shares one cancellation handle so `cancel_query`
/// aborts the entire batch atomically.
///
/// When `batch_id` is supplied, a `batch-statement-complete` event is emitted
/// after each statement so the UI updates result tabs progressively. The full
/// `Vec` is still returned at the end for final reconciliation / fallback.
#[tauri::command]
pub async fn execute_query_batch<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, QueryCancellationState>,
    connection_id: String,
    queries: Vec<String>,
    limit: Option<u32>,
    page: Option<u32>,
    schema: Option<String>,
    batch_id: Option<String>,
) -> Result<Vec<BatchStatementResult>, String> {
    crate::application::queries::execute_query_batch(
        &app.state::<crate::runtime::RuntimeContext>(),
        &state,
        crate::application::queries::QueryRequestScope::DESKTOP,
        crate::application::queries::QueryResponsePolicy::Unbounded,
        connection_id,
        queries,
        limit,
        page,
        schema,
        batch_id,
    )
    .await
}

// --- Explain Query Plan ---

#[tauri::command]
pub async fn explain_query_plan<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, QueryCancellationState>,
    connection_id: String,
    query: String,
    analyze: bool,
    schema: Option<String>,
) -> Result<ExplainQueryOutput, String> {
    crate::application::queries::explain_query_plan(
        &app.state::<crate::runtime::RuntimeContext>(),
        &state,
        crate::application::queries::QueryRequestScope::DESKTOP,
        connection_id,
        query,
        analyze,
        schema,
    )
    .await
}

// --- Count Query ---

#[tauri::command]
pub async fn count_query<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    query: String,
    schema: Option<String>,
) -> Result<u64, String> {
    crate::application::queries::count_query(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        connection_id,
        query,
        schema,
    )
    .await
}

// --- Window Title Management ---

/// Sets the window title with Wayland workaround
///
/// WORKAROUND: This is a temporary fix for tauri-apps/tauri#13749
/// On Wayland (Linux), the standard `window.setTitle()` API doesn't properly update
/// the window title in the window manager's title bar due to an upstream dependency issue.
/// This command directly manipulates the GTK HeaderBar to ensure the title is visible.
///
/// See: https://github.com/tauri-apps/tauri/issues/13749
///
/// This workaround should be removed once the upstream issue is resolved.
#[tauri::command]
pub async fn set_window_title(app: AppHandle, title: String) -> Result<(), String> {
    // Get the main window
    let window = app
        .get_webview_window("main")
        .ok_or("Failed to get main window")?;

    // Set title using standard Tauri API (works on all platforms)
    window
        .set_title(&title)
        .map_err(|e| format!("Failed to set window title: {}", e))?;

    // Apply Wayland-specific workaround on Linux
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::{BinExt, Cast, GtkWindowExt, HeaderBarExt};
        use gtk::{EventBox, HeaderBar};

        // Get the GTK window
        let gtk_window = window
            .gtk_window()
            .map_err(|e| format!("Failed to get GTK window: {}", e))?;

        // Check if we have a custom titlebar (Wayland uses EventBox with HeaderBar)
        if let Some(titlebar) = gtk_window.titlebar() {
            // Try to downcast to EventBox (Wayland)
            if let Ok(event_box) = titlebar.downcast::<EventBox>() {
                // Get the HeaderBar child and set its title
                if let Some(child) = event_box.child() {
                    if let Ok(header_bar) = child.downcast::<HeaderBar>() {
                        header_bar.set_title(Some(&title));
                    }
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn open_er_diagram_window(
    app: AppHandle,
    connection_id: String,
    connection_name: String,
    database_name: String,
    focus_table: Option<String>,
    schema: Option<String>,
) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    use urlencoding::encode;

    let schema_suffix = schema
        .as_deref()
        .map(|s| format!("/{}", s))
        .unwrap_or_default();
    let title = format!(
        "tabularis - {} ({}{})",
        database_name, connection_name, schema_suffix
    );
    let mut url = format!(
        "/schema-diagram?connectionId={}&connectionName={}&databaseName={}",
        encode(&connection_id),
        encode(&connection_name),
        encode(&database_name)
    );

    if let Some(table) = focus_table {
        url.push_str(&format!("&focusTable={}", encode(&table)));
    }

    if let Some(s) = &schema {
        url.push_str(&format!("&schema={}", encode(s)));
    }

    // Derive a unique window label per (connection, database, schema) so that
    // diagrams for different databases on the same connection do not collide on a
    // shared label (which previously kept showing the first database's diagram).
    // Tauri window labels only allow a limited character set, so sanitize anything
    // else to '_'.
    let raw_label = format!(
        "er-diagram:{}:{}:{}",
        connection_id,
        database_name,
        schema.as_deref().unwrap_or("")
    );
    let label: String = raw_label
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();

    // If a diagram window for this exact database already exists, just focus it
    // instead of failing to build a second window with the same label.
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.set_focus();
        return Ok(());
    }

    let _webview = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(&title)
        .inner_size(1200.0, 800.0)
        .center()
        .build()
        .map_err(|e| format!("Failed to create ER Diagram window: {}", e))?;

    Ok(())
}

/// Builds a connection URL for a database driver.
pub async fn build_connection_url(params: &ConnectionParams) -> Result<String, String> {
    let user = encode(params.username.as_deref().unwrap_or_default());
    let raw_pass = params.password.as_deref().unwrap_or_default();
    let credentials = if raw_pass.is_empty() {
        user.into_owned()
    } else {
        format!("{}:{}", user, encode(raw_pass))
    };
    let host = params.host.as_deref().unwrap_or("localhost");

    match params.driver.as_str() {
        "sqlite" => Ok(format!("sqlite://{}", params.database)),
        "postgres" => Ok(format!(
            "postgres://{}@{}:{}/{}",
            credentials,
            host,
            params.port.unwrap_or(DEFAULT_POSTGRES_PORT),
            params.database
        )),
        "mysql" => Ok(format!(
            "mysql://{}@{}:{}/{}",
            credentials,
            host,
            params.port.unwrap_or(DEFAULT_MYSQL_PORT),
            params.database
        )),
        _ => Err("Unsupported driver".into()),
    }
}

fn resolve_test_connection_password(
    params: &ConnectionParams,
    saved_conn: Option<&SavedConnection>,
    get_keychain_password: impl Fn(&str) -> Result<String, String>,
) -> Option<String> {
    if let Some(pwd) = &params.password {
        return Some(pwd.clone());
    }

    let saved = saved_conn?;

    if saved.params.save_in_keychain.unwrap_or(false) {
        if let Ok(pwd) = get_keychain_password(&saved.id) {
            if !pwd.trim().is_empty() {
                return Some(pwd);
            }
        }
    }

    match &saved.params.password {
        Some(pwd) if !pwd.trim().is_empty() => Some(pwd.clone()),
        _ => None,
    }
}

/// Resolves SSH credential (password or passphrase) for testing
/// 1. Credential from request params (if provided, even if empty)
/// 2. Credential from keychain (if save_in_keychain is enabled)
/// 3. Credential from saved connection (as fallback)
#[cfg(test)]
fn resolve_ssh_test_credential(
    request_credential: Option<&str>,
    connection_id: Option<&str>,
    get_ssh_connection: impl Fn(&str) -> Option<SshConnection>,
    get_keychain_credential: impl Fn(&str) -> Result<String, String>,
    extract_saved_credential: impl Fn(&SshConnection) -> Option<String>,
) -> Option<String> {
    // Priority 1: Credential from request
    // If credential field is present in request, use it even if empty
    // Empty string means "use empty credential", not "fallback to keychain"
    if let Some(cred) = request_credential {
        return Some(cred.to_string());
    }

    // If no connection_id, we can't look up saved credentials
    let conn_id = connection_id?;
    let saved = get_ssh_connection(conn_id)?;

    // Priority 2: Credential from keychain
    if saved.save_in_keychain.unwrap_or(false) {
        if let Ok(cred) = get_keychain_credential(conn_id) {
            if !cred.trim().is_empty() {
                return Some(cred);
            }
        }
    }

    // Priority 3: Credential from saved connection
    extract_saved_credential(&saved)
}

/// Fills SSH secrets that are still unresolved from the inline SSH fields of
/// a saved database connection (already hydrated from the keychain by
/// `find_connection_by_id`). Secrets explicitly provided by the request keep
/// priority; blank saved values are ignored.
#[cfg(test)]
fn apply_inline_ssh_secret_fallback(
    resolved_password: Option<String>,
    resolved_passphrase: Option<String>,
    saved_params: &ConnectionParams,
) -> (Option<String>, Option<String>) {
    fn non_blank(value: &Option<String>) -> Option<String> {
        value.as_ref().filter(|v| !v.trim().is_empty()).cloned()
    }
    (
        resolved_password.or_else(|| non_blank(&saved_params.ssh_password)),
        resolved_passphrase.or_else(|| non_blank(&saved_params.ssh_key_passphrase)),
    )
}

/// Helper for backward compatibility - resolves SSH password
#[cfg(test)]
fn resolve_ssh_test_password(
    request_password: Option<&str>,
    connection_id: Option<&str>,
    get_ssh_connection: impl Fn(&str) -> Option<SshConnection>,
    get_keychain_password: impl Fn(&str) -> Result<String, String>,
) -> Option<String> {
    resolve_ssh_test_credential(
        request_password,
        connection_id,
        get_ssh_connection,
        get_keychain_password,
        |conn| {
            conn.password
                .as_ref()
                .filter(|p| !p.trim().is_empty())
                .cloned()
        },
    )
}

// ==================== View Management Commands ====================

#[tauri::command]
pub async fn get_views<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<crate::models::ViewInfo>, String> {
    crate::application::metadata::get_views(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_view_definition<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    view_name: String,
    schema: Option<String>,
) -> Result<String, String> {
    crate::application::database_objects::get_view_definition(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        view_name,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn create_view<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    view_name: String,
    definition: String,
    schema: Option<String>,
) -> Result<(), String> {
    crate::application::database_objects::create_view(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        view_name,
        definition,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn alter_view<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    view_name: String,
    definition: String,
    schema: Option<String>,
) -> Result<(), String> {
    crate::application::database_objects::alter_view(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        view_name,
        definition,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn drop_view<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    view_name: String,
    schema: Option<String>,
) -> Result<(), String> {
    crate::application::database_objects::drop_view(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        view_name,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_view_columns<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    view_name: String,
    schema: Option<String>,
) -> Result<Vec<TableColumn>, String> {
    crate::application::metadata::get_view_columns(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        view_name,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_materialized_views<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<crate::models::ViewInfo>, String> {
    crate::application::metadata::get_materialized_views(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_materialized_view_columns<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    view_name: String,
    schema: Option<String>,
) -> Result<Vec<TableColumn>, String> {
    crate::application::metadata::get_materialized_view_columns(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        view_name,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_materialized_view_definition<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    view_name: String,
    schema: Option<String>,
) -> Result<String, String> {
    crate::application::metadata::get_materialized_view_definition(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        view_name,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn refresh_materialized_view<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    view_name: String,
    schema: Option<String>,
) -> Result<(), String> {
    crate::application::database_objects::refresh_materialized_view(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        view_name,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_triggers<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<TriggerInfo>, String> {
    crate::application::metadata::get_triggers(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_trigger_definition<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    trigger_name: String,
    table_name: String,
    schema: Option<String>,
) -> Result<String, String> {
    crate::application::database_objects::get_trigger_definition(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        trigger_name,
        table_name,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn create_trigger<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    trigger_sql: String,
    schema: Option<String>,
) -> Result<(), String> {
    crate::application::database_objects::create_trigger(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        trigger_sql,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn drop_trigger<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    trigger_name: String,
    table_name: String,
    schema: Option<String>,
) -> Result<(), String> {
    crate::application::database_objects::drop_trigger(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        trigger_name,
        table_name,
        schema,
    )
    .await
}

// --- User management (gated by `DriverCapabilities::user_management`) -------

#[tauri::command]
pub async fn get_db_privilege_catalog<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<crate::models::DbPrivilegeCatalog, String> {
    crate::application::database_objects::get_db_privilege_catalog(
        &app.state::<crate::runtime::RuntimeContext>(),
        &connection_id,
    )
    .await
}

#[tauri::command]
pub async fn get_db_users<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<Vec<crate::models::DbUserInfo>, String> {
    crate::application::database_objects::get_db_users(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
    )
    .await
}

#[tauri::command]
pub async fn get_db_user_grants<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    user: String,
    host: String,
) -> Result<Vec<String>, String> {
    crate::application::database_objects::get_db_user_grants(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        user,
        host,
    )
    .await
}

#[tauri::command]
pub async fn create_db_user<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    user: String,
    host: String,
    password: String,
) -> Result<(), String> {
    crate::application::database_objects::create_db_user(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        user,
        host,
        password,
    )
    .await
}

#[tauri::command]
pub async fn drop_db_user<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    user: String,
    host: String,
) -> Result<(), String> {
    crate::application::database_objects::drop_db_user(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        user,
        host,
    )
    .await
}

#[tauri::command]
pub async fn set_db_user_password<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    user: String,
    host: String,
    password: String,
) -> Result<(), String> {
    crate::application::database_objects::set_db_user_password(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        user,
        host,
        password,
    )
    .await
}

#[tauri::command]
pub async fn get_db_user_privileges<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    user: String,
    host: String,
) -> Result<Vec<crate::models::DbUserGrantSet>, String> {
    crate::application::database_objects::get_db_user_privileges(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        user,
        host,
    )
    .await
}

#[tauri::command]
pub async fn apply_db_user_privileges<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    user: String,
    host: String,
    database: Option<String>,
    table: Option<String>,
    privileges: Vec<String>,
    grant: bool,
) -> Result<(), String> {
    crate::application::database_objects::apply_db_user_privileges(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        user,
        host,
        database,
        table,
        privileges,
        grant,
    )
    .await
}

/// Register a connection as active for health-check pinging.
#[tauri::command]
pub async fn register_active_connection<R: Runtime>(app: AppHandle<R>, connection_id: String) {
    crate::application::connections::register_active_connection(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        None,
        connection_id,
    )
    .await;
}

/// Snapshot of connection ids currently open in the shared backend (across all
/// windows). Used by each window to render cross-window connection status.
#[tauri::command]
pub async fn get_active_connections() -> Vec<String> {
    crate::health_check::active_connections().await
}

/// Disconnect from a database connection by closing its connection pool
#[tauri::command]
pub async fn disconnect_connection<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<(), String> {
    crate::application::connections::disconnect_connection(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        None,
        &connection_id,
    )
    .await
}

// --- Type Registry ---

#[tauri::command]
pub async fn get_data_types(driver: String) -> Result<crate::models::DataTypeRegistry, String> {
    log::debug!("Fetching data types for driver: {}", driver);

    let drv = driver_for(&driver).await?;
    let types = drv.get_data_types();

    Ok(crate::models::DataTypeRegistry { driver, types })
}

/// Maps generic inferred types (emitted by the clipboard parser) to
/// driver-specific type names. Returns names in the same order as `kinds`.
#[tauri::command]
pub async fn map_inferred_column_types(
    driver: String,
    kinds: Vec<String>,
) -> Result<Vec<String>, String> {
    let drv = driver_for(&driver).await?;
    Ok(kinds.iter().map(|k| drv.map_inferred_type(k)).collect())
}

// --- DDL generation commands ---

#[tauri::command]
pub async fn get_create_table_sql<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table_name: String,
    columns: Vec<ColumnDefinition>,
    schema: Option<String>,
) -> Result<Vec<String>, String> {
    crate::application::database_objects::get_create_table_sql(
        &app.state::<crate::runtime::RuntimeContext>(),
        &connection_id,
        table_name,
        columns,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_add_column_sql<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table: String,
    column: ColumnDefinition,
    schema: Option<String>,
) -> Result<Vec<String>, String> {
    crate::application::database_objects::get_add_column_sql(
        &app.state::<crate::runtime::RuntimeContext>(),
        &connection_id,
        table,
        column,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_alter_column_sql<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table: String,
    old_column: ColumnDefinition,
    new_column: ColumnDefinition,
    schema: Option<String>,
) -> Result<Vec<String>, String> {
    crate::application::database_objects::get_alter_column_sql(
        &app.state::<crate::runtime::RuntimeContext>(),
        &connection_id,
        table,
        old_column,
        new_column,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_create_index_sql<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table: String,
    index_name: String,
    columns: Vec<String>,
    is_unique: bool,
    schema: Option<String>,
) -> Result<Vec<String>, String> {
    crate::application::database_objects::get_create_index_sql(
        &app.state::<crate::runtime::RuntimeContext>(),
        &connection_id,
        table,
        index_name,
        columns,
        is_unique,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_create_foreign_key_sql<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table: String,
    fk_name: String,
    column: String,
    ref_table: String,
    ref_column: String,
    on_delete: Option<String>,
    on_update: Option<String>,
    schema: Option<String>,
) -> Result<Vec<String>, String> {
    crate::application::database_objects::get_create_foreign_key_sql(
        &app.state::<crate::runtime::RuntimeContext>(),
        &connection_id,
        table,
        fk_name,
        column,
        ref_table,
        ref_column,
        on_delete,
        on_update,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn drop_index_action<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table: String,
    index_name: String,
    schema: Option<String>,
) -> Result<(), String> {
    crate::application::database_objects::drop_index(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        table,
        index_name,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn drop_foreign_key_action<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table: String,
    fk_name: String,
    schema: Option<String>,
) -> Result<(), String> {
    crate::application::database_objects::drop_foreign_key(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        table,
        fk_name,
        schema,
    )
    .await
}

#[tauri::command]
pub async fn get_registered_drivers() -> Vec<crate::drivers::driver_trait::PluginManifest> {
    crate::drivers::registry::list_drivers().await
}

#[tauri::command]
pub async fn get_keybindings<R: Runtime>(
    app: AppHandle<R>,
) -> Result<serde_json::Value, String> {
    crate::application::persistence::get_keybindings(
        &app.state::<crate::runtime::RuntimeContext>(),
    )
}

#[tauri::command]
pub async fn save_keybindings<R: Runtime>(
    app: AppHandle<R>,
    keybindings: serde_json::Value,
) -> Result<(), String> {
    crate::application::persistence::save_keybindings(
        &app.state::<crate::runtime::RuntimeContext>(),
        &keybindings,
    )
}

#[tauri::command]
pub async fn get_driver_manifest(
    driver_id: String,
) -> Option<crate::drivers::driver_trait::PluginManifest> {
    crate::drivers::registry::get_driver(&driver_id)
        .await
        .map(|d| d.manifest().clone())
}

// ==================== Connection Groups Management ====================

#[tauri::command]
pub async fn get_connection_groups<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<ConnectionGroup>, String> {
    let path = get_config_path(&app)?;
    persistence::load_groups(&path)
}

#[tauri::command]
pub async fn get_connections_with_groups<R: Runtime>(
    app: AppHandle<R>,
) -> Result<ConnectionsFile, String> {
    // Run migrations if needed
    migrate_ssh_connections(&app).await.ok();
    migrate_postgres_ssl_mode_spelling(&app).await.ok();

    let path = get_config_path(&app)?;
    persistence::load_connections_file(&path)
}

#[tauri::command]
pub async fn create_connection_group<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    parent_id: Option<String>,
) -> Result<ConnectionGroup, String> {
    let path = get_config_path(&app)?;
    let mut file = persistence::load_connections_file(&path).unwrap_or_default();

    if let Some(pid) = &parent_id {
        if !file.groups.iter().any(|g| &g.id == pid) {
            return Err(format!("Parent group with ID {} not found", pid));
        }
    }

    let max_order = file
        .groups
        .iter()
        .filter(|g| g.parent_id == parent_id)
        .map(|g| g.sort_order)
        .max()
        .unwrap_or(-1);

    let group = ConnectionGroup {
        id: Uuid::new_v4().to_string(),
        name,
        collapsed: false,
        sort_order: max_order + 1,
        parent_id,
    };

    file.groups.push(group.clone());
    save_connections_and_invalidate(&app, &path, &file)?;

    Ok(group)
}

/// Splits a `/`-separated group path into trimmed, non-empty segments.
/// Returns an error if the result is empty.
pub(crate) fn parse_group_path(path: &str) -> Result<Vec<String>, String> {
    let segments: Vec<String> = path
        .split('/')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if segments.is_empty() {
        return Err("Group path cannot be empty".to_string());
    }
    Ok(segments)
}

/// Finds an existing group by case-insensitive name match within a parent's
/// children, or `None` if no such group exists.
pub(crate) fn find_child_group<'a>(
    groups: &'a [ConnectionGroup],
    name: &str,
    parent_id: &Option<String>,
) -> Option<&'a ConnectionGroup> {
    let name_lower = name.to_lowercase();
    groups
        .iter()
        .find(|g| g.name.to_lowercase() == name_lower && g.parent_id == *parent_id)
}

/// Creates a nested group hierarchy from a `/`-separated path.
///
/// Each segment of `path` becomes one group. Existing segments are reused
/// (looked up case-insensitively among the children of the current parent);
/// missing segments are created in order. The final segment is returned.
/// The hierarchy is created atomically: either every missing segment is
/// persisted or none are.
#[tauri::command]
pub async fn create_group_path<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    parent_id: Option<String>,
) -> Result<ConnectionGroup, String> {
    let path_cfg = get_config_path(&app)?;
    let mut file = persistence::load_connections_file(&path_cfg).unwrap_or_default();

    if let Some(pid) = &parent_id {
        if !file.groups.iter().any(|g| &g.id == pid) {
            return Err(format!("Parent group with ID {} not found", pid));
        }
    }

    let segments = parse_group_path(&path)?;
    let mut current_parent = parent_id;
    let mut last_created: Option<ConnectionGroup> = None;

    for seg in segments {
        if let Some(g) = find_child_group(&file.groups, &seg, &current_parent).cloned() {
            current_parent = Some(g.id.clone());
            last_created = Some(g);
            continue;
        }
        let max_order = file
            .groups
            .iter()
            .filter(|g| g.parent_id == current_parent)
            .map(|g| g.sort_order)
            .max()
            .unwrap_or(-1);
        let new_group = ConnectionGroup {
            id: Uuid::new_v4().to_string(),
            name: seg,
            collapsed: false,
            sort_order: max_order + 1,
            parent_id: current_parent.clone(),
        };
        current_parent = Some(new_group.id.clone());
        last_created = Some(new_group.clone());
        file.groups.push(new_group);
    }

    save_connections_and_invalidate(&app, &path_cfg, &file)?;

    last_created.ok_or_else(|| "Group path resolved to an empty hierarchy".to_string())
}

#[tauri::command]
pub async fn update_connection_group<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    name: Option<String>,
    collapsed: Option<bool>,
    sort_order: Option<i32>,
) -> Result<ConnectionGroup, String> {
    let path = get_config_path(&app)?;
    let mut file = persistence::load_connections_file(&path)?;

    let group = file
        .groups
        .iter_mut()
        .find(|g| g.id == id)
        .ok_or_else(|| format!("Group with ID {} not found", id))?;

    if let Some(n) = name {
        group.name = n;
    }
    if let Some(c) = collapsed {
        group.collapsed = c;
    }
    if let Some(o) = sort_order {
        group.sort_order = o;
    }

    let updated = group.clone();
    save_connections_and_invalidate(&app, &path, &file)?;

    Ok(updated)
}
/// Re-parent a group. Pass `Some(id)` to make it a child of that group,
/// or `None` to make it a top-level root. Cycles are rejected.
#[tauri::command]
pub async fn move_group_to_parent<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    parent_id: Option<String>,
) -> Result<ConnectionGroup, String> {
    let path = get_config_path(&app)?;
    let mut file = persistence::load_connections_file(&path)?;

    if !file.groups.iter().any(|g| g.id == id) {
        return Err(format!("Group with ID {} not found", id));
    }

    if let Some(pid) = &parent_id {
        if pid == &id {
            return Err("A group cannot be its own parent".to_string());
        }
        if !file.groups.iter().any(|g| &g.id == pid) {
            return Err(format!("Parent group with ID {} not found", pid));
        }
    }

    reject_if_would_create_cycle(&file.groups, &id, parent_id.as_deref())?;

    let group = file
        .groups
        .iter_mut()
        .find(|g| g.id == id)
        .expect("group existence checked above");
    group.parent_id = parent_id;
    let updated = group.clone();

    save_connections_and_invalidate(&app, &path, &file)?;
    Ok(updated)
}

/// Reject re-parenting that would create a cycle: `target` must not be a
/// descendant of `group_id`. Walks up from `target` looking for `group_id`.
/// Bounded by `groups.len()` to fail-safe against pre-existing data cycles.
pub(crate) fn reject_if_would_create_cycle(
    groups: &[ConnectionGroup],
    group_id: &str,
    new_parent_id: Option<&str>,
) -> Result<(), String> {
    let Some(target) = new_parent_id else {
        return Ok(());
    };
    let mut current = Some(target.to_string());
    let mut visited = std::collections::HashSet::new();
    let max_steps = groups.len() + 1;
    for _ in 0..max_steps {
        match current {
            Some(node) if node == group_id => {
                return Err(
                    "Cannot move a group into one of its own descendants (would create a cycle)"
                        .to_string(),
                );
            }
            Some(node) => {
                if !visited.insert(node.clone()) {
                    return Err(
                        "Connection-group tree contains a pre-existing cycle; refusing to modify it"
                            .to_string(),
                    );
                }
                current = groups
                    .iter()
                    .find(|g| g.id == node)
                    .and_then(|g| g.parent_id.clone());
            }
            None => return Ok(()),
        }
    }
    Err("Connection-group tree is deeper than the number of groups; refusing to modify it".to_string())
}

#[tauri::command]
pub async fn delete_connection_group<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let path = get_config_path(&app)?;
    let mut file = persistence::load_connections_file(&path)?;

    // Ensure the group exists before we walk the tree.
    if !file.groups.iter().any(|g| g.id == id) {
        return Err(format!("Group with ID {} not found", id));
    }

    // Cascade delete: collect the target group and all of its descendants
    // (transitively) so the entire subtree is removed. The caller only
    // needs to specify the top-level group — every nested child group is
    // deleted along with it. Connections belonging to any group in the
    // subtree are removed as well.
    let to_delete = crate::models::collect_group_subtree(&file.groups, &id);

    file.groups.retain(|g| !to_delete.contains(&g.id));
    file.connections
        .retain(|c| !c.group_id.as_ref().is_some_and(|gid| to_delete.contains(gid)));

    save_connections_and_invalidate(&app, &path, &file)?;

    Ok(())
}

#[tauri::command]
pub async fn move_connection_to_group<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    group_id: Option<String>,
    sort_order: Option<i32>,
) -> Result<SavedConnection, String> {
    let path = get_config_path(&app)?;
    let mut file = persistence::load_connections_file(&path)?;

    let conn = file
        .connections
        .iter_mut()
        .find(|c| c.id == connection_id)
        .ok_or_else(|| format!("Connection with ID {} not found", connection_id))?;

    conn.group_id = group_id;
    if let Some(order) = sort_order {
        conn.sort_order = Some(order);
    }

    let updated = conn.clone();
    save_connections_and_invalidate(&app, &path, &file)?;

    Ok(updated)
}

#[tauri::command]
pub async fn reorder_groups<R: Runtime>(
    app: AppHandle<R>,
    group_orders: Vec<(String, i32)>,
) -> Result<(), String> {
    let path = get_config_path(&app)?;
    let mut file = persistence::load_connections_file(&path)?;

    for (group_id, order) in group_orders {
        if let Some(group) = file.groups.iter_mut().find(|g| g.id == group_id) {
            group.sort_order = order;
        }
    }

    save_connections_and_invalidate(&app, &path, &file)?;
    Ok(())
}

#[tauri::command]
pub async fn reorder_connections_in_group<R: Runtime>(
    app: AppHandle<R>,
    connection_orders: Vec<(String, i32)>,
) -> Result<(), String> {
    let path = get_config_path(&app)?;
    let mut file = persistence::load_connections_file(&path)?;

    for (conn_id, order) in connection_orders {
        if let Some(conn) = file.connections.iter_mut().find(|c| c.id == conn_id) {
            conn.sort_order = Some(order);
        }
    }

    save_connections_and_invalidate(&app, &path, &file)?;
    Ok(())
}

#[tauri::command]
pub async fn get_server_now<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<String, String> {
    crate::application::queries::get_server_now(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        connection_id,
    )
    .await
}

#[tauri::command]
pub async fn export_connections_payload<R: Runtime>(
    app: AppHandle<R>,
    include_secrets: Option<bool>,
    connection_ids: Option<Vec<String>>,
) -> Result<ExportPayload, String> {
    crate::application::connection_files::export_payload(
        app.state::<crate::runtime::RuntimeContext>().inner(),
        include_secrets.unwrap_or(true),
        connection_ids,
    )
    .await
}

#[tauri::command]
pub async fn encrypt_export_payload(
    payload: ExportPayload,
    password: String,
) -> Result<crate::export_crypto::EncryptedEnvelope, String> {
    let plaintext = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    crate::export_crypto::encrypt(&plaintext, &password)
}

#[tauri::command]
pub async fn decrypt_export_payload(
    envelope: crate::export_crypto::EncryptedEnvelope,
    password: String,
) -> Result<ExportPayload, String> {
    let plaintext = crate::export_crypto::decrypt(&envelope, &password)?;
    serde_json::from_str(&plaintext).map_err(|e| format!("Invalid export payload: {e}"))
}

#[tauri::command]
pub async fn import_connections_payload<R: Runtime>(
    app: AppHandle<R>,
    payload: ExportPayload,
) -> Result<(), String> {
    apply_export_payload(app, payload).await
}

/// Merge an `ExportPayload` into the user's stored connections, groups, SSH and
/// K8s records, moving any inline secrets into the keychain. Shared by the JSON
/// import command above and the foreign-app import flow.
pub async fn apply_export_payload<R: Runtime>(
    app: AppHandle<R>,
    payload: ExportPayload,
) -> Result<(), String> {
    crate::application::connection_files::apply_export_payload(
        app.state::<crate::runtime::RuntimeContext>().inner(),
        app.state::<std::sync::Arc<crate::connection_cache::ConnectionCache>>()
            .inner()
            .as_ref(),
        app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>()
            .inner()
            .as_ref(),
        payload,
    )
    .await
}
