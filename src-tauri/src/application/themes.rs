//! Theme catalog, personal themes and theme packages for every transport.
//!
//! Desktop commands and browser RPC both land here, so a theme change made in
//! one host is visible to the other and the `theme-catalog-changed` event
//! reaches every open window through [`RuntimeContext::events`].

use crate::application::file_transfers::FileTransferStore;
use crate::runtime::RuntimeContext;
use crate::theme_packages::{self, commands as packages};
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use tokio::io::AsyncReadExt;
use uuid::Uuid;

/// Upload purpose used by the browser for local theme archives.
pub const THEME_PACKAGE_UPLOAD_PURPOSE: &str = "theme-package";

/// Where a local theme archive comes from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LocalThemeArchive {
    /// A path on the host running Tabularis (desktop dialog or server file browser).
    Path(PathBuf),
    /// A file the browser uploaded for this session.
    Upload { owner: Uuid, token: String },
}

#[derive(Clone, Debug, PartialEq)]
pub enum ThemeCommand {
    GetCatalog,
    CreatePersonalTheme {
        name: String,
        source: String,
    },
    CreatePersonalSnapshot {
        name: String,
        source: String,
    },
    UpdatePersonalTheme {
        theme_id: String,
        name: String,
        source: String,
        expected_revision: String,
    },
    UpdatePersonalSnapshot {
        theme_id: String,
        name: String,
        source: String,
        editor: Value,
        expected_revision: String,
    },
    DuplicatePersonalTheme {
        theme_id: String,
        name: String,
        editor: Option<Value>,
    },
    ImportTheme {
        theme_json: String,
        name: Option<String>,
    },
    ExportTheme {
        theme_id: String,
    },
    PreviewThemeDocument {
        source: String,
        name: String,
    },
    PreviewLocalPackage {
        archive: LocalThemeArchive,
    },
    InstallLocalPackage {
        archive: LocalThemeArchive,
        package_name: String,
        expected_digest: String,
    },
    FetchRegistry {
        package_name: Option<String>,
        expected_registry_key: Option<String>,
    },
    FetchPackageDetail {
        package_name: String,
        expected_registry_key: String,
        requested_registry_url: Option<String>,
    },
    InstallRegistryTheme {
        package_name: String,
        expected_registry_key: String,
        version: Option<String>,
    },
    CancelInstall {
        registry_key: String,
        package_name: String,
    },
    SetPackageEnabled {
        registry_key: String,
        package_name: String,
        enabled: bool,
    },
    UninstallPackage {
        registry_key: String,
        package_name: String,
    },
    RecoverPackages,
}

pub async fn execute(runtime: &RuntimeContext, command: ThemeCommand) -> Result<Value, String> {
    let config_dir = runtime.paths.config_dir().to_path_buf();
    match command {
        ThemeCommand::GetCatalog => json(catalog(runtime)),
        ThemeCommand::CreatePersonalTheme { name, source } => committed(
            runtime,
            theme_packages::create_personal_definition(&config_dir, &name, &source),
        ),
        ThemeCommand::CreatePersonalSnapshot { name, source } => committed(
            runtime,
            theme_packages::create_personal_snapshot(&config_dir, &name, &source),
        ),
        ThemeCommand::UpdatePersonalTheme {
            theme_id,
            name,
            source,
            expected_revision,
        } => committed(
            runtime,
            theme_packages::update_personal_definition(
                &config_dir,
                &theme_id,
                &name,
                &source,
                &expected_revision,
            ),
        ),
        ThemeCommand::UpdatePersonalSnapshot {
            theme_id,
            name,
            source,
            editor,
            expected_revision,
        } => committed(
            runtime,
            theme_packages::update_personal_snapshot(
                &config_dir,
                &theme_id,
                &name,
                &source,
                editor,
                &expected_revision,
            ),
        ),
        ThemeCommand::DuplicatePersonalTheme {
            theme_id,
            name,
            editor,
        } => committed(
            runtime,
            theme_packages::duplicate_personal_theme(
                &config_dir,
                &crate::paths::get_default_app_data_dir(),
                env!("CARGO_PKG_VERSION"),
                &theme_id,
                &name,
                editor,
            ),
        ),
        ThemeCommand::ImportTheme { theme_json, name } => {
            let result = match name {
                Some(name) => {
                    theme_packages::import_legacy_theme_named(&config_dir, &theme_json, &name)
                }
                None => theme_packages::import_legacy_theme(&config_dir, &theme_json),
            };
            committed(runtime, result)
        }
        ThemeCommand::ExportTheme { theme_id } => json(theme_packages::export_personal_theme(
            &config_dir,
            &theme_id,
        )?),
        ThemeCommand::PreviewThemeDocument { source, name } => {
            json(packages::preview_theme_document(source, name)?)
        }
        ThemeCommand::PreviewLocalPackage { archive } => {
            let bytes = read_archive_now(runtime, archive).await?;
            json(packages::preview_local_package_bytes(bytes).await?)
        }
        ThemeCommand::InstallLocalPackage {
            archive,
            package_name,
            expected_digest,
        } => {
            let bytes = read_archive_now(runtime, archive).await?;
            let result =
                packages::install_local_package(move || Ok(bytes), package_name, expected_digest)
                    .await?;
            notify_catalog_changed(runtime);
            json(result)
        }
        ThemeCommand::FetchRegistry {
            package_name,
            expected_registry_key,
        } => json(
            packages::fetch_registry(registry_base(runtime)?, package_name, expected_registry_key)
                .await?,
        ),
        ThemeCommand::FetchPackageDetail {
            package_name,
            expected_registry_key,
            requested_registry_url,
        } => json(
            packages::fetch_package_detail(
                registry_base(runtime)?,
                package_name,
                expected_registry_key,
                requested_registry_url,
            )
            .await?,
        ),
        ThemeCommand::InstallRegistryTheme {
            package_name,
            expected_registry_key,
            version,
        } => {
            let result = packages::install_registry(
                registry_base(runtime)?,
                expected_registry_key,
                package_name,
                version,
            )
            .await?;
            notify_catalog_changed(runtime);
            json(result)
        }
        ThemeCommand::CancelInstall {
            registry_key,
            package_name,
        } => json(packages::cancel_theme_install(registry_key, package_name)),
        ThemeCommand::SetPackageEnabled {
            registry_key,
            package_name,
            enabled,
        } => {
            packages::set_package_enabled(&registry_key, &package_name, enabled)?;
            notify_catalog_changed(runtime);
            Ok(Value::Null)
        }
        ThemeCommand::UninstallPackage {
            registry_key,
            package_name,
        } => committed(
            runtime,
            packages::uninstall_package(&registry_key, &package_name),
        ),
        ThemeCommand::RecoverPackages => {
            let failures = packages::recover_packages();
            if failures.is_empty() {
                notify_catalog_changed(runtime);
            }
            json(failures)
        }
    }
}

/// The complete catalog as the active storage location sees it.
pub fn catalog(runtime: &RuntimeContext) -> theme_packages::ThemeCatalog {
    theme_packages::read_theme_catalog(
        runtime.paths.config_dir(),
        &crate::paths::get_default_app_data_dir(),
        env!("CARGO_PKG_VERSION"),
    )
}

/// Tells every window and browser session that the catalog changed.
pub fn notify_catalog_changed(runtime: &RuntimeContext) {
    if let Err(error) = runtime.events.emit("theme-catalog-changed", Value::Null) {
        log::warn!("Theme change committed but refresh delivery failed: {error}");
    }
}

fn committed<T: Serialize>(
    runtime: &RuntimeContext,
    result: Result<T, String>,
) -> Result<Value, String> {
    let value = json(result?)?;
    notify_catalog_changed(runtime);
    Ok(value)
}

fn registry_base(runtime: &RuntimeContext) -> Result<String, String> {
    let base = super::persistence::load_config(runtime)
        .tabularium_registry_url
        .unwrap_or_else(|| crate::plugins::registry::DEFAULT_TABULARIUM_URL.into());
    theme_packages::registry_key(&base)?;
    Ok(base)
}

async fn read_archive_now(
    runtime: &RuntimeContext,
    archive: LocalThemeArchive,
) -> Result<Vec<u8>, String> {
    match archive {
        LocalThemeArchive::Path(path) => {
            tokio::task::spawn_blocking(move || packages::read_local_archive(&path))
                .await
                .map_err(|error| error.to_string())?
        }
        LocalThemeArchive::Upload { owner, token } => {
            read_uploaded_archive(runtime, owner, &token).await
        }
    }
}

/// Reads an uploaded archive without consuming the token, so the preview and
/// the install step can both use the same upload.
pub async fn read_uploaded_archive(
    runtime: &RuntimeContext,
    owner: Uuid,
    token: &str,
) -> Result<Vec<u8>, String> {
    let reader = FileTransferStore::new(runtime.paths.data_dir())
        .open_upload(owner, token, THEME_PACKAGE_UPLOAD_PURPOSE)
        .await?;
    let limit = packages::MAX_LOCAL_ARCHIVE_BYTES as u64;
    if reader.metadata().size > limit {
        return Err("Local theme archive exceeds its byte limit".into());
    }
    let mut bytes = Vec::new();
    reader
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("Local theme archive exceeds its byte limit".into());
    }
    Ok(bytes)
}

fn json(value: impl Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "themes_tests.rs"]
mod tests;
