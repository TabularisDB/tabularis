use crate::models::{
    ConnectionAppearance, ConnectionGroup, ConnectionParams, ConnectionsFile, SavedConnection,
    TestConnectionRequest,
};
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
    GetConnections,
    GetConnectionById {
        id: String,
    },
    GetConnectionsWithGroups,
    SaveConnection {
        name: String,
        params: ConnectionParams,
        detect_json_in_text_columns: Option<bool>,
        environment: Option<String>,
    },
    UpdateConnection {
        id: String,
        name: String,
        params: ConnectionParams,
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
}

pub async fn execute(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    command: ConnectionCommand,
) -> Result<Value, String> {
    match command {
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
            detect_json_in_text_columns,
            environment,
        } => json(save_connection(
            runtime,
            state,
            name,
            params,
            detect_json_in_text_columns,
            environment,
        )?),
        ConnectionCommand::UpdateConnection {
            id,
            name,
            params,
            detect_json_in_text_columns,
            environment,
        } => json(update_connection(
            runtime,
            state,
            id,
            name,
            params,
            detect_json_in_text_columns,
            environment,
        )?),
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
        ConnectionCommand::GetRegisteredDrivers => {
            json(crate::drivers::registry::list_drivers().await)
        }
        ConnectionCommand::GetDriverManifest { driver_id } => {
            let manifest = crate::drivers::registry::get_driver(&driver_id)
                .await
                .map(|driver| driver.manifest().clone());
            json(manifest)
        }
        ConnectionCommand::GetActiveConnections => {
            json(crate::health_check::active_connections().await)
        }
        ConnectionCommand::RegisterActiveConnection { connection_id } => {
            crate::health_check::register_connection(connection_id).await;
            emit_active_connections(runtime).await;
            Ok(Value::Null)
        }
        ConnectionCommand::DisconnectConnection { connection_id } => {
            disconnect_connection(runtime, &connection_id).await?;
            emit_active_connections(runtime).await;
            Ok(Value::Null)
        }
        ConnectionCommand::TestConnection { request } => {
            json(test_connection(runtime, request).await?)
        }
    }
}

pub fn load_connections(path: &Path) -> Result<Vec<SavedConnection>, String> {
    crate::persistence::load_connections(path)
}

pub fn load_redacted_connections(path: &Path) -> Result<Vec<SavedConnection>, String> {
    load_connections(path).map(redacted_connections)
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

fn secret_account(connection_id: &str, suffix: &str) -> String {
    format!("{connection_id}:{suffix}")
}

fn non_empty(value: Option<&String>) -> Option<&str> {
    value.map(String::as_str).filter(|value| !value.is_empty())
}

fn persist_secrets_for_create(
    runtime: &RuntimeContext,
    id: &str,
    params: &mut ConnectionParams,
) -> Result<(), String> {
    if let Some(uri) = non_empty(params.connection_uri.as_ref()) {
        if !params.save_in_keychain.unwrap_or(false) {
            return Err("Connection URIs must be stored in the OS keychain".to_string());
        }
        runtime
            .secrets
            .set(&secret_account(id, CONNECTION_URI_SUFFIX), uri)?;
        params.connection_uri_in_keychain = Some(true);
        params.connection_uri = None;
    }
    if !params.save_in_keychain.unwrap_or(false) {
        return Ok(());
    }
    set_optional_secret(runtime, id, DB_SECRET_SUFFIX, params.password.as_ref())?;
    set_optional_secret(runtime, id, SSH_SECRET_SUFFIX, params.ssh_password.as_ref())?;
    set_optional_secret(
        runtime,
        id,
        SSH_PASSPHRASE_SUFFIX,
        params.ssh_key_passphrase.as_ref(),
    )?;
    params.password = None;
    params.ssh_password = None;
    params.ssh_key_passphrase = None;
    Ok(())
}

fn merge_and_persist_update_secrets(
    runtime: &RuntimeContext,
    id: &str,
    existing: &ConnectionParams,
    params: &mut ConnectionParams,
) -> Result<(), String> {
    let keychain = params.save_in_keychain.unwrap_or(false);
    if let Some(uri) = non_empty(params.connection_uri.as_ref()) {
        if !keychain {
            return Err("Connection URIs must be stored in the OS keychain".to_string());
        }
        runtime
            .secrets
            .set(&secret_account(id, CONNECTION_URI_SUFFIX), uri)?;
        params.connection_uri_in_keychain = Some(true);
    } else if keychain && existing.connection_uri_in_keychain.unwrap_or(false) {
        params.connection_uri_in_keychain = Some(true);
    } else {
        runtime
            .secrets
            .delete(&secret_account(id, CONNECTION_URI_SUFFIX))?;
        params.connection_uri_in_keychain = None;
    }
    params.connection_uri = None;

    if keychain {
        set_optional_secret(runtime, id, DB_SECRET_SUFFIX, params.password.as_ref())?;
        set_optional_secret(runtime, id, SSH_SECRET_SUFFIX, params.ssh_password.as_ref())?;
        set_optional_secret(
            runtime,
            id,
            SSH_PASSPHRASE_SUFFIX,
            params.ssh_key_passphrase.as_ref(),
        )?;
        params.password = None;
        params.ssh_password = None;
        params.ssh_key_passphrase = None;
    } else {
        if non_empty(params.password.as_ref()).is_none() {
            params.password = existing.password.clone();
        }
        if non_empty(params.ssh_password.as_ref()).is_none() {
            params.ssh_password = existing.ssh_password.clone();
        }
        if non_empty(params.ssh_key_passphrase.as_ref()).is_none() {
            params.ssh_key_passphrase = existing.ssh_key_passphrase.clone();
        }
        delete_connection_secrets(runtime, id)?;
    }
    Ok(())
}

fn set_optional_secret(
    runtime: &RuntimeContext,
    id: &str,
    suffix: &str,
    value: Option<&String>,
) -> Result<(), String> {
    if let Some(value) = non_empty(value) {
        runtime.secrets.set(&secret_account(id, suffix), value)?;
    }
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

fn restore_secrets(
    runtime: &RuntimeContext,
    id: &str,
    params: &mut ConnectionParams,
) -> Result<(), String> {
    if params.save_in_keychain.unwrap_or(false) {
        if params.password.as_deref().is_none_or(str::is_empty) {
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

fn save_connection(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    name: String,
    mut params: ConnectionParams,
    detect_json_in_text_columns: Option<bool>,
    environment: Option<String>,
) -> Result<SavedConnection, String> {
    let mut file = load_file(runtime)?;
    let id = Uuid::new_v4().to_string();
    params.connection_id = None;
    persist_secrets_for_create(runtime, &id, &mut params)?;
    let connection = SavedConnection {
        id,
        name,
        params,
        group_id: None,
        sort_order: None,
        detect_json_in_text_columns,
        appearance: None,
        tag_ids: None,
        environment: validate_environment(environment)?,
    };
    file.connections.push(connection.clone());
    save_file(runtime, state, &file)?;
    Ok(redact_connection(connection))
}

fn update_connection(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    id: String,
    name: String,
    mut params: ConnectionParams,
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
    params.connection_id = None;
    merge_and_persist_update_secrets(runtime, &id, &existing.params, &mut params)?;
    let connection = SavedConnection {
        id,
        name,
        params,
        group_id: existing.group_id,
        sort_order: existing.sort_order,
        detect_json_in_text_columns,
        appearance: existing.appearance,
        tag_ids: existing.tag_ids,
        environment: validate_environment(environment)?,
    };
    file.connections[index] = connection.clone();
    save_file(runtime, state, &file)?;
    Ok(redact_connection(connection))
}

fn delete_connection(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    id: &str,
) -> Result<(), String> {
    let mut file = load_file(runtime)?;
    let appearance = file
        .connections
        .iter()
        .find(|connection| connection.id == id)
        .and_then(|connection| connection.appearance.clone());
    file.connections.retain(|connection| connection.id != id);
    delete_connection_secrets(runtime, id)?;
    crate::credential_cache::invalidate_all_for_connection(&state.credential_cache, id);
    save_file(runtime, state, &file)?;
    crate::connection_appearance::cascade_delete_if_image(
        runtime.paths.data_dir(),
        appearance.as_ref(),
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn duplicate_connection(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    id: &str,
) -> Result<SavedConnection, String> {
    let mut file = load_file(runtime)?;
    let original = find_connection(&file, id)?;
    let new_id = Uuid::new_v4().to_string();
    if original.params.save_in_keychain.unwrap_or(false) {
        for suffix in [
            DB_SECRET_SUFFIX,
            SSH_SECRET_SUFFIX,
            SSH_PASSPHRASE_SUFFIX,
            CONNECTION_URI_SUFFIX,
        ] {
            if let Some(secret) = runtime.secrets.get(&secret_account(id, suffix))? {
                runtime
                    .secrets
                    .set(&secret_account(&new_id, suffix), &secret)?;
            }
        }
    }
    let appearance = duplicate_appearance(runtime.paths.data_dir(), &original, &new_id);
    let duplicate = SavedConnection {
        id: new_id,
        name: format!("{} (Copy)", original.name),
        params: original.params,
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
    file.connections.retain(|connection| {
        !connection
            .group_id
            .as_ref()
            .is_some_and(|group_id| deleted.contains(group_id))
    });
    save_file(runtime, state, &file)
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

async fn emit_active_connections(runtime: &RuntimeContext) {
    let active = crate::health_check::active_connections().await;
    let _ = runtime.events.emit(
        "connections:active-changed",
        serde_json::to_value(active).unwrap_or(Value::Null),
    );
}

async fn disconnect_connection(
    runtime: &RuntimeContext,
    connection_id: &str,
) -> Result<(), String> {
    crate::health_check::unregister_connection(connection_id).await;
    let mut connection = find_connection(&load_file(runtime)?, connection_id)?;
    if connection.params.ssh_enabled.unwrap_or(false)
        || connection.params.k8s_enabled.unwrap_or(false)
    {
        return Err("Tunnel-backed web connections are migrated in WEB-051".to_string());
    }
    restore_secrets(runtime, connection_id, &mut connection.params)?;
    let params =
        crate::commands::resolve_connection_params_with_id(&connection.params, connection_id)?;
    crate::pool_manager::close_pool_with_id(&params, Some(connection_id)).await;
    Ok(())
}

async fn test_connection(
    runtime: &RuntimeContext,
    mut request: TestConnectionRequest,
) -> Result<String, String> {
    let progress_id = request.progress_id.clone();
    if request.params.ssh_enabled.unwrap_or(false)
        || request.params.k8s_enabled.unwrap_or(false)
        || request.params.ssh_connection_id.is_some()
        || request.params.k8s_connection_id.is_some()
    {
        return Err(emit_test_failure(
            runtime,
            progress_id.as_deref(),
            "resolve",
            "Tunnel-backed web connections are migrated in WEB-051".to_string(),
        ));
    }
    if let Some(connection_id) = request.connection_id.as_deref() {
        let saved = find_connection(&load_file(runtime)?, connection_id)?;
        if request.params.password.as_deref().is_none_or(str::is_empty) {
            request.params.password = saved.params.password;
        }
        restore_secrets(runtime, connection_id, &mut request.params)?;
    }
    let resolved = match request.connection_id.as_deref() {
        Some(connection_id) => {
            crate::commands::resolve_connection_params_with_id(&request.params, connection_id)
        }
        None => crate::commands::resolve_connection_params(&request.params),
    }
    .map_err(|error| emit_test_failure(runtime, progress_id.as_deref(), "resolve", error))?;
    let driver = crate::drivers::registry::get_driver(&resolved.driver)
        .await
        .ok_or_else(|| format!("Driver not found: {}", resolved.driver))?;
    emit_test_progress(
        runtime,
        progress_id.as_deref(),
        "dbConnect",
        "start",
        request.params.host.clone(),
    );
    if driver.manifest().capabilities.file_based {
        let path = if resolved.driver == "sqlite" {
            crate::sqlite_database::expand_sqlite_filename(resolved.database.primary())
        } else {
            PathBuf::from(resolved.database.primary())
        };
        if !path.exists() {
            return Err(emit_test_failure(
                runtime,
                progress_id.as_deref(),
                "dbConnect",
                format!("Database file not found: {}", resolved.database),
            ));
        }
    }
    driver
        .test_connection(&resolved)
        .await
        .map_err(|error| emit_test_failure(runtime, progress_id.as_deref(), "dbConnect", error))?;
    emit_test_progress(runtime, progress_id.as_deref(), "dbConnect", "ok", None);
    Ok("Connection successful!".to_string())
}

fn emit_test_progress(
    runtime: &RuntimeContext,
    progress_id: Option<&str>,
    step: &str,
    status: &str,
    detail: Option<String>,
) {
    let Some(id) = progress_id else {
        return;
    };
    let _ = runtime.events.emit(
        "connection-test-progress",
        serde_json::json!({
            "id": id,
            "step": step,
            "status": status,
            "detail": detail,
        }),
    );
}

fn emit_test_failure(
    runtime: &RuntimeContext,
    progress_id: Option<&str>,
    step: &str,
    error: String,
) -> String {
    emit_test_progress(runtime, progress_id, step, "error", Some(error.clone()));
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
