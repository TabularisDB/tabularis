use std::fs;
use std::io::Read;
use std::path::PathBuf;

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InstalledPluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
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

pub async fn download_and_install(plugin_id: &str, download_url: &str) -> Result<(), String> {
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

    // Validate manifest.json exists
    let manifest_path = tmp_dir.join("manifest.json");
    if !manifest_path.exists() {
        fs::remove_dir_all(&tmp_dir).ok();
        return Err("Plugin archive does not contain manifest.json".to_string());
    }

    // Validate manifest.json parses correctly
    let manifest_str = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read manifest.json: {}", e))?;
    serde_json::from_str::<serde_json::Value>(&manifest_str).map_err(|e| {
        fs::remove_dir_all(&tmp_dir).ok();
        format!("Invalid manifest.json: {}", e)
    })?;

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

        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }

        let manifest_str = match fs::read_to_string(&manifest_path) {
            Ok(s) => s,
            Err(_) => continue,
        };

        #[derive(Deserialize)]
        struct Manifest {
            id: String,
            name: String,
            version: String,
            description: String,
        }

        let manifest: Manifest = match serde_json::from_str(&manifest_str) {
            Ok(m) => m,
            Err(_) => continue,
        };

        plugins.push(InstalledPluginInfo {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            description: manifest.description,
        });
    }

    Ok(plugins)
}
