use super::{catalog::PACKAGES_DIR, lifecycle, *};
use crate::plugins::{install_cancellation, registry, tabularium};
use sha2::{Digest, Sha256};
use std::path::Path;
use tauri::{AppHandle, Emitter};

fn registry_base(app: &AppHandle) -> Result<String, String> {
    let config = crate::config::load_config_internal(app);
    let base = config
        .tabularium_registry_url
        .unwrap_or_else(|| registry::DEFAULT_TABULARIUM_URL.into());
    registry_key(&base)?;
    Ok(base)
}

fn operation_id(registry: &str, package: &str) -> String {
    format!("theme:{registry}:{package}")
}

fn refresh(app: &AppHandle) {
    if let Err(error) = app.emit("theme-catalog-changed", ()) {
        log::warn!(
            "Theme operation committed but refresh delivery failed: {}",
            error
        );
    }
}

/// Standalone import preview validates without creating a personal file.
#[tauri::command]
pub fn preview_theme_document(source: String, name: String) -> Result<ThemeContribution, String> {
    catalog::validate_name(&name)?;
    let value = parse_bounded_json(source.as_bytes(), legacy::LEGACY_BYTES * 2, 128, 262_144)?;
    if value.get("themeSnapshotVersion").is_some() && value.get("colors").is_none() {
        return super::snapshot::preview_snapshot(&source, &name);
    }
    // A valid legacy document requires monacoTheme and may have opaque version metadata.
    let (format, mode) =
        if value.get("schemaVersion").is_some() && value.get("monacoTheme").is_none() {
            let definition = validate_definition_json(source.as_bytes())?;
            ("v1", catalog::label(&definition, "mode")?.to_string())
        } else {
            let document = legacy::parse_legacy(&source)?;
            ("legacy", catalog::legacy_mode(&document))
        };
    Ok(ThemeContribution {
        id: "theme:preview-document".into(),
        name,
        revision: catalog::revision(&source),
        origin: serde_json::json!({"kind":"personal"}),
        read_only: false,
        mode,
        format: format.into(),
        source,
        available: true,
        editor: None,
    })
}

#[tauri::command]
pub async fn preview_local_theme_package(
    path: String,
) -> Result<lifecycle::LocalThemePreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = lifecycle::read_local_archive(Path::new(&path))?;
        lifecycle::local_preview(&bytes, env!("CARGO_PKG_VERSION"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn install_local_theme_package(
    app: AppHandle,
    path: String,
    package_name: String,
    expected_digest: String,
) -> Result<ThemeCommit, String> {
    lifecycle::validate_package_name(&package_name)?;
    let key = lifecycle::local_registry_key();
    let guard = install_cancellation::begin(&operation_id(&key, &package_name))?;
    let cancellation = guard.cancellation().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        cancellation.check()?;
        let bytes = lifecycle::read_local_archive(Path::new(&path))?;
        if format!("{:x}", Sha256::digest(&bytes)) != expected_digest {
            return Err("Local package changed after preview; preview it again".into());
        }
        let package =
            lifecycle::validate_local_archive(&bytes, env!("CARGO_PKG_VERSION"), &|| {
                cancellation.check()
            })?;
        if super::package_id(package.manifest())? != package_name {
            return Err("Local package identity changed after preview".into());
        }
        install_validated_theme(
            &crate::paths::get_default_app_data_dir().join(PACKAGES_DIR),
            &key,
            &package,
            &|| cancellation.check(),
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    refresh(&app);
    Ok(result)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeRegistrySnapshot {
    pub registry_key: String,
    pub registry_url: String,
    pub plugins: Vec<registry::RegistryPlugin>,
}

#[tauri::command]
pub async fn fetch_theme_registry(
    app: AppHandle,
    package_name: Option<String>,
    expected_registry_key: Option<String>,
) -> Result<ThemeRegistrySnapshot, String> {
    let base = registry_base(&app)?;
    let key = registry_key(&base)?;
    if expected_registry_key
        .as_ref()
        .is_some_and(|expected| expected != &key)
    {
        return Err("Configured theme registry changed; refresh discovery".into());
    }
    let mut plugins = if let Some(package) = package_name {
        lifecycle::validate_package_name(&package)?;
        let detail = tabularium::fetch_theme_detail(&base, &package).await?;
        if detail.plugin.id != package {
            return Err("Registry returned a different theme package".into());
        }
        vec![detail.plugin]
    } else {
        tabularium::fetch_theme_list(&base).await?
    };
    for plugin in &mut plugins {
        plugin.registry_base_url = Some(base.clone());
    }
    Ok(ThemeRegistrySnapshot {
        registry_key: key,
        registry_url: base,
        plugins,
    })
}

/// Read-only details: never resolve a tracked download during discovery.
#[tauri::command]
pub async fn fetch_theme_package_detail(
    app: AppHandle,
    package_name: String,
    expected_registry_key: String,
    requested_registry_url: Option<String>,
) -> Result<tabularium::ThemeRegistryDetail, String> {
    lifecycle::validate_package_name(&package_name)?;
    let base = registry_base(&app)?;
    if registry_key(&base)? != expected_registry_key {
        return Err("Configured theme registry changed; refresh discovery".into());
    }
    if let Some(requested) = requested_registry_url {
        if registry_key(&requested)? != expected_registry_key {
            return Err("Deep-link registry differs from the configured registry; change it explicitly before installing".into());
        }
    }
    let mut detail = tabularium::fetch_theme_detail(&base, &package_name).await?;
    if detail.plugin.id != package_name {
        return Err("Registry entry is not the requested theme package".into());
    }
    detail.plugin.registry_base_url = Some(base);
    Ok(detail)
}

#[tauri::command]
pub async fn install_registry_theme(
    app: AppHandle,
    package_name: String,
    expected_registry_key: String,
    version: Option<String>,
) -> Result<ThemeCommit, String> {
    let result = super::transport::install_registry_package(
        &crate::paths::get_default_app_data_dir(),
        &registry_base(&app)?,
        &expected_registry_key,
        &package_name,
        version.as_deref(),
        env!("CARGO_PKG_VERSION"),
    )
    .await?;
    refresh(&app);
    Ok(result)
}

#[tauri::command]
pub fn cancel_theme_install(registry_key: String, package_name: String) -> bool {
    install_cancellation::cancel(&operation_id(&registry_key, &package_name))
}

#[tauri::command]
pub fn set_theme_package_enabled(
    app: AppHandle,
    registry_key: String,
    package_name: String,
    enabled: bool,
) -> Result<(), String> {
    lifecycle::set_package_enabled(
        &crate::paths::get_default_app_data_dir(),
        &registry_key,
        &package_name,
        enabled,
    )?;
    refresh(&app);
    Ok(())
}

/// Recovery is an explicit action, never a catalog-read or hydration side effect.
#[tauri::command]
pub fn recover_theme_packages(app: AppHandle) -> Result<Vec<String>, String> {
    let root = crate::paths::get_default_app_data_dir().join(PACKAGES_DIR);
    let mut failures = Vec::new();
    match recover_theme_transactions(&root, &lifecycle::local_registry_key()) {
        Ok(()) => refresh(&app),
        Err(error) => failures.push(error),
    }
    Ok(failures)
}

#[tauri::command]
pub fn uninstall_theme_package(
    app: AppHandle,
    registry_key: String,
    package_name: String,
) -> Result<ThemeCommit, String> {
    let result = lifecycle::remove_package(
        &crate::paths::get_default_app_data_dir(),
        &registry_key,
        &package_name,
    )?;
    refresh(&app);
    Ok(result)
}
