use super::file_transfers::FileTransferStore;
use crate::connection_import::{
    all_importers, analyzer, convert, expand_home, importer_by_id, tabularis, ImportEnvelope,
};
use crate::models::{ExportPayload, K8sConnection, SavedConnection, SshConnection};
use crate::runtime::{state::ApplicationState, RuntimeContext};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

pub const CONNECTION_IMPORT_PURPOSE: &str = "connection-import";
const JSON_MIME_TYPE: &str = "application/json";
const EXPORT_FILE_NAME: &str = "tabularis-connections.json";
const MAX_CONNECTION_IMPORT_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionFilesCommand {
    Export {
        mode: ConnectionExportMode,
        password: Option<String>,
        connection_ids: Option<Vec<String>>,
    },
    ListImportSources,
    PreviewForeignImport {
        source_id: String,
        include_passwords: bool,
        file: Option<ConnectionImportFile>,
    },
    ApplyForeignImport {
        source_id: String,
        resolutions: Vec<convert::ImportResolution>,
    },
    PreviewTabularisImport {
        file: ConnectionImportFile,
        password: Option<String>,
    },
    ApplyPreparedTabularisImport {
        resolutions: Vec<convert::ImportResolution>,
    },
    GetBackupStatus,
    GetDatabaseBackupStatus,
    RunDatabaseBackup,
    CancelDatabaseBackup,
    SetBackupPassword {
        password: String,
    },
    SetBackupTargetPassword {
        target_id: String,
        password: String,
    },
    RunBackup,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionExportMode {
    Encrypted,
    NoSecrets,
    Plaintext,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConnectionImportFile {
    ServerPath { path: String },
    Upload { token: String },
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GeneratedFile {
    Inline {
        file_name: String,
        mime_type: String,
        contents: String,
    },
    Download {
        file_name: String,
        mime_type: String,
        token: String,
        size: u64,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRunResult {
    pub server_location: String,
    pub target_kind: crate::backup::BackupTargetKind,
    pub download: Option<GeneratedFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSourceInfo {
    pub id: String,
    pub display_name: String,
    pub available: bool,
    pub connection_count: usize,
    pub reads_passwords_from_keychain: bool,
    pub needs_file: bool,
    pub manual_path_supported: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TabularisImportPreviewResult {
    PasswordRequired,
    Preview { preview: analyzer::ImportPreview },
}

#[derive(Default)]
pub struct ImportEnvelopeCache {
    foreign: Mutex<HashMap<(Option<Uuid>, String), ImportEnvelope>>,
    tabularis: Mutex<HashMap<Option<Uuid>, ExportPayload>>,
}

impl ImportEnvelopeCache {
    pub fn clear_session(&self, session_id: Uuid) {
        self.foreign
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .retain(|(owner, _), _| *owner != Some(session_id));
        self.tabularis
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&Some(session_id));
    }
}

pub async fn execute(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    session_id: Option<Uuid>,
    command: ConnectionFilesCommand,
) -> Result<Value, String> {
    match command {
        ConnectionFilesCommand::Export {
            mode,
            password,
            connection_ids,
        } => json(generate_export_file(runtime, session_id, mode, password, connection_ids).await?),
        ConnectionFilesCommand::ListImportSources => json(list_import_sources().await?),
        ConnectionFilesCommand::PreviewForeignImport {
            source_id,
            include_passwords,
            file,
        } => json(
            preview_foreign_import(
                runtime,
                &state.import_envelope_cache,
                session_id,
                source_id,
                include_passwords,
                file,
            )
            .await?,
        ),
        ConnectionFilesCommand::ApplyForeignImport {
            source_id,
            resolutions,
        } => {
            apply_foreign_import(
                runtime,
                &state.connection_cache,
                &state.credential_cache,
                &state.import_envelope_cache,
                session_id,
                source_id,
                resolutions,
            )
            .await?;
            Ok(Value::Null)
        }
        ConnectionFilesCommand::PreviewTabularisImport { file, password } => json(
            preview_tabularis_import_file(
                runtime,
                &state.import_envelope_cache,
                session_id,
                file,
                password,
            )
            .await?,
        ),
        ConnectionFilesCommand::ApplyPreparedTabularisImport { resolutions } => {
            apply_prepared_tabularis_import(
                runtime,
                &state.connection_cache,
                &state.credential_cache,
                &state.import_envelope_cache,
                session_id,
                resolutions,
            )
            .await?;
            Ok(Value::Null)
        }
        ConnectionFilesCommand::GetDatabaseBackupStatus => json(crate::database_backup::get_database_backup_status(runtime).await?),
        ConnectionFilesCommand::RunDatabaseBackup => json(crate::database_backup::run_database_backup_now(runtime, &state.dump_cancellation).await?),
        ConnectionFilesCommand::CancelDatabaseBackup => {
            crate::database_backup::cancel_database_backup(&state.dump_cancellation).await?;
            Ok(Value::Null)
        }
        ConnectionFilesCommand::GetBackupStatus => {
            json(crate::backup::backup_status(runtime).await?)
        }
        ConnectionFilesCommand::SetBackupPassword { password } => {
            crate::backup::set_backup_password(runtime, &password)?;
            Ok(Value::Null)
        }
        ConnectionFilesCommand::SetBackupTargetPassword {
            target_id,
            password,
        } => {
            crate::backup::set_backup_target_password(runtime, &target_id, &password)?;
            Ok(Value::Null)
        }
        ConnectionFilesCommand::RunBackup => {
            let artifact = crate::backup::run_backup_for_runtime(runtime, "manual").await?;
            let download = if let Some(session_id) = session_id {
                Some(
                    store_download(runtime, session_id, &artifact.file_name, artifact.content)
                        .await?,
                )
            } else {
                None
            };
            json(BackupRunResult {
                server_location: artifact.location,
                target_kind: artifact.target_kind,
                download,
            })
        }
    }
}

pub async fn generate_export_file(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    mode: ConnectionExportMode,
    password: Option<String>,
    connection_ids: Option<Vec<String>>,
) -> Result<GeneratedFile, String> {
    if session_id.is_some() && matches!(mode, ConnectionExportMode::Plaintext) {
        return Err("Plaintext connection exports are not available in the browser".to_string());
    }
    let include_secrets = !matches!(mode, ConnectionExportMode::NoSecrets);
    let payload = export_payload(runtime, include_secrets, connection_ids).await?;
    let contents = match mode {
        ConnectionExportMode::Encrypted => {
            let password = password.filter(|value| !value.is_empty()).ok_or_else(|| {
                "A password is required for encrypted connection exports".to_string()
            })?;
            let plaintext = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
            let envelope = crate::export_crypto::encrypt(&plaintext, &password)?;
            serde_json::to_string_pretty(&envelope).map_err(|error| error.to_string())?
        }
        ConnectionExportMode::NoSecrets | ConnectionExportMode::Plaintext => {
            serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?
        }
    };
    match session_id {
        Some(session_id) => store_download(runtime, session_id, EXPORT_FILE_NAME, contents).await,
        None => Ok(GeneratedFile::Inline {
            file_name: EXPORT_FILE_NAME.to_string(),
            mime_type: JSON_MIME_TYPE.to_string(),
            contents,
        }),
    }
}

pub async fn export_payload(
    runtime: &RuntimeContext,
    include_secrets: bool,
    connection_ids: Option<Vec<String>>,
) -> Result<ExportPayload, String> {
    let mut file = crate::persistence::load_connections_file(&runtime.paths.connections_file())?;
    let mut ssh_connections =
        crate::application::tunnels::get_ssh_connections(runtime, include_secrets)?;
    let mut k8s_connections = crate::application::tunnels::get_k8s_connections(runtime)?;

    if let Some(ids) = connection_ids.as_ref() {
        let selected: HashSet<&str> = ids.iter().map(String::as_str).collect();
        file.connections
            .retain(|connection| selected.contains(connection.id.as_str()));
        ssh_connections.retain(|connection| selected.contains(connection.id.as_str()));
        k8s_connections.retain(|connection| selected.contains(connection.id.as_str()));
        let kept_groups = crate::models::collect_group_ancestors(
            &file.groups,
            file.connections
                .iter()
                .filter_map(|connection| connection.group_id.as_deref()),
        );
        file.groups.retain(|group| kept_groups.contains(&group.id));
        let kept_tags: HashSet<String> = file
            .connections
            .iter()
            .flat_map(|connection| connection.tag_ids.iter().flatten())
            .cloned()
            .collect();
        file.tags.retain(|tag| kept_tags.contains(&tag.id));
        let kept_profiles: HashSet<String> = file
            .connections
            .iter()
            .filter_map(|connection| connection.params.credential_profile_id.clone())
            .collect();
        file.credential_profiles
            .retain(|profile| kept_profiles.contains(&profile.id));
    }

    let mut plugin_secrets = HashMap::new();
    let mut credential_profile_secrets = HashMap::new();
    for connection in &mut file.connections {
        if include_secrets {
            // A missing keychain entry must not abort the whole export (or a
            // scheduled backup): the connection is exported without that value.
            let values =
                crate::application::connections::load_plugin_secrets(runtime, connection);
            if !values.is_empty() {
                plugin_secrets.insert(connection.id.clone(), values);
            }
            crate::application::connections::restore_connection_secrets(
                runtime,
                &connection.id,
                &mut connection.params,
            )?;
            if let Some(profile_id) = connection.params.credential_profile_id.clone() {
                connection.params.password = None;
                if let std::collections::hash_map::Entry::Vacant(entry) =
                    credential_profile_secrets.entry(profile_id)
                {
                    if let Ok(Some(password)) = runtime.secrets.get(
                        &crate::application::connections::profile_db_secret_account(entry.key()),
                    ) {
                        if !password.is_empty() {
                            entry.insert(password);
                        }
                    }
                }
            }
        } else {
            connection.params.password = None;
            connection.params.connection_uri = None;
            connection.params.ssh_password = None;
            connection.params.ssh_key_passphrase = None;
            connection.plugin_secret_keys.clear();
        }
    }

    Ok(ExportPayload {
        version: 1,
        groups: file.groups,
        connections: file.connections,
        ssh_connections,
        k8s_connections,
        tags: file.tags,
        credential_profiles: file.credential_profiles,
        credential_profile_secrets,
        plugin_secrets,
    })
}

pub async fn list_import_sources() -> Result<Vec<ImportSourceInfo>, String> {
    let mut sources = Vec::new();
    for importer in all_importers() {
        let available = importer.is_available().await;
        let connection_count = if available {
            importer.connection_count().await
        } else {
            0
        };
        sources.push(ImportSourceInfo {
            id: importer.id().to_string(),
            display_name: importer.display_name().to_string(),
            available,
            connection_count,
            reads_passwords_from_keychain: importer.reads_passwords_from_keychain(),
            needs_file: importer.import_file_types().is_some(),
            manual_path_supported: importer.supports_manual_path(),
        });
    }
    Ok(sources)
}

pub async fn preview_foreign_import(
    runtime: &RuntimeContext,
    cache: &ImportEnvelopeCache,
    session_id: Option<Uuid>,
    source_id: String,
    include_passwords: bool,
    file: Option<ConnectionImportFile>,
) -> Result<analyzer::ImportPreview, String> {
    let importer =
        importer_by_id(&source_id).ok_or_else(|| format!("Unknown import source: {source_id}"))?;
    let claimed = resolve_import_file(runtime, session_id, file)?;
    let path = claimed.as_ref().map(ResolvedImportFile::path);
    let envelope = importer
        .import(include_passwords, path)
        .await
        .map_err(|error| error.to_string())?;
    let preview = analyze_import(runtime, &envelope).await?;
    cache
        .foreign
        .lock()
        .map_err(|_| "Import cache poisoned".to_string())?
        .insert((session_id, source_id), envelope);
    Ok(preview)
}

pub async fn apply_foreign_import(
    runtime: &RuntimeContext,
    connection_cache: &crate::connection_cache::ConnectionCache,
    credential_cache: &crate::credential_cache::CredentialCache,
    cache: &ImportEnvelopeCache,
    session_id: Option<Uuid>,
    source_id: String,
    resolutions: Vec<convert::ImportResolution>,
) -> Result<(), String> {
    let envelope = cache
        .foreign
        .lock()
        .map_err(|_| "Import cache poisoned".to_string())?
        .remove(&(session_id, source_id))
        .ok_or_else(|| "No import preview found; run preview first".to_string())?;
    let registered_ids = registered_driver_ids().await;
    let existing_groups = load_file(runtime)?.groups;
    let payload =
        convert::build_payload(&envelope, &resolutions, &registered_ids, &existing_groups);
    apply_export_payload(runtime, connection_cache, credential_cache, payload).await
}

pub async fn preview_tabularis_import_file(
    runtime: &RuntimeContext,
    cache: &ImportEnvelopeCache,
    session_id: Option<Uuid>,
    file: ConnectionImportFile,
    password: Option<String>,
) -> Result<TabularisImportPreviewResult, String> {
    let (content, upload_to_consume) =
        read_tabularis_import_file(runtime, session_id, file).await?;
    let value: Value = serde_json::from_str(&content)
        .map_err(|error| format!("Invalid connection export: {error}"))?;
    let payload = if value.get("encrypted").and_then(Value::as_bool) == Some(true) {
        let Some(password) = password.filter(|value| !value.is_empty()) else {
            return Ok(TabularisImportPreviewResult::PasswordRequired);
        };
        let envelope = serde_json::from_value(value)
            .map_err(|error| format!("Invalid encrypted export: {error}"))?;
        let plaintext = crate::export_crypto::decrypt(&envelope, &password)?;
        serde_json::from_str(&plaintext)
            .map_err(|error| format!("Invalid export payload: {error}"))?
    } else {
        serde_json::from_value(value).map_err(|error| format!("Invalid export payload: {error}"))?
    };
    let preview = preview_tabularis_payload(runtime, &payload).await?;
    cache
        .tabularis
        .lock()
        .map_err(|_| "Import cache poisoned".to_string())?
        .insert(session_id, payload);
    if let Some((owner, token)) = upload_to_consume {
        FileTransferStore::new(runtime.paths.data_dir()).claim_upload(
            owner,
            &token,
            CONNECTION_IMPORT_PURPOSE,
        )?;
    }
    Ok(TabularisImportPreviewResult::Preview { preview })
}

pub async fn apply_prepared_tabularis_import(
    runtime: &RuntimeContext,
    connection_cache: &crate::connection_cache::ConnectionCache,
    credential_cache: &crate::credential_cache::CredentialCache,
    cache: &ImportEnvelopeCache,
    session_id: Option<Uuid>,
    resolutions: Vec<convert::ImportResolution>,
) -> Result<(), String> {
    let payload = cache
        .tabularis
        .lock()
        .map_err(|_| "Import cache poisoned".to_string())?
        .remove(&session_id)
        .ok_or_else(|| "No Tabularis import preview found; run preview first".to_string())?;
    let existing_groups = load_file(runtime)?.groups;
    let payload = tabularis::apply(&payload, &resolutions, &existing_groups);
    apply_export_payload(runtime, connection_cache, credential_cache, payload).await
}

pub async fn preview_tabularis_payload(
    runtime: &RuntimeContext,
    payload: &ExportPayload,
) -> Result<analyzer::ImportPreview, String> {
    let existing = load_file(runtime)?.connections;
    let registered_ids = registered_driver_ids().await;
    Ok(tabularis::preview(payload, &existing, &registered_ids))
}

pub async fn apply_export_payload(
    runtime: &RuntimeContext,
    connection_cache: &crate::connection_cache::ConnectionCache,
    credential_cache: &crate::credential_cache::CredentialCache,
    payload: ExportPayload,
) -> Result<(), String> {
    crate::persistence::with_connections_file_exclusive(|| {
        apply_export_payload_locked(runtime, connection_cache, credential_cache, payload)
    })
}

fn apply_export_payload_locked(
    runtime: &RuntimeContext,
    connection_cache: &crate::connection_cache::ConnectionCache,
    credential_cache: &crate::credential_cache::CredentialCache,
    mut payload: ExportPayload,
) -> Result<(), String> {
    let connections_path = runtime.paths.connections_file();
    let mut current =
        crate::persistence::read_connections_file(&connections_path).unwrap_or_default();
    let connections_snapshot = current.clone();
    let mut imported_plugin_secrets = std::mem::take(&mut payload.plugin_secrets);
    let imported_profile_secrets = std::mem::take(&mut payload.credential_profile_secrets);
    let mut plugin_secret_writes = Vec::new();
    let mut current_ssh: Vec<SshConnection> = load_json(&ssh_path(runtime))?;
    crate::commands::merge_groups(&mut current.groups, payload.groups);
    let tag_remap = crate::connection_tags::merge_imported_tags(&mut current.tags, payload.tags);
    for profile in payload.credential_profiles {
        crate::credential_profiles::validate_profile_keychain_namespace(&current, &profile.id)?;
        if let Some(existing) = current
            .credential_profiles
            .iter_mut()
            .find(|existing| existing.id == profile.id)
        {
            *existing = profile;
        } else {
            current.credential_profiles.push(profile);
        }
    }

    let mut stale_connection_db_deletes = Vec::new();
    let mut incoming = payload.connections;
    remap_tags(&mut current.connections, &mut incoming, &tag_remap);

    for mut connection in incoming {
        if let Some(profile_id) = connection.params.credential_profile_id.as_deref() {
            crate::credential_profiles::validate_connection_profile_link(
                &connection.id,
                profile_id,
            )?;
            connection.params.password = None;
        }
        connection.environment = normalize_environment(connection.environment.take());
        let declared_plugin_secret_keys = std::mem::take(&mut connection.plugin_secret_keys);
        let imported_values = imported_plugin_secrets
            .remove(&connection.id)
            .unwrap_or_default();
        let previous_plugin_metadata = current
            .connections
            .iter()
            .find(|existing| existing.id == connection.id)
            .map(|existing| {
                (
                    existing.params.driver.clone(),
                    existing.plugin_secret_keys.clone(),
                )
            });
        // Keychain writes are deferred until the connections file is saved,
        // so a failed import never leaves orphaned plugin secrets behind.
        plugin_secret_writes.extend(crate::plugin_secrets::plan_imported_secrets(
            &mut connection,
            &declared_plugin_secret_keys,
            imported_values,
            previous_plugin_metadata
                .as_ref()
                .map(|(driver, keys)| (driver.as_str(), keys.as_slice())),
        ));
        persist_imported_connection_secrets(
            runtime,
            credential_cache,
            &mut connection,
            &mut stale_connection_db_deletes,
        )?;
        if let Some(existing) = current
            .connections
            .iter_mut()
            .find(|existing| existing.id == connection.id)
        {
            *existing = connection;
        } else {
            current.connections.push(connection);
        }
    }

    for mut connection in payload.ssh_connections {
        persist_imported_ssh_secrets(runtime, credential_cache, &mut connection)?;
        if let Some(existing) = current_ssh
            .iter_mut()
            .find(|existing| existing.id == connection.id)
        {
            *existing = connection;
        } else {
            current_ssh.push(connection);
        }
    }

    crate::plugin_secrets::commit_secret_writes(
        &RuntimeSecretStore(runtime),
        credential_cache,
        plugin_secret_writes,
        || crate::persistence::write_connections_file(&connections_path, &current),
    )?;
    if let Err(error) = apply_imported_credential_profile_secrets(
        runtime,
        credential_cache,
        imported_profile_secrets,
        stale_connection_db_deletes,
    ) {
        // `with_connections_file_exclusive` keeps other writers out until restore
        // finishes, so this snapshot cannot overwrite a concurrent edit.
        if let Err(restore_error) =
            crate::persistence::write_connections_file(&connections_path, &connections_snapshot)
        {
            return Err(format!(
                "{error}. Failed to restore connections after credential profile import: {restore_error}"
            ));
        }
        connection_cache.invalidate();
        return Err(error);
    }
    save_json(&ssh_path(runtime), &current_ssh)?;
    let mut current_k8s: Vec<K8sConnection> = load_json(&k8s_path(runtime))?;
    for connection in payload.k8s_connections {
        if let Some(existing) = current_k8s
            .iter_mut()
            .find(|existing| existing.id == connection.id)
        {
            *existing = connection;
        } else {
            current_k8s.push(connection);
        }
    }
    save_json(&k8s_path(runtime), &current_k8s)?;
    connection_cache.invalidate();
    Ok(())
}

async fn store_download(
    runtime: &RuntimeContext,
    session_id: Uuid,
    file_name: &str,
    contents: String,
) -> Result<GeneratedFile, String> {
    let metadata = FileTransferStore::new(runtime.paths.data_dir())
        .store_download_bytes(
            session_id,
            "connection-export",
            file_name,
            Some(JSON_MIME_TYPE),
            contents.into_bytes(),
        )
        .await?;
    Ok(GeneratedFile::Download {
        file_name: metadata.file_name,
        mime_type: metadata.mime_type,
        token: metadata.token,
        size: metadata.size,
    })
}

async fn analyze_import(
    runtime: &RuntimeContext,
    envelope: &ImportEnvelope,
) -> Result<analyzer::ImportPreview, String> {
    let existing = load_file(runtime)?.connections;
    let registered_ids = registered_driver_ids().await;
    let file_exists = |path: &str| PathBuf::from(expand_home(path)).exists();
    Ok(analyzer::analyze(
        envelope,
        &existing,
        &registered_ids,
        &file_exists,
    ))
}

async fn registered_driver_ids() -> Vec<String> {
    crate::drivers::registry::list_drivers()
        .await
        .into_iter()
        .map(|manifest| manifest.id)
        .collect()
}

enum ResolvedImportFile {
    Server(PathBuf),
    Upload(super::file_transfers::ClaimedUpload),
}

impl ResolvedImportFile {
    fn path(&self) -> &Path {
        match self {
            Self::Server(path) => path,
            Self::Upload(upload) => upload.path(),
        }
    }
}

async fn read_tabularis_import_file(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    file: ConnectionImportFile,
) -> Result<(String, Option<(Uuid, String)>), String> {
    match file {
        ConnectionImportFile::ServerPath { path } if session_id.is_none() => {
            let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
            Ok((content, None))
        }
        ConnectionImportFile::ServerPath { .. } => {
            Err("Browser imports cannot reference server filesystem paths".to_string())
        }
        ConnectionImportFile::Upload { token } => {
            let owner = session_id
                .ok_or_else(|| "Upload tokens are only valid for browser sessions".to_string())?;
            let mut reader = FileTransferStore::new(runtime.paths.data_dir())
                .open_upload(owner, &token, CONNECTION_IMPORT_PURPOSE)
                .await?;
            if reader.metadata().size > MAX_CONNECTION_IMPORT_BYTES {
                return Err(format!(
                    "Connection import exceeds the {MAX_CONNECTION_IMPORT_BYTES} byte limit"
                ));
            }
            let mut content = String::new();
            tokio::io::AsyncReadExt::read_to_string(&mut reader, &mut content)
                .await
                .map_err(|error| format!("Failed to read connection import: {error}"))?;
            Ok((content, Some((owner, token))))
        }
    }
}

fn resolve_import_file(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    file: Option<ConnectionImportFile>,
) -> Result<Option<ResolvedImportFile>, String> {
    match file {
        None => Ok(None),
        Some(ConnectionImportFile::ServerPath { path }) if session_id.is_none() => {
            Ok(Some(ResolvedImportFile::Server(PathBuf::from(path))))
        }
        Some(ConnectionImportFile::ServerPath { .. }) => {
            Err("Browser imports cannot reference server filesystem paths".to_string())
        }
        Some(ConnectionImportFile::Upload { token }) => {
            let session_id = session_id
                .ok_or_else(|| "Upload tokens are only valid for browser sessions".to_string())?;
            let upload = FileTransferStore::new(runtime.paths.data_dir()).claim_upload(
                session_id,
                &token,
                CONNECTION_IMPORT_PURPOSE,
            )?;
            if upload.metadata().size > MAX_CONNECTION_IMPORT_BYTES {
                return Err(format!(
                    "Connection import exceeds the {MAX_CONNECTION_IMPORT_BYTES} byte limit"
                ));
            }
            Ok(Some(ResolvedImportFile::Upload(upload)))
        }
    }
}

struct RuntimeSecretStore<'a>(&'a RuntimeContext);

impl crate::plugin_secrets::SecretStore for RuntimeSecretStore<'_> {
    fn set(&self, connection_id: &str, driver: &str, key: &str, value: &str) -> Result<(), String> {
        let account = super::connections::plugin_secret_account(connection_id, driver, key);
        self.0.secrets.set(&account, value)
    }

    fn delete(&self, connection_id: &str, driver: &str, key: &str) -> Result<(), String> {
        let account = super::connections::plugin_secret_account(connection_id, driver, key);
        self.0.secrets.delete(&account)
    }
}

/// Applies imported credential-profile passwords after `connections.json` is saved.
///
/// Keychain updates are not transactional with the filesystem: on failure, prior
/// writes in this batch are rolled back via [`SecretWrites`] (best-effort; a
/// failed rollback is logged). The caller restores the pre-import
/// `connections.json` while [`with_connections_file_exclusive`] is held. A
/// failed restore is reported in the returned error. Manual edits or a broken
/// keychain rollback can still leave metadata and secrets misaligned.
fn apply_imported_credential_profile_secrets(
    runtime: &RuntimeContext,
    credential_cache: &crate::credential_cache::CredentialCache,
    profile_secrets: HashMap<String, String>,
    stale_connection_db_deletes: Vec<String>,
) -> Result<(), String> {
    use super::connections::{profile_db_secret_account, SecretWrites};

    let mut profile_ids: Vec<String> = profile_secrets.keys().cloned().collect();
    profile_ids.sort();
    let mut writes = SecretWrites::default();
    let result = (|| {
        for profile_id in profile_ids {
            let password = profile_secrets
                .get(&profile_id)
                .expect("profile id was collected from the same map");
            writes.set(runtime, profile_db_secret_account(&profile_id), password)?;
        }
        for connection_id in &stale_connection_db_deletes {
            if profile_secrets.keys().any(|profile_id| {
                crate::credential_profiles::connection_db_collides_with_profile_db(
                    connection_id,
                    profile_id,
                )
            }) {
                continue;
            }
            writes.delete(runtime, format!("{connection_id}:db"))?;
        }
        Ok(())
    })();
    if let Err(error) = result {
        writes.rollback(runtime);
        return Err(error);
    }
    for connection_id in stale_connection_db_deletes {
        crate::credential_cache::invalidate_db_password(credential_cache, &connection_id);
    }
    Ok(())
}

fn persist_imported_connection_secrets(
    runtime: &RuntimeContext,
    credential_cache: &crate::credential_cache::CredentialCache,
    connection: &mut SavedConnection,
    stale_connection_db_deletes: &mut Vec<String>,
) -> Result<(), String> {
    crate::credential_cache::invalidate_all_for_connection(credential_cache, &connection.id);
    let keychain = connection.params.save_in_keychain.unwrap_or(false);
    let imported_uri = connection
        .params
        .connection_uri
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    if let Some(uri) = imported_uri {
        if !keychain {
            return Err("Connection URIs must be stored in the OS keychain".to_string());
        }
        runtime
            .secrets
            .set(&format!("{}:connection_uri", connection.id), uri)?;
        crate::credential_cache::set_connection_uri_cached(credential_cache, &connection.id, uri);
        connection.params.connection_uri_in_keychain = Some(true);
    } else {
        connection.params.connection_uri_in_keychain = None;
    }
    if keychain {
        if let Some(profile_id) = connection.params.credential_profile_id.as_deref() {
            if !crate::credential_profiles::connection_db_collides_with_profile_db(
                &connection.id,
                profile_id,
            ) {
                stale_connection_db_deletes.push(connection.id.clone());
            }
        } else {
            set_imported_secret(
                runtime,
                credential_cache,
                &connection.id,
                "db",
                connection.params.password.as_deref(),
            )?;
        }
        set_imported_secret(
            runtime,
            credential_cache,
            &connection.id,
            "ssh",
            connection.params.ssh_password.as_deref(),
        )?;
        set_imported_secret(
            runtime,
            credential_cache,
            &connection.id,
            "ssh_passphrase",
            connection.params.ssh_key_passphrase.as_deref(),
        )?;
        connection.params.password = None;
        connection.params.ssh_password = None;
        connection.params.ssh_key_passphrase = None;
    }
    connection.params.connection_uri = None;
    connection.params.connection_id = None;
    Ok(())
}

fn persist_imported_ssh_secrets(
    runtime: &RuntimeContext,
    credential_cache: &crate::credential_cache::CredentialCache,
    connection: &mut SshConnection,
) -> Result<(), String> {
    crate::credential_cache::invalidate_all_for_connection(credential_cache, &connection.id);
    if connection.save_in_keychain.unwrap_or(false) {
        set_imported_secret(
            runtime,
            credential_cache,
            &connection.id,
            "ssh",
            connection.password.as_deref(),
        )?;
        set_imported_secret(
            runtime,
            credential_cache,
            &connection.id,
            "ssh_passphrase",
            connection.key_passphrase.as_deref(),
        )?;
        connection.password = None;
        connection.key_passphrase = None;
    }
    Ok(())
}

fn set_imported_secret(
    runtime: &RuntimeContext,
    credential_cache: &crate::credential_cache::CredentialCache,
    id: &str,
    suffix: &str,
    value: Option<&str>,
) -> Result<(), String> {
    if let Some(value) = value.filter(|value| !value.is_empty()) {
        runtime.secrets.set(&format!("{id}:{suffix}"), value)?;
        match suffix {
            "db" => crate::credential_cache::set_db_password_cached(credential_cache, id, value),
            "ssh" => crate::credential_cache::set_ssh_password_cached(credential_cache, id, value),
            "ssh_passphrase" => {
                crate::credential_cache::set_ssh_key_passphrase_cached(credential_cache, id, value)
            }
            _ => {}
        }
    }
    Ok(())
}

fn remap_tags(
    existing: &mut [SavedConnection],
    incoming: &mut [SavedConnection],
    remap: &HashMap<String, String>,
) {
    for connection in incoming.iter_mut().chain(existing.iter_mut()) {
        if let Some(tag_ids) = connection.tag_ids.as_mut() {
            let mut seen = HashSet::new();
            *tag_ids = tag_ids
                .iter()
                .map(|id| remap.get(id).unwrap_or(id).clone())
                .filter(|id| seen.insert(id.clone()))
                .collect();
        }
    }
}

fn normalize_environment(environment: Option<String>) -> Option<String> {
    match environment.as_deref() {
        Some("development" | "staging" | "production") => environment,
        _ => None,
    }
}

fn load_file(runtime: &RuntimeContext) -> Result<crate::models::ConnectionsFile, String> {
    crate::persistence::load_connections_file(&runtime.paths.connections_file())
}

fn ssh_path(runtime: &RuntimeContext) -> PathBuf {
    runtime.paths.config_dir().join("ssh_connections.json")
}

fn k8s_path(runtime: &RuntimeContext) -> PathBuf {
    runtime.paths.config_dir().join("k8s_connections.json")
}

fn load_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Vec<T>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&fs::read_to_string(path).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

fn save_json(path: &Path, values: &[impl Serialize]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    crate::persistence::write_private_file(
        path,
        serde_json::to_string_pretty(values).map_err(|error| error.to_string())?,
    )
}

fn json(value: impl Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "connection_files_tests.rs"]
mod tests;
