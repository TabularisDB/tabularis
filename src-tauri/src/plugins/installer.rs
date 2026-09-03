use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::time::sleep;

use super::install_cancellation::{InstallCancellation, INSTALL_CANCELLED_ERROR};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InstalledPluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
}

#[derive(Deserialize)]
struct InstalledPluginManifest {
    /// Legacy manifests carried an explicit `id`; the canonical schema uses
    /// `name` as the slug/identity, so this is optional and falls back to `name`.
    #[serde(default)]
    id: Option<String>,
    name: String,
    /// The registry guarantees `version` in the manifest (`.tabularium`).
    version: String,
    description: String,
    /// First Tabularis release this plugin can run on, if it declares one.
    #[serde(default)]
    min_runtime_version: Option<String>,
}

pub fn get_plugins_dir() -> Result<PathBuf, String> {
    let plugins_dir = crate::paths::get_app_data_dir().join("plugins");
    if !plugins_dir.exists() {
        fs::create_dir_all(&plugins_dir)
            .map_err(|e| format!("Failed to create plugins directory: {}", e))?;
    }
    Ok(plugins_dir)
}

/// Plugins directory used by builds before the project dirs were unified under
/// `tabularis` (the old `com.debba.tabularis` identifier). On Linux this equals
/// the current directory, so callers must guard against migrating onto itself.
fn legacy_plugins_dir() -> Option<PathBuf> {
    ProjectDirs::from("com", "debba", "tabularis").map(|pd| pd.data_dir().join("plugins"))
}

fn dir_has_entries(dir: &Path) -> bool {
    fs::read_dir(dir)
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false)
}

/// Move plugin folders from `legacy` into `target`. No-op when there is nothing
/// to move, when the paths are identical (Linux), or when `target` already holds
/// plugins (never clobber an existing install). Returns the number of folders
/// moved. Best-effort: per-entry failures are logged and skipped.
pub(crate) fn migrate_plugins_between(legacy: &Path, target: &Path) -> usize {
    if legacy == target || !legacy.is_dir() || dir_has_entries(target) {
        return 0;
    }

    let entries = match fs::read_dir(legacy) {
        Ok(entries) => entries,
        Err(e) => {
            log::error!("Plugin migration: failed to read {:?}: {}", legacy, e);
            return 0;
        }
    };
    if let Err(e) = fs::create_dir_all(target) {
        log::error!("Plugin migration: failed to create {:?}: {}", target, e);
        return 0;
    }

    let mut moved = 0;
    for entry in entries.flatten() {
        let dest = target.join(entry.file_name());
        if dest.exists() {
            continue;
        }
        match fs::rename(entry.path(), &dest) {
            Ok(()) => moved += 1,
            Err(e) => log::error!(
                "Plugin migration: failed to move {:?} -> {:?}: {}",
                entry.path(),
                dest,
                e
            ),
        }
    }
    // Best-effort cleanup of the now-empty legacy directory.
    let _ = fs::remove_dir(legacy);
    moved
}

/// One-time migration: relocate plugins from the legacy `com.debba.tabularis`
/// project dir into the unified `tabularis` data dir. Safe to call on every
/// startup — it only does work the first time after upgrading.
pub fn migrate_legacy_plugins_dir() {
    let Some(legacy) = legacy_plugins_dir() else {
        return;
    };
    let target = crate::paths::get_app_data_dir().join("plugins");
    let moved = migrate_plugins_between(&legacy, &target);
    if moved > 0 {
        log::info!(
            "Migrated {} plugin(s) from legacy directory {:?} to {:?}",
            moved,
            legacy,
            target
        );
    }
}

/// Canonical plugin bundle manifest. JSON content. The preferred manifest; the
/// only fallback is the removable `manifest.json` legacy path in `read_manifest`
/// (see `COMPAT(registry-ga)`), which goes away once all plugins republish.
const MANIFEST_FILE: &str = ".tabularium";

/// Whether a directory contains a bundle manifest `read_manifest` can read —
/// including the legacy `manifest.json` fallback, so callers gating on this
/// don't reject bundles the read path would happily accept.
pub fn has_manifest(dir: &Path) -> bool {
    dir.join(MANIFEST_FILE).exists() || crate::plugins::compat::has_legacy_manifest(dir)
}

/// Reads and deserialises a plugin bundle's `.tabularium` manifest (JSON).
pub fn read_manifest<T: serde::de::DeserializeOwned>(dir: &Path) -> Result<T, String> {
    let path = dir.join(MANIFEST_FILE);
    if !path.exists() {
        // COMPAT(registry-ga): fall back to legacy manifest.json.
        if let Some(legacy) = crate::plugins::compat::read_legacy_manifest::<T>(dir) {
            log::warn!("Using legacy manifest.json in {:?} — republish as .tabularium", dir);
            return legacy;
        }
        return Err(format!(
            "No .tabularium manifest in {:?} — this plugin bundle must ship a .tabularium (JSON)",
            dir
        ));
    }
    let manifest_str = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read plugin manifest {:?}: {}", path, e))?;
    serde_json::from_str(&manifest_str)
        .map_err(|e| format!("Failed to parse plugin manifest {:?}: {}", path, e))
}

pub(crate) fn read_plugin_info_from_dir(path: &Path) -> Result<InstalledPluginInfo, String> {
    let manifest: InstalledPluginManifest = read_manifest(path)?;
    let id = manifest.id.unwrap_or_else(|| manifest.name.clone());

    Ok(InstalledPluginInfo {
        id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
    })
}

pub async fn download_and_install(
    plugin_id: &str,
    download_url: &str,
    expected_sha256: Option<&str>,
    expected_version: Option<&str>,
    cancellation: &InstallCancellation,
) -> Result<(), String> {
    cancellation.check()?;
    let plugins_dir = get_plugins_dir()?;
    let tmp_dir = plugins_dir.join(format!(".tmp-{}", plugin_id));
    let final_dir = plugins_dir.join(plugin_id);

    // Clean up any leftover temp dir
    if tmp_dir.exists() {
        fs::remove_dir_all(&tmp_dir)
            .map_err(|e| format!("Failed to clean temp directory: {}", e))?;
    }

    // Download ZIP to memory
    log::info!("Downloading plugin '{}' from: {}", plugin_id, download_url);
    let response = tokio::select! {
        biased;
        _ = cancellation.cancelled() => return Err(INSTALL_CANCELLED_ERROR.to_string()),
        result = reqwest::get(download_url) => {
            result.map_err(|e| format!("Failed to download plugin: {}", e))?
        }
    };

    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();
    log::info!(
        "Download response for '{}': HTTP {} (content-type: {})",
        plugin_id,
        status,
        content_type
    );

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let snippet = body.chars().take(200).collect::<String>();
        log::error!(
            "Plugin '{}' download failed — HTTP {}: {}",
            plugin_id,
            status,
            snippet
        );
        return Err(format!(
            "Failed to download plugin: server returned HTTP {} for URL: {}",
            status, download_url
        ));
    }

    let bytes = tokio::select! {
        biased;
        _ = cancellation.cancelled() => return Err(INSTALL_CANCELLED_ERROR.to_string()),
        result = response.bytes() => {
            result.map_err(|e| format!("Failed to read plugin download: {}", e))?
        }
    };

    log::info!(
        "Plugin '{}' downloaded {} bytes (content-type: {})",
        plugin_id,
        bytes.len(),
        content_type
    );

    // Verify SHA-256 if the registry advertised one. The Tabularium
    // registry signs releases with a sha256 in the integrity envelope
    // (see https://docs.tabularium.wiki/consuming/) — refusing to install
    // on mismatch is what protects users from a tampered upstream asset.
    // The legacy GitHub-hosted registry doesn't publish hashes, so this
    // check is opt-in per call.
    if let Some(expected) = expected_sha256 {
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let actual = format!("{:x}", hasher.finalize());
        if !actual.eq_ignore_ascii_case(expected) {
            log::error!(
                "Plugin '{}' SHA-256 mismatch: expected {}, got {}",
                plugin_id,
                expected,
                actual
            );
            return Err(format!(
                "SHA-256 mismatch for plugin '{}': expected {}, got {} — asset may be tampered or corrupted",
                plugin_id, expected, actual
            ));
        }
        log::info!("Plugin '{}' SHA-256 verified ({})", plugin_id, actual);
    }

    cancellation.check()?;

    // Extract to temp dir
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("Failed to create temp directory: {}", e))?;

    let cursor = std::io::Cursor::new(bytes.clone());
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| {
        log::error!(
            "Plugin '{}': failed to open ZIP archive ({} bytes, content-type: {}): {}",
            plugin_id,
            bytes.len(),
            content_type,
            e
        );
        format!(
            "Failed to open ZIP archive: {} (downloaded {} bytes from {})",
            e,
            bytes.len(),
            download_url
        )
    })?;

    for i in 0..archive.len() {
        if cancellation.is_cancelled() {
            drop(archive);
            fs::remove_dir_all(&tmp_dir).ok();
            return Err(INSTALL_CANCELLED_ERROR.to_string());
        }

        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry: {}", e))?;

        let out_path = match file.enclosed_name() {
            Some(path) => tmp_dir.join(path),
            None => continue,
        };

        if file.name().ends_with('/') {
            fs::create_dir_all(&out_path)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        } else {
            if let Some(parent) = out_path.parent() {
                if !parent.exists() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create parent directory: {}", e))?;
                }
            }
            let mut buf = Vec::new();
            let mut chunk = [0_u8; 64 * 1024];
            while !cancellation.is_cancelled() {
                let read = file
                    .read(&mut chunk)
                    .map_err(|e| format!("Failed to read ZIP file content: {}", e))?;
                if read == 0 {
                    break;
                }
                buf.extend_from_slice(&chunk[..read]);
            }
            if cancellation.is_cancelled() {
                drop(file);
                drop(archive);
                fs::remove_dir_all(&tmp_dir).ok();
                return Err(INSTALL_CANCELLED_ERROR.to_string());
            }
            fs::write(&out_path, &buf).map_err(|e| format!("Failed to write file: {}", e))?;

            // Set executable permissions on Unix
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Some(mode) = file.unix_mode() {
                    fs::set_permissions(&out_path, fs::Permissions::from_mode(mode))
                        .map_err(|e| format!("Failed to set permissions: {}", e))?;
                }
            }
        }
    }

    // Validate the bundle ships a manifest that deserialises with the required
    // fields (notably `version` — the strict-mode drift catch), and that its
    // identity/version match what the registry advertised. All of this happens
    // while the bundle is still in the temp dir: a bad archive must never
    // replace an existing installation or linger as a half-installed plugin.
    if !has_manifest(&tmp_dir) {
        fs::remove_dir_all(&tmp_dir).ok();
        return Err("Plugin archive does not contain a .tabularium manifest".to_string());
    }
    let manifest = match read_manifest::<InstalledPluginManifest>(&tmp_dir) {
        Ok(m) => m,
        Err(e) => {
            fs::remove_dir_all(&tmp_dir).ok();
            return Err(format!("Invalid plugin manifest: {}", e));
        }
    };
    // The canonical schema uses `name` as the identity; legacy manifests may
    // carry an explicit `id`.
    let manifest_id = manifest.id.clone().unwrap_or_else(|| manifest.name.clone());
    if manifest_id != plugin_id {
        fs::remove_dir_all(&tmp_dir).ok();
        return Err(format!(
            "Plugin archive mismatch: registry expected id '{}' but the archive manifest reports '{}'. Installation aborted.",
            plugin_id, manifest_id
        ));
    }
    if let Some(expected) = expected_version {
        if manifest.version != expected {
            fs::remove_dir_all(&tmp_dir).ok();
            return Err(format!(
                "Plugin archive version mismatch: registry expected version '{}' but the archive manifest reports '{}'. The published asset appears inconsistent. Installation aborted.",
                expected, manifest.version
            ));
        }
    }
    // The marketplace hides incompatible releases, but archives can also be
    // installed by URL or from a local file, so gate the host version here
    // while the bundle is still in the temp dir.
    if let Err(e) = super::runtime_version::enforce_min_runtime_version(
        &manifest_id,
        manifest.min_runtime_version.as_deref(),
    ) {
        fs::remove_dir_all(&tmp_dir).ok();
        return Err(e);
    }

    // Cancellation remains safe until this commit point: the existing plugin
    // is still registered and its files have not been touched.
    if cancellation.is_cancelled() {
        fs::remove_dir_all(&tmp_dir).ok();
        return Err(INSTALL_CANCELLED_ERROR.to_string());
    }

    // Updating an installed plugin must stop its process immediately before
    // replacing files, otherwise the OS may keep them locked. Once this short
    // commit phase starts, installation is completed atomically rather than
    // leaving the existing plugin disabled.
    if final_dir.exists() {
        crate::drivers::registry::unregister_driver(plugin_id).await;
        crate::drivers::registry::unregister_manifest(plugin_id).await;
        sleep(Duration::from_millis(500)).await;
        fs::remove_dir_all(&final_dir)
            .map_err(|e| format!("Failed to remove existing plugin: {}", e))?;
    }

    // Rename temp to final
    fs::rename(&tmp_dir, &final_dir)
        .map_err(|e| format!("Failed to finalize plugin installation: {}", e))?;

    log::info!("Plugin '{}' installed successfully", plugin_id);
    Ok(())
}

pub fn uninstall(plugin_id: &str) -> Result<(), String> {
    let plugins_dir = get_plugins_dir()?;
    let mut plugin_dir = plugins_dir.join(plugin_id);

    // The directory normally matches the plugin id, but manually copied or
    // legacy bundles may live in a folder named differently from the manifest
    // id — those still show up as installed (list_installed reads manifests),
    // so resolve them by scanning manifests before giving up.
    if !plugin_dir.exists() {
        plugin_dir = find_plugin_dir_by_id(&plugins_dir, plugin_id)
            .ok_or_else(|| format!("Plugin '{}' is not installed", plugin_id))?;
    }

    fs::remove_dir_all(&plugin_dir)
        .map_err(|e| format!("Failed to remove plugin '{}': {}", plugin_id, e))?;

    log::info!("Plugin '{}' uninstalled successfully", plugin_id);
    Ok(())
}

/// Scans the plugins directory for a bundle whose manifest id matches
/// `plugin_id`, regardless of the directory name.
fn find_plugin_dir_by_id(plugins_dir: &Path, plugin_id: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(plugins_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() || !has_manifest(&path) {
            continue;
        }
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.starts_with(".tmp-") {
                continue;
            }
        }
        if let Ok(info) = read_plugin_info_from_dir(&path) {
            if info.id == plugin_id {
                return Some(path);
            }
        }
    }
    None
}

pub fn list_installed() -> Result<Vec<InstalledPluginInfo>, String> {
    let plugins_dir = get_plugins_dir()?;
    let mut plugins = Vec::new();

    let entries = match fs::read_dir(&plugins_dir) {
        Ok(e) => e,
        Err(_) => return Ok(plugins),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        // Skip temp directories
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.starts_with(".tmp-") {
                continue;
            }
        }

        if !has_manifest(&path) {
            continue;
        }

        if let Ok(plugin) = read_plugin_info_from_dir(&path) {
            plugins.push(plugin);
        }
    }

    Ok(plugins)
}
