#[path = "connection_secret_writes.rs"]
mod connection_secret_writes;
pub(crate) use connection_secret_writes::SecretWrites;

use crate::models::{
    ConnectionAppearance, ConnectionGroup, ConnectionParams, ConnectionsFile, CredentialProfile,
    SavedConnection, TestConnectionRequest,
};
use crate::plugin_secrets::PluginSecretChanges;
use crate::runtime::{state::ApplicationState, RuntimeContext};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use uuid::Uuid;

const ICON_UPLOAD_TTL: Duration = Duration::from_secs(5 * 60);
const MAX_PENDING_ICON_UPLOADS_PER_SESSION: usize = 16;
const DB_SECRET_SUFFIX: &str = "db";
const SSH_SECRET_SUFFIX: &str = "ssh";
const SSH_PASSPHRASE_SUFFIX: &str = "ssh_passphrase";
const CONNECTION_URI_SUFFIX: &str = "connection_uri";

#[derive(Debug)]
pub enum ConnectionCommand {
    SetSelectedDatabases {
        connection_id: String,
        databases: Vec<String>,
    },
    GetConnections,
    GetConnectionById {
        id: String,
    },
    GetConnectionsWithGroups,
    SaveConnection {
        name: String,
        params: ConnectionParams,
        plugin_secret_changes: Option<PluginSecretChanges>,
        detect_json_in_text_columns: Option<bool>,
        environment: Option<String>,
    },
    UpdateConnection {
        id: String,
        name: String,
        params: ConnectionParams,
        plugin_secret_changes: Option<PluginSecretChanges>,
        detect_json_in_text_columns: Option<bool>,
        environment: Option<String>,
    },
    DeleteConnection {
        id: String,
    },
    DuplicateConnection {
        id: String,
    },
    SetConnectionAppearance {
        id: String,
        appearance: Option<ConnectionAppearance>,
    },
    SaveConnectionIcon {
        connection_id: String,
        upload_token: String,
        session_id: Uuid,
    },
    DeleteConnectionIcon {
        relative_path: String,
    },
    GetConnectionGroups,
    CreateConnectionGroup {
        name: String,
        parent_id: Option<String>,
    },
    CreateGroupPath {
        path: String,
        parent_id: Option<String>,
    },
    UpdateConnectionGroup {
        id: String,
        name: Option<String>,
        collapsed: Option<bool>,
        sort_order: Option<i32>,
    },
    MoveGroupToParent {
        id: String,
        parent_id: Option<String>,
    },
    DeleteConnectionGroup {
        id: String,
    },
    MoveConnectionToGroup {
        connection_id: String,
        group_id: Option<String>,
        sort_order: Option<i32>,
    },
    ReorderGroups {
        group_orders: Vec<(String, i32)>,
    },
    ReorderConnectionsInGroup {
        connection_orders: Vec<(String, i32)>,
    },
    ListConnectionTags,
    CreateConnectionTag {
        name: String,
        color: String,
    },
    UpdateConnectionTag {
        id: String,
        name: String,
        color: String,
    },
    DeleteConnectionTag {
        id: String,
    },
    SetConnectionTags {
        connection_id: String,
        tag_ids: Vec<String>,
    },
    ListCredentialProfiles,
    CreateCredentialProfile {
        name: String,
        username: String,
        password: String,
    },
    UpdateCredentialProfile {
        id: String,
        name: String,
        username: String,
        password: Option<String>,
    },
    DeleteCredentialProfile {
        id: String,
    },
    GetRegisteredDrivers,
    GetDriverManifest {
        driver_id: String,
    },
    GetActiveConnections,
    RegisterActiveConnection {
        connection_id: String,
    },
    DisconnectConnection {
        connection_id: String,
    },
    TestConnection {
        request: TestConnectionRequest,
    },
    ListDatabases {
        request: TestConnectionRequest,
    },
    CreateSqliteDatabase {
        path: String,
    },
}

pub async fn execute(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    command: ConnectionCommand,
) -> Result<Value, String> {
    execute_for_session(runtime, state, None, command).await
}

pub async fn execute_for_session(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    session_id: Option<Uuid>,
    command: ConnectionCommand,
) -> Result<Value, String> {
    match command {
        ConnectionCommand::SetSelectedDatabases {
            connection_id,
            databases,
        } => {
            set_selected_databases(runtime, &connection_id, databases).await?;
            state.connection_cache.invalidate();
            Ok(Value::Null)
        }
        ConnectionCommand::GetConnections => {
            json(redacted_connections(load_file(runtime)?.connections))
        }
        ConnectionCommand::GetConnectionById { id } => {
            let connection = find_connection(&load_file(runtime)?, &id)?;
            json(redact_connection(connection))
        }
        ConnectionCommand::GetConnectionsWithGroups => {
            let mut file = load_file(runtime)?;
            file.connections = redacted_connections(file.connections);
            json(file)
        }
        ConnectionCommand::SaveConnection {
            name,
            params,
            plugin_secret_changes,
            detect_json_in_text_columns,
            environment,
        } => json(save_connection(
            runtime,
            state,
            name,
            params,
            plugin_secret_changes.unwrap_or_default(),
            detect_json_in_text_columns,
            environment,
        )?),
        ConnectionCommand::UpdateConnection {
            id,
            name,
            params,
            plugin_secret_changes,
            detect_json_in_text_columns,
            environment,
        } => {
            let previous_driver = find_connection(&load_file(runtime)?, &id)?.params.driver;
            let updated = update_connection(
                runtime,
                state,
                id.clone(),
                name,
                params,
                plugin_secret_changes.unwrap_or_default(),
                detect_json_in_text_columns,
                environment,
            )?;
            invalidate_connection_metadata(
                runtime,
                &id,
                [&previous_driver, &updated.params.driver],
            )
            .await;
            json(updated)
        }
        ConnectionCommand::DeleteConnection { id } => {
            delete_connection(runtime, state, &id)?;
            Ok(Value::Null)
        }
        ConnectionCommand::DuplicateConnection { id } => {
            json(duplicate_connection(runtime, state, &id)?)
        }
        ConnectionCommand::SetConnectionAppearance { id, appearance } => {
            let mut file = load_file(runtime)?;
            let connection = file
                .connections
                .iter_mut()
                .find(|connection| connection.id == id)
                .ok_or_else(|| "Connection not found".to_string())?;
            connection.appearance = appearance;
            save_file(runtime, state, &file)?;
            Ok(Value::Null)
        }
        ConnectionCommand::SaveConnectionIcon {
            connection_id,
            upload_token,
            session_id,
        } => {
            let upload = consume_icon_upload(runtime, session_id, &upload_token)?;
            let destination = runtime.paths.data_dir().join("connection-icons");
            let result =
                crate::connection_appearance::save_icon_impl(&destination, &connection_id, &upload)
                    .map_err(|error| error.to_string());
            let _ = fs::remove_file(upload);
            json(result?)
        }
        ConnectionCommand::DeleteConnectionIcon { relative_path } => {
            delete_icon(runtime.paths.data_dir(), &relative_path)?;
            Ok(Value::Null)
        }
        ConnectionCommand::GetConnectionGroups => json(load_file(runtime)?.groups),
        ConnectionCommand::CreateConnectionGroup { name, parent_id } => {
            json(create_group(runtime, state, name, parent_id)?)
        }
        ConnectionCommand::CreateGroupPath { path, parent_id } => {
            json(create_group_path(runtime, state, &path, parent_id)?)
        }
        ConnectionCommand::UpdateConnectionGroup {
            id,
            name,
            collapsed,
            sort_order,
        } => json(update_group(
            runtime, state, &id, name, collapsed, sort_order,
        )?),
        ConnectionCommand::MoveGroupToParent { id, parent_id } => {
            json(move_group(runtime, state, &id, parent_id)?)
        }
        ConnectionCommand::DeleteConnectionGroup { id } => {
            delete_group(runtime, state, &id)?;
            Ok(Value::Null)
        }
        ConnectionCommand::MoveConnectionToGroup {
            connection_id,
            group_id,
            sort_order,
        } => json(move_connection(
            runtime,
            state,
            &connection_id,
            group_id,
            sort_order,
        )?),
        ConnectionCommand::ReorderGroups { group_orders } => {
            reorder_groups(runtime, state, group_orders)?;
            Ok(Value::Null)
        }
        ConnectionCommand::ReorderConnectionsInGroup { connection_orders } => {
            reorder_connections(runtime, state, connection_orders)?;
            Ok(Value::Null)
        }
        ConnectionCommand::ListConnectionTags => json(load_file(runtime)?.tags),
        ConnectionCommand::CreateConnectionTag { name, color } => {
            let mut file = load_file(runtime)?;
            let tag = crate::connection_tags::create_tag_impl(&mut file, &name, &color)?;
            save_file(runtime, state, &file)?;
            json(tag)
        }
        ConnectionCommand::UpdateConnectionTag { id, name, color } => {
            let mut file = load_file(runtime)?;
            crate::connection_tags::update_tag_impl(&mut file, &id, &name, &color)?;
            save_file(runtime, state, &file)?;
            Ok(Value::Null)
        }
        ConnectionCommand::DeleteConnectionTag { id } => {
            let mut file = load_file(runtime)?;
            crate::connection_tags::delete_tag_impl(&mut file, &id)?;
            save_file(runtime, state, &file)?;
            Ok(Value::Null)
        }
        ConnectionCommand::SetConnectionTags {
            connection_id,
            tag_ids,
        } => {
            let mut file = load_file(runtime)?;
            crate::connection_tags::set_connection_tags_impl(&mut file, &connection_id, &tag_ids)?;
            save_file(runtime, state, &file)?;
            Ok(Value::Null)
        }
        ConnectionCommand::ListCredentialProfiles => {
            json(load_file(runtime)?.credential_profiles)
        }
        ConnectionCommand::CreateCredentialProfile {
            name,
            username,
            password,
        } => json(create_credential_profile(runtime, state, name, username, password)?),
        ConnectionCommand::UpdateCredentialProfile {
            id,
            name,
            username,
            password,
        } => {
            update_credential_profile(runtime, state, id, name, username, password)?;
            Ok(Value::Null)
        }
        ConnectionCommand::DeleteCredentialProfile { id } => {
            delete_credential_profile(runtime, state, id)?;
            Ok(Value::Null)
        }
        ConnectionCommand::GetRegisteredDrivers => {
            json(crate::drivers::registry::list_drivers().await)
        }
        ConnectionCommand::GetDriverManifest { driver_id } => {
            let manifest = crate::drivers::registry::get_driver(&driver_id)
                .await
                .map(
                    |driver| crate::plugins::connection_metadata::DriverManifestDetails {
                        manifest: driver.manifest().clone(),
                        connection_metadata: driver.has_connection_metadata().then_some(true),
                    },
                );
            json(manifest)
        }
        ConnectionCommand::GetActiveConnections => {
            json(active_connections(state, session_id).await)
        }
        ConnectionCommand::RegisterActiveConnection { connection_id } => {
            register_active_connection(runtime, Some(state), session_id, connection_id).await;
            Ok(Value::Null)
        }
        ConnectionCommand::DisconnectConnection { connection_id } => {
            disconnect_connection(runtime, Some(state), session_id, &connection_id).await?;
            Ok(Value::Null)
        }
        ConnectionCommand::TestConnection { request } => {
            json(test_connection(runtime, session_id, request).await?)
        }
        ConnectionCommand::ListDatabases { request } => {
            json(list_databases(runtime, session_id, request).await?)
        }
        ConnectionCommand::CreateSqliteDatabase { path } => {
            json(create_sqlite_database(runtime, state, path).await?)
        }
    }
}

pub fn load_connections(path: &Path) -> Result<Vec<SavedConnection>, String> {
    crate::persistence::load_connections(path)
}

pub fn load_redacted_connections(path: &Path) -> Result<Vec<SavedConnection>, String> {
    load_connections(path).map(redacted_connections)
}

/// Driver id of a saved connection, without resolving secrets or tunnels.
pub(crate) fn saved_connection_driver(
    runtime: &RuntimeContext,
    connection_id: &str,
) -> Result<String, String> {
    Ok(find_connection(&load_file(runtime)?, connection_id)?
        .params
        .driver)
}

pub(crate) fn resolve_saved_connection_params(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
) -> Result<(String, ConnectionParams), String> {
    let file = load_file(runtime)?;
    let saved = find_connection(&file, connection_id)?;
    let driver_id = saved.params.driver.clone();
    let plugin_secrets = load_plugin_secrets(runtime, &saved);
    let mut params = saved.params;
    restore_secrets_for_connect(runtime, connection_id, &mut params)?;
    apply_credential_profile(runtime, &file, &mut params)?;
    params.extra.extend(plugin_secrets);
    params.connection_id = Some(connection_id.to_string());
    let params =
        crate::application::tunnels::resolve_connection_params(runtime, &params, session_id)?;
    Ok((driver_id, params))
}

pub fn store_icon_upload(
    data_dir: &Path,
    session_id: Uuid,
    bytes: &[u8],
) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("The uploaded icon is empty".to_string());
    }
    if bytes.len() as u64 > crate::connection_appearance::MAX_ICON_BYTES {
        return Err("The uploaded icon exceeds 512 KB".to_string());
    }
    let token = Uuid::new_v4().to_string();
    let directory = upload_directory(data_dir, session_id);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let mut pending = 0;
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        let age = metadata
            .modified()
            .ok()
            .and_then(|modified| SystemTime::now().duration_since(modified).ok())
            .unwrap_or(Duration::ZERO);
        if age > ICON_UPLOAD_TTL || entry.path().extension().is_some_and(|ext| ext == "tmp") {
            let _ = fs::remove_file(entry.path());
        } else if metadata.is_file() {
            pending += 1;
        }
    }
    if pending >= MAX_PENDING_ICON_UPLOADS_PER_SESSION {
        return Err("Too many pending connection icon uploads".to_string());
    }
    let destination = directory.join(&token);
    let temporary = directory.join(format!("{token}.tmp"));
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    fs::rename(&temporary, &destination).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        error.to_string()
    })?;
    Ok(token)
}

pub fn resolve_icon_asset(data_dir: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let filename = relative_path
        .strip_prefix("connection-icons/")
        .filter(|filename| {
            !filename.is_empty()
                && !filename.contains('/')
                && !filename.contains('\\')
                && *filename != "."
                && *filename != ".."
        })
        .ok_or_else(|| "Invalid connection icon path".to_string())?;
    let path = data_dir.join("connection-icons").join(filename);
    if !path.is_file() {
        return Err("Connection icon not found".to_string());
    }
    Ok(path)
}

fn load_file(runtime: &RuntimeContext) -> Result<ConnectionsFile, String> {
    crate::persistence::load_connections_file(&runtime.paths.connections_file())
}

fn save_file(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    file: &ConnectionsFile,
) -> Result<(), String> {
    crate::persistence::save_connections_file(&runtime.paths.connections_file(), file)?;
    state.connection_cache.invalidate();
    Ok(())
}

fn find_connection(file: &ConnectionsFile, id: &str) -> Result<SavedConnection, String> {
    file.connections
        .iter()
        .find(|connection| connection.id == id)
        .cloned()
        .ok_or_else(|| "Connection not found".to_string())
}

fn redacted_connections(connections: Vec<SavedConnection>) -> Vec<SavedConnection> {
    connections.into_iter().map(redact_connection).collect()
}

fn redact_connection(mut connection: SavedConnection) -> SavedConnection {
    connection.params.password = None;
    connection.params.connection_uri = None;
    connection.params.ssh_password = None;
    connection.params.ssh_key_passphrase = None;
    connection.params.connection_id = None;
    connection
}

fn validate_environment(environment: Option<String>) -> Result<Option<String>, String> {
    match environment.as_deref() {
        None | Some("") => Ok(None),
        Some("development" | "staging" | "production") => Ok(environment),
        Some(other) => Err(format!("Invalid environment: {other}")),
    }
}

/// AWS IAM auth needs a fresh RDS token in the password field.
pub(crate) fn require_iam_token(iam_auth: bool, password: Option<&str>) -> Result<(), String> {
    if iam_auth && password.unwrap_or("").is_empty() {
        return Err(
            "AWS IAM authentication is enabled but the password field is empty. \
             Paste the output of `aws rds generate-db-auth-token` into the \
             password field and try again. Tokens expire every 15 minutes."
                .to_string(),
        );
    }
    Ok(())
}

fn secret_account(connection_id: &str, suffix: &str) -> String {
    format!("{connection_id}:{suffix}")
}

/// Keychain account for a shared credential profile password. Uses a dedicated
/// namespace so a profile id cannot collide with a connection id (`{id}:db`).
pub(crate) fn profile_db_secret_account(profile_id: &str) -> String {
    format!("{profile_id}:profile:db")
}

fn validate_credential_profile_reference(
    file: &ConnectionsFile,
    connection_id: &str,
    params: &ConnectionParams,
) -> Result<(), String> {
    if let Some(profile_id) = params.credential_profile_id.as_deref() {
        if !file.credential_profiles.iter().any(|profile| profile.id == profile_id) {
            return Err(format!("Credential profile '{profile_id}' not found"));
        }
        crate::credential_profiles::validate_connection_profile_link(connection_id, profile_id)?;
    }
    Ok(())
}

/// Profile-linked connections never keep an inline DB password in `connections.json`.
fn clear_profile_owned_inline_password(params: &mut ConnectionParams) {
    if params.credential_profile_id.is_some() {
        params.password = None;
    }
}

/// Deletes a stale per-connection DB secret unless it aliases a linked profile's account.
fn delete_connection_db_secret_if_distinct(
    runtime: &RuntimeContext,
    writes: &mut SecretWrites,
    connection_id: &str,
    profile_id: Option<&str>,
) -> Result<(), String> {
    if profile_id.is_some_and(|profile_id| {
        crate::credential_profiles::connection_db_collides_with_profile_db(
            connection_id,
            profile_id,
        )
    }) {
        return Ok(());
    }
    writes.delete(runtime, secret_account(connection_id, DB_SECRET_SUFFIX))?;
    Ok(())
}

fn skip_connection_db_keychain_delete(connection: &SavedConnection) -> bool {
    let Some(profile_id) = connection.params.credential_profile_id.as_deref() else {
        return false;
    };
    crate::credential_profiles::connection_db_collides_with_profile_db(
        &connection.id,
        profile_id,
    )
}

fn persist_credential_profile_password(
    runtime: &RuntimeContext,
    cache: &crate::credential_cache::CredentialCache,
    file: &ConnectionsFile,
    profile_id: &str,
    password: &str,
    writes: &mut SecretWrites,
) -> Result<(), String> {
    if password.is_empty() {
        return Err("Credential profile password cannot be empty".to_string());
    }
    writes.set(runtime, profile_db_secret_account(profile_id), password)?;
    for connection_id in crate::credential_profiles::connection_ids_for_profile(file, profile_id) {
        crate::credential_cache::invalidate_db_password(cache, &connection_id);
    }
    crate::credential_cache::set_db_password_cached(cache, profile_id, password);
    Ok(())
}

fn create_credential_profile(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    name: String,
    username: String,
    password: String,
) -> Result<CredentialProfile, String> {
    let mut file = load_file(runtime)?;
    let profile = crate::credential_profiles::create_profile_impl(&mut file, &name, &username)?;
    let mut writes = SecretWrites::default();
    let result = (|| {
        persist_credential_profile_password(
            runtime,
            &state.credential_cache,
            &file,
            &profile.id,
            &password,
            &mut writes,
        )?;
        save_file(runtime, state, &file)?;
        Ok(())
    })();
    if let Err(error) = result {
        writes.rollback(runtime);
        return Err(error);
    }
    Ok(profile)
}

fn delete_credential_profile(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    id: String,
) -> Result<(), String> {
    let path = runtime.paths.connections_file();
    let profile = crate::persistence::with_connections_file_exclusive(|| {
        let mut file = crate::persistence::read_connections_file(&path)?;
        let dependents =
            crate::credential_profiles::dependent_connections_for_profile(&file, &id);
        if !dependents.is_empty() {
            return Err(crate::credential_profiles::credential_profile_delete_blocked_error(
                &id,
                dependents,
            ));
        }
        if !file.credential_profiles.iter().any(|profile| profile.id == id) {
            return Err("Credential profile not found".to_string());
        }
        crate::credential_profiles::validate_profile_keychain_namespace(&file, &id)?;
        let profile = crate::credential_profiles::delete_profile_impl(&mut file, &id)?;
        crate::persistence::write_connections_file(&path, &file)?;
        Ok(profile)
    })?;
    state.connection_cache.invalidate();

    let account = profile_db_secret_account(&id);
    let mut writes = SecretWrites::default();
    if let Err(error) = writes.delete(runtime, account) {
        let restore_result = crate::persistence::with_connections_file_exclusive(|| {
            let mut file = crate::persistence::read_connections_file(&path)?;
            if !file.credential_profiles.iter().any(|profile| profile.id == id) {
                file.credential_profiles.push(profile);
                crate::persistence::write_connections_file(&path, &file)?;
            }
            Ok(())
        });
        writes.rollback(runtime);
        if let Err(restore_error) = restore_result {
            return Err(format!(
                "{error}. Failed to restore credential profile metadata: {restore_error}"
            ));
        }
        state.connection_cache.invalidate();
        return Err(error);
    }
    crate::credential_cache::invalidate_db_password(&state.credential_cache, &id);
    Ok(())
}

fn update_credential_profile(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    id: String,
    name: String,
    username: String,
    password: Option<String>,
) -> Result<(), String> {
    let mut file = load_file(runtime)?;
    if !file.credential_profiles.iter().any(|profile| profile.id == id) {
        return Err("Credential profile not found".to_string());
    }
    let mut writes = SecretWrites::default();
    let result = (|| {
        if let Some(password) = password.as_deref() {
            persist_credential_profile_password(
                runtime,
                &state.credential_cache,
                &file,
                &id,
                password,
                &mut writes,
            )?;
        }
        crate::credential_profiles::update_profile_impl(&mut file, &id, &name, &username)?;
        save_file(runtime, state, &file)?;
        Ok(())
    })();
    if let Err(error) = result {
        writes.rollback(runtime);
        return Err(error);
    }
    Ok(())
}

fn non_empty(value: Option<&String>) -> Option<&str> {
    value.map(String::as_str).filter(|value| !value.is_empty())
}

fn non_empty_trimmed(value: Option<&String>) -> Option<&str> {
    value
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
}

fn persist_secrets_for_create(
    runtime: &RuntimeContext,
    id: &str,
    params: &mut ConnectionParams,
    writes: &mut SecretWrites,
) -> Result<(), String> {
    if !params.ssh_enabled.unwrap_or(false) {
        params.ssh_password = None;
        params.ssh_key_passphrase = None;
    } else if non_empty_trimmed(params.ssh_key_passphrase.as_ref()).is_none() {
        params.ssh_key_passphrase = None;
    }
    if let Some(uri) = non_empty(params.connection_uri.as_ref()) {
        if !params.save_in_keychain.unwrap_or(false) {
            return Err("Connection URIs must be stored in the OS keychain".to_string());
        }
        writes.set(runtime, secret_account(id, CONNECTION_URI_SUFFIX), uri)?;
        params.connection_uri_in_keychain = Some(true);
        params.connection_uri = None;
    }
    persist_passwords(runtime, id, params, writes)
}

fn persist_passwords(
    runtime: &RuntimeContext,
    id: &str,
    params: &mut ConnectionParams,
    writes: &mut SecretWrites,
) -> Result<(), String> {
    if !params.save_in_keychain.unwrap_or(false) {
        clear_profile_owned_inline_password(params);
        return Ok(());
    }
    let mut password_writes = SecretWrites::default();
    let profile_id = params.credential_profile_id.clone();
    let result = (|| {
        if profile_id.is_some() {
            clear_profile_owned_inline_password(params);
            delete_connection_db_secret_if_distinct(
                runtime,
                &mut password_writes,
                id,
                profile_id.as_deref(),
            )?;
        }
        for (suffix, value) in [
            (DB_SECRET_SUFFIX, params.password.as_deref()),
            (SSH_SECRET_SUFFIX, params.ssh_password.as_deref()),
            (SSH_PASSPHRASE_SUFFIX, params.ssh_key_passphrase.as_deref()),
        ] {
            if suffix == DB_SECRET_SUFFIX && profile_id.is_some() {
                continue;
            }
            if let Some(value) = value {
                if value.is_empty() {
                    password_writes.delete(runtime, secret_account(id, suffix))?;
                } else {
                    password_writes.set(runtime, secret_account(id, suffix), value)?;
                }
            }
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        password_writes.rollback(runtime);
        log::warn!("Keychain unavailable for connection {id}; storing passwords in the config file: {error}");
        crate::persistence::apply_secret_persistence(params, false);
    } else {
        writes.append(password_writes);
        crate::persistence::apply_secret_persistence(params, true);
    }
    Ok(())
}

fn merge_and_persist_update_secrets(
    runtime: &RuntimeContext,
    id: &str,
    existing: &ConnectionParams,
    params: &mut ConnectionParams,
    writes: &mut SecretWrites,
) -> Result<(), String> {
    let keychain = params.save_in_keychain.unwrap_or(false);
    if let Some(uri) = non_empty(params.connection_uri.as_ref()) {
        if !keychain {
            return Err("Connection URIs must be stored in the OS keychain".to_string());
        }
        writes.set(runtime, secret_account(id, CONNECTION_URI_SUFFIX), uri)?;
        params.connection_uri_in_keychain = Some(true);
    } else if keychain
        && existing.driver == params.driver
        && existing.connection_uri_in_keychain.unwrap_or(false)
        && params.connection_uri_in_keychain != Some(false)
    {
        params.connection_uri_in_keychain = Some(true);
    } else if existing.connection_uri_in_keychain.unwrap_or(false) {
        writes.delete(runtime, secret_account(id, CONNECTION_URI_SUFFIX))?;
        params.connection_uri_in_keychain = None;
    } else {
        params.connection_uri_in_keychain = None;
    }
    params.connection_uri = None;

    // An empty passphrase field means "unchanged", like an omitted one.
    if non_empty_trimmed(params.ssh_key_passphrase.as_ref()).is_none() {
        params.ssh_key_passphrase = None;
    }
    // Browser responses redact secrets; an omitted field must keep its saved value.
    for (field, previous, suffix) in [
        (&mut params.password, &existing.password, DB_SECRET_SUFFIX),
        (
            &mut params.ssh_password,
            &existing.ssh_password,
            SSH_SECRET_SUFFIX,
        ),
        (
            &mut params.ssh_key_passphrase,
            &existing.ssh_key_passphrase,
            SSH_PASSPHRASE_SUFFIX,
        ),
    ] {
        if suffix == DB_SECRET_SUFFIX && params.credential_profile_id.is_some() {
            *field = None;
            continue;
        }
        if field.is_none() {
            *field = if existing.save_in_keychain.unwrap_or(false) {
                runtime.secrets.get(&secret_account(id, suffix))?
            } else {
                previous.clone()
            };
        }
    }
    if params.credential_profile_id.is_some() {
        clear_profile_owned_inline_password(params);
        delete_connection_db_secret_if_distinct(
            runtime,
            writes,
            id,
            params.credential_profile_id.as_deref(),
        )?;
    }
    if !params.ssh_enabled.unwrap_or(false) && keychain {
        // Empty values delete the stored SSH secrets of a disabled tunnel.
        params.ssh_password = Some(String::new());
        params.ssh_key_passphrase = Some(String::new());
    }
    persist_passwords(runtime, id, params, writes)?;
    Ok(())
}

fn delete_connection_secrets(runtime: &RuntimeContext, id: &str) -> Result<(), String> {
    for suffix in [
        DB_SECRET_SUFFIX,
        SSH_SECRET_SUFFIX,
        SSH_PASSPHRASE_SUFFIX,
        CONNECTION_URI_SUFFIX,
    ] {
        runtime.secrets.delete(&secret_account(id, suffix))?;
    }
    Ok(())
}

pub(crate) fn restore_connection_secrets(
    runtime: &RuntimeContext,
    id: &str,
    params: &mut ConnectionParams,
) -> Result<(), String> {
    restore_secrets(runtime, id, params)
}

pub(crate) fn plugin_secret_account(connection_id: &str, driver: &str, key: &str) -> String {
    format!("{connection_id}:plugin:{driver}:{key}")
}

/// Stored plugin-owned secrets of `connection`. Lenient like the desktop path:
/// an unreadable key is logged and left unset so the plugin reports it.
pub(crate) fn load_plugin_secrets(
    runtime: &RuntimeContext,
    connection: &SavedConnection,
) -> std::collections::HashMap<String, String> {
    let driver = &connection.params.driver;
    crate::plugin_secrets::resolve_secret_values(
        &connection.id,
        &connection.plugin_secret_keys,
        |key| {
            runtime
                .secrets
                .get(&plugin_secret_account(&connection.id, driver, key))
        },
    )
    .values
}

/// Applies the modal's plugin secret changes to the keychain and returns the
/// key list to persist. Values never stay in `params.extra`.
fn persist_plugin_secrets(
    runtime: &RuntimeContext,
    id: &str,
    previous: Option<(&str, &[String])>,
    params: &mut ConnectionParams,
    changes: &PluginSecretChanges,
    writes: &mut SecretWrites,
) -> Result<Vec<String>, String> {
    let same_driver = previous.is_none_or(|(driver, _)| driver == params.driver);
    let existing = previous.map(|(_, keys)| keys).unwrap_or_default();
    let keys = crate::plugin_secrets::next_secret_keys(existing, same_driver, changes)?;
    if let Some((old_driver, old_keys)) = previous.filter(|_| !same_driver) {
        for key in old_keys {
            writes.delete(runtime, plugin_secret_account(id, old_driver, key))?;
        }
    }
    for (key, value) in changes {
        params.extra.remove(key);
        let account = plugin_secret_account(id, &params.driver, key);
        match value {
            Some(value) => writes.set(runtime, account, value)?,
            None => writes.delete(runtime, account)?,
        }
    }
    Ok(keys)
}

/// Secrets a plugin SQL builder may forward: the connection URI, the database
/// password and the plugin-owned secrets. SSH secrets are skipped because the
/// builders never open tunnels.
///
/// Credential profiles fail closed (same as connect/test): an unresolved profile
/// aborts with an error and never falls back to inline connection credentials.
/// Other keychain reads stay lenient via [`commands::apply_sql_builder_secrets`].
pub(crate) fn bind_sql_builder_secrets(
    runtime: &RuntimeContext,
    connection: &mut SavedConnection,
) -> Result<(), String> {
    let id = connection.id.clone();
    let profile_password = if connection.params.credential_profile_id.is_some() {
        let file = load_file(runtime)?;
        apply_credential_profile(runtime, &file, &mut connection.params)?;
        connection.params.password.clone()
    } else {
        None
    };
    crate::commands::apply_sql_builder_secrets(
        &mut connection.params,
        &id,
        |stored| {
            if stored {
                runtime
                    .secrets
                    .get(&secret_account(&id, CONNECTION_URI_SUFFIX))
            } else {
                Ok(None)
            }
        },
        || {
            if let Some(password) = profile_password {
                Ok(password)
            } else {
                runtime
                    .secrets
                    .get(&secret_account(&id, DB_SECRET_SUFFIX))?
                    .ok_or_else(|| "No password stored".to_string())
            }
        },
    );
    let plugin_secrets = load_plugin_secrets(runtime, connection);
    connection.params.extra.extend(plugin_secrets);
    Ok(())
}

fn delete_plugin_secrets(runtime: &RuntimeContext, connection: &SavedConnection) {
    for key in &connection.plugin_secret_keys {
        let account = plugin_secret_account(&connection.id, &connection.params.driver, key);
        if let Err(error) = runtime.secrets.delete(&account) {
            log::warn!("Failed to remove plugin secret '{key}': {error}");
        }
    }
}

/// Replace a connection's inline login with the shared credential profile it
/// references. The profile supplies the username and the password stored under
/// `{profile_id}:profile:db` (see [`profile_db_secret_account`]).
///
/// Fail-closed: a referenced profile that is missing, or a profile without a
/// stored password, is an error. It never falls back to the connection's own
/// password, so a stale inline credential cannot silently take over.
///
/// IAM connections keep their per-connect token: the profile only supplies the
/// username, because their password is never a stored secret.
pub(crate) fn resolve_credential_profile(
    params: &mut ConnectionParams,
    profiles: &[CredentialProfile],
    read_password: impl FnOnce(&str) -> Result<Option<String>, String>,
) -> Result<(), String> {
    let Some(profile_id) = params.credential_profile_id.clone() else {
        return Ok(());
    };
    let profile = profiles
        .iter()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| format!("Credential profile '{profile_id}' not found"))?;
    let username = profile.username.clone();
    if params.use_iam_auth.unwrap_or(false) {
        params.username = Some(username);
        return Ok(());
    }
    let password = read_password(&profile_id)?.ok_or_else(|| {
        format!("Password for credential profile '{profile_id}' is unavailable in the OS keychain")
    })?;
    params.username = Some(username);
    params.password = Some(password);
    Ok(())
}

fn apply_credential_profile(
    runtime: &RuntimeContext,
    file: &ConnectionsFile,
    params: &mut ConnectionParams,
) -> Result<(), String> {
    resolve_credential_profile(params, &file.credential_profiles, |profile_id| {
        runtime.secrets.get(&profile_db_secret_account(profile_id))
    })
}

fn restore_secrets(
    runtime: &RuntimeContext,
    id: &str,
    params: &mut ConnectionParams,
) -> Result<(), String> {
    if params.save_in_keychain.unwrap_or(false) {
        // IAM tokens expire after 15 minutes, so a stored one is always stale.
        // A referenced credential profile owns the password instead.
        if params.credential_profile_id.is_none()
            && params.password.as_deref().is_none_or(str::is_empty)
            && !params.use_iam_auth.unwrap_or(false)
        {
            params.password = runtime.secrets.get(&secret_account(id, DB_SECRET_SUFFIX))?;
        }
        if params.ssh_password.as_deref().is_none_or(str::is_empty) {
            params.ssh_password = runtime
                .secrets
                .get(&secret_account(id, SSH_SECRET_SUFFIX))?;
        }
        if params
            .ssh_key_passphrase
            .as_deref()
            .is_none_or(str::is_empty)
        {
            params.ssh_key_passphrase = runtime
                .secrets
                .get(&secret_account(id, SSH_PASSPHRASE_SUFFIX))?;
        }
    }
    if params.connection_uri_in_keychain.unwrap_or(false)
        && params.connection_uri.as_deref().is_none_or(str::is_empty)
    {
        params.connection_uri = runtime
            .secrets
            .get(&secret_account(id, CONNECTION_URI_SUFFIX))?;
    }
    Ok(())
}

/// Like `restore_secrets`, for opening a connection: a URI the file says is in
/// the keychain must be there, or the driver fails with a confusing error.
fn restore_secrets_for_connect(
    runtime: &RuntimeContext,
    id: &str,
    params: &mut ConnectionParams,
) -> Result<(), String> {
    restore_secrets(runtime, id, params)?;
    if params.connection_uri_in_keychain.unwrap_or(false)
        && params.connection_uri.as_deref().is_none_or(str::is_empty)
    {
        return Err("Stored connection URI is unavailable in the OS keychain".to_string());
    }
    Ok(())
}

fn save_connection(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    name: String,
    mut params: ConnectionParams,
    plugin_secret_changes: PluginSecretChanges,
    detect_json_in_text_columns: Option<bool>,
    environment: Option<String>,
) -> Result<SavedConnection, String> {
    let mut file = load_file(runtime)?;
    let id = Uuid::new_v4().to_string();
    let environment = validate_environment(environment)?;
    let mut writes = SecretWrites::default();
    let result = (|| {
        params.connection_id = None;
        validate_credential_profile_reference(&file, &id, &params)?;
        let plugin_secret_keys = persist_plugin_secrets(
            runtime,
            &id,
            None,
            &mut params,
            &plugin_secret_changes,
            &mut writes,
        )?;
        persist_secrets_for_create(runtime, &id, &mut params, &mut writes)?;
        clear_profile_owned_inline_password(&mut params);
        let connection = SavedConnection {
            id,
            name,
            params,
            plugin_secret_keys,
            group_id: None,
            sort_order: None,
            detect_json_in_text_columns,
            appearance: None,
            tag_ids: None,
            environment,
        };
        file.connections.push(connection.clone());
        save_file(runtime, state, &file)?;
        if !connection.params.save_in_keychain.unwrap_or(false) {
            for suffix in [DB_SECRET_SUFFIX, SSH_SECRET_SUFFIX, SSH_PASSPHRASE_SUFFIX] {
                if suffix == DB_SECRET_SUFFIX && skip_connection_db_keychain_delete(&connection) {
                    continue;
                }
                if let Err(error) = runtime
                    .secrets
                    .delete(&secret_account(&connection.id, suffix))
                {
                    log::warn!("Failed to remove unused connection credential: {error}");
                }
            }
        }
        Ok(redact_connection(connection))
    })();
    if result.is_err() {
        writes.rollback(runtime);
    }
    result
}

/// Creates an empty SQLite file and saves a connection to it. The file is
/// removed again when the connection cannot be saved.
async fn create_sqlite_database(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    path: String,
) -> Result<SavedConnection, String> {
    let database_path = crate::sqlite_database::create_sqlite_file(path).await?;
    let path = PathBuf::from(&database_path);
    let name = crate::sqlite_database::connection_name(&path)?;
    let params = ConnectionParams {
        driver: "sqlite".to_string(),
        database: crate::models::DatabaseSelection::Single(database_path),
        ..ConnectionParams::default()
    };
    save_connection(
        runtime,
        state,
        name,
        params,
        PluginSecretChanges::default(),
        None,
        None,
    )
    .map_err(|error| match fs::remove_file(&path) {
        Ok(()) => format!("Failed to save the SQLite connection: {error}"),
        Err(cleanup_error) => format!(
            "Failed to save the SQLite connection: {error}. The new database could not be removed: {cleanup_error}"
        ),
    })
}

/// Drops cached plugin connection metadata for both the old and the new driver
/// of an edited connection, and tells the frontend when any was dropped.
async fn invalidate_connection_metadata(
    runtime: &RuntimeContext,
    connection_id: &str,
    driver_ids: [&String; 2],
) {
    let mut metadata_changed = false;
    for driver_id in driver_ids {
        if let Some(driver) = crate::drivers::registry::get_driver(driver_id).await {
            if driver.has_connection_metadata() {
                driver
                    .invalidate_connection_metadata(Some(connection_id))
                    .await;
                metadata_changed = true;
            }
        }
    }
    if metadata_changed {
        let _ = runtime.events.emit(
            "connection-metadata-invalidated",
            serde_json::json!({ "connectionId": connection_id }),
        );
    }
}

fn update_connection(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    id: String,
    name: String,
    mut params: ConnectionParams,
    plugin_secret_changes: PluginSecretChanges,
    detect_json_in_text_columns: Option<bool>,
    environment: Option<String>,
) -> Result<SavedConnection, String> {
    let mut file = load_file(runtime)?;
    let index = file
        .connections
        .iter()
        .position(|connection| connection.id == id)
        .ok_or_else(|| "Connection not found".to_string())?;
    let existing = file.connections[index].clone();
    let environment = validate_environment(environment)?;
    let mut writes = SecretWrites::default();
    let result = (|| {
        params.connection_id = None;
        validate_credential_profile_reference(&file, &id, &params)?;
        let plugin_secret_keys = persist_plugin_secrets(
            runtime,
            &id,
            Some((&existing.params.driver, &existing.plugin_secret_keys)),
            &mut params,
            &plugin_secret_changes,
            &mut writes,
        )?;
        merge_and_persist_update_secrets(runtime, &id, &existing.params, &mut params, &mut writes)?;
        clear_profile_owned_inline_password(&mut params);
        let connection = SavedConnection {
            id,
            name,
            params,
            plugin_secret_keys,
            group_id: existing.group_id,
            sort_order: existing.sort_order,
            detect_json_in_text_columns,
            appearance: existing.appearance,
            tag_ids: existing.tag_ids,
            environment,
        };
        file.connections[index] = connection.clone();
        save_file(runtime, state, &file)?;
        if !connection.params.save_in_keychain.unwrap_or(false) {
            for suffix in [DB_SECRET_SUFFIX, SSH_SECRET_SUFFIX, SSH_PASSPHRASE_SUFFIX] {
                if suffix == DB_SECRET_SUFFIX && skip_connection_db_keychain_delete(&connection) {
                    continue;
                }
                if let Err(error) = runtime
                    .secrets
                    .delete(&secret_account(&connection.id, suffix))
                {
                    log::warn!("Failed to remove unused connection credential: {error}");
                }
            }
        }
        crate::credential_cache::invalidate_all_for_connection(
            &state.credential_cache,
            &connection.id,
        );
        if let Some(database) = crate::models::single_db_before_multi_transition(
            &existing.params.database,
            &connection.params.database,
        ) {
            if let Err(error) = super::productivity::backfill_saved_queries_for_connection(
                runtime.paths.config_dir(),
                &connection.id,
                &database,
            ) {
                log::warn!("Failed to backfill saved query database: {error}");
            }
            if let Err(error) = super::productivity::backfill_query_history_for_connection(
                runtime.paths.config_dir(),
                &connection.id,
                &database,
            ) {
                log::warn!("Failed to backfill query history database: {error}");
            }
        }
        Ok(redact_connection(connection))
    })();
    if result.is_err() {
        writes.rollback(runtime);
    }
    result
}

fn delete_connection(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    id: &str,
) -> Result<(), String> {
    let mut file = load_file(runtime)?;
    let removed = file
        .connections
        .iter()
        .find(|connection| connection.id == id)
        .cloned();
    file.connections.retain(|connection| connection.id != id);
    save_file(runtime, state, &file)?;
    clean_up_deleted_connection(runtime, state, id, removed.as_ref());
    Ok(())
}

/// Removes what a deleted connection leaves outside the connections file. The
/// connection is already gone at this point, so failures are only logged.
fn clean_up_deleted_connection(
    runtime: &RuntimeContext,
    state: &ApplicationState,
    id: &str,
    removed: Option<&SavedConnection>,
) {
    if let Err(error) = delete_connection_secrets(runtime, id) {
        log::warn!("Failed to remove credentials of deleted connection {id}: {error}");
    }
    if let Some(removed) = removed {
        delete_plugin_secrets(runtime, removed);
    }
    crate::credential_cache::invalidate_all_for_connection(&state.credential_cache, id);
    if let Err(error) = crate::connection_appearance::cascade_delete_if_image(
        runtime.paths.data_dir(),
        removed.and_then(|connection| connection.appearance.as_ref()),
    ) {
        log::warn!("Failed to remove icon of deleted connection {id}: {error}");
    }
    if let Err(error) =
        super::productivity::remove_query_history_for_connection(runtime.paths.config_dir(), id)
    {
        log::warn!("Failed to remove query history of deleted connection {id}: {error}");
    }
}

fn duplicate_connection(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    id: &str,
) -> Result<SavedConnection, String> {
    let mut file = load_file(runtime)?;
    let mut original = find_connection(&file, id)?;
    let new_id = Uuid::new_v4().to_string();
    let mut writes = SecretWrites::default();
    let result = (|| {
        {
            for suffix in [
                DB_SECRET_SUFFIX,
                SSH_SECRET_SUFFIX,
                SSH_PASSPHRASE_SUFFIX,
                CONNECTION_URI_SUFFIX,
            ] {
                let should_copy = if suffix == CONNECTION_URI_SUFFIX {
                    original.params.connection_uri_in_keychain.unwrap_or(false)
                } else if suffix == DB_SECRET_SUFFIX
                    && original.params.use_iam_auth.unwrap_or(false)
                {
                    false
                } else {
                    original.params.save_in_keychain.unwrap_or(false)
                };
                if !should_copy {
                    continue;
                }
                if let Some(secret) = runtime.secrets.get(&secret_account(id, suffix))? {
                    writes.set(runtime, secret_account(&new_id, suffix), &secret)?;
                } else if suffix == CONNECTION_URI_SUFFIX {
                    original.params.connection_uri_in_keychain = None;
                }
            }
        }
        // A secret that can no longer be read is not copied, and the
        // duplicate does not list it.
        let plugin_secrets = load_plugin_secrets(runtime, &original);
        for (key, value) in &plugin_secrets {
            writes.set(
                runtime,
                plugin_secret_account(&new_id, &original.params.driver, key),
                value,
            )?;
        }
        let mut plugin_secret_keys: Vec<String> = plugin_secrets.into_keys().collect();
        plugin_secret_keys.sort();
        let appearance = duplicate_appearance(runtime.paths.data_dir(), &original, &new_id);
        let duplicate = SavedConnection {
            id: new_id,
            name: format!("{} (Copy)", original.name),
            params: original.params,
            plugin_secret_keys,
            group_id: original.group_id,
            sort_order: None,
            detect_json_in_text_columns: original.detect_json_in_text_columns,
            appearance,
            tag_ids: original.tag_ids,
            environment: validate_environment(original.environment).unwrap_or(None),
        };
        file.connections.push(duplicate.clone());
        save_file(runtime, state, &file)?;
        Ok(redact_connection(duplicate))
    })();
    if result.is_err() {
        writes.rollback(runtime);
    }
    result
}

fn duplicate_appearance(
    data_dir: &Path,
    original: &SavedConnection,
    new_id: &str,
) -> Option<ConnectionAppearance> {
    let mut appearance = original.appearance.clone()?;
    if let Some(crate::models::IconOverride::Image { path }) = appearance.icon.clone() {
        match crate::connection_appearance::copy_icon_for_duplicate(data_dir, &path, new_id) {
            Ok(path) => appearance.icon = Some(crate::models::IconOverride::Image { path }),
            Err(_) => appearance.icon = None,
        }
    }
    (appearance.icon.is_some() || appearance.accent_color.is_some()).then_some(appearance)
}

fn create_group(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    name: String,
    parent_id: Option<String>,
) -> Result<ConnectionGroup, String> {
    let mut file = load_file(runtime)?;
    validate_parent(&file, parent_id.as_deref())?;
    let sort_order = next_group_order(&file, &parent_id);
    let group = ConnectionGroup {
        id: Uuid::new_v4().to_string(),
        name,
        collapsed: false,
        sort_order,
        parent_id,
    };
    file.groups.push(group.clone());
    save_file(runtime, state, &file)?;
    Ok(group)
}

fn create_group_path(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    path: &str,
    parent_id: Option<String>,
) -> Result<ConnectionGroup, String> {
    let mut file = load_file(runtime)?;
    validate_parent(&file, parent_id.as_deref())?;
    let segments = crate::commands::parse_group_path(path)?;
    let mut current_parent = parent_id;
    let mut last = None;
    for name in segments {
        if let Some(existing) =
            crate::commands::find_child_group(&file.groups, &name, &current_parent).cloned()
        {
            current_parent = Some(existing.id.clone());
            last = Some(existing);
            continue;
        }
        let group = ConnectionGroup {
            id: Uuid::new_v4().to_string(),
            name,
            collapsed: false,
            sort_order: next_group_order(&file, &current_parent),
            parent_id: current_parent,
        };
        current_parent = Some(group.id.clone());
        last = Some(group.clone());
        file.groups.push(group);
    }
    save_file(runtime, state, &file)?;
    last.ok_or_else(|| "Group path resolved to an empty hierarchy".to_string())
}

fn validate_parent(file: &ConnectionsFile, parent_id: Option<&str>) -> Result<(), String> {
    if let Some(parent_id) = parent_id {
        if !file.groups.iter().any(|group| group.id == parent_id) {
            return Err(format!("Parent group with ID {parent_id} not found"));
        }
    }
    Ok(())
}

fn next_group_order(file: &ConnectionsFile, parent_id: &Option<String>) -> i32 {
    file.groups
        .iter()
        .filter(|group| group.parent_id == *parent_id)
        .map(|group| group.sort_order)
        .max()
        .unwrap_or(-1)
        + 1
}

fn update_group(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    id: &str,
    name: Option<String>,
    collapsed: Option<bool>,
    sort_order: Option<i32>,
) -> Result<ConnectionGroup, String> {
    let mut file = load_file(runtime)?;
    let group = file
        .groups
        .iter_mut()
        .find(|group| group.id == id)
        .ok_or_else(|| format!("Group with ID {id} not found"))?;
    if let Some(name) = name {
        group.name = name;
    }
    if let Some(collapsed) = collapsed {
        group.collapsed = collapsed;
    }
    if let Some(sort_order) = sort_order {
        group.sort_order = sort_order;
    }
    let updated = group.clone();
    save_file(runtime, state, &file)?;
    Ok(updated)
}

fn move_group(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    id: &str,
    parent_id: Option<String>,
) -> Result<ConnectionGroup, String> {
    let mut file = load_file(runtime)?;
    if !file.groups.iter().any(|group| group.id == id) {
        return Err(format!("Group with ID {id} not found"));
    }
    validate_parent(&file, parent_id.as_deref())?;
    crate::commands::reject_if_would_create_cycle(&file.groups, id, parent_id.as_deref())?;
    let group = file
        .groups
        .iter_mut()
        .find(|group| group.id == id)
        .expect("group existence checked above");
    group.parent_id = parent_id;
    let updated = group.clone();
    save_file(runtime, state, &file)?;
    Ok(updated)
}

fn delete_group(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    id: &str,
) -> Result<(), String> {
    let mut file = load_file(runtime)?;
    if !file.groups.iter().any(|group| group.id == id) {
        return Err(format!("Group with ID {id} not found"));
    }
    let deleted = crate::models::collect_group_subtree(&file.groups, id);
    file.groups.retain(|group| !deleted.contains(&group.id));
    let (removed, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut file.connections)
        .into_iter()
        .partition(|connection| {
            connection
                .group_id
                .as_ref()
                .is_some_and(|group_id| deleted.contains(group_id))
        });
    file.connections = kept;
    save_file(runtime, state, &file)?;
    for connection in &removed {
        clean_up_deleted_connection(runtime, state, &connection.id, Some(connection));
    }
    Ok(())
}

fn move_connection(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    connection_id: &str,
    group_id: Option<String>,
    sort_order: Option<i32>,
) -> Result<SavedConnection, String> {
    let mut file = load_file(runtime)?;
    validate_parent(&file, group_id.as_deref())?;
    let connection = file
        .connections
        .iter_mut()
        .find(|connection| connection.id == connection_id)
        .ok_or_else(|| format!("Connection with ID {connection_id} not found"))?;
    connection.group_id = group_id;
    if let Some(sort_order) = sort_order {
        connection.sort_order = Some(sort_order);
    }
    let updated = connection.clone();
    save_file(runtime, state, &file)?;
    Ok(redact_connection(updated))
}

fn reorder_groups(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    orders: Vec<(String, i32)>,
) -> Result<(), String> {
    let mut file = load_file(runtime)?;
    for (id, order) in orders {
        if let Some(group) = file.groups.iter_mut().find(|group| group.id == id) {
            group.sort_order = order;
        }
    }
    save_file(runtime, state, &file)
}

fn reorder_connections(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    orders: Vec<(String, i32)>,
) -> Result<(), String> {
    let mut file = load_file(runtime)?;
    for (id, order) in orders {
        if let Some(connection) = file
            .connections
            .iter_mut()
            .find(|connection| connection.id == id)
        {
            connection.sort_order = Some(order);
        }
    }
    save_file(runtime, state, &file)
}

async fn active_connections(state: &ApplicationState, session_id: Option<Uuid>) -> Vec<String> {
    let Some(session_id) = session_id else {
        return crate::health_check::active_connections().await;
    };
    state
        .web_active_connections
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(&session_id)
        .map(|connections| connections.iter().cloned().collect())
        .unwrap_or_default()
}

pub async fn register_active_connection(
    runtime: &RuntimeContext,
    state: Option<&ApplicationState>,
    session_id: Option<Uuid>,
    connection_id: String,
) {
    if let (Some(state), Some(session_id)) = (state, session_id) {
        state
            .web_active_connections
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .entry(session_id)
            .or_default()
            .insert(connection_id.clone());
    }
    crate::health_check::register_connection(connection_id).await;
    emit_active_connections(runtime, state, session_id).await;
}

async fn emit_active_connections(
    runtime: &RuntimeContext,
    state: Option<&ApplicationState>,
    session_id: Option<Uuid>,
) {
    let active = if let (Some(state), Some(session_id)) = (state, session_id) {
        active_connections(state, Some(session_id)).await
    } else {
        crate::health_check::active_connections().await
    };
    let payload = serde_json::to_value(active).unwrap_or(Value::Null);
    let _ = if let Some(session_id) = session_id {
        runtime
            .events
            .emit_to(session_id, "connections:active-changed", payload)
    } else {
        runtime.events.emit("connections:active-changed", payload)
    };
}

pub async fn disconnect_connection(
    runtime: &RuntimeContext,
    state: Option<&ApplicationState>,
    session_id: Option<Uuid>,
    connection_id: &str,
) -> Result<(), String> {
    super::query_sessions::release_connection(runtime, session_id, connection_id).await;
    let still_owned = if let (Some(state), Some(session_id)) = (state, session_id) {
        let mut sessions = state
            .web_active_connections
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(connections) = sessions.get_mut(&session_id) {
            connections.remove(connection_id);
            if connections.is_empty() {
                sessions.remove(&session_id);
            }
        }
        sessions
            .iter()
            .any(|(_, connections)| connections.contains(connection_id))
    } else {
        false
    };

    if !still_owned {
        crate::health_check::unregister_connection(connection_id).await;
        if let Ok(saved) = find_connection(&load_file(runtime)?, connection_id) {
            if let Some(driver) = crate::drivers::registry::get_driver(&saved.params.driver).await {
                driver
                    .invalidate_connection_metadata(Some(connection_id))
                    .await;
            }
        }
        let saved = find_connection(&load_file(runtime)?, connection_id)?;
        crate::pool_manager::close_pools_for_connection_id(&saved.params.driver, connection_id)
            .await;
    }
    emit_active_connections(runtime, state, session_id).await;
    Ok(())
}

/// Completes the connection form of the modal with what it omits: the saved
/// connection's secrets and the plugin secret changes. An id without a saved
/// connection is used as an ad-hoc connection.
fn prepare_connection_request(
    runtime: &RuntimeContext,
    request: &mut TestConnectionRequest,
) -> Result<(), String> {
    let iam_auth = request.params.use_iam_auth.unwrap_or(false);
    let mut stored_plugin_secrets = std::collections::HashMap::new();
    let file = load_file(runtime)?;
    let saved = match request.connection_id.as_deref() {
        Some(connection_id) => find_connection(&file, connection_id).ok(),
        None => None,
    };
    if let Some(saved) = saved {
        // Stored plugin secrets apply only while the driver is unchanged, and
        // only for keys the pending modal changes do not set or clear.
        if saved.params.driver == request.params.driver {
            stored_plugin_secrets = load_plugin_secrets(runtime, &saved);
            stored_plugin_secrets.retain(|key, _| !request.plugin_secret_changes.contains_key(key));
        }
        if request.params.credential_profile_id.is_none()
            && request.params.password.as_deref().is_none_or(str::is_empty)
            && !iam_auth
        {
            request.params.password = saved.params.password;
        }
        restore_secrets_for_connect(runtime, &saved.id, &mut request.params)?;
    }
    // A profile selected in the modal (saved or not) owns the login; resolve it
    // after the saved connection's secrets so it always wins.
    apply_credential_profile(runtime, &file, &mut request.params)?;
    crate::plugin_secrets::apply_runtime_changes(
        &mut request.params,
        stored_plugin_secrets,
        &request.plugin_secret_changes,
    )?;
    // Without a token the server only answers an opaque "Access denied".
    require_iam_token(iam_auth, request.params.password.as_deref())
}

async fn list_databases(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    mut request: TestConnectionRequest,
) -> Result<Vec<String>, String> {
    prepare_connection_request(runtime, &mut request)?;
    let mut expanded =
        crate::application::tunnels::expand_connection_params(runtime, &request.params)?;
    expanded.connection_id = request.connection_id;
    let runtime_for_tunnel = runtime.clone();
    let resolved = tokio::task::spawn_blocking(move || {
        crate::application::tunnels::resolve_connection_params(
            &runtime_for_tunnel,
            &expanded,
            session_id,
        )
    })
    .await
    .map_err(|error| error.to_string())??;
    let driver = crate::drivers::registry::get_driver(&resolved.driver)
        .await
        .ok_or_else(|| format!("Driver not found: {}", resolved.driver))?;
    driver.get_databases(&resolved).await
}

async fn test_connection(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    mut request: TestConnectionRequest,
) -> Result<String, String> {
    let progress_id = request.progress_id.clone();
    prepare_connection_request(runtime, &mut request).map_err(|error| {
        emit_test_failure(
            runtime,
            session_id,
            progress_id.as_deref(),
            "resolve",
            error,
        )
    })?;

    let expanded = crate::application::tunnels::expand_connection_params(runtime, &request.params)
        .map_err(|error| {
            emit_test_failure(
                runtime,
                session_id,
                progress_id.as_deref(),
                "resolve",
                error,
            )
        })?;
    let tunnel_step = if expanded.ssh_enabled.unwrap_or(false) {
        Some("sshTunnel")
    } else if expanded.k8s_enabled.unwrap_or(false) {
        Some("k8sForward")
    } else if expanded.ssm_enabled.unwrap_or(false) {
        Some("ssmForward")
    } else {
        None
    };
    if let Some(step) = tunnel_step {
        emit_test_progress(
            runtime,
            session_id,
            progress_id.as_deref(),
            step,
            "start",
            if step == "sshTunnel" {
                Some(format!(
                    "{}@{}:{}",
                    expanded.ssh_user.as_deref().unwrap_or("?"),
                    expanded.ssh_host.as_deref().unwrap_or("?"),
                    expanded.ssh_port.unwrap_or(22),
                ))
            } else if step == "ssmForward" {
                expanded.ssm_target.clone()
            } else {
                expanded.k8s_resource_name.clone()
            },
        );
    }

    let runtime_for_tunnel = runtime.clone();
    let mut expanded_for_tunnel = expanded.clone();
    // Per-connection proxy overrides are keyed by id, so set it before resolving.
    if let Some(connection_id) = request.connection_id.as_deref() {
        expanded_for_tunnel.connection_id = Some(connection_id.to_string());
    }
    let resolved = tokio::task::spawn_blocking(move || {
        crate::application::tunnels::resolve_connection_params(
            &runtime_for_tunnel,
            &expanded_for_tunnel,
            session_id,
        )
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| {
        emit_test_failure(
            runtime,
            session_id,
            progress_id.as_deref(),
            tunnel_step.unwrap_or("resolve"),
            error,
        )
    })?;
    if let Some(step) = tunnel_step {
        emit_test_progress(
            runtime,
            session_id,
            progress_id.as_deref(),
            step,
            "ok",
            resolved.port.map(|port| format!("127.0.0.1:{port}")),
        );
    }

    let driver = crate::drivers::registry::get_driver(&resolved.driver)
        .await
        .ok_or_else(|| {
            emit_test_failure(
                runtime,
                session_id,
                progress_id.as_deref(),
                "resolve",
                format!("Driver not found: {}", resolved.driver),
            )
        })?;
    let db_target = match (expanded.host.as_deref(), expanded.port) {
        (Some(host), Some(port)) => format!("{host}:{port}"),
        (Some(host), None) => host.to_string(),
        _ => expanded.database.to_string(),
    };
    emit_test_progress(
        runtime,
        session_id,
        progress_id.as_deref(),
        "dbConnect",
        "start",
        Some(db_target),
    );
    let capabilities = &driver.manifest().capabilities;
    if capabilities.file_based
        && crate::fs_path::requires_existing_database_file(
            capabilities.in_memory,
            resolved.database.primary(),
        )
    {
        let path = if resolved.driver == "sqlite" {
            crate::sqlite_database::expand_sqlite_filename(resolved.database.primary())
        } else {
            PathBuf::from(resolved.database.primary())
        };
        if !path.exists() {
            return Err(emit_test_failure(
                runtime,
                session_id,
                progress_id.as_deref(),
                "dbConnect",
                format!("Database file not found: {}", resolved.database),
            ));
        }
    }
    driver.test_connection(&resolved).await.map_err(|error| {
        emit_test_failure(
            runtime,
            session_id,
            progress_id.as_deref(),
            "dbConnect",
            error,
        )
    })?;
    driver
        .invalidate_connection_metadata(resolved.connection_id.as_deref())
        .await;
    emit_test_progress(
        runtime,
        session_id,
        progress_id.as_deref(),
        "dbConnect",
        "ok",
        None,
    );
    Ok("Connection successful!".to_string())
}

fn emit_test_progress(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    progress_id: Option<&str>,
    step: &str,
    status: &str,
    detail: Option<String>,
) {
    let Some(id) = progress_id else {
        return;
    };
    let payload = serde_json::json!({
        "id": id,
        "step": step,
        "status": status,
        "detail": detail,
    });
    let _ = match session_id {
        Some(session_id) => runtime
            .events
            .emit_to(session_id, "connection-test-progress", payload),
        None => runtime.events.emit("connection-test-progress", payload),
    };
}

fn emit_test_failure(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    progress_id: Option<&str>,
    step: &str,
    error: String,
) -> String {
    emit_test_progress(
        runtime,
        session_id,
        progress_id,
        step,
        "error",
        Some(error.clone()),
    );
    error
}

fn upload_directory(data_dir: &Path, session_id: Uuid) -> PathBuf {
    data_dir
        .join("web-uploads")
        .join("connection-icons")
        .join(session_id.to_string())
}

fn consume_icon_upload(
    runtime: &RuntimeContext,
    session_id: Uuid,
    token: &str,
) -> Result<PathBuf, String> {
    let token = Uuid::parse_str(token).map_err(|_| "Invalid icon upload token".to_string())?;
    let path = upload_directory(runtime.paths.data_dir(), session_id).join(token.to_string());
    let metadata = fs::metadata(&path).map_err(|_| "Icon upload token not found".to_string())?;
    let modified = metadata.modified().map_err(|error| error.to_string())?;
    let age = SystemTime::now()
        .duration_since(modified)
        .unwrap_or(Duration::ZERO);
    if age > ICON_UPLOAD_TTL {
        let _ = fs::remove_file(&path);
        return Err("Icon upload token expired".to_string());
    }
    if !metadata.is_file() {
        return Err("Icon upload token is invalid".to_string());
    }
    Ok(path)
}

fn delete_icon(data_dir: &Path, relative_path: &str) -> Result<(), String> {
    let path = match resolve_icon_asset(data_dir, relative_path) {
        Ok(path) => path,
        Err(error) if error == "Connection icon not found" => return Ok(()),
        Err(error) => return Err(error),
    };
    fs::remove_file(path).map_err(|error| error.to_string())
}

fn json(value: impl Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "connections_tests.rs"]
mod tests;

pub async fn set_selected_databases(
    runtime: &RuntimeContext,
    connection_id: &str,
    mut databases: Vec<String>,
) -> Result<(), String> {
    if databases.is_empty() {
        return Err("Database selection cannot be empty".to_string());
    }
    if databases.iter().any(|db| db.trim().is_empty()) {
        return Err("Database names cannot be empty".to_string());
    }
    let mut file = load_file(runtime)?;
    let connection = file
        .connections
        .iter_mut()
        .find(|connection| connection.id == connection_id)
        .ok_or("Connection not found")?;
    let is_schema_based = crate::drivers::registry::get_driver(&connection.params.driver)
        .await
        .map(|driver| driver.manifest().capabilities.schemas)
        .unwrap_or(false);
    connection.params.database = if databases.len() == 1 && !is_schema_based {
        crate::models::DatabaseSelection::Single(databases.remove(0))
    } else {
        crate::models::DatabaseSelection::Multiple(databases)
    };
    crate::persistence::save_connections_file(&runtime.paths.connections_file(), &file)
}
