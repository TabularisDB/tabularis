use crate::commands::*;
use crate::credential_cache;
use crate::keychain_utils;
use crate::models::{
    BatchStatementResult, ColumnDefinition, ConnectionParams, ExplainQueryOutput, ForeignKey,
    Index, K8sConnection, K8sConnectionInput, QueryResult, RoutineInfo, RoutineParameter,
    SavedConnection, SshConnection, SshConnectionInput, SshTestParams, TableColumn, TableInfo,
    TestConnectionRequest, TriggerInfo,
};
use crate::persistence;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime, State};
use uuid::Uuid;

#[tauri::command]
pub async fn get_connection_metadata<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<Option<crate::plugins::connection_metadata::ConnectionMetadata>, String> {
    crate::application::metadata::get_connection_metadata(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
    )
    .await
}

pub async fn expand_ssh_connection_params<R: Runtime>(
    app: &AppHandle<R>,
    params: &ConnectionParams,
) -> Result<ConnectionParams, String> {
    crate::application::tunnels::expand_connection_params(
        &app.state::<crate::runtime::RuntimeContext>(),
        params,
    )
}

async fn execute_connection_command<R: Runtime>(
    app: &AppHandle<R>,
    command: crate::application::connections::ConnectionCommand,
) -> Result<serde_json::Value, String> {
    crate::application::connections::execute(
        &app.state::<crate::runtime::RuntimeContext>(),
        &app.state::<std::sync::Arc<crate::runtime::state::ApplicationState>>(),
        command,
    )
    .await
}

#[tauri::command]
pub async fn get_connections<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    migrate_ssh_connections(&app).await.ok();
    migrate_postgres_ssl_mode_spelling(&app).await.ok();
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::GetConnections,
    )
    .await
}

#[tauri::command]
pub async fn get_connections_with_groups<R: Runtime>(
    app: AppHandle<R>,
) -> Result<serde_json::Value, String> {
    migrate_ssh_connections(&app).await.ok();
    migrate_postgres_ssl_mode_spelling(&app).await.ok();
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::GetConnectionsWithGroups,
    )
    .await
}

#[tauri::command]
pub async fn save_connection<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    params: ConnectionParams,
    plugin_secret_changes: Option<crate::plugin_secrets::PluginSecretChanges>,
    detect_json_in_text_columns: Option<bool>,
    environment: Option<String>,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::SaveConnection {
            name,
            params,
            plugin_secret_changes,
            detect_json_in_text_columns,
            environment,
        },
    )
    .await
}

#[tauri::command]
pub async fn update_connection<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    name: String,
    params: ConnectionParams,
    plugin_secret_changes: Option<crate::plugin_secrets::PluginSecretChanges>,
    detect_json_in_text_columns: Option<bool>,
    environment: Option<String>,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::UpdateConnection {
            id,
            name,
            params,
            plugin_secret_changes,
            detect_json_in_text_columns,
            environment,
        },
    )
    .await
}

#[tauri::command]
pub async fn duplicate_connection<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::DuplicateConnection { id },
    )
    .await
}

#[tauri::command]
pub async fn delete_connection<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::DeleteConnection { id },
    )
    .await
}

#[tauri::command]
pub async fn test_connection<R: Runtime>(
    app: AppHandle<R>,
    request: TestConnectionRequest,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::TestConnection { request },
    )
    .await
}

#[tauri::command]
pub async fn list_databases<R: Runtime>(
    app: AppHandle<R>,
    request: TestConnectionRequest,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::ListDatabases { request },
    )
    .await
}

#[tauri::command]
pub async fn get_connection_groups<R: Runtime>(
    app: AppHandle<R>,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::GetConnectionGroups,
    )
    .await
}

#[tauri::command]
pub async fn create_connection_group<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    parent_id: Option<String>,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::CreateConnectionGroup {
            name,
            parent_id,
        },
    )
    .await
}

#[tauri::command]
pub async fn create_group_path<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    parent_id: Option<String>,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::CreateGroupPath { path, parent_id },
    )
    .await
}

#[tauri::command]
pub async fn update_connection_group<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    name: Option<String>,
    collapsed: Option<bool>,
    sort_order: Option<i32>,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::UpdateConnectionGroup {
            id,
            name,
            collapsed,
            sort_order,
        },
    )
    .await
}

#[tauri::command]
pub async fn move_group_to_parent<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    parent_id: Option<String>,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::MoveGroupToParent { id, parent_id },
    )
    .await
}

#[tauri::command]
pub async fn delete_connection_group<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::DeleteConnectionGroup { id },
    )
    .await
}

#[tauri::command]
pub async fn move_connection_to_group<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    group_id: Option<String>,
    sort_order: Option<i32>,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::MoveConnectionToGroup {
            connection_id,
            group_id,
            sort_order,
        },
    )
    .await
}

#[tauri::command]
pub async fn reorder_groups<R: Runtime>(
    app: AppHandle<R>,
    group_orders: Vec<(String, i32)>,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::ReorderGroups { group_orders },
    )
    .await
}

#[tauri::command]
pub async fn reorder_connections_in_group<R: Runtime>(
    app: AppHandle<R>,
    connection_orders: Vec<(String, i32)>,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::ReorderConnectionsInGroup {
            connection_orders,
        },
    )
    .await
}

#[tauri::command]
pub async fn set_connection_appearance<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    appearance: Option<crate::models::ConnectionAppearance>,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::SetConnectionAppearance {
            id,
            appearance,
        },
    )
    .await
}

#[tauri::command]
pub async fn list_connection_tags<R: Runtime>(
    app: AppHandle<R>,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::ListConnectionTags,
    )
    .await
}

#[tauri::command]
pub async fn create_connection_tag<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    color: String,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::CreateConnectionTag { name, color },
    )
    .await
}

#[tauri::command]
pub async fn update_connection_tag<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    name: String,
    color: String,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::UpdateConnectionTag { id, name, color },
    )
    .await
}

#[tauri::command]
pub async fn delete_connection_tag<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::DeleteConnectionTag { id },
    )
    .await
}

#[tauri::command]
pub async fn set_connection_tags<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    tag_ids: Vec<String>,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::SetConnectionTags {
            connection_id,
            tag_ids,
        },
    )
    .await
}

#[tauri::command]
pub async fn delete_connection_icon<R: Runtime>(
    app: AppHandle<R>,
    relative_path: String,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::DeleteConnectionIcon { relative_path },
    )
    .await
}

#[tauri::command]
pub async fn create_sqlite_database<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<serde_json::Value, String> {
    execute_connection_command(
        &app,
        crate::application::connections::ConnectionCommand::CreateSqliteDatabase { path },
    )
    .await
}

pub fn get_config_path<R: Runtime>(_app: &AppHandle<R>) -> Result<PathBuf, String> {
    let config_dir = crate::paths::get_app_config_dir();
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }
    Ok(crate::paths::resolve_connections_path(&config_dir))
}

pub fn get_ssh_config_path<R: Runtime>(_app: &AppHandle<R>) -> Result<PathBuf, String> {
    let config_dir = crate::paths::get_app_config_dir();
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }
    Ok(config_dir.join("ssh_connections.json"))
}

/// Saved connection as stored, without any keychain secret.
fn lookup_saved_connection<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
) -> Result<SavedConnection, String> {
    let conn_cache = app.state::<std::sync::Arc<crate::connection_cache::ConnectionCache>>();

    let conn = match conn_cache.lookup(id) {
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
    Ok(conn)
}

/// Load a saved connection with its host-owned credentials (keychain password,
/// SSH secrets, connection URI) but without plugin-owned secrets. Used by the
/// edit modal and by the Test Connection / Load Databases flows, which resolve
/// plugin secrets themselves once the pending changes are known.
pub fn find_connection_metadata_by_id<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
) -> Result<SavedConnection, String> {
    let mut conn = lookup_saved_connection(app, id)?;

    let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
    restore_runtime_connection_uri(&cache, &conn.id, &mut conn.params)?;

    // Load passwords from keychain via the in-memory cache (warm hit = lookup,
    // cold miss = keychain call + cache). Skip IAM-auth connections: their
    // 15-min tokens must come from the `password` field, never the keychain,
    // so a stale token from an older release can't be surfaced in the modal.
    if conn.params.save_in_keychain.unwrap_or(false) && !conn.params.use_iam_auth.unwrap_or(false) {
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

/// Load a connection for driver execution. Unlike the metadata/edit path,
/// this resolves plugin-owned secrets into `params.extra` only in memory.
pub fn find_connection_by_id<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
) -> Result<SavedConnection, String> {
    let mut conn = find_connection_metadata_by_id(app, id)?;
    let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
    crate::plugin_secrets::hydrate_connection(&cache, &mut conn);
    Ok(conn)
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

#[tauri::command]
pub async fn get_connection_by_id<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<SavedConnection, String> {
    find_connection_metadata_by_id(&app, &id)
}

#[tauri::command]
pub async fn get_schemas<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    database: Option<String>,
) -> Result<Vec<String>, String> {
    crate::application::metadata::get_schemas(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        database,
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
    databases: Vec<String>,
) -> Result<(), String> {
    crate::application::connections::set_selected_databases(
        &app.state::<crate::runtime::RuntimeContext>(),
        &connection_id,
        databases,
    )
    .await?;
    app.state::<std::sync::Arc<crate::connection_cache::ConnectionCache>>()
        .invalidate();
    Ok(())
}

#[tauri::command]
pub async fn get_routines<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<RoutineInfo>, String> {
    crate::application::metadata::get_routines(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        schema,
        database,
    )
    .await
}

#[tauri::command]
pub async fn get_routine_parameters<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    routine_name: String,
    schema: Option<String>,
    database: Option<String>,
    /* The signature of the overload the user clicked, where the dialect has them (#893) */
    identity_args: Option<String>,
) -> Result<Vec<RoutineParameter>, String> {
    crate::application::database_objects::get_routine_parameters(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        routine_name,
        schema,
        database,
        identity_args,
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
    database: Option<String>,
    identity_args: Option<String>,
) -> Result<String, String> {
    crate::application::database_objects::get_routine_definition(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        routine_name,
        routine_type,
        schema,
        database,
        identity_args,
    )
    .await
}

/// Preview generation only; the returned SQL is never executed here.
#[tauri::command]
pub async fn get_table_query_template<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    request: crate::models::TableQueryTemplateRequest,
    database: Option<String>,
) -> Result<Option<String>, String> {
    crate::application::database_objects::get_table_query_template(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        request,
        database,
    )
    .await
}

/// Column statistics through the optional plugin RPC (issue #1137). `None`
/// means the driver doesn't provide them; the frontend then falls back to its
/// generic SQL or hides the entry.
#[tauri::command]
pub async fn get_column_stats<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    request: crate::models::ColumnStatsRequest,
    database: Option<String>,
) -> Result<Option<crate::models::ColumnStatsResult>, String> {
    crate::application::database_objects::get_column_stats(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        request,
        database,
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
    database: Option<String>,
) -> Result<String, String> {
    crate::application::database_objects::get_routine_create_template(
        &app.state::<crate::runtime::RuntimeContext>(),
        &connection_id,
        routine_type,
        schema,
        database,
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
    database: Option<String>,
    identity_args: Option<String>,
) -> Result<String, String> {
    crate::application::database_objects::get_routine_edit_script(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        routine_name,
        routine_type,
        schema,
        database,
        identity_args,
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
    database: Option<String>,
    identity_args: Option<String>,
) -> Result<(), String> {
    crate::application::database_objects::drop_routine(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        routine_name,
        routine_type,
        schema,
        database,
        identity_args,
    )
    .await
}

#[tauri::command]
pub async fn get_schema_snapshot<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<crate::models::TableSchema>, String> {
    crate::application::metadata::get_schema_snapshot(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        schema,
        database,
    )
    .await
}

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
    persistence::write_private_file(&ssh_path, ssh_json)?;

    // Save migrated connections using new format (preserving groups)
    conn_file.connections = migrated_connections;
    save_connections_and_invalidate(app, &conn_path, &conn_file)?;

    eprintln!(
        "[Migration] Successfully migrated {} SSH connections",
        ssh_connections.len()
    );
    Ok(())
}

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

#[tauri::command]
pub async fn get_k8s_connections<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<K8sConnection>, String> {
    crate::application::tunnels::get_k8s_connections(&app.state::<crate::runtime::RuntimeContext>())
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

async fn execute_tunnel_command<R: Runtime>(
    app: &AppHandle<R>,
    command: crate::application::tunnels::TunnelCommand,
) -> Result<serde_json::Value, String> {
    crate::application::tunnels::execute(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        command,
    )
    .await
}

#[tauri::command]
pub async fn test_k8s_connection_cmd<R: Runtime>(
    app: AppHandle<R>,
    context: String,
    namespace: String,
    kubectl_path: Option<String>,
    kubeconfig_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let options = crate::k8s_tunnel::K8sCommandOptions::new(kubectl_path, kubeconfig_path);
    execute_tunnel_command(
        &app,
        crate::application::tunnels::TunnelCommand::TestK8sConnection {
            context,
            namespace,
            options,
        },
    )
    .await
}

#[tauri::command]
pub async fn get_k8s_contexts_cmd<R: Runtime>(
    app: AppHandle<R>,
    kubectl_path: Option<String>,
    kubeconfig_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let options = crate::k8s_tunnel::K8sCommandOptions::new(kubectl_path, kubeconfig_path);
    execute_tunnel_command(
        &app,
        crate::application::tunnels::TunnelCommand::GetK8sContexts { options },
    )
    .await
}

#[tauri::command]
pub async fn get_k8s_namespaces_cmd<R: Runtime>(
    app: AppHandle<R>,
    context: String,
    kubectl_path: Option<String>,
    kubeconfig_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let options = crate::k8s_tunnel::K8sCommandOptions::new(kubectl_path, kubeconfig_path);
    execute_tunnel_command(
        &app,
        crate::application::tunnels::TunnelCommand::GetK8sNamespaces { context, options },
    )
    .await
}

#[tauri::command]
pub async fn get_k8s_resources_cmd<R: Runtime>(
    app: AppHandle<R>,
    context: String,
    namespace: String,
    resource_type: String,
    kubectl_path: Option<String>,
    kubeconfig_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let options = crate::k8s_tunnel::K8sCommandOptions::new(kubectl_path, kubeconfig_path);
    execute_tunnel_command(
        &app,
        crate::application::tunnels::TunnelCommand::GetK8sResources {
            context,
            namespace,
            resource_type,
            options,
        },
    )
    .await
}

#[tauri::command]
pub async fn get_k8s_resource_ports_cmd<R: Runtime>(
    app: AppHandle<R>,
    context: String,
    namespace: String,
    resource_type: String,
    resource_name: String,
    kubectl_path: Option<String>,
    kubeconfig_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let options = crate::k8s_tunnel::K8sCommandOptions::new(kubectl_path, kubeconfig_path);
    execute_tunnel_command(
        &app,
        crate::application::tunnels::TunnelCommand::GetK8sResourcePorts {
            context,
            namespace,
            resource_type,
            resource_name,
            options,
        },
    )
    .await
}

#[tauri::command]
pub async fn validate_k8s_path_cmd<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    kind: String,
) -> Result<serde_json::Value, String> {
    execute_tunnel_command(
        &app,
        crate::application::tunnels::TunnelCommand::ValidateK8sPath { path, kind },
    )
    .await
}

#[tauri::command]
pub async fn test_ssm_connection_cmd<R: Runtime>(
    app: AppHandle<R>,
    target: String,
    profile: Option<String>,
    region: Option<String>,
    host: String,
    port: u16,
) -> Result<serde_json::Value, String> {
    execute_tunnel_command(
        &app,
        crate::application::tunnels::TunnelCommand::TestSsmConnection {
            target,
            profile,
            region,
            host,
            port,
        },
    )
    .await
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
pub async fn get_tables<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<TableInfo>, String> {
    crate::application::metadata::get_tables(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        schema,
        database,
    )
    .await
}

#[tauri::command]
pub async fn get_columns<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<TableColumn>, String> {
    crate::application::metadata::get_columns(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        table_name,
        schema,
        database,
    )
    .await
}

#[tauri::command]
pub async fn get_foreign_keys<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<ForeignKey>, String> {
    crate::application::metadata::get_foreign_keys(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        table_name,
        schema,
        database,
    )
    .await
}

#[tauri::command]
pub async fn get_indexes<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<Index>, String> {
    crate::application::metadata::get_indexes(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        table_name,
        schema,
        database,
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
    let max_blob_size = crate::transport::desktop::config::get_max_blob_size(&app);

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

#[tauri::command]
pub async fn cancel_query(
    state: State<'_, std::sync::Arc<QueryCancellationState>>,
    connection_id: String,
) -> Result<(), String> {
    crate::application::queries::cancel_query(&state, None, &connection_id, None)
}

#[tauri::command]
pub async fn execute_query<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, std::sync::Arc<QueryCancellationState>>,
    connection_id: String,
    query: String,
    limit: Option<u32>,
    page: Option<u32>,
    schema: Option<String>,
    database: Option<String>,
    session_id: Option<String>,
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
        session_id,
        database,
    )
    .await
}

pub(crate) async fn release_connection_sessions<R: Runtime>(
    app: &AppHandle<R>,
    connection_id: &str,
    _params: Option<&ConnectionParams>,
) {
    crate::application::query_sessions::release_connection(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        connection_id,
    )
    .await;
}

#[tauri::command]
pub async fn release_query_session<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    session_id: String,
) -> Result<(), String> {
    crate::application::query_sessions::release(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        &session_id,
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
    state: State<'_, std::sync::Arc<QueryCancellationState>>,
    connection_id: String,
    queries: Vec<String>,
    limit: Option<u32>,
    page: Option<u32>,
    schema: Option<String>,
    database: Option<String>,
    batch_id: Option<String>,
    session_id: Option<String>,
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
        session_id,
        batch_id,
        database,
    )
    .await
}

#[tauri::command]
pub async fn explain_query_plan<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, std::sync::Arc<QueryCancellationState>>,
    connection_id: String,
    query: String,
    analyze: bool,
    schema: Option<String>,
    database: Option<String>,
) -> Result<ExplainQueryOutput, String> {
    crate::application::queries::explain_query_plan(
        &app.state::<crate::runtime::RuntimeContext>(),
        &state,
        crate::application::queries::QueryRequestScope::DESKTOP,
        connection_id,
        query,
        analyze,
        schema,
        database,
    )
    .await
}

#[tauri::command]
pub async fn count_query<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    query: String,
    schema: Option<String>,
    database: Option<String>,
    session_id: Option<String>,
) -> Result<u64, String> {
    crate::application::queries::count_query(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        connection_id,
        query,
        schema,
        session_id,
        database,
    )
    .await
}

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
    database: Option<String>,
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

    // `database` (distinct from the display-only `database_name` above) is only
    // set for a schema-based multi-db connection (PostgreSQL browsing several
    // databases) — it's the value the schema-diagram page actually routes its
    // snapshot request with, alongside `schema`. Absent for the flat multi-db
    // (MySQL) and plain single-database cases, which already resolve correctly
    // through `schema` alone.
    if let Some(db) = &database {
        url.push_str(&format!("&database={}", encode(db)));
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
        .decorations(crate::transport::desktop::window_decorations::native_decorations_enabled())
        .build()
        .map_err(|e| format!("Failed to create ER Diagram window: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn get_views<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<crate::models::ViewInfo>, String> {
    crate::application::metadata::get_views(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        schema,
        database,
    )
    .await
}

#[tauri::command]
pub async fn get_view_definition<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    view_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<String, String> {
    crate::application::database_objects::get_view_definition(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        view_name,
        schema,
        database,
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
    database: Option<String>,
) -> Result<(), String> {
    crate::application::database_objects::create_view(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        view_name,
        definition,
        schema,
        database,
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
    database: Option<String>,
) -> Result<(), String> {
    crate::application::database_objects::alter_view(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        view_name,
        definition,
        schema,
        database,
    )
    .await
}

#[tauri::command]
pub async fn drop_view<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    view_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<(), String> {
    crate::application::database_objects::drop_view(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        view_name,
        schema,
        database,
    )
    .await
}

#[tauri::command]
pub async fn get_view_columns<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    view_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<TableColumn>, String> {
    crate::application::metadata::get_view_columns(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        view_name,
        schema,
        database,
    )
    .await
}

#[tauri::command]
pub async fn get_materialized_views<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<crate::models::ViewInfo>, String> {
    crate::application::metadata::get_materialized_views(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        schema,
        database,
    )
    .await
}

#[tauri::command]
pub async fn get_materialized_view_columns<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    view_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<TableColumn>, String> {
    crate::application::metadata::get_materialized_view_columns(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        view_name,
        schema,
        database,
    )
    .await
}

#[tauri::command]
pub async fn get_materialized_view_definition<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    view_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<String, String> {
    crate::application::metadata::get_materialized_view_definition(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        view_name,
        schema,
        database,
    )
    .await
}

#[tauri::command]
pub async fn refresh_materialized_view<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    view_name: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<(), String> {
    crate::application::database_objects::refresh_materialized_view(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        view_name,
        schema,
        database,
    )
    .await
}

#[tauri::command]
pub async fn get_triggers<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<TriggerInfo>, String> {
    crate::application::metadata::get_triggers(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        schema,
        database,
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
    database: Option<String>,
) -> Result<String, String> {
    crate::application::database_objects::get_trigger_definition(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        trigger_name,
        table_name,
        schema,
        database,
    )
    .await
}

#[tauri::command]
pub async fn create_trigger<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    trigger_sql: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<(), String> {
    crate::application::database_objects::create_trigger(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        trigger_sql,
        schema,
        database,
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
    database: Option<String>,
) -> Result<(), String> {
    crate::application::database_objects::drop_trigger(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        trigger_name,
        table_name,
        schema,
        database,
    )
    .await
}

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

/// Disconnect from a database connection by closing all of its connection pools
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

/// Maps generic inferred types (emitted by the clipboard parser) to
/// driver-specific type names. Returns names in the same order as `kinds`.
#[tauri::command]
pub async fn map_inferred_column_types<R: Runtime>(
    app: AppHandle<R>,
    driver: String,
    kinds: Vec<String>,
    connection_id: Option<String>,
) -> Result<Vec<String>, String> {
    crate::application::database_objects::map_inferred_column_types(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        driver,
        kinds,
        connection_id,
    )
    .await
}

#[tauri::command]
pub async fn get_create_table_sql<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table_name: String,
    columns: Vec<ColumnDefinition>,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<String>, String> {
    crate::application::database_objects::get_create_table_sql(
        &app.state::<crate::runtime::RuntimeContext>(),
        &connection_id,
        table_name,
        columns,
        schema,
        database,
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
    database: Option<String>,
) -> Result<Vec<String>, String> {
    crate::application::database_objects::get_add_column_sql(
        &app.state::<crate::runtime::RuntimeContext>(),
        &connection_id,
        table,
        column,
        schema,
        database,
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
    database: Option<String>,
) -> Result<Vec<String>, String> {
    crate::application::database_objects::get_alter_column_sql(
        &app.state::<crate::runtime::RuntimeContext>(),
        &connection_id,
        table,
        old_column,
        new_column,
        schema,
        database,
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
    database: Option<String>,
) -> Result<Vec<String>, String> {
    crate::application::database_objects::get_create_index_sql(
        &app.state::<crate::runtime::RuntimeContext>(),
        &connection_id,
        table,
        index_name,
        columns,
        is_unique,
        schema,
        database,
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
    database: Option<String>,
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
        database,
    )
    .await
}

/// Plugin-provided statement for dropping a table, or `None` to let the
/// explorer build its generic `DROP TABLE`. Only plugins declaring
/// `capabilities.drop_table_sql` are asked; every other driver (built-ins
/// included) returns `None` without resolving credentials or params.
#[tauri::command]
pub async fn get_drop_table_sql<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    table: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Option<String>, String> {
    crate::application::database_objects::get_drop_table_sql(
        &app.state::<crate::runtime::RuntimeContext>(),
        &connection_id,
        table,
        schema,
        database,
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
    database: Option<String>,
) -> Result<(), String> {
    crate::application::database_objects::drop_index(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        table,
        index_name,
        schema,
        database,
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
    database: Option<String>,
) -> Result<(), String> {
    crate::application::database_objects::drop_foreign_key(
        &app.state::<crate::runtime::RuntimeContext>(),
        None,
        &connection_id,
        table,
        fk_name,
        schema,
        database,
    )
    .await
}

#[tauri::command]
pub async fn get_keybindings<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    crate::application::persistence::get_keybindings(&app.state::<crate::runtime::RuntimeContext>())
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

/// Detects the MIME type of base64-encoded binary data using magic-byte analysis
/// and returns the canonical blob wire format: "BLOB:<size>:<mime>:<base64>".
/// Called by the frontend after the user selects a file to upload.
#[tauri::command]
pub fn detect_blob_mime(base64_data: String) -> Result<String, String> {
    crate::commands::detect_blob_mime(base64_data)
}

/// Detects the MIME type from a small base64-encoded header (first ~8KB).
/// Returns only the MIME type string — the frontend constructs the wire format
/// locally, avoiding a full round-trip of the entire file over IPC.
#[tauri::command]
pub fn detect_mime_type(header_base64: String) -> Result<String, String> {
    crate::commands::detect_mime_type(header_base64)
}

/// Gets file statistics (size and MIME type) without reading the entire file.
/// Used after streaming upload to construct the final wire format.
#[tauri::command]
pub fn get_file_stats(file_path: String) -> Result<serde_json::Value, String> {
    crate::commands::get_file_stats(file_path)
}

/// Reads a file from disk and returns it as a base64-encoded data URL.
/// Used for image preview of BLOB_FILE_REF values without requiring frontend FS permissions.
/// Only available for image files; returns an error for non-image MIME types.
#[tauri::command]
pub async fn read_file_as_data_url(file_path: String) -> Result<String, String> {
    crate::commands::read_file_as_data_url(file_path).await
}

/// Snapshot of connection ids currently open in the shared backend (across all
/// windows). Used by each window to render cross-window connection status.
#[tauri::command]
pub async fn get_active_connections() -> Vec<String> {
    crate::commands::get_active_connections().await
}

#[tauri::command]
pub async fn get_data_types(driver: String) -> Result<crate::models::DataTypeRegistry, String> {
    crate::commands::get_data_types(driver).await
}

#[tauri::command]
pub async fn get_registered_drivers() -> Vec<crate::drivers::driver_trait::PluginManifest> {
    crate::commands::get_registered_drivers().await
}

#[tauri::command]
pub async fn get_driver_manifest(
    driver_id: String,
) -> Option<crate::plugins::connection_metadata::DriverManifestDetails> {
    crate::commands::get_driver_manifest(driver_id).await
}
