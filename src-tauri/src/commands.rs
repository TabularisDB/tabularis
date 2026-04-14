use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, Runtime, State};
use tokio::task::AbortHandle;
use urlencoding::encode;
use uuid::Uuid;

use crate::credential_cache;
use crate::keychain_utils;
use crate::models::{
    ColumnDefinition, ConnectionGroup, ConnectionParams, ConnectionsFile, ExplainPlan, ForeignKey,
    Index, QueryResult, RoutineInfo, RoutineParameter, SavedConnection, SshConnection,
    SshConnectionInput, SshTestParams, TableColumn, TableInfo, TestConnectionRequest,
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

pub struct QueryCancellationState {
    pub handles: Arc<Mutex<HashMap<String, AbortHandle>>>,
}

impl Default for QueryCancellationState {
    fn default() -> Self {
        Self {
            handles: Arc::new(Mutex::new(HashMap::new())),
        }
    }
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
            if ssh.key_file.as_ref().map_or(false, |k| !k.trim().is_empty()) {
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
        let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>().inner().clone();
        let id = ssh.id.clone();
        let (pwd_r, pass_r) = tokio::task::spawn_blocking(move || {
            let pwd  = credential_cache::get_ssh_password_cached(&cache, &id);
            let pass = credential_cache::get_ssh_key_passphrase_cached(&cache, &id);
            (pwd, pass)
        })
        .await
        .map_err(|e| e.to_string())?;

        if let Ok(v) = pwd_r  { if !v.trim().is_empty() { ssh.password       = Some(v); } }
        if let Ok(v) = pass_r { if !v.trim().is_empty() { ssh.key_passphrase = Some(v); } }
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
            expanded_params.ssh_host           = Some(ssh_conn.host.clone());
            expanded_params.ssh_port           = Some(ssh_conn.port);
            expanded_params.ssh_user           = Some(ssh_conn.user.clone());
            expanded_params.ssh_password       = ssh_conn.password.clone();
            expanded_params.ssh_key_file       = ssh_conn.key_file.clone();
            expanded_params.ssh_key_passphrase = ssh_conn.key_passphrase.clone();
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

pub fn resolve_connection_params(params: &ConnectionParams) -> Result<ConnectionParams, String> {
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
    let path = get_config_path(app)?;
    if !path.exists() {
        return Err("Connection not found".into());
    }
    // Use persistence module to properly load connections (handles both old and new formats)
    let conn_file = persistence::load_connections_file(&path)?;
    let mut conn = conn_file.connections
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| "Connection not found".to_string())?;

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
            if let Ok(ssh_passphrase) = credential_cache::get_ssh_key_passphrase_cached(&cache, &conn.id) {
                if !ssh_passphrase.trim().is_empty() {
                    conn.params.ssh_key_passphrase = Some(ssh_passphrase);
                }
            }
        }
    }

    Ok(conn)
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
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_schemas(&params).await
}

#[tauri::command]
pub async fn get_available_databases<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<Vec<String>, String> {
    log::info!("Fetching available databases for connection: {}", connection_id);

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
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
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_routine_parameters(&params, &routine_name, schema.as_deref()).await
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
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_routine_definition(&params, &routine_name, &routine_type, schema.as_deref()).await
}

#[tauri::command]
pub async fn get_schema_snapshot<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<crate::models::TableSchema>, String> {
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_schema_snapshot(&params, schema.as_deref()).await
}

#[tauri::command]
pub async fn save_connection<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    params: ConnectionParams,
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
    };
    conn_file.connections.push(new_conn.clone());
    persistence::save_connections_file(&path, &conn_file)?;

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

    persistence::save_connections_file(&path, &conn_file)?;

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

    let updated = SavedConnection {
        id: id.clone(),
        name,
        params: params_to_save,
        group_id: original_group_id,
        sort_order: original_sort_order,
    };

    conn_file.connections[conn_idx] = updated.clone();

    persistence::save_connections_file(&path, &conn_file)?;

    let mut returned_conn = updated;
    returned_conn.params = params;
    Ok(returned_conn)
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
            if let Ok(ssh_passphrase) = credential_cache::get_ssh_key_passphrase_cached(&cache, &original.id) {
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
                    credential_cache::set_ssh_key_passphrase_cached(&cache, &new_id, ssh_passphrase);
                }
            }
        }
        new_params.password = None;
        new_params.ssh_password = None;
        new_params.ssh_key_passphrase = None;
    }

    let new_conn = SavedConnection {
        id: new_id,
        name: format!("{} (Copy)", original.name),
        params: new_params,
        group_id: original.group_id.clone(), // Copy to same group as original
        sort_order: None, // Will be placed at end of group
    };

    conn_file.connections.push(new_conn.clone());

    persistence::save_connections_file(&path, &conn_file)?;

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
                        if let Ok(ssh_pwd) = keychain_utils::get_ssh_password(&conn.id, &conn.name) {
                            if !ssh_pwd.trim().is_empty() {
                                keychain_utils::set_ssh_password(&new_ssh_id, &ssh_pwd).ok();
                            }
                        }
                        if let Ok(ssh_pass) = keychain_utils::get_ssh_key_passphrase(&conn.id, &conn.name) {
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
    persistence::save_connections_file(&conn_path, &conn_file)?;

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
                if ssh.key_file.as_ref().map_or(false, |k| !k.trim().is_empty()) {
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
        let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>().inner().clone();
        let credentials = tokio::task::spawn_blocking(move || {
            ids_needing_creds
                .into_iter()
                .map(|id| {
                    let pwd  = credential_cache::get_ssh_password_cached(&cache, &id);
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
    )
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
            password: None,
            database: DatabaseSelection::Single("testdb".to_string()),
            ssl_mode: None,
            ssh_enabled: None,
            ssh_connection_id: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_password: None,
            ssh_key_file: None,
            ssh_key_passphrase: None,
            save_in_keychain: None,
            connection_id: None,
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
        }
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
                ssl_mode: None,
                ssh_enabled: None,
                ssh_connection_id: None,
                ssh_host: None,
                ssh_port: None,
                ssh_user: None,
                ssh_password: None,
                ssh_key_file: None,
                ssh_key_passphrase: None,
                save_in_keychain: None,
                connection_id: None,
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
            assert_eq!(url, "mysql://root:@localhost:3306/testdb");
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
                ssl_mode: None,
                ssh_enabled: Some(true),
                ssh_connection_id: None,
                ssh_host: Some(ssh_host.to_string()),
                ssh_port: Some(ssh_port),
                ssh_user: Some(ssh_user.to_string()),
                ssh_password: None,
                ssh_key_file: Some("/home/user/.ssh/id_rsa".to_string()),
                ssh_key_passphrase: None,
                save_in_keychain: None,
                connection_id: None,
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
            assert!(url.contains(":@localhost"));
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
}

#[tauri::command]
pub async fn list_databases<R: Runtime>(
    app: AppHandle<R>,
    request: TestConnectionRequest,
) -> Result<Vec<String>, String> {
    let mut expanded_params = expand_ssh_connection_params(&app, &request.params).await?;

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
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_columns(&params, &table_name, schema.as_deref()).await
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
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_foreign_keys(&params, &table_name, schema.as_deref()).await
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
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.get_indexes(&params, &table_name, schema.as_deref()).await
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
        connection_id, table, pk_col, pk_val
    );
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let mut params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    if let Some(db) = database {
        params.database = crate::models::DatabaseSelection::Single(db);
    }
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.delete_record(&params, &table, &pk_col, pk_val, schema.as_deref()).await
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
        connection_id, table, col_name, new_val, pk_col, pk_val
    );
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let mut params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    if let Some(db) = database {
        params.database = crate::models::DatabaseSelection::Single(db);
    }
    let max_blob_size = crate::config::get_max_blob_size(&app);
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.update_record(&params, &table, &pk_col, pk_val, &col_name, new_val, schema.as_deref(), max_blob_size).await
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
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.save_blob_to_file(&params, &table, &col_name, &pk_col, pk_val, schema.as_deref(), &file_path).await
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
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    let wire = drv.fetch_blob_as_data_url(&params, &table, &col_name, &pk_col, pk_val, schema.as_deref()).await?;
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
        connection_id, table, columns.join(", ")
    );
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let mut params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    if let Some(db) = database {
        params.database = crate::models::DatabaseSelection::Single(db);
    }
    let max_blob_size = crate::config::get_max_blob_size(&app);
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.insert_record(&params, &table, data, schema.as_deref(), max_blob_size).await
}

#[tauri::command]
pub async fn cancel_query(
    state: State<'_, QueryCancellationState>,
    connection_id: String,
) -> Result<(), String> {
    let mut handles = state.handles.lock().unwrap();
    if let Some(handle) = handles.remove(&connection_id) {
        handle.abort();
        Ok(())
    } else {
        Err("No running query found".into())
    }
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

    // 1. Sanitize Query (Ignore trailing semicolon + normalize smart quotes)
    let sanitized_query = query
        .trim()
        .trim_end_matches(';')
        .replace('\u{2018}', "'") // Left single quotation mark
        .replace('\u{2019}', "'") // Right single quotation mark
        .replace('\u{201C}', "\"") // Left double quotation mark
        .replace('\u{201D}', "\"") // Right double quotation mark
        .to_string();

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    // 2. Spawn Cancellable Task
    let drv = driver_for(&saved_conn.params.driver).await?;
    let task = tokio::spawn(async move {
        drv.execute_query(&params, &sanitized_query, limit, page.unwrap_or(1), schema.as_deref()).await
    });

    // 3. Register Abort Handle
    let abort_handle = task.abort_handle();
    {
        let mut handles = state.handles.lock().unwrap();
        // If a query is already running for this connection, we overwrite the handle.
        // Ideally we should cancel the previous one, but the UI should prevent double run.
        handles.insert(connection_id.clone(), abort_handle);
    }

    // 4. Await & Handle Cancellation
    let result = task.await;

    // 5. Cleanup
    {
        let mut handles = state.handles.lock().unwrap();
        // Only remove if it matches (edge case: multiple queries, but connection_id is unique per tab usually)
        handles.remove(&connection_id);
    }

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

    let sanitized_query = query
        .trim()
        .trim_end_matches(';')
        .replace('\u{2018}', "'")
        .replace('\u{2019}', "'")
        .replace('\u{201C}', "\"")
        .replace('\u{201D}', "\"")
        .to_string();

    if !crate::drivers::common::is_explainable_query(&sanitized_query) {
        return Err(
            "EXPLAIN is only supported for DML statements (SELECT, INSERT, UPDATE, DELETE, REPLACE). DDL statements like CREATE, DROP, or ALTER cannot be explained."
                .into(),
        );
    }

    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    let task = tokio::spawn(async move {
        drv.explain_query(&params, &sanitized_query, analyze, schema.as_deref())
            .await
    });

    let abort_handle = task.abort_handle();
    {
        let mut handles = state.handles.lock().unwrap();
        handles.insert(format!("explain_{}", connection_id), abort_handle);
    }

    let result = task.await;

    {
        let mut handles = state.handles.lock().unwrap();
        handles.remove(&format!("explain_{}", connection_id));
    }

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
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let sanitized = query
        .trim()
        .trim_end_matches(';')
        .to_string();

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

    let _webview = WebviewWindowBuilder::new(&app, "er-diagram", WebviewUrl::App(url.into()))
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
    let pass = encode(params.password.as_deref().unwrap_or_default());
    let host = params.host.as_deref().unwrap_or("localhost");

    match params.driver.as_str() {
        "sqlite" => Ok(format!("sqlite://{}", params.database)),
        "postgres" => Ok(format!(
            "postgres://{}:{}@{}:{}/{}",
            user,
            pass,
            host,
            params.port.unwrap_or(DEFAULT_POSTGRES_PORT),
            params.database
        )),
        "mysql" => Ok(format!(
            "mysql://{}:{}@{}:{}/{}",
            user,
            pass,
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
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    let result = drv.get_view_definition(&params, &view_name, schema.as_deref()).await;

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
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    let result = drv.create_view(&params, &view_name, &definition, schema.as_deref()).await;

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
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    let result = drv.alter_view(&params, &view_name, &definition, schema.as_deref()).await;

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
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;

    let drv = driver_for(&saved_conn.params.driver).await?;
    let result = drv.get_view_columns(&params, &view_name, schema.as_deref()).await;

    match &result {
        Ok(columns) => log::info!("Retrieved {} columns for view {}", columns.len(), view_name),
        Err(e) => log::error!("Failed to get view columns for {}: {}", view_name, e),
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
    drv.get_create_table_sql(&table_name, columns, schema.as_deref()).await
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
    drv.get_add_column_sql(&table, column, schema.as_deref()).await
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
    drv.get_alter_column_sql(&table, old_column, new_column, schema.as_deref()).await
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
    drv.get_create_index_sql(&table, &index_name, columns, is_unique, schema.as_deref()).await
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
        &table, &fk_name, &column, &ref_table, &ref_column,
        on_delete.as_deref(), on_update.as_deref(), schema.as_deref(),
    ).await
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
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.drop_index(&params, &table, &index_name, schema.as_deref()).await
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
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    let drv = driver_for(&saved_conn.params.driver).await?;
    drv.drop_foreign_key(&params, &table, &fk_name, schema.as_deref()).await
}

#[tauri::command]
pub async fn get_registered_drivers() -> Vec<crate::drivers::driver_trait::PluginManifest> {
    crate::drivers::registry::list_drivers().await
}

#[tauri::command]
pub async fn get_keybindings<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
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
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
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
    persistence::save_connections_file(&path, &file)?;

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
    persistence::save_connections_file(&path, &file)?;

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
    persistence::save_connections_file(&path, &file)?;

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
    persistence::save_connections_file(&path, &file)?;

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

    persistence::save_connections_file(&path, &file)?;
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

    persistence::save_connections_file(&path, &file)?;
    Ok(())
}
