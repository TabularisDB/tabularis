use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

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
}

pub fn get_plugins_dir() -> Result<PathBuf, String> {
    let proj_dirs = ProjectDirs::from("com", "debba", "tabularis")
        .ok_or_else(|| "Could not determine project directories".to_string())?;
    let plugins_dir = proj_dirs.data_dir().join("plugins");
    if !plugins_dir.exists() {
        fs::create_dir_all(&plugins_dir)
            .map_err(|e| format!("Failed to create plugins directory: {}", e))?;
    }
    Ok(plugins_dir)
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

pub fn read_installed_plugin(plugin_id: &str) -> Result<InstalledPluginInfo, String> {
    let plugins_dir = get_plugins_dir()?;
    read_plugin_info_from_dir(&plugins_dir.join(plugin_id))
}

pub async fn download_and_install(
    plugin_id: &str,
    download_url: &str,
    expected_sha256: Option<&str>,
) -> Result<(), String> {
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
    let response = reqwest::get(download_url)
        .await
        .map_err(|e| format!("Failed to download plugin: {}", e))?;

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

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read plugin download: {}", e))?;

    log::info!(
        "Plugin '{}' downloaded {} bytes (content-type: {})",
        plugin_id,
        bytes.len(),
        content_type
    );

    // Verify SHA-256 if the registry advertised one. The Tabularium
    // registry signs releases with a sha256 in the integrity envelope
    // (see https://tabularium.wiki/docs/#/consuming) — refusing to install
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
            file.read_to_end(&mut buf)
                .map_err(|e| format!("Failed to read ZIP file content: {}", e))?;
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

    // Validate the bundle ships a manifest and that it deserialises into a
    // well-formed one with the required fields (notably `version` — the
    // strict-mode drift catch).
    if !has_manifest(&tmp_dir) {
        fs::remove_dir_all(&tmp_dir).ok();
        return Err("Plugin archive does not contain a .tabularium manifest".to_string());
    }
    if let Err(e) = read_manifest::<InstalledPluginManifest>(&tmp_dir) {
        fs::remove_dir_all(&tmp_dir).ok();
        return Err(format!("Invalid plugin manifest: {}", e));
    }

    // Remove existing plugin dir if present
    if final_dir.exists() {
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
    let plugin_dir = plugins_dir.join(plugin_id);

    if !plugin_dir.exists() {
        return Err(format!("Plugin '{}' is not installed", plugin_id));
    }

    fs::remove_dir_all(&plugin_dir)
        .map_err(|e| format!("Failed to remove plugin '{}': {}", plugin_id, e))?;

    log::info!("Plugin '{}' uninstalled successfully", plugin_id);
    Ok(())
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
