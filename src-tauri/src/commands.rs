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
    ExplainPlan, ExportPayload, ForeignKey, Index, K8sConnection, K8sConnectionInput, QueryResult,
    RoutineInfo, RoutineParameter, SavedConnection, SshConnection, SshConnectionInput, SshTestParams,
    TableColumn, TableInfo, TestConnectionRequest, TriggerInfo,
};
use crate::persistence;
use crate::ssh_tunnel::{get_tunnels, SshTunnel};

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

/// Trims trailing semicolons and normalises Unicode smart quotes that some
/// editors insert when the user pastes a query. Called on every query the
/// UI hands off to a driver.
fn sanitize_user_query(query: &str) -> String {
    query
        .trim()
        .trim_end_matches(';')
        .replace('\u{2018}', "'")
        .replace('\u{2019}', "'")
        .replace('\u{201C}', "\"")
        .replace('\u{201D}', "\"")
}

// --- Persistence Helpers ---

/// Load a single SSH connection by ID, fetching only its credentials from
/// keychain (via the in-memory cache). This is O(1) keychain calls versus the
/// O(N) behaviour of `get_ssh_connections`, which loads every saved SSH
/// connection and retrieves credentials for each one.
async fn get_ssh_connection_by_id<R: Runtime>(
    app: &AppHandle<R>,
    ssh_id: &str,
) -> Result<SshConnection, String> {
    let path = get_ssh_config_path(app)?;
    if !path.exists() {
        return Err(format!("SSH connection with ID {} not found", ssh_id));
    }

    // File I/O off the Tokio executor thread
    let content = tokio::task::spawn_blocking({
        let path = path.clone();
        move || std::fs::read_to_string(path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    let mut ssh = serde_json::from_str::<Vec<SshConnection>>(&content)
        .unwrap_or_default()
        .into_iter()
        .find(|s| s.id == ssh_id)
        .ok_or_else(|| format!("SSH connection with ID {} not found", ssh_id))?;

    // Backward compat: determine auth_type if absent (mirrors get_ssh_connections logic)
    if ssh.auth_type.is_none() {
        ssh.auth_type = Some(
            if ssh
                .key_file
                .as_ref()
                .map_or(false, |k| !k.trim().is_empty())
            {
                "ssh_key".to_string()
            } else {
                "password".to_string()
            },
        );
    }

    // Fetch credentials only for this connection, via the in-memory cache.
    // On a warm cache hit this is a HashMap lookup (nanoseconds); on a cold miss
    // it calls keychain once per credential and then caches the result.
    if ssh.save_in_keychain.unwrap_or(false) {
        // Clone the Arc out of the Tauri State so the closure owns it ('static bound)
        let cache = app
            .state::<std::sync::Arc<crate::credential_cache::CredentialCache>>()
            .inner()
            .clone();
        let id = ssh.id.clone();
        let (pwd_r, pass_r) = tokio::task::spawn_blocking(move || {
            let pwd = credential_cache::get_ssh_password_cached(&cache, &id);
            let pass = credential_cache::get_ssh_key_passphrase_cached(&cache, &id);
            (pwd, pass)
        })
        .await
        .map_err(|e| e.to_string())?;

        if let Ok(v) = pwd_r {
            if !v.trim().is_empty() {
                ssh.password = Some(v);
            }
        }
        if let Ok(v) = pass_r {
            if !v.trim().is_empty() {
                ssh.key_passphrase = Some(v);
            }
        }
    }

    Ok(ssh)
}

pub async fn expand_ssh_connection_params<R: Runtime>(
    app: &AppHandle<R>,
    params: &ConnectionParams,
) -> Result<ConnectionParams, String> {
    let mut expanded_params = params.clone();

    // If ssh_connection_id is set and SSH is enabled, load the SSH connection and merge it
    if params.ssh_enabled.unwrap_or(false) {
        if let Some(ssh_id) = &params.ssh_connection_id {
            // Use targeted lookup instead of loading all SSH connections:
            // this calls keychain only for this specific connection (O(1)),
            // and results are backed by the in-memory credential cache.
            let ssh_conn = get_ssh_connection_by_id(app, ssh_id).await?;

            // Populate legacy SSH fields from the SSH connection
            expanded_params.ssh_host = Some(ssh_conn.host.clone());
            expanded_params.ssh_port = Some(ssh_conn.port);
            expanded_params.ssh_user = Some(ssh_conn.user.clone());
            expanded_params.ssh_password = ssh_conn.password.clone();
            expanded_params.ssh_key_file = ssh_conn.key_file.clone();
            expanded_params.ssh_key_passphrase = ssh_conn.key_passphrase.clone();
            expanded_params.ssh_allow_passphrase_prompt = ssh_conn.allow_passphrase_prompt;
        }
    }

    Ok(expanded_params)
}

/// Check if a string option is empty or contains only whitespace.
#[inline]
#[cfg(test)]
fn is_empty_or_whitespace(s: &Option<String>) -> bool {
    s.as_ref().map(|p| p.trim().is_empty()).unwrap_or(true)
}

/// Build the SSH tunnel map key for caching tunnels.
#[inline]
fn build_tunnel_map_key(
    ssh_user: &str,
    ssh_host: &str,
    ssh_port: u16,
    remote_host: &str,
    remote_port: u16,
) -> String {
    crate::ssh_tunnel::build_tunnel_key(ssh_user, ssh_host, ssh_port, remote_host, remote_port)
}

/// Resolve K8s tunnel params synchronously (no saved-connection lookup; uses inline fields only).
fn resolve_k8s_params(params: &ConnectionParams) -> Result<ConnectionParams, String> {
    let context = params
        .k8s_context
        .as_deref()
        .ok_or("Missing K8s context")?;
    let namespace = params
        .k8s_namespace
        .as_deref()
        .ok_or("Missing K8s namespace")?;
    let resource_type = params
        .k8s_resource_type
        .as_deref()
        .ok_or("Missing K8s resource type")?;
    let resource_name = params
        .k8s_resource_name
        .as_deref()
        .ok_or("Missing K8s resource name")?;
    let port = params.k8s_port.ok_or("Missing K8s port")?;

    let map_key = crate::k8s_tunnel::build_tunnel_key(
        context, namespace, resource_type, resource_name, port,
    );

    // Check for existing tunnel
    {
        let tunnels = crate::k8s_tunnel::get_tunnels().lock().unwrap();
        if let Some(tunnel) = tunnels.get(&map_key) {
            log::debug!("Reusing existing K8s tunnel on port {}", tunnel.local_port);
            let mut new_params = params.clone();
            new_params.k8s_enabled = Some(false);
            new_params.host = Some("127.0.0.1".to_string());
            new_params.port = Some(tunnel.local_port);
            return Ok(new_params);
        }
    }

    log::info!(
        "Creating new K8s tunnel for {}/{} in {}:{} (context: {})",
        resource_type, resource_name, namespace, port, context
    );

    let tunnel = crate::k8s_tunnel::K8sTunnel::new(
        context, namespace, resource_type, resource_name, port,
    )
    .map_err(|e| {
        eprintln!("[Connection Error] K8s Tunnel setup failed: {}", e);
        e
    })?;

    let local_port = tunnel.local_port;
    log::info!("K8s tunnel created successfully on port {}", local_port);

    {
        let mut tunnels = crate::k8s_tunnel::get_tunnels().lock().unwrap();
        tunnels.insert(map_key, tunnel);
    }

    let mut new_params = params.clone();
    new_params.k8s_enabled = Some(false);
    new_params.host = Some("127.0.0.1".to_string());
    new_params.port = Some(local_port);
    Ok(new_params)
}

pub fn resolve_connection_params(params: &ConnectionParams) -> Result<ConnectionParams, String> {
    // K8s and SSH are mutually exclusive
    if params.k8s_enabled.unwrap_or(false) && params.ssh_enabled.unwrap_or(false) {
        return Err(
            "Kubernetes and SSH tunnel cannot both be enabled for the same connection".to_string()
        );
    }

    // Handle K8s tunnel
    if params.k8s_enabled.unwrap_or(false) {
        return resolve_k8s_params(params);
    }

    // Handle SSH tunnel (existing logic)
    if !params.ssh_enabled.unwrap_or(false) {
        return Ok(params.clone());
    }

    let ssh_host = params.ssh_host.as_deref().ok_or("Missing SSH Host")?;
    let ssh_port = params.ssh_port.unwrap_or(22);
    let ssh_user = params.ssh_user.as_deref().ok_or("Missing SSH User")?;
    let remote_host = params.host.as_deref().unwrap_or("localhost");
    let remote_port = params.port.unwrap_or(DEFAULT_MYSQL_PORT);

    let map_key = build_tunnel_map_key(ssh_user, ssh_host, ssh_port, remote_host, remote_port);

    // Check for existing tunnel
    {
        let tunnels = get_tunnels().lock().unwrap();
        if let Some(tunnel) = tunnels.get(&map_key) {
            log::debug!("Reusing existing SSH tunnel on port {}", tunnel.local_port);
            let mut new_params = params.clone();
            new_params.host = Some("127.0.0.1".to_string());
            new_params.port = Some(tunnel.local_port);
            return Ok(new_params);
        }
    }

    // Create new tunnel
    log::info!(
        "Creating new SSH tunnel for {}@{}:{}",
        ssh_user,
        ssh_host,
        ssh_port
    );
    let tunnel = SshTunnel::new(
        ssh_host,
        ssh_port,
        ssh_user,
        params.ssh_password.as_deref(),
        params.ssh_key_file.as_deref(),
        params.ssh_key_passphrase.as_deref(),
        params.ssh_allow_passphrase_prompt.unwrap_or(false),
        remote_host,
        remote_port,
    )
    .map_err(|e| {
        eprintln!("[Connection Error] SSH Tunnel setup failed: {}", e);
        e
    })?;

    let local_port = tunnel.local_port;
    log::info!("SSH tunnel created successfully on port {}", local_port);

    {
        let mut tunnels = get_tunnels().lock().unwrap();
        tunnels.insert(map_key, tunnel);
    }

    let mut new_params = params.clone();
    new_params.host = Some("127.0.0.1".to_string());
    new_params.port = Some(local_port);
    Ok(new_params)
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
    Ok(config_dir.join("connections.json"))
}

pub fn get_ssh_config_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }
    Ok(config_dir.join("ssh_connections.json"))
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

    // Load passwords from keychain if needed, via the in-memory cache.
    // On a warm cache hit this is a HashMap lookup (nanoseconds); on a cold miss
    // it calls keychain once and caches the result for all subsequent reads.
    if conn.params.save_in_keychain.unwrap_or(false) {
        let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
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

/// Write the connections file and invalidate the in-memory connection cache so
/// the next `find_connection_by_id` call re-reads fresh data from disk.
fn save_connections_and_invalidate<R: Runtime>(
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
    log::info!("Fetching schemas for connection: {}", connection_id);

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_schemas(&params).await
}

#[tauri::command]
pub async fn get_available_databases<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<Vec<String>, String> {
    log::info!(
        "Fetching available databases for connection: {}",
        connection_id
    );

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_databases(&params).await
}

#[tauri::command]
pub async fn get_routines<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<RoutineInfo>, String> {
    log::info!("Fetching routines for connection: {}", connection_id);

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_routines(&params, schema.as_deref()).await
}

#[tauri::command]
pub async fn get_routine_parameters<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    routine_name: String,
    schema: Option<String>,
) -> Result<Vec<RoutineParameter>, String> {
    log::info!(
        "Fetching routine parameters for: {} on connection: {}",
        routine_name,
        connection_id
    );

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_routine_parameters(&params, &routine_name, schema.as_deref())
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
    log::info!(
        "Fetching routine definition for: {} ({}) on connection: {}",
        routine_name,
        routine_type,
        connection_id
    );

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_routine_definition(&params, &routine_name, &routine_type, schema.as_deref())
        .await
}

#[tauri::command]
pub async fn get_schema_snapshot<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<crate::models::TableSchema>, String> {
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_schema_snapshot(&params, schema.as_deref()).await
}

#[tauri::command]
pub async fn save_connection<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    params: ConnectionParams,
    detect_json_in_text_columns: Option<bool>,
) -> Result<SavedConnection, String> {
    log::info!("Saving new connection: {}", name);

    let path = get_config_path(&app)?;
    let mut conn_file = persistence::load_connections_file(&path).unwrap_or_default();

    let id = Uuid::new_v4().to_string();
    let mut params_to_save = params.clone();

    if params.save_in_keychain.unwrap_or(false) {
        log::debug!("Storing passwords in keychain for connection: {}", name);
        let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
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
    };
    conn_file.connections.push(new_conn.clone());
    save_connections_and_invalidate(&app, &path, &conn_file)?;

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
    // Invalidate the in-memory cache for this connection
    let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
    credential_cache::invalidate_all_for_connection(&cache, &id);

    save_connections_and_invalidate(&app, &path, &conn_file)?;

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
) -> Result<SavedConnection, String> {
    let path = get_config_path(&app)?;
    let mut conn_file = persistence::load_connections_file(&path)?;

    let conn_idx = conn_file
        .connections
        .iter()
        .position(|c| c.id == id)
        .ok_or("Connection not found")?;

    let mut params_to_save = params.clone();

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
        credential_cache::invalidate_all_for_connection(&cache, &id);
    }

    // Preserve existing group_id and sort_order from the original connection
    let original_group_id = conn_file.connections[conn_idx].group_id.clone();
    let original_sort_order = conn_file.connections[conn_idx].sort_order;
    let original_db_selection = conn_file.connections[conn_idx].params.database.clone();
    // Preserve user's appearance customization across edits
    let original_appearance = conn_file.connections[conn_idx].appearance.clone();

    let updated = SavedConnection {
        id: id.clone(),
        name,
        params: params_to_save,
        group_id: original_group_id,
        sort_order: original_sort_order,
        detect_json_in_text_columns,
        appearance: original_appearance,
    };

    conn_file.connections[conn_idx] = updated.clone();

    save_connections_and_invalidate(&app, &path, &conn_file)?;

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

    // Recover passwords if in keychain (via cache for fast repeat access)
    if original.params.save_in_keychain.unwrap_or(false) {
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
    // Run migration if needed
    migrate_ssh_connections(&app).await.ok();

    let path = get_config_path(&app)?;
    // Use persistence function that handles both old and new formats
    persistence::load_connections(&path)
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

    println!("[Migration] Starting SSH connections migration...");

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

    println!(
        "[Migration] Successfully migrated {} SSH connections",
        ssh_connections.len()
    );
    Ok(())
}

#[tauri::command]
pub async fn get_ssh_connections<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<SshConnection>, String> {
    let path = get_ssh_config_path(&app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    // File I/O off the Tokio executor thread
    let content = tokio::task::spawn_blocking({
        let path = path.clone();
        move || std::fs::read_to_string(path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    let mut ssh_connections: Vec<SshConnection> =
        serde_json::from_str(&content).unwrap_or_default();

    // Backward compatibility: determine auth_type if missing
    for ssh in &mut ssh_connections {
        if ssh.auth_type.is_none() {
            ssh.auth_type = Some(
                if ssh
                    .key_file
                    .as_ref()
                    .map_or(false, |k| !k.trim().is_empty())
                {
                    "ssh_key".to_string()
                } else {
                    "password".to_string()
                },
            );
        }
    }

    // Fetch credentials for all connections that use keychain, in a single
    // spawn_blocking call. The cache is checked first (HashMap lookup), so
    // subsequent calls (e.g. from the UI refreshing the list) are near-instant.
    let ids_needing_creds: Vec<String> = ssh_connections
        .iter()
        .filter(|s| s.save_in_keychain.unwrap_or(false))
        .map(|s| s.id.clone())
        .collect();

    if !ids_needing_creds.is_empty() {
        // Clone the Arc out of the Tauri State so the closure owns it ('static bound)
        let cache = app
            .state::<std::sync::Arc<crate::credential_cache::CredentialCache>>()
            .inner()
            .clone();
        let credentials = tokio::task::spawn_blocking(move || {
            ids_needing_creds
                .into_iter()
                .map(|id| {
                    let pwd = credential_cache::get_ssh_password_cached(&cache, &id);
                    let pass = credential_cache::get_ssh_key_passphrase_cached(&cache, &id);
                    (id, pwd, pass)
                })
                .collect::<Vec<_>>()
        })
        .await
        .map_err(|e| e.to_string())?;

        for (id, pwd_r, pass_r) in credentials {
            if let Some(ssh) = ssh_connections.iter_mut().find(|s| s.id == id) {
                if let Ok(pwd) = pwd_r {
                    if !pwd.trim().is_empty() {
                        ssh.password = Some(pwd);
                    }
                }
                if let Ok(pass) = pass_r {
                    if !pass.trim().is_empty() {
                        ssh.key_passphrase = Some(pass);
                    }
                }
            }
        }
    }

    Ok(ssh_connections)
}

#[tauri::command]
pub async fn save_ssh_connection<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    ssh: SshConnectionInput,
) -> Result<SshConnection, String> {
    let path = get_ssh_config_path(&app)?;
    let mut ssh_connections: Vec<SshConnection> = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    };

    let id = Uuid::new_v4().to_string();
    let ssh_to_save = SshConnection {
        id: id.clone(),
        name: name.clone(),
        host: ssh.host,
        port: ssh.port,
        user: ssh.user,
        auth_type: Some(ssh.auth_type.clone()),
        password: if ssh.save_in_keychain.unwrap_or(false) {
            let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
            if let Some(pwd) = &ssh.password {
                keychain_utils::set_ssh_password(&id, pwd)?;
                credential_cache::set_ssh_password_cached(&cache, &id, pwd);
            }
            None
        } else {
            ssh.password.clone()
        },
        key_file: ssh.key_file.clone(),
        key_passphrase: if ssh.save_in_keychain.unwrap_or(false) {
            let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
            if let Some(passphrase) = &ssh.key_passphrase {
                if !passphrase.trim().is_empty() {
                    keychain_utils::set_ssh_key_passphrase(&id, passphrase)?;
                    credential_cache::set_ssh_key_passphrase_cached(&cache, &id, passphrase);
                }
            }
            None
        } else {
            ssh.key_passphrase.clone()
        },
        allow_passphrase_prompt: ssh.allow_passphrase_prompt,
        save_in_keychain: ssh.save_in_keychain,
    };

    ssh_connections.push(ssh_to_save.clone());
    let json = serde_json::to_string_pretty(&ssh_connections).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;

    let mut returned_ssh = ssh_to_save;
    returned_ssh.password = ssh.password;
    returned_ssh.key_passphrase = ssh.key_passphrase;
    Ok(returned_ssh)
}

#[tauri::command]
pub async fn update_ssh_connection<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    name: String,
    ssh: SshConnectionInput,
) -> Result<SshConnection, String> {
    let path = get_ssh_config_path(&app)?;
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut ssh_connections: Vec<SshConnection> =
        serde_json::from_str(&content).unwrap_or_default();

    let ssh_idx = ssh_connections
        .iter()
        .position(|s| s.id == id)
        .ok_or("SSH connection not found")?;

    let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
    if ssh.save_in_keychain.unwrap_or(false) {
        if let Some(pwd) = &ssh.password {
            keychain_utils::set_ssh_password(&id, pwd)?;
            credential_cache::set_ssh_password_cached(&cache, &id, pwd);
        }
        if let Some(passphrase) = &ssh.key_passphrase {
            if !passphrase.trim().is_empty() {
                keychain_utils::set_ssh_key_passphrase(&id, passphrase)?;
                credential_cache::set_ssh_key_passphrase_cached(&cache, &id, passphrase);
            }
        }
    } else {
        keychain_utils::delete_ssh_password(&id).ok();
        keychain_utils::delete_ssh_key_passphrase(&id).ok();
        credential_cache::invalidate_ssh_password(&cache, &id);
        credential_cache::invalidate_ssh_key_passphrase(&cache, &id);
    }

    let ssh_to_save = SshConnection {
        id: id.clone(),
        name: name.clone(),
        host: ssh.host,
        port: ssh.port,
        user: ssh.user,
        auth_type: Some(ssh.auth_type.clone()),
        password: if ssh.save_in_keychain.unwrap_or(false) {
            None
        } else {
            ssh.password.clone()
        },
        key_file: ssh.key_file.clone(),
        key_passphrase: if ssh.save_in_keychain.unwrap_or(false) {
            None
        } else {
            ssh.key_passphrase.clone()
        },
        allow_passphrase_prompt: ssh.allow_passphrase_prompt,
        save_in_keychain: ssh.save_in_keychain,
    };

    ssh_connections[ssh_idx] = ssh_to_save.clone();

    let json = serde_json::to_string_pretty(&ssh_connections).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;

    let mut returned_ssh = ssh_to_save;
    returned_ssh.password = ssh.password;
    returned_ssh.key_passphrase = ssh.key_passphrase;
    Ok(returned_ssh)
}

#[tauri::command]
pub async fn delete_ssh_connection<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let path = get_ssh_config_path(&app)?;
    if !path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut ssh_connections: Vec<SshConnection> =
        serde_json::from_str(&content).unwrap_or_default();

    ssh_connections.retain(|s| s.id != id);

    // Remove credentials from keychain and invalidate cache
    keychain_utils::delete_ssh_password(&id).ok();
    keychain_utils::delete_ssh_key_passphrase(&id).ok();
    let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
    credential_cache::invalidate_ssh_password(&cache, &id);
    credential_cache::invalidate_ssh_key_passphrase(&cache, &id);

    let json = serde_json::to_string_pretty(&ssh_connections).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn test_ssh_connection<R: Runtime>(
    app: AppHandle<R>,
    ssh: SshTestParams,
) -> Result<String, String> {
    use crate::ssh_tunnel;

    // Resolve password using same logic as database connections
    let resolved_password = resolve_ssh_test_password(
        ssh.password.as_deref(),
        ssh.connection_id.as_deref(),
        |conn_id| {
            let path = get_ssh_config_path(&app).ok()?;
            if !path.exists() {
                return None;
            }
            let content = fs::read_to_string(path).ok()?;
            let connections: Vec<SshConnection> =
                serde_json::from_str(&content).unwrap_or_default();
            connections.into_iter().find(|c| c.id == conn_id)
        },
        |conn_id| keychain_utils::get_ssh_password(conn_id, ""),
    );

    // Resolve passphrase using same logic
    let resolved_passphrase = resolve_ssh_test_credential(
        ssh.key_passphrase.as_deref(),
        ssh.connection_id.as_deref(),
        |conn_id| {
            let path = get_ssh_config_path(&app).ok()?;
            if !path.exists() {
                return None;
            }
            let content = fs::read_to_string(path).ok()?;
            let connections: Vec<SshConnection> =
                serde_json::from_str(&content).unwrap_or_default();
            connections.into_iter().find(|c| c.id == conn_id)
        },
        |conn_id| keychain_utils::get_ssh_key_passphrase(conn_id, ""),
        |conn| {
            conn.key_passphrase
                .as_ref()
                .filter(|p| !p.trim().is_empty())
                .cloned()
        },
    );

    ssh_tunnel::test_ssh_connection(
        &ssh.host,
        ssh.port,
        &ssh.user,
        resolved_password.as_deref(),
        ssh.key_file.as_deref(),
        resolved_passphrase.as_deref(),
        ssh.allow_passphrase_prompt.unwrap_or(false),
    )
}

// ---------------------------------------------------------------------------
// Kubernetes Connections
// ---------------------------------------------------------------------------

/// Load K8s connections synchronously from the config file.
fn load_k8s_connections_sync<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Vec<K8sConnection>, String> {
    let path = get_k8s_config_path(app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(serde_json::from_str(&content).unwrap_or_default())
}

/// Get the path to the k8s_connections.json file.
fn get_k8s_config_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config dir: {}", e))?;
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }
    Ok(config_dir.join("k8s_connections.json"))
}

#[tauri::command]
pub async fn get_k8s_connections<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<K8sConnection>, String> {
    let path = get_k8s_config_path(&app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let connections: Vec<K8sConnection> =
        serde_json::from_str(&content).unwrap_or_default();
    Ok(connections)
}

#[tauri::command]
pub async fn save_k8s_connection<R: Runtime>(
    app: AppHandle<R>,
    k8s: K8sConnectionInput,
) -> Result<K8sConnection, String> {
    let path = get_k8s_config_path(&app)?;
    let mut connections: Vec<K8sConnection> = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        vec![]
    };

    let id = Uuid::new_v4().to_string();
    let connection = K8sConnection {
        id: id.clone(),
        name: k8s.name,
        context: k8s.context,
        namespace: k8s.namespace,
        resource_type: k8s.resource_type,
        resource_name: k8s.resource_name,
        port: k8s.port,
    };

    connections.push(connection.clone());
    let json =
        serde_json::to_string_pretty(&connections).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;

    Ok(connection)
}

#[tauri::command]
pub async fn update_k8s_connection<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    k8s: K8sConnectionInput,
) -> Result<K8sConnection, String> {
    let path = get_k8s_config_path(&app)?;
    let mut connections: Vec<K8sConnection> = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        return Err("No K8s connections file found".to_string());
    };

    let idx = connections
        .iter()
        .position(|c| c.id == id)
        .ok_or_else(|| format!("K8s connection with ID {} not found", id))?;

    let connection = K8sConnection {
        id: id.clone(),
        name: k8s.name,
        context: k8s.context,
        namespace: k8s.namespace,
        resource_type: k8s.resource_type,
        resource_name: k8s.resource_name,
        port: k8s.port,
    };

    connections[idx] = connection.clone();
    let json =
        serde_json::to_string_pretty(&connections).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;

    Ok(connection)
}

#[tauri::command]
pub async fn delete_k8s_connection<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let path = get_k8s_config_path(&app)?;
    let mut connections: Vec<K8sConnection> = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        return Ok(());
    };

    connections.retain(|c| c.id != id);
    let json =
        serde_json::to_string_pretty(&connections).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn test_k8s_connection_cmd<R: Runtime>(
    _app: AppHandle<R>,
    context: String,
    namespace: String,
) -> Result<String, String> {
    crate::k8s_tunnel::test_k8s_connection(&context, &namespace)
}

#[tauri::command]
pub async fn get_k8s_contexts_cmd<R: Runtime>(
    _app: AppHandle<R>,
) -> Result<Vec<String>, String> {
    crate::k8s_tunnel::get_k8s_contexts()
}

#[tauri::command]
pub async fn get_k8s_namespaces_cmd<R: Runtime>(
    _app: AppHandle<R>,
    context: String,
) -> Result<Vec<String>, String> {
    crate::k8s_tunnel::get_k8s_namespaces(&context)
}

#[tauri::command]
pub async fn get_k8s_resources_cmd<R: Runtime>(
    _app: AppHandle<R>,
    context: String,
    namespace: String,
    resource_type: String,
) -> Result<Vec<String>, String> {
    crate::k8s_tunnel::get_k8s_resources(&context, &namespace, &resource_type)
}

#[tauri::command]
pub async fn get_k8s_resource_ports_cmd<R: Runtime>(
    _app: AppHandle<R>,
    context: String,
    namespace: String,
    resource_type: String,
    resource_name: String,
) -> Result<Vec<u16>, String> {
    crate::k8s_tunnel::get_k8s_resource_ports(
        &context,
        &namespace,
        &resource_type,
        &resource_name,
    )
}

/// Expand K8s connection params by loading saved config and creating/reusing a tunnel.
pub async fn expand_k8s_connection_params<R: Runtime>(
    app: &AppHandle<R>,
    params: &ConnectionParams,
) -> Result<ConnectionParams, String> {
    if !params.k8s_enabled.unwrap_or(false) {
        return Ok(params.clone());
    }

    // Mutual exclusion: K8s and SSH cannot both be active
    if params.ssh_enabled.unwrap_or(false) {
        return Err(
            "Kubernetes and SSH tunnel cannot both be enabled for the same connection".to_string()
        );
    }

    // Resolve K8s params from saved connection if using connection_id
    let (context, namespace, resource_type, resource_name, port) =
        if let Some(k8s_id) = &params.k8s_connection_id {
            let k8s_conn = get_k8s_connection_by_id(app, k8s_id).await?;
            (
                k8s_conn.context,
                k8s_conn.namespace,
                k8s_conn.resource_type,
                k8s_conn.resource_name,
                k8s_conn.port,
            )
        } else {
            let ctx = params
                .k8s_context
                .as_deref()
                .ok_or("Missing K8s context")?
                .to_string();
            let ns = params
                .k8s_namespace
                .as_deref()
                .ok_or("Missing K8s namespace")?
                .to_string();
            let rt = params
                .k8s_resource_type
                .as_deref()
                .ok_or("Missing K8s resource type")?
                .to_string();
            let rn = params
                .k8s_resource_name
                .as_deref()
                .ok_or("Missing K8s resource name")?
                .to_string();
            let p = params.k8s_port.ok_or("Missing K8s port")?;
            (ctx, ns, rt, rn, p)
        };

    let _remote_host = params.host.as_deref().unwrap_or("localhost");
    let _remote_port = params.port.unwrap_or(DEFAULT_MYSQL_PORT);

    let map_key = crate::k8s_tunnel::build_tunnel_key(
        &context,
        &namespace,
        &resource_type,
        &resource_name,
        port,
    );

    // Check for existing tunnel
    {
        let tunnels = crate::k8s_tunnel::get_tunnels().lock().unwrap();
        if let Some(tunnel) = tunnels.get(&map_key) {
            log::debug!(
                "Reusing existing K8s tunnel on port {}",
                tunnel.local_port
            );
            let mut new_params = params.clone();
            new_params.k8s_enabled = Some(false);
            new_params.host = Some("127.0.0.1".to_string());
            new_params.port = Some(tunnel.local_port);
            return Ok(new_params);
        }
    }

    // Create new tunnel
    log::info!(
        "Creating new K8s tunnel for {}/{} in {}:{} (context: {})",
        resource_type,
        resource_name,
        namespace,
        port,
        context
    );

    let tunnel = crate::k8s_tunnel::K8sTunnel::new(
        &context,
        &namespace,
        &resource_type,
        &resource_name,
        port,
    )
    .map_err(|e| {
        eprintln!("[Connection Error] K8s Tunnel setup failed: {}", e);
        e
    })?;

    let local_port = tunnel.local_port;
    log::info!("K8s tunnel created successfully on port {}", local_port);

    {
        let mut tunnels = crate::k8s_tunnel::get_tunnels().lock().unwrap();
        tunnels.insert(map_key, tunnel);
    }

    let mut new_params = params.clone();
    new_params.k8s_enabled = Some(false);
    new_params.host = Some("127.0.0.1".to_string());
    new_params.port = Some(local_port);
    Ok(new_params)
}

/// Load a K8s connection by ID from the config file.
async fn get_k8s_connection_by_id<R: Runtime>(
    app: &AppHandle<R>,
    k8s_id: &str,
) -> Result<K8sConnection, String> {
    let path = get_k8s_config_path(app)?;
    if !path.exists() {
        return Err(format!("K8s connection with ID {} not found", k8s_id));
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let connections: Vec<K8sConnection> =
        serde_json::from_str(&content).unwrap_or_default();
    connections
        .into_iter()
        .find(|c| c.id == k8s_id)
        .ok_or_else(|| format!("K8s connection with ID {} not found", k8s_id))
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

    let mut expanded_params = expand_ssh_connection_params(&app, &request.params).await?;
    expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;

    if request.params.password.is_none() && expanded_params.password.is_none() {
        let saved_conn = match &request.connection_id {
            Some(id) => find_connection_by_id(&app, id).ok(),
            None => None,
        };
        expanded_params.password =
            resolve_test_connection_password(&request.params, saved_conn.as_ref(), |conn_id| {
                keychain_utils::get_db_password(conn_id, "")
            });
    }

    let resolved_params = if let Some(conn_id) = &request.connection_id {
        resolve_connection_params_with_id(&expanded_params, conn_id)?
    } else {
        resolve_connection_params(&expanded_params)?
    };
    log::debug!(
        "Test connection params: Host={:?}, Port={:?}",
        resolved_params.host,
        resolved_params.port
    );

    let drv = driver_for(&resolved_params.driver).await?;

    // For file-based drivers, verify the database file exists before attempting connection
    if drv.manifest().capabilities.file_based {
        let db_path = std::path::Path::new(resolved_params.database.primary());
        if !db_path.exists() {
            return Err(format!(
                "Database file not found: {}",
                resolved_params.database
            ));
        }
    }

    drv.test_connection(&resolved_params).await?;

    log::info!(
        "Connection test successful for database: {}",
        request.params.database
    );
    Ok("Connection successful!".to_string())
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
        };
        ConnectionsFile {
            groups: vec![],
            connections: vec![conn],
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
}

#[tauri::command]
pub async fn list_databases<R: Runtime>(
    app: AppHandle<R>,
    request: TestConnectionRequest,
) -> Result<Vec<String>, String> {
    let mut expanded_params = expand_ssh_connection_params(&app, &request.params).await?;
    expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;

    if request.params.password.is_none() && expanded_params.password.is_none() {
        let saved_conn = match &request.connection_id {
            Some(id) => find_connection_by_id(&app, id).ok(),
            None => None,
        };
        expanded_params.password =
            resolve_test_connection_password(&request.params, saved_conn.as_ref(), |conn_id| {
                keychain_utils::get_db_password(conn_id, "")
            });
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
    log::info!("Fetching tables for connection: {}", connection_id);

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    log::debug!(
        "Getting tables from {} database: {}",
        saved_conn.params.driver,
        params.database
    );

    let drv = driver_for(&saved_conn.params.driver).await?;
    let result = drv.get_tables(&params, schema.as_deref()).await;

    match &result {
        Ok(tables) => log::info!("Retrieved {} tables from {}", tables.len(), params.database),
        Err(e) => log::error!("Failed to get tables from {}: {}", params.database, e),
    }

    result
}

#[tauri::command]
pub async fn get_columns<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table_name: String,
    schema: Option<String>,
) -> Result<Vec<TableColumn>, String> {
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_columns(&params, &table_name, schema.as_deref())
        .await
}

#[tauri::command]
pub async fn get_foreign_keys<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table_name: String,
    schema: Option<String>,
) -> Result<Vec<ForeignKey>, String> {
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_foreign_keys(&params, &table_name, schema.as_deref())
        .await
}

#[tauri::command]
pub async fn get_indexes<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table_name: String,
    schema: Option<String>,
) -> Result<Vec<Index>, String> {
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_indexes(&params, &table_name, schema.as_deref())
        .await
}

#[tauri::command]
pub async fn delete_record<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table: String,
    pk_col: String,
    pk_val: serde_json::Value,
    schema: Option<String>,
    database: Option<String>,
) -> Result<u64, String> {
    log::info!(
        "Executing query on connection: {} | Query: DELETE FROM {} WHERE {} = {}",
        connection_id,
        table,
        pk_col,
        pk_val
    );
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let mut params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    if let Some(db) = database {
        params.database = crate::models::DatabaseSelection::Single(db);
    }
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.delete_record(&params, &table, &pk_col, pk_val, schema.as_deref())
        .await
}

#[tauri::command]
pub async fn update_record<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table: String,
    pk_col: String,
    pk_val: serde_json::Value,
    col_name: String,
    new_val: serde_json::Value,
    schema: Option<String>,
    database: Option<String>,
) -> Result<u64, String> {
    log::info!(
        "Executing query on connection: {} | Query: UPDATE {} SET {} = {} WHERE {} = {}",
        connection_id,
        table,
        col_name,
        new_val,
        pk_col,
        pk_val
    );
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let mut params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    if let Some(db) = database {
        params.database = crate::models::DatabaseSelection::Single(db);
    }
    let max_blob_size = crate::config::get_max_blob_size(&app);
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.update_record(
        &params,
        &table,
        &pk_col,
        pk_val,
        &col_name,
        new_val,
        schema.as_deref(),
        max_blob_size,
    )
    .await
}

#[tauri::command]
pub async fn save_blob_to_file<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table: String,
    col_name: String,
    pk_col: String,
    pk_val: serde_json::Value,
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
        &pk_col,
        pk_val,
        schema.as_deref(),
        &file_path,
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
    pk_col: String,
    pk_val: serde_json::Value,
    schema: Option<String>,
) -> Result<String, String> {
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    let wire = drv
        .fetch_blob_as_data_url(
            &params,
            &table,
            &col_name,
            &pk_col,
            pk_val,
            schema.as_deref(),
        )
        .await?;
    // Convert the BLOB wire format to a data: URL
    // wire format: "BLOB:<size>:<mime>:<base64>"
    if !wire.starts_with("BLOB:") {
        return Err("Invalid BLOB wire format".into());
    }
    let after_prefix = &wire[5..]; // skip "BLOB:"
    let size_end = after_prefix.find(':').ok_or("Invalid BLOB wire format")?;
    let after_size = &after_prefix[size_end + 1..];
    let mime_end = after_size.find(':').ok_or("Invalid BLOB wire format")?;
    let mime = &after_size[..mime_end];
    if !mime.starts_with("image/") {
        return Err(format!("Not an image: {}", mime));
    }
    let base64_payload = &after_size[mime_end + 1..];
    Ok(format!("data:{};base64,{}", mime, base64_payload))
}

/// Detects the MIME type of base64-encoded binary data using magic-byte analysis
/// and returns the canonical blob wire format: "BLOB:<size>:<mime>:<base64>".
/// Called by the frontend after the user selects a file to upload.
#[tauri::command]
pub fn detect_blob_mime(base64_data: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Invalid base64: {}", e))?;
    Ok(crate::drivers::common::encode_blob_full(&bytes))
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
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&header_base64)
        .map_err(|e| format!("Invalid base64: {}", e))?;
    let mime = infer::get(&bytes)
        .map(|k| k.mime_type())
        .unwrap_or("application/octet-stream");
    Ok(mime.to_string())
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
    let columns: Vec<&str> = data.keys().map(|k| k.as_str()).collect();
    log::info!(
        "Executing query on connection: {} | Query: INSERT INTO {} ({}) VALUES (...)",
        connection_id,
        table,
        columns.join(", ")
    );
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let mut params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    if let Some(db) = database {
        params.database = crate::models::DatabaseSelection::Single(db);
    }
    let max_blob_size = crate::config::get_max_blob_size(&app);
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.insert_record(&params, &table, data, schema.as_deref(), max_blob_size)
        .await
}

pub(crate) fn cancel_query_impl(
    state: &QueryCancellationState,
    connection_id: &str,
) -> Result<(), String> {
    let entries = {
        let mut handles = state.handles.lock().unwrap();
        handles.remove(connection_id).unwrap_or_default()
    };
    if entries.is_empty() {
        return Err("No running query found".into());
    }
    for handle in entries {
        handle.abort();
    }
    Ok(())
}

#[tauri::command]
pub async fn cancel_query(
    state: State<'_, QueryCancellationState>,
    connection_id: String,
) -> Result<(), String> {
    cancel_query_impl(&state, &connection_id)
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
    log::info!(
        "Executing query on connection: {} | Query: {}",
        connection_id,
        query
    );

    let sanitized_query = sanitize_user_query(&query);

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    let task = tokio::spawn(async move {
        drv.execute_query(
            &params,
            &sanitized_query,
            limit,
            page.unwrap_or(1),
            schema.as_deref(),
        )
        .await
    });

    let abort_handle = Arc::new(task.abort_handle());
    register_abort_handle(&state.handles, connection_id.clone(), abort_handle.clone());

    let result = task.await;

    unregister_abort_handle(&state.handles, &connection_id, &abort_handle);

    match result {
        Ok(Ok(query_result)) => {
            log::info!(
                "Query executed successfully, returned {} rows",
                query_result.rows.len()
            );
            Ok(query_result)
        }
        Ok(Err(e)) => {
            log::error!("Query execution failed: {}", e);
            Err(e)
        }
        Err(_) => {
            log::warn!("Query was cancelled");
            Err("Query cancelled".into())
        }
    }
}

/// Payload for the `batch-statement-complete` event, emitted once per
/// statement the instant it finishes so the frontend can mark that result tab
/// done in real time instead of waiting for the whole batch. `batch_id` lets a
/// listener ignore events from other concurrent runs; `index` maps back to the
/// statement's slot. Borrows the result so no clone of the (potentially large)
/// row set is needed.
#[derive(serde::Serialize, Clone)]
struct BatchStatementEvent<'a> {
    batch_id: &'a str,
    index: usize,
    statement: &'a BatchStatementResult,
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
    log::info!(
        "Executing query batch on connection: {} | {} statement(s)",
        connection_id,
        queries.len()
    );

    let sanitized_queries: Vec<String> = queries.iter().map(|q| sanitize_user_query(q)).collect();

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;

    // Build a Tauri-agnostic progress sink the driver invokes per statement.
    // Each invocation emits one event so result tabs resolve as they finish.
    let progress: Option<Arc<crate::drivers::driver_trait::BatchProgressFn>> =
        batch_id.map(|bid| {
            let app = app.clone();
            let cb: Arc<crate::drivers::driver_trait::BatchProgressFn> =
                Arc::new(move |index, statement: &BatchStatementResult| {
                    let _ = app.emit(
                        "batch-statement-complete",
                        BatchStatementEvent {
                            batch_id: &bid,
                            index,
                            statement,
                        },
                    );
                });
            cb
        });

    let task = tokio::spawn(async move {
        drv.execute_batch(
            &params,
            &sanitized_queries,
            limit,
            page.unwrap_or(1),
            schema.as_deref(),
            progress.as_deref(),
        )
        .await
    });

    let abort_handle = Arc::new(task.abort_handle());
    register_abort_handle(&state.handles, connection_id.clone(), abort_handle.clone());

    let result = task.await;

    unregister_abort_handle(&state.handles, &connection_id, &abort_handle);

    match result {
        Ok(Ok(batch_results)) => {
            let success_count = batch_results.iter().filter(|r| r.result.is_some()).count();
            log::info!(
                "Batch executed: {} succeeded, {} failed (of {} total)",
                success_count,
                batch_results.len() - success_count,
                batch_results.len()
            );
            Ok(batch_results)
        }
        Ok(Err(e)) => {
            log::error!("Batch execution failed at setup: {}", e);
            Err(e)
        }
        Err(_) => {
            log::warn!("Batch was cancelled");
            Err("Query cancelled".into())
        }
    }
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
) -> Result<ExplainPlan, String> {
    log::info!(
        "Explaining query on connection: {} | analyze: {} | Query: {}",
        connection_id,
        analyze,
        query
    );

    let sanitized_query = sanitize_user_query(&query);

    if !crate::drivers::common::is_explainable_query(&sanitized_query) {
        return Err(
            "EXPLAIN is only supported for DML statements (SELECT, INSERT, UPDATE, DELETE, REPLACE). DDL statements like CREATE, DROP, or ALTER cannot be explained."
                .into(),
        );
    }

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    let task = tokio::spawn(async move {
        drv.explain_query(&params, &sanitized_query, analyze, schema.as_deref())
            .await
    });

    let abort_handle = Arc::new(task.abort_handle());
    register_abort_handle(&state.handles, connection_id.clone(), abort_handle.clone());

    let result = task.await;

    unregister_abort_handle(&state.handles, &connection_id, &abort_handle);

    match result {
        Ok(Ok(plan)) => {
            log::info!("Explain query completed successfully");
            Ok(plan)
        }
        Ok(Err(e)) => {
            log::error!("Explain query failed: {}", e);
            Err(e)
        }
        Err(_) => {
            log::warn!("Explain query was cancelled");
            Err("Explain query cancelled".into())
        }
    }
}

// --- Count Query ---

#[tauri::command]
pub async fn count_query<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    query: String,
    schema: Option<String>,
) -> Result<u64, String> {
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let sanitized = query.trim().trim_end_matches(';').to_string();

    let count_q = format!("SELECT COUNT(*) FROM ({}) as count_wrapper", sanitized);

    let drv = driver_for(&saved_conn.params.driver).await?;
    let result = drv
        .execute_query(&params, &count_q, None, 1, schema.as_deref())
        .await?;

    let total: u64 = result
        .rows
        .first()
        .and_then(|r| r.first())
        .and_then(|v| v.as_i64())
        .map(|n| n as u64)
        .unwrap_or(0);

    Ok(total)
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

/// Helper for backward compatibility - resolves SSH password
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
    log::info!("Fetching views for connection: {}", connection_id);

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    log::debug!(
        "Getting views from {} database: {}",
        saved_conn.params.driver,
        params.database
    );

    let drv = driver_for(&saved_conn.params.driver).await?;
    let result = drv.get_views(&params, schema.as_deref()).await;

    match &result {
        Ok(views) => log::info!("Retrieved {} views from {}", views.len(), params.database),
        Err(e) => log::error!("Failed to get views from {}: {}", params.database, e),
    }

    result
}

#[tauri::command]
pub async fn get_view_definition<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    view_name: String,
    schema: Option<String>,
) -> Result<String, String> {
    log::info!(
        "Fetching view definition for: {} on connection: {}",
        view_name,
        connection_id
    );

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    let result = drv
        .get_view_definition(&params, &view_name, schema.as_deref())
        .await;

    match &result {
        Ok(_) => log::info!("Successfully retrieved view definition for {}", view_name),
        Err(e) => log::error!("Failed to get view definition for {}: {}", view_name, e),
    }

    result
}

#[tauri::command]
pub async fn create_view<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    view_name: String,
    definition: String,
    schema: Option<String>,
) -> Result<(), String> {
    log::info!(
        "Creating view: {} on connection: {}",
        view_name,
        connection_id
    );

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    let result = drv
        .create_view(&params, &view_name, &definition, schema.as_deref())
        .await;

    match &result {
        Ok(_) => log::info!("Successfully created view: {}", view_name),
        Err(e) => log::error!("Failed to create view {}: {}", view_name, e),
    }

    result
}

#[tauri::command]
pub async fn alter_view<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    view_name: String,
    definition: String,
    schema: Option<String>,
) -> Result<(), String> {
    log::info!(
        "Altering view: {} on connection: {}",
        view_name,
        connection_id
    );

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    let result = drv
        .alter_view(&params, &view_name, &definition, schema.as_deref())
        .await;

    match &result {
        Ok(_) => log::info!("Successfully altered view: {}", view_name),
        Err(e) => log::error!("Failed to alter view {}: {}", view_name, e),
    }

    result
}

#[tauri::command]
pub async fn drop_view<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    view_name: String,
    schema: Option<String>,
) -> Result<(), String> {
    log::info!(
        "Dropping view: {} on connection: {}",
        view_name,
        connection_id
    );

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    let result = drv.drop_view(&params, &view_name, schema.as_deref()).await;

    match &result {
        Ok(_) => log::info!("Successfully dropped view: {}", view_name),
        Err(e) => log::error!("Failed to drop view {}: {}", view_name, e),
    }

    result
}

#[tauri::command]
pub async fn get_view_columns<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    view_name: String,
    schema: Option<String>,
) -> Result<Vec<TableColumn>, String> {
    log::info!(
        "Fetching view columns for: {} on connection: {}",
        view_name,
        connection_id
    );

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    let result = drv
        .get_view_columns(&params, &view_name, schema.as_deref())
        .await;

    match &result {
        Ok(columns) => log::info!("Retrieved {} columns for view {}", columns.len(), view_name),
        Err(e) => log::error!("Failed to get view columns for {}: {}", view_name, e),
    }

    result
}

#[tauri::command]
pub async fn get_triggers<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<TriggerInfo>, String> {
    log::info!("Fetching triggers for connection: {}", connection_id);

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    let result = drv.get_triggers(&params, schema.as_deref()).await;

    match &result {
        Ok(triggers) => log::info!("Retrieved {} triggers", triggers.len()),
        Err(e) => log::error!("Failed to get triggers: {}", e),
    }

    result
}

#[tauri::command]
pub async fn get_trigger_definition<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    trigger_name: String,
    table_name: String,
    schema: Option<String>,
) -> Result<String, String> {
    log::info!(
        "Fetching trigger definition for: {} on connection: {}",
        trigger_name,
        connection_id
    );

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_trigger_definition(&params, &trigger_name, &table_name, schema.as_deref())
        .await
}

#[tauri::command]
pub async fn create_trigger<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    trigger_sql: String,
    schema: Option<String>,
) -> Result<(), String> {
    log::info!("Creating trigger on connection: {}", connection_id);

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    let result = drv
        .create_trigger(&params, &trigger_sql, schema.as_deref())
        .await;

    match &result {
        Ok(_) => log::info!("Successfully created trigger"),
        Err(e) => log::error!("Failed to create trigger: {}", e),
    }

    result
}

#[tauri::command]
pub async fn drop_trigger<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    trigger_name: String,
    table_name: String,
    schema: Option<String>,
) -> Result<(), String> {
    log::info!(
        "Dropping trigger: {} on connection: {}",
        trigger_name,
        connection_id
    );

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    let result = drv
        .drop_trigger(&params, &trigger_name, &table_name, schema.as_deref())
        .await;

    match &result {
        Ok(_) => log::info!("Successfully dropped trigger: {}", trigger_name),
        Err(e) => log::error!("Failed to drop trigger {}: {}", trigger_name, e),
    }

    result
}

/// Register a connection as active for health-check pinging.
#[tauri::command]
pub async fn register_active_connection(connection_id: String) {
    crate::health_check::register_connection(connection_id).await;
}

/// Disconnect from a database connection by closing its connection pool
#[tauri::command]
pub async fn disconnect_connection<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<(), String> {
    log::info!("Disconnecting from connection: {}", connection_id);

    // Unregister from health check before closing the pool.
    crate::health_check::unregister_connection(&connection_id).await;

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    // Close the connection pool
    crate::pool_manager::close_pool_with_id(&params, Some(&connection_id)).await;

    log::info!(
        "Successfully disconnected from connection: {}",
        connection_id
    );
    Ok(())
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
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_create_table_sql(&table_name, columns, schema.as_deref())
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
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_add_column_sql(&table, column, schema.as_deref())
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
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_alter_column_sql(&table, old_column, new_column, schema.as_deref())
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
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_create_index_sql(&table, &index_name, columns, is_unique, schema.as_deref())
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
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_create_foreign_key_sql(
        &table,
        &fk_name,
        &column,
        &ref_table,
        &ref_column,
        on_delete.as_deref(),
        on_update.as_deref(),
        schema.as_deref(),
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
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.drop_index(&params, &table, &index_name, schema.as_deref())
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
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.drop_foreign_key(&params, &table, &fk_name, schema.as_deref())
        .await
}

#[tauri::command]
pub async fn get_registered_drivers() -> Vec<crate::drivers::driver_trait::PluginManifest> {
    crate::drivers::registry::list_drivers().await
}

#[tauri::command]
pub async fn get_keybindings<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let path = config_dir.join("keybindings.json");
    if !path.exists() {
        return Ok(serde_json::Value::Object(serde_json::Map::new()));
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_keybindings<R: Runtime>(
    app: AppHandle<R>,
    keybindings: serde_json::Value,
) -> Result<(), String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    let path = config_dir.join("keybindings.json");
    let content = serde_json::to_string_pretty(&keybindings).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
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
    // Run migration if needed
    migrate_ssh_connections(&app).await.ok();

    let path = get_config_path(&app)?;
    persistence::load_connections_file(&path)
}

#[tauri::command]
pub async fn create_connection_group<R: Runtime>(
    app: AppHandle<R>,
    name: String,
) -> Result<ConnectionGroup, String> {
    let path = get_config_path(&app)?;
    let mut file = persistence::load_connections_file(&path).unwrap_or_default();

    // Calculate next sort_order
    let max_order = file.groups.iter().map(|g| g.sort_order).max().unwrap_or(-1);

    let group = ConnectionGroup {
        id: Uuid::new_v4().to_string(),
        name,
        collapsed: false,
        sort_order: max_order + 1,
    };

    file.groups.push(group.clone());
    save_connections_and_invalidate(&app, &path, &file)?;

    Ok(group)
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

#[tauri::command]
pub async fn delete_connection_group<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let path = get_config_path(&app)?;
    let mut file = persistence::load_connections_file(&path)?;

    // Remove connections from the group (set group_id to None)
    for conn in &mut file.connections {
        if conn.group_id.as_ref() == Some(&id) {
            conn.group_id = None;
        }
    }

    // Remove the group
    file.groups.retain(|g| g.id != id);
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
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let query = match saved_conn.params.driver.as_str() {
        "sqlite" => "SELECT datetime('now', 'localtime')",
        _ => "SELECT NOW()",
    };

    let drv = driver_for(&saved_conn.params.driver).await?;
    let result = drv.execute_query(&params, query, Some(1), 1, None).await?;

    result
        .rows
        .first()
        .and_then(|row| row.first())
        .map(|v| match v {
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        })
        .ok_or_else(|| "No timestamp returned from server".to_string())
}

#[tauri::command]
pub async fn export_connections_payload<R: Runtime>(
    app: AppHandle<R>,
) -> Result<ExportPayload, String> {
    let conn_path = get_config_path(&app)?;
    let ssh_path = get_ssh_config_path(&app)?;

    let mut conn_file = persistence::load_connections_file(&conn_path)?;
    let mut ssh_connections = if ssh_path.exists() {
        let content = fs::read_to_string(&ssh_path).map_err(|e| e.to_string())?;
        serde_json::from_str::<Vec<SshConnection>>(&content).unwrap_or_default()
    } else {
        Vec::new()
    };

    let cache = app
        .state::<std::sync::Arc<crate::credential_cache::CredentialCache>>()
        .inner()
        .clone();

    // Resolve passwords for database connections
    for conn in &mut conn_file.connections {
        if conn.params.save_in_keychain.unwrap_or(false) {
            if let Ok(pwd) = credential_cache::get_db_password_cached(&cache, &conn.id) {
                conn.params.password = Some(pwd);
            }
            if conn.params.ssh_enabled.unwrap_or(false) {
                if let Ok(ssh_pwd) = credential_cache::get_ssh_password_cached(&cache, &conn.id) {
                    conn.params.ssh_password = Some(ssh_pwd);
                }
                if let Ok(ssh_passphrase) =
                    credential_cache::get_ssh_key_passphrase_cached(&cache, &conn.id)
                {
                    conn.params.ssh_key_passphrase = Some(ssh_passphrase);
                }
            }
        }
    }

    // Resolve passwords for SSH connections
    for ssh in &mut ssh_connections {
        if ssh.save_in_keychain.unwrap_or(false) {
            if let Ok(pwd) = credential_cache::get_ssh_password_cached(&cache, &ssh.id) {
                ssh.password = Some(pwd);
            }
            if let Ok(passphrase) = credential_cache::get_ssh_key_passphrase_cached(&cache, &ssh.id)
            {
                ssh.key_passphrase = Some(passphrase);
            }
        }
    }

    Ok(ExportPayload {
        version: 1,
        groups: conn_file.groups,
        connections: conn_file.connections,
        ssh_connections,
        k8s_connections: load_k8s_connections_sync(&app)?,
    })
}

#[tauri::command]
pub async fn import_connections_payload<R: Runtime>(
    app: AppHandle<R>,
    payload: ExportPayload,
) -> Result<(), String> {
    let conn_path = get_config_path(&app)?;
    let ssh_path = get_ssh_config_path(&app)?;

    let mut current_file = persistence::load_connections_file(&conn_path).unwrap_or_default();
    let mut current_ssh = if ssh_path.exists() {
        let content = fs::read_to_string(&ssh_path).map_err(|e| e.to_string())?;
        serde_json::from_str::<Vec<SshConnection>>(&content).unwrap_or_default()
    } else {
        Vec::new()
    };

    let cache = app
        .state::<std::sync::Arc<crate::credential_cache::CredentialCache>>()
        .inner()
        .clone();

    // Merge groups
    for new_group in payload.groups {
        if let Some(existing) = current_file.groups.iter_mut().find(|g| g.id == new_group.id) {
            *existing = new_group;
        } else {
            current_file.groups.push(new_group);
        }
    }

    // Merge connections and handle passwords
    for mut new_conn in payload.connections {
        // Handle passwords in keychain
        if new_conn.params.save_in_keychain.unwrap_or(false) {
            if let Some(pwd) = &new_conn.params.password {
                keychain_utils::set_db_password(&new_conn.id, pwd)?;
                credential_cache::set_db_password_cached(&cache, &new_conn.id, pwd);
            }
            if new_conn.params.ssh_enabled.unwrap_or(false) {
                if let Some(ssh_pwd) = &new_conn.params.ssh_password {
                    keychain_utils::set_ssh_password(&new_conn.id, ssh_pwd)?;
                    credential_cache::set_ssh_password_cached(&cache, &new_conn.id, ssh_pwd);
                }
                if let Some(ssh_passphrase) = &new_conn.params.ssh_key_passphrase {
                    keychain_utils::set_ssh_key_passphrase(&new_conn.id, ssh_passphrase)?;
                    credential_cache::set_ssh_key_passphrase_cached(
                        &cache,
                        &new_conn.id,
                        ssh_passphrase,
                    );
                }
            }
            // Clear passwords from struct before saving to disk
            new_conn.params.password = None;
            new_conn.params.ssh_password = None;
            new_conn.params.ssh_key_passphrase = None;
        }

        if let Some(existing) = current_file
            .connections
            .iter_mut()
            .find(|c| c.id == new_conn.id)
        {
            *existing = new_conn;
        } else {
            current_file.connections.push(new_conn);
        }
    }

    // Merge SSH connections and handle passwords
    for mut new_ssh in payload.ssh_connections {
        if new_ssh.save_in_keychain.unwrap_or(false) {
            if let Some(pwd) = &new_ssh.password {
                keychain_utils::set_ssh_password(&new_ssh.id, pwd)?;
                credential_cache::set_ssh_password_cached(&cache, &new_ssh.id, pwd);
            }
            if let Some(passphrase) = &new_ssh.key_passphrase {
                keychain_utils::set_ssh_key_passphrase(&new_ssh.id, passphrase)?;
                credential_cache::set_ssh_key_passphrase_cached(&cache, &new_ssh.id, passphrase);
            }
            // Clear passwords from struct before saving to disk
            new_ssh.password = None;
            new_ssh.key_passphrase = None;
        }

        if let Some(existing) = current_ssh.iter_mut().find(|s| s.id == new_ssh.id) {
            *existing = new_ssh;
        } else {
            current_ssh.push(new_ssh);
        }
    }

    // Save files
    save_connections_and_invalidate(&app, &conn_path, &current_file)?;
    let ssh_json = serde_json::to_string_pretty(&current_ssh).map_err(|e| e.to_string())?;
    fs::write(ssh_path, ssh_json).map_err(|e| e.to_string())?;

    // Merge K8s connections
    let k8s_path = get_k8s_config_path(&app)?;
    let mut current_k8s = load_k8s_connections_sync(&app)?;
    for new_k8s in payload.k8s_connections {
        if let Some(existing) = current_k8s.iter_mut().find(|k| k.id == new_k8s.id) {
            *existing = new_k8s;
        } else {
            current_k8s.push(new_k8s);
        }
    }
    let k8s_json = serde_json::to_string_pretty(&current_k8s).map_err(|e| e.to_string())?;
    fs::write(k8s_path, k8s_json).map_err(|e| e.to_string())?;

    Ok(())
}
