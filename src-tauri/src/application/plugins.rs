use crate::config::AppConfig;
use crate::drivers::driver_trait::PluginManifest;
use crate::plugins::installer::{self, InstalledPluginInfo};
use crate::plugins::manager::{ConfigManifest, PluginLoadError};
use crate::plugins::registry::{
    self, PluginReadme, RegistryPlugin, RegistryPluginWithStatus, RegistryReleaseWithStatus,
};
use crate::runtime::RuntimeContext;
use serde_json::Value;
use tokio::time::{sleep, Duration};

const MAX_PLUGIN_ID_LENGTH: usize = 128;

#[derive(Clone, Debug)]
pub enum PluginCommand {
    FetchRegistry,
    FetchPreview {
        slug: String,
        registry_url: Option<String>,
        version: Option<String>,
    },
    FetchReadme {
        slug: String,
        locale: Option<String>,
        registry_url: Option<String>,
    },
    Install {
        plugin_id: String,
        version: Option<String>,
    },
    CancelInstall {
        plugin_id: String,
    },
    Uninstall {
        plugin_id: String,
    },
    GetInstalled,
    Disable {
        plugin_id: String,
    },
    Enable {
        plugin_id: String,
    },
    GetManifest {
        plugin_id: String,
    },
    GetStartupErrors,
    KillProcess {
        plugin_id: String,
    },
    RestartProcess {
        plugin_id: String,
    },
}

pub async fn execute(runtime: &RuntimeContext, command: PluginCommand) -> Result<Value, String> {
    match command {
        PluginCommand::FetchRegistry => json(fetch_plugin_registry(runtime).await?),
        PluginCommand::FetchPreview {
            slug,
            registry_url,
            version,
        } => json(fetch_plugin_preview(runtime, slug, registry_url, version).await?),
        PluginCommand::FetchReadme {
            slug,
            locale,
            registry_url,
        } => json(fetch_plugin_readme(runtime, slug, locale, registry_url).await?),
        PluginCommand::Install { plugin_id, version } => {
            install_plugin(runtime, plugin_id, version).await?;
            Ok(Value::Null)
        }
        PluginCommand::CancelInstall { plugin_id } => json(cancel_plugin_install(plugin_id)?),
        PluginCommand::Uninstall { plugin_id } => {
            uninstall_plugin(runtime, plugin_id).await?;
            Ok(Value::Null)
        }
        PluginCommand::GetInstalled => json(get_installed_plugins(runtime)),
        PluginCommand::Disable { plugin_id } => {
            disable_plugin(plugin_id).await?;
            Ok(Value::Null)
        }
        PluginCommand::Enable { plugin_id } => {
            enable_plugin(runtime, plugin_id).await?;
            Ok(Value::Null)
        }
        PluginCommand::GetManifest { plugin_id } => json(get_plugin_manifest(runtime, plugin_id)?),
        PluginCommand::GetStartupErrors => json(get_plugin_startup_errors()),
        PluginCommand::KillProcess { plugin_id } => {
            kill_plugin_process(plugin_id).await?;
            Ok(Value::Null)
        }
        PluginCommand::RestartProcess { plugin_id } => {
            restart_plugin_process(runtime, plugin_id).await?;
            Ok(Value::Null)
        }
    }
}

pub async fn fetch_plugin_registry(
    runtime: &RuntimeContext,
) -> Result<Vec<RegistryPluginWithStatus>, String> {
    let config = super::persistence::load_config(runtime);
    let base_url = registry_base_url(&config).trim_end_matches('/').to_string();
    let legacy_url = crate::plugins::compat::legacy_registry_url(&config);
    let installed = get_installed_plugins(runtime);
    let installed_ids: Vec<String> = installed.iter().map(|plugin| plugin.id.clone()).collect();
    let remote =
        crate::plugins::compat::resolve_registry(&base_url, &legacy_url, &installed_ids).await?;
    let platform = registry::get_current_platform();

    Ok(remote
        .plugins
        .into_iter()
        .map(|plugin| {
            let installed_version = installed
                .iter()
                .find(|installed| installed.id == plugin.id)
                .map(|installed| installed.version.clone());
            to_plugin_with_status(plugin, installed_version, &platform)
        })
        .collect())
}

pub async fn install_plugin(
    runtime: &RuntimeContext,
    plugin_id: String,
    version: Option<String>,
) -> Result<(), String> {
    validate_plugin_id(&plugin_id)?;
    let install_guard = crate::plugins::install_cancellation::begin(&plugin_id)?;
    let cancellation = install_guard.cancellation();
    cancellation.check()?;

    let config = super::persistence::load_config(runtime);
    let platform = registry::get_current_platform();
    let base = registry_base_url(&config);
    let (download_url, expected_sha256, target_version) = if let Some(result) =
        crate::plugins::compat::resolve_static_asset(
            base,
            &plugin_id,
            version.as_deref(),
            &platform,
        )
        .await
    {
        let asset = result?;
        (asset.download_url, asset.expected_sha256, asset.version)
    } else {
        match resolve_api_install_asset(base, &plugin_id, version.as_deref(), &platform).await {
            Ok(resolved) => resolved,
            Err(api_error) => {
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
                    Err(_) => return Err(api_error),
                }
            }
        }
    };

    cancellation.check()?;
    let plugins_dir = runtime.paths.plugins_dir();
    installer::download_and_install_into(
        &plugins_dir,
        &plugin_id,
        &download_url,
        expected_sha256.as_deref(),
        Some(&target_version),
        cancellation,
    )
    .await?;

    let (interpreter_override, settings) = plugin_configuration(&config, &plugin_id);
    let plugin_dir = plugins_dir.join(&plugin_id);
    crate::plugins::manager::load_plugin_from_dir(&plugin_dir, interpreter_override, settings)
        .await
        .map_err(|error| format!("Plugin installed but failed to load: {error}"))
}

pub fn cancel_plugin_install(plugin_id: String) -> Result<bool, String> {
    validate_plugin_id(&plugin_id)?;
    Ok(crate::plugins::install_cancellation::cancel(&plugin_id))
}

pub async fn uninstall_plugin(runtime: &RuntimeContext, plugin_id: String) -> Result<(), String> {
    validate_plugin_id(&plugin_id)?;
    crate::drivers::registry::unregister_driver(&plugin_id).await;
    crate::drivers::registry::unregister_manifest(&plugin_id).await;
    installer::uninstall_from(&runtime.paths.plugins_dir(), &plugin_id)
}

pub fn get_installed_plugins(runtime: &RuntimeContext) -> Vec<InstalledPluginInfo> {
    installer::list_installed_from(&runtime.paths.plugins_dir())
}

pub async fn disable_plugin(plugin_id: String) -> Result<(), String> {
    validate_plugin_id(&plugin_id)?;
    crate::drivers::registry::unregister_driver(&plugin_id).await;
    crate::drivers::registry::unregister_manifest(&plugin_id).await;
    Ok(())
}

pub async fn enable_plugin(runtime: &RuntimeContext, plugin_id: String) -> Result<(), String> {
    validate_plugin_id(&plugin_id)?;
    let config = super::persistence::load_config(runtime);
    load_plugin(runtime, &config, &plugin_id).await
}

pub fn get_plugin_manifest(
    runtime: &RuntimeContext,
    plugin_id: String,
) -> Result<PluginManifest, String> {
    validate_plugin_id(&plugin_id)?;
    let plugin_dir = runtime.paths.plugins_dir().join(&plugin_id);
    let config: ConfigManifest = installer::read_manifest(&plugin_dir)
        .map_err(|error| format!("Failed to read manifest for '{plugin_id}': {error}"))?;
    Ok(plugin_manifest(config))
}

pub fn get_plugin_startup_errors() -> Vec<PluginLoadError> {
    crate::plugins::manager::take_plugin_startup_errors()
}

pub async fn fetch_plugin_preview(
    runtime: &RuntimeContext,
    slug: String,
    registry_url: Option<String>,
    version: Option<String>,
) -> Result<RegistryPluginWithStatus, String> {
    validate_plugin_id(&slug)?;
    let config = super::persistence::load_config(runtime);
    let base = registry_url
        .as_deref()
        .map(str::to_string)
        .unwrap_or_else(|| registry_base_url(&config).to_string());
    let mut plugin = crate::plugins::tabularium::fetch_plugin_detail(&base, &slug).await?;
    plugin.registry_base_url = Some(base.trim_end_matches('/').to_string());

    let installed_version = get_installed_plugins(runtime)
        .into_iter()
        .find(|installed| installed.id == slug)
        .map(|installed| installed.version);
    let platform = registry::get_current_platform();
    let target = version
        .as_deref()
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| plugin.latest_version.clone());
    let action = registry::classify_install(installed_version.as_deref(), &target);
    let mut result = to_plugin_with_status(plugin, installed_version, &platform);
    result.install_action = Some(action);
    result.signature =
        Some(crate::plugins::tabularium::check_release_signature(&base, &slug, &target).await);
    Ok(result)
}

pub async fn fetch_plugin_readme(
    runtime: &RuntimeContext,
    slug: String,
    locale: Option<String>,
    registry_url: Option<String>,
) -> Result<PluginReadme, String> {
    validate_plugin_id(&slug)?;
    let config = super::persistence::load_config(runtime);
    let base = registry_url
        .as_deref()
        .map(str::to_string)
        .unwrap_or_else(|| registry_base_url(&config).to_string());
    crate::plugins::tabularium::fetch_plugin_readme(&base, &slug, locale.as_deref()).await
}

pub async fn kill_plugin_process(plugin_id: String) -> Result<(), String> {
    validate_plugin_id(&plugin_id)?;
    crate::drivers::registry::unregister_driver(&plugin_id).await;
    Ok(())
}

pub async fn restart_plugin_process(
    runtime: &RuntimeContext,
    plugin_id: String,
) -> Result<(), String> {
    validate_plugin_id(&plugin_id)?;
    crate::drivers::registry::unregister_driver(&plugin_id).await;
    sleep(Duration::from_millis(500)).await;
    let config = super::persistence::load_config(runtime);
    load_plugin(runtime, &config, &plugin_id)
        .await
        .map_err(|error| format!("Failed to restart plugin '{plugin_id}': {error}"))
}

fn registry_base_url(config: &AppConfig) -> &str {
    config
        .tabularium_registry_url
        .as_deref()
        .unwrap_or(registry::DEFAULT_TABULARIUM_URL)
}

fn validate_plugin_id(plugin_id: &str) -> Result<(), String> {
    let mut characters = plugin_id.chars();
    let valid_first = characters
        .next()
        .is_some_and(|character| character.is_ascii_alphanumeric());
    let valid_rest = characters
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'));
    if plugin_id.len() > MAX_PLUGIN_ID_LENGTH || !valid_first || !valid_rest {
        return Err(format!("Invalid plugin identifier: '{plugin_id}'"));
    }
    Ok(())
}

fn plugin_configuration(
    config: &AppConfig,
    plugin_id: &str,
) -> (
    Option<String>,
    std::collections::HashMap<String, serde_json::Value>,
) {
    let plugin = config
        .plugins
        .as_ref()
        .and_then(|plugins| plugins.get(plugin_id));
    (
        plugin.and_then(|plugin| plugin.interpreter.clone()),
        plugin
            .map(|plugin| plugin.settings.clone())
            .unwrap_or_default(),
    )
}

async fn load_plugin(
    runtime: &RuntimeContext,
    config: &AppConfig,
    plugin_id: &str,
) -> Result<(), String> {
    let plugin_dir = runtime.paths.plugins_dir().join(plugin_id);
    if !plugin_dir.exists() {
        return Err(format!("Plugin '{plugin_id}' is not installed"));
    }
    let (interpreter_override, settings) = plugin_configuration(config, plugin_id);
    crate::plugins::manager::load_plugin_from_dir(&plugin_dir, interpreter_override, settings).await
}

fn plugin_manifest(config: ConfigManifest) -> PluginManifest {
    PluginManifest {
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
        type_mappings: config.type_mappings,
    }
}

fn to_plugin_with_status(
    plugin: RegistryPlugin,
    installed_version: Option<String>,
    platform: &str,
) -> RegistryPluginWithStatus {
    let releases: Vec<RegistryReleaseWithStatus> = plugin
        .releases
        .iter()
        .map(|release| RegistryReleaseWithStatus {
            version: release.version.clone(),
            min_tabularis_version: release.min_tabularis_version.clone(),
            platform_supported: release.assets.contains_key(platform)
                || release.assets.contains_key("universal"),
        })
        .collect();
    let platform_supported = releases
        .iter()
        .any(|release| release.version == plugin.latest_version && release.platform_supported);
    let update_available = matches!(
        registry::classify_install(installed_version.as_deref(), &plugin.latest_version),
        registry::InstallAction::Update
    );

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

async fn resolve_api_install_asset(
    base: &str,
    plugin_id: &str,
    version: Option<&str>,
    platform: &str,
) -> Result<(String, Option<String>, String), String> {
    let target_version = match version {
        Some(version) => version.to_string(),
        None => {
            let detail = crate::plugins::tabularium::fetch_plugin_detail(base, plugin_id).await?;
            if !detail.latest_version.is_empty() {
                detail.latest_version
            } else {
                detail
                    .releases
                    .first()
                    .map(|release| release.version.clone())
                    .ok_or_else(|| {
                        format!("Plugin '{plugin_id}' has no releases on the registry")
                    })?
            }
        }
    };
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

fn json<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests;
