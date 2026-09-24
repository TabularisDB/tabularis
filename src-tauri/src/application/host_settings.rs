//! Host-level settings shared by the desktop app and the Web UI: proxy
//! credentials kept in the OS keychain and the custom storage location.
//!
//! Paths are always paths on the machine running Tabularis. The browser RPC
//! layer confines them to the configured server file-browser roots before
//! building a [`HostSettingsCommand`].

use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HostSettingsCommand {
    ProxyPasswordIsSet { slot: String },
    SetProxyPassword { slot: String, password: String },
    DeleteProxyPassword { slot: String },
    GetStorageLocation,
    InspectStorageLocation { path: PathBuf },
    SetStorageLocation { path: PathBuf, copy_data: bool },
    ResetStorageLocation,
    GetAppDataDir,
}

pub fn execute(command: HostSettingsCommand) -> Result<Value, String> {
    match command {
        HostSettingsCommand::ProxyPasswordIsSet { slot } => {
            json(crate::proxy::proxy_password_is_set(slot)?)
        }
        HostSettingsCommand::SetProxyPassword { slot, password } => {
            crate::proxy::set_proxy_password(slot, password)?;
            Ok(Value::Null)
        }
        HostSettingsCommand::DeleteProxyPassword { slot } => {
            crate::proxy::delete_proxy_password(slot)?;
            Ok(Value::Null)
        }
        HostSettingsCommand::GetStorageLocation => {
            json(crate::storage_location::get_storage_location())
        }
        HostSettingsCommand::InspectStorageLocation { path } => json(
            crate::storage_location::inspect_storage_location(path_text(path)?)?,
        ),
        HostSettingsCommand::SetStorageLocation { path, copy_data } => json(
            crate::storage_location::set_storage_location(path_text(path)?, copy_data)?,
        ),
        HostSettingsCommand::ResetStorageLocation => {
            json(crate::storage_location::reset_storage_location()?)
        }
        HostSettingsCommand::GetAppDataDir => json(crate::storage_location::get_app_data_dir()),
    }
}

fn path_text(path: PathBuf) -> Result<String, String> {
    path.into_os_string()
        .into_string()
        .map_err(|_| "The storage path is not valid UTF-8".to_string())
}

fn json(value: impl Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}
