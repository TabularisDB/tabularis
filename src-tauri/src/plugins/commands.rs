use std::fs;
use std::time::Duration;

use crate::drivers::driver_trait::PluginManifest;
use crate::plugins::installer::{self, InstalledPluginInfo};
use crate::plugins::manager::ConfigManifest;
use crate::plugins::registry::{self, RegistryPlugin, RegistryPluginWithStatus, RegistryReleaseWithStatus};
use tauri::AppHandle;
use tokio::time::sleep;

/// Resolves which Tabularium registry to talk to. Operators pin a
/// URL via `tabularium_registry_url` in `config.json`; otherwise the
/// built-in default applies.
fn registry_base_url(config: &crate::config::AppConfig) -> &str {
    config
        .tabularium_registry_url
        .as_deref()
        .unwrap_or(registry::DEFAULT_TABULARIUM_URL)
}

#[tauri::command]
pub async fn fetch_plugin_registry(
    app: AppHandle,
) -> Result<Vec<RegistryPluginWithStatus>, String> {
    let config = crate::config::load_config_internal(&app);
    let base_url = registry_base_url(&config).trim_end_matches('/').to_string();
    // COMPAT(registry-ga): merge the API with the legacy static registry.json so
    // not-yet-migrated plugins stay visible during the transition.
    let legacy_url = crate::plugins::compat::legacy_registry_url(&config);
    let installed = installer::list_installed()?;
    let installed_ids: Vec<String> = installed.iter().map(|i| i.id.clone()).collect();
    let remote =
        crate::plugins::compat::resolve_registry(&base_url, &legacy_url, &installed_ids).await?;
    let platform = registry::get_current_platform();

    let result: Vec<RegistryPluginWithStatus> = remote
        .plugins
        .into_iter()
        .map(|plugin| {
            let installed_version = installed
                .iter()
                .find(|i| i.id == plugin.id)
                .map(|i| i.version.clone());
            // `registry_base_url` is stamped in resolve_registry, which still
            // knows whether a plugin came from the API or the legacy registry.
            to_plugin_with_status(plugin, installed_version, &platform)
        })
        .collect();

    Ok(result)
}

/// Builds a `RegistryPluginWithStatus` from a registry plugin + the installed
/// version (if any), computing per-release platform support and a SemVer-aware
/// `update_available`. `install_action` is left `None` here; the deeplink
/// preview path sets it explicitly.
fn to_plugin_with_status(
    plugin: RegistryPlugin,
    installed_version: Option<String>,
    platform: &str,
) -> RegistryPluginWithStatus {
    let releases: Vec<RegistryReleaseWithStatus> = plugin
        .releases
        .iter()
        .map(|r| {
            let platform_supported =
                r.assets.contains_key(platform) || r.assets.contains_key("universal");
            RegistryReleaseWithStatus {
                version: r.version.clone(),
                min_tabularis_version: r.min_tabularis_version.clone(),
                platform_supported,
            }
        })
        .collect();

    let platform_supported = releases
        .iter()
        .any(|r| r.version == plugin.latest_version && r.platform_supported);

    // SemVer-aware: "update" classification doubles as `update_available`.
    let action = registry::classify_install(installed_version.as_deref(), &plugin.latest_version);
    let update_available = matches!(action, registry::InstallAction::Update);

    RegistryPluginWithStatus {
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        author: plugin.author,
        homepage: plugin.homepage,
        latest_version: plugin.latest_version,
        releases,
        installed_version,
        update_available,
        platform_supported,
        icon: plugin.icon,
        repo_url: plugin.repo_url,
        kind: plugin.kind,
        tags: plugin.tags,
        category: plugin.category,
        downloads: plugin.downloads,
        registry_base_url: plugin.registry_base_url,
        engine: plugin.engine,
        paradigms: plugin.paradigms,
        verified: plugin.verified,
        install_action: None,
        signature: None,
    }
}

/// API-path install resolution: resolves the concrete target version, confirms
/// the platform is supported (+ sha256), and returns the registry's TRACKED
/// download URL. Returns `(download_url, expected_sha256, target_version)`.
async fn resolve_api_install_asset(
    base: &str,
    plugin_id: &str,
    version: Option<&str>,
    platform: &str,
) -> Result<(String, Option<String>, String), String> {
    let target_version = match version {
        Some(v) => v.to_string(),
        None => {
            let detail = crate::plugins::tabularium::fetch_plugin_detail(base, plugin_id).await?;
            if !detail.latest_version.is_empty() {
                detail.latest_version
            } else {
                detail
                    .releases
                    .first()
                    .map(|r| r.version.clone())
                    .ok_or_else(|| {
                        format!("Plugin '{}' has no releases on the registry", plugin_id)
                    })?
            }
        }
    };
    // Resolve the asset for its sha256 + to confirm the platform is supported,
    // but download via the registry's TRACKED redirect so the download counter
    // increments. Use the dedicated `/latest` endpoint when no version was
    // pinned, otherwise the versioned `/releases/{version}` endpoint.
    let asset =
        registry::resolve_tabularium_asset(base, plugin_id, &target_version, platform).await?;
    let download_url = match version {
        Some(_) => crate::plugins::tabularium::tracked_download_url(
            base,
            plugin_id,
            &target_version,
            platform,
        ),
        None => crate::plugins::tabularium::tracked_latest_download_url(base, plugin_id, platform),
    };
    Ok((download_url, asset.expected_sha256, target_version))
}

#[tauri::command]
pub async fn install_plugin(
    app: AppHandle,
    plugin_id: String,
    version: Option<String>,
) -> Result<(), String> {
    // Updating an installed plugin must stop the existing process first,
    // otherwise the OS may keep files locked while we replace the directory.
    crate::drivers::registry::unregister_driver(&plugin_id).await;
    crate::drivers::registry::unregister_manifest(&plugin_id).await;
    sleep(Duration::from_millis(500)).await;

    let config = crate::config::load_config_internal(&app);
    let platform = registry::get_current_platform();
    let base = registry_base_url(&config);

    // Resolve the download URL + expected SHA-256 + concrete target version.
    // Resolution order:
    //   1. COMPAT(registry-ga): if the configured registry URL is a static
    //      `.json` file, resolve directly from it (direct download, no sha256).
    //   2. Otherwise use the Tabularium API + the TRACKED redirect download.
    //   3. COMPAT(registry-ga): if the API doesn't know the plugin (it lives
    //      only in the legacy registry, not yet migrated), fall back to the
    //      configured legacy `registry.json`'s direct asset.
    let (download_url, expected_sha256, target_version) =
        if let Some(res) =
            crate::plugins::compat::resolve_static_asset(base, &plugin_id, version.as_deref(), &platform)
                .await
        {
            let asset = res?;
            (asset.download_url, asset.expected_sha256, asset.version)
        } else {
            match resolve_api_install_asset(base, &plugin_id, version.as_deref(), &platform).await {
                Ok(resolved) => resolved,
                Err(api_err) => {
                    // COMPAT(registry-ga): legacy-registry install fallback.
                    let legacy_url = crate::plugins::compat::legacy_registry_url(&config);
                    match crate::plugins::compat::fetch_static_asset(
                        &legacy_url,
                        &plugin_id,
                        version.as_deref(),
                        &platform,
                    )
                    .await
                    {
                        Ok(asset) => (asset.download_url, asset.expected_sha256, asset.version),
                        Err(_) => return Err(api_err),
                    }
                }
            }
        };
    installer::download_and_install(&plugin_id, &download_url, expected_sha256.as_deref()).await?;

    // Verify the installed manifest matches what the registry advertised. The
    // canonical schema uses `name` as the identity, so `installed_plugin.id`
    // falls back to the manifest `name` when no legacy `id` is present.
    let installed_plugin = installer::read_installed_plugin(&plugin_id)?;
    if installed_plugin.id != plugin_id {
        return Err(format!(
            "Plugin archive mismatch: registry expected id '{}' but installed manifest reports '{}'",
            plugin_id, installed_plugin.id
        ));
    }
    if installed_plugin.version != target_version {
        return Err(format!(
            "Plugin archive version mismatch: registry expected version '{}' but installed manifest reports '{}'. The published asset appears inconsistent.",
            target_version, installed_plugin.version
        ));
    }

    // Hot-register the new driver (no restart needed)
    let plugin_cfg = config.plugins.as_ref().and_then(|m| m.get(&plugin_id));
    let interpreter_override = plugin_cfg.and_then(|c| c.interpreter.clone());
    let settings = plugin_cfg.map(|c| c.settings.clone()).unwrap_or_default();
    let plugins_dir = installer::get_plugins_dir()?;
    let plugin_dir = plugins_dir.join(&plugin_id);
    crate::plugins::manager::load_plugin_from_dir(&plugin_dir, interpreter_override, settings)
        .await
        .map_err(|e| format!("Plugin installed but failed to load: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn uninstall_plugin(plugin_id: String) -> Result<(), String> {
    // Unregister from in-memory driver registry first
    crate::drivers::registry::unregister_driver(&plugin_id).await;
    crate::drivers::registry::unregister_manifest(&plugin_id).await;

    // Remove from filesystem
    installer::uninstall(&plugin_id)?;

    Ok(())
}

#[tauri::command]
pub async fn get_installed_plugins() -> Result<Vec<InstalledPluginInfo>, String> {
    installer::list_installed()
}

/// Stops the plugin process and removes the driver from the registry.
/// The plugin files remain on disk and can be re-enabled with `enable_plugin`.
#[tauri::command]
pub async fn disable_plugin(plugin_id: String) -> Result<(), String> {
    crate::drivers::registry::unregister_driver(&plugin_id).await;
    crate::drivers::registry::unregister_manifest(&plugin_id).await;
    Ok(())
}

/// Loads the plugin from disk and registers its driver, starting the plugin process.
#[tauri::command]
pub async fn enable_plugin(app: AppHandle, plugin_id: String) -> Result<(), String> {
    let config = crate::config::load_config_internal(&app);
    let plugin_cfg = config.plugins.as_ref().and_then(|m| m.get(&plugin_id));
    let interpreter_override = plugin_cfg.and_then(|c| c.interpreter.clone());
    let settings = plugin_cfg.map(|c| c.settings.clone()).unwrap_or_default();
    let plugins_dir = installer::get_plugins_dir()?;
    let plugin_dir = plugins_dir.join(&plugin_id);
    if !plugin_dir.exists() {
        return Err(format!("Plugin '{}' is not installed", plugin_id));
    }
    crate::plugins::manager::load_plugin_from_dir(&plugin_dir, interpreter_override, settings)
        .await?;
    Ok(())
}

/// Reads a plugin's `.tabularium` manifest from disk and returns a PluginManifest.
/// Useful for retrieving setting definitions for disabled plugins.
#[tauri::command]
pub async fn get_plugin_manifest(plugin_id: String) -> Result<PluginManifest, String> {
    let plugins_dir = installer::get_plugins_dir()?;
    let plugin_dir = plugins_dir.join(&plugin_id);

    let config: ConfigManifest = installer::read_manifest(&plugin_dir)
        .map_err(|e| format!("Failed to read manifest for '{}': {}", plugin_id, e))?;

    Ok(PluginManifest {
        id: config.id.unwrap_or_else(|| config.name.clone()),
        name: config.name,
        version: config.version,
        description: config.description,
        default_port: config.default_port,
        capabilities: config.capabilities,
        is_builtin: false,
        engine: config.engine,
        paradigms: config.paradigms,
        default_username: config.default_username.unwrap_or_default(),
        color: config.color,
        icon: config.icon,
        settings: config.settings,
        ui_extensions: config.ui_extensions,
    })
}

/// Returns the absolute filesystem path of an installed plugin's directory.
#[tauri::command]
pub fn get_plugin_dir(plugin_id: String) -> Result<String, String> {
    let plugins_dir = installer::get_plugins_dir()?;
    let plugin_dir = plugins_dir.join(&plugin_id);
    if !plugin_dir.exists() {
        return Err(format!("Plugin '{}' is not installed", plugin_id));
    }
    plugin_dir
        .to_str()
        .ok_or_else(|| "Plugin path contains invalid UTF-8".to_string())
        .map(|s| s.to_string())
}

/// Fetches a rich plugin preview from a Tabularium registry, used by the
/// `tabularis://` deep-link confirmation modal. When `registry_url` is
/// omitted the user's configured registry (or the built-in default) is
/// queried instead. Returns `RegistryPluginWithStatus` populated with the
/// installed version and a resolved `install_action` so the modal can show
/// Install / Update / "already installed".
///
/// NB: the deeplink *preview* talks to the Tabularium API directly (no static
/// `registry.json` support). This is intentional — `tabularis://` links target
/// the new registry — so there is deliberately no `COMPAT(registry-ga)` marker
/// here. (`install_plugin` itself DOES support static registries, so the
/// catalogue install path stays fully backwards-compatible.)
#[tauri::command]
pub async fn fetch_tabularium_plugin_preview(
    app: AppHandle,
    slug: String,
    registry_url: Option<String>,
    version: Option<String>,
) -> Result<RegistryPluginWithStatus, String> {
    let config = crate::config::load_config_internal(&app);
    let base = registry_url
        .as_deref()
        .map(str::to_string)
        .unwrap_or_else(|| registry_base_url(&config).to_string());
    let mut plugin = crate::plugins::tabularium::fetch_plugin_detail(&base, &slug).await?;
    plugin.registry_base_url = Some(base.trim_end_matches('/').to_string());

    let installed_version = installer::list_installed()?
        .into_iter()
        .find(|i| i.id == slug)
        .map(|i| i.version);
    let platform = registry::get_current_platform();

    // Target = the version the deeplink will install: the pinned version if the
    // link specified one, otherwise the registry's latest.
    let target = version
        .as_deref()
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| plugin.latest_version.clone());
    let action = registry::classify_install(installed_version.as_deref(), &target);

    let mut with_status = to_plugin_with_status(plugin, installed_version, &platform);
    with_status.install_action = Some(action);
    // Probe the target release's signature so the confirm modal can badge it
    // (verified / unsigned / invalid) before the user commits to installing.
    with_status.signature =
        Some(crate::plugins::tabularium::check_release_signature(&base, &slug, &target).await);
    Ok(with_status)
}

/// Reads a file from an installed plugin's directory.
/// The `file_path` must be a relative path with no `..` components.
#[tauri::command]
pub fn read_plugin_file(plugin_id: String, file_path: String) -> Result<String, String> {
    if file_path.contains("..") || file_path.starts_with('/') || file_path.starts_with('\\') {
        return Err(
            "Invalid file path: must be relative and contain no '..' components".to_string(),
        );
    }
    let plugins_dir = installer::get_plugins_dir()?;
    let full_path = plugins_dir.join(&plugin_id).join(&file_path);
    fs::read_to_string(&full_path).map_err(|e| {
        format!(
            "Failed to read '{}' from plugin '{}': {}",
            file_path, plugin_id, e
        )
    })
}
