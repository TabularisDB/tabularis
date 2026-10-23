//! Browser RPC routes for theme packages, host settings, SQL files and the
//! shared UI state store.
//!
//! Every path a browser sends is a path on the server. Paths are resolved
//! against the configured server file-browser roots before they reach the
//! application layer, exactly like the SQLite file helpers in `rpc.rs`.

use super::{decode_empty_payload, decode_payload};
use crate::application::host_settings::HostSettingsCommand;
use crate::application::themes::{LocalThemeArchive, ThemeCommand};
use crate::application::ui_state::UiStateCommand;
use crate::application::AuthorizationLevel;
use crate::transport::web::server_files;
use serde::Deserialize;
use serde_json::Value;
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ThemeRpcCommand {
    GetCatalog,
    CreatePersonalTheme,
    CreatePersonalSnapshot,
    UpdatePersonalTheme,
    UpdatePersonalSnapshot,
    DuplicatePersonalTheme,
    ImportTheme,
    ExportTheme,
    PreviewThemeDocument,
    PreviewLocalPackage,
    InstallLocalPackage,
    FetchRegistry,
    FetchPackageDetail,
    InstallRegistryTheme,
    CancelInstall,
    SetPackageEnabled,
    UninstallPackage,
    RecoverPackages,
}

impl ThemeRpcCommand {
    pub(super) fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "get_theme_catalog" => Self::GetCatalog,
            "create_personal_theme" => Self::CreatePersonalTheme,
            "create_personal_snapshot" => Self::CreatePersonalSnapshot,
            "update_personal_theme" => Self::UpdatePersonalTheme,
            "update_personal_snapshot" => Self::UpdatePersonalSnapshot,
            "duplicate_personal_theme" => Self::DuplicatePersonalTheme,
            "import_theme" => Self::ImportTheme,
            "export_theme" => Self::ExportTheme,
            "preview_theme_document" => Self::PreviewThemeDocument,
            "preview_local_theme_package" => Self::PreviewLocalPackage,
            "install_local_theme_package" => Self::InstallLocalPackage,
            "fetch_theme_registry" => Self::FetchRegistry,
            "fetch_theme_package_detail" => Self::FetchPackageDetail,
            "install_registry_theme" => Self::InstallRegistryTheme,
            "cancel_theme_install" => Self::CancelInstall,
            "set_theme_package_enabled" => Self::SetPackageEnabled,
            "uninstall_theme_package" => Self::UninstallPackage,
            "recover_theme_packages" => Self::RecoverPackages,
            _ => return None,
        })
    }

    /// Reading the catalog is needed by every session to render; changing
    /// themes or packages changes host files and stays local-admin.
    pub(super) fn authorization(self) -> AuthorizationLevel {
        match self {
            Self::GetCatalog | Self::PreviewThemeDocument => AuthorizationLevel::Session,
            _ => AuthorizationLevel::LocalAdmin,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum HostSettingsRpcCommand {
    ProxyPasswordIsSet,
    SetProxyPassword,
    DeleteProxyPassword,
    GetStorageLocation,
    InspectStorageLocation,
    SetStorageLocation,
    ResetStorageLocation,
    GetAppDataDir,
}

impl HostSettingsRpcCommand {
    pub(super) fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "proxy_password_is_set" => Self::ProxyPasswordIsSet,
            "set_proxy_password" => Self::SetProxyPassword,
            "delete_proxy_password" => Self::DeleteProxyPassword,
            "get_storage_location" => Self::GetStorageLocation,
            "inspect_storage_location" => Self::InspectStorageLocation,
            "set_storage_location" => Self::SetStorageLocation,
            "reset_storage_location" => Self::ResetStorageLocation,
            "get_app_data_dir" => Self::GetAppDataDir,
            _ => return None,
        })
    }

    pub(super) fn authorization(self) -> AuthorizationLevel {
        match self {
            Self::ProxyPasswordIsSet | Self::SetProxyPassword | Self::DeleteProxyPassword => {
                AuthorizationLevel::Sensitive
            }
            _ => AuthorizationLevel::LocalAdmin,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum UiStateRpcCommand {
    Get,
    Set,
    Delete,
}

impl UiStateRpcCommand {
    pub(super) fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "get_ui_state" => Self::Get,
            "set_ui_state" => Self::Set,
            "delete_ui_state" => Self::Delete,
            _ => return None,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NameSourceRequest {
    name: String,
    source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdatePersonalThemeRequest {
    theme_id: String,
    name: String,
    source: String,
    expected_revision: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdatePersonalSnapshotRequest {
    theme_id: String,
    name: String,
    source: String,
    editor: Value,
    expected_revision: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DuplicatePersonalThemeRequest {
    theme_id: String,
    name: String,
    #[serde(default)]
    editor: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportThemeRequest {
    theme_json: String,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThemeIdRequest {
    theme_id: String,
}

/// Browsers either upload the archive (`uploadToken`) or pick it with the
/// server file browser (`path`).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LocalPackageRequest {
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    upload_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InstallLocalPackageRequest {
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    upload_token: Option<String>,
    package_name: String,
    expected_digest: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FetchThemeRegistryRequest {
    #[serde(default)]
    package_name: Option<String>,
    #[serde(default)]
    expected_registry_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FetchThemePackageDetailRequest {
    package_name: String,
    expected_registry_key: String,
    #[serde(default)]
    requested_registry_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InstallRegistryThemeRequest {
    package_name: String,
    expected_registry_key: String,
    #[serde(default)]
    version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThemePackageRequest {
    registry_key: String,
    package_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetThemePackageEnabledRequest {
    registry_key: String,
    package_name: String,
    enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProxySlotRequest {
    slot: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetProxyPasswordRequest {
    slot: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoragePathRequest {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetStorageLocationRequest {
    path: String,
    copy_data: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GetUiStateRequest {
    #[serde(default)]
    keys: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetUiStateRequest {
    key: String,
    value: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UiStateKeyRequest {
    key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ReadSqlFileRequest {
    pub(super) path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct WriteSqlFileRequest {
    pub(super) path: String,
    pub(super) content: String,
}

fn decode_optional<T: for<'de> Deserialize<'de> + Default>(body: &[u8]) -> Result<T, String> {
    if body.is_empty() {
        return Ok(T::default());
    }
    let value: Value = decode_payload(body)?;
    if value.is_null() {
        return Ok(T::default());
    }
    serde_json::from_value(value).map_err(|error| format!("Invalid command payload: {error}"))
}

fn local_archive(
    roots: &[PathBuf],
    session_id: Option<Uuid>,
    path: Option<String>,
    upload_token: Option<String>,
) -> Result<LocalThemeArchive, String> {
    match (path, upload_token) {
        (Some(path), None) => Ok(LocalThemeArchive::Path(
            server_files::validate_existing_file(roots, &path)?,
        )),
        (None, Some(token)) => Ok(LocalThemeArchive::Upload {
            owner: session_id.ok_or_else(|| "A browser session is required".to_string())?,
            token,
        }),
        _ => Err("Provide either a server path or an upload token".to_string()),
    }
}

/// Decoding errors are payload errors; path confinement errors are too,
/// because they reject the request before any work starts.
pub(super) fn decode_theme_command(
    command: ThemeRpcCommand,
    body: &[u8],
    roots: &[PathBuf],
    session_id: Option<Uuid>,
) -> Result<ThemeCommand, String> {
    Ok(match command {
        ThemeRpcCommand::GetCatalog => {
            decode_empty_payload(body)?;
            ThemeCommand::GetCatalog
        }
        ThemeRpcCommand::CreatePersonalTheme => {
            let request: NameSourceRequest = decode_payload(body)?;
            ThemeCommand::CreatePersonalTheme {
                name: request.name,
                source: request.source,
            }
        }
        ThemeRpcCommand::CreatePersonalSnapshot => {
            let request: NameSourceRequest = decode_payload(body)?;
            ThemeCommand::CreatePersonalSnapshot {
                name: request.name,
                source: request.source,
            }
        }
        ThemeRpcCommand::UpdatePersonalTheme => {
            let request: UpdatePersonalThemeRequest = decode_payload(body)?;
            ThemeCommand::UpdatePersonalTheme {
                theme_id: request.theme_id,
                name: request.name,
                source: request.source,
                expected_revision: request.expected_revision,
            }
        }
        ThemeRpcCommand::UpdatePersonalSnapshot => {
            let request: UpdatePersonalSnapshotRequest = decode_payload(body)?;
            ThemeCommand::UpdatePersonalSnapshot {
                theme_id: request.theme_id,
                name: request.name,
                source: request.source,
                editor: request.editor,
                expected_revision: request.expected_revision,
            }
        }
        ThemeRpcCommand::DuplicatePersonalTheme => {
            let request: DuplicatePersonalThemeRequest = decode_payload(body)?;
            ThemeCommand::DuplicatePersonalTheme {
                theme_id: request.theme_id,
                name: request.name,
                editor: request.editor,
            }
        }
        ThemeRpcCommand::ImportTheme => {
            let request: ImportThemeRequest = decode_payload(body)?;
            ThemeCommand::ImportTheme {
                theme_json: request.theme_json,
                name: request.name,
            }
        }
        ThemeRpcCommand::ExportTheme => {
            let request: ThemeIdRequest = decode_payload(body)?;
            ThemeCommand::ExportTheme {
                theme_id: request.theme_id,
            }
        }
        ThemeRpcCommand::PreviewThemeDocument => {
            let request: NameSourceRequest = decode_payload(body)?;
            ThemeCommand::PreviewThemeDocument {
                source: request.source,
                name: request.name,
            }
        }
        ThemeRpcCommand::PreviewLocalPackage => {
            let request: LocalPackageRequest = decode_payload(body)?;
            ThemeCommand::PreviewLocalPackage {
                archive: local_archive(roots, session_id, request.path, request.upload_token)?,
            }
        }
        ThemeRpcCommand::InstallLocalPackage => {
            let request: InstallLocalPackageRequest = decode_payload(body)?;
            ThemeCommand::InstallLocalPackage {
                archive: local_archive(roots, session_id, request.path, request.upload_token)?,
                package_name: request.package_name,
                expected_digest: request.expected_digest,
            }
        }
        ThemeRpcCommand::FetchRegistry => {
            let request: FetchThemeRegistryRequest = decode_optional(body)?;
            ThemeCommand::FetchRegistry {
                package_name: request.package_name,
                expected_registry_key: request.expected_registry_key,
            }
        }
        ThemeRpcCommand::FetchPackageDetail => {
            let request: FetchThemePackageDetailRequest = decode_payload(body)?;
            ThemeCommand::FetchPackageDetail {
                package_name: request.package_name,
                expected_registry_key: request.expected_registry_key,
                requested_registry_url: request.requested_registry_url,
            }
        }
        ThemeRpcCommand::InstallRegistryTheme => {
            let request: InstallRegistryThemeRequest = decode_payload(body)?;
            ThemeCommand::InstallRegistryTheme {
                package_name: request.package_name,
                expected_registry_key: request.expected_registry_key,
                version: request.version,
            }
        }
        ThemeRpcCommand::CancelInstall => {
            let request: ThemePackageRequest = decode_payload(body)?;
            ThemeCommand::CancelInstall {
                registry_key: request.registry_key,
                package_name: request.package_name,
            }
        }
        ThemeRpcCommand::SetPackageEnabled => {
            let request: SetThemePackageEnabledRequest = decode_payload(body)?;
            ThemeCommand::SetPackageEnabled {
                registry_key: request.registry_key,
                package_name: request.package_name,
                enabled: request.enabled,
            }
        }
        ThemeRpcCommand::UninstallPackage => {
            let request: ThemePackageRequest = decode_payload(body)?;
            ThemeCommand::UninstallPackage {
                registry_key: request.registry_key,
                package_name: request.package_name,
            }
        }
        ThemeRpcCommand::RecoverPackages => {
            decode_empty_payload(body)?;
            ThemeCommand::RecoverPackages
        }
    })
}

pub(super) fn decode_host_settings_command(
    command: HostSettingsRpcCommand,
    body: &[u8],
    roots: &[PathBuf],
) -> Result<HostSettingsCommand, String> {
    Ok(match command {
        HostSettingsRpcCommand::ProxyPasswordIsSet => {
            let request: ProxySlotRequest = decode_payload(body)?;
            HostSettingsCommand::ProxyPasswordIsSet { slot: request.slot }
        }
        HostSettingsRpcCommand::SetProxyPassword => {
            let request: SetProxyPasswordRequest = decode_payload(body)?;
            HostSettingsCommand::SetProxyPassword {
                slot: request.slot,
                password: request.password,
            }
        }
        HostSettingsRpcCommand::DeleteProxyPassword => {
            let request: ProxySlotRequest = decode_payload(body)?;
            HostSettingsCommand::DeleteProxyPassword { slot: request.slot }
        }
        HostSettingsRpcCommand::GetStorageLocation => {
            decode_empty_payload(body)?;
            HostSettingsCommand::GetStorageLocation
        }
        HostSettingsRpcCommand::InspectStorageLocation => {
            let request: StoragePathRequest = decode_payload(body)?;
            HostSettingsCommand::InspectStorageLocation {
                path: server_files::validate_directory_target(roots, &request.path)?,
            }
        }
        HostSettingsRpcCommand::SetStorageLocation => {
            let request: SetStorageLocationRequest = decode_payload(body)?;
            HostSettingsCommand::SetStorageLocation {
                path: server_files::validate_directory_target(roots, &request.path)?,
                copy_data: request.copy_data,
            }
        }
        HostSettingsRpcCommand::ResetStorageLocation => {
            decode_empty_payload(body)?;
            HostSettingsCommand::ResetStorageLocation
        }
        HostSettingsRpcCommand::GetAppDataDir => {
            decode_empty_payload(body)?;
            HostSettingsCommand::GetAppDataDir
        }
    })
}

pub(super) fn decode_ui_state_command(
    command: UiStateRpcCommand,
    body: &[u8],
) -> Result<UiStateCommand, String> {
    Ok(match command {
        UiStateRpcCommand::Get => {
            let request: GetUiStateRequest = decode_optional(body)?;
            UiStateCommand::Get { keys: request.keys }
        }
        UiStateRpcCommand::Set => {
            let request: SetUiStateRequest = decode_payload(body)?;
            UiStateCommand::Set {
                key: request.key,
                value: request.value,
            }
        }
        UiStateRpcCommand::Delete => {
            let request: UiStateKeyRequest = decode_payload(body)?;
            UiStateCommand::Delete { key: request.key }
        }
    })
}
