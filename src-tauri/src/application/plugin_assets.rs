use crate::plugins::installer;
use crate::plugins::manager::ConfigManifest;
use std::path::{Component, Path, PathBuf};

const MAX_PLUGIN_ASSET_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug)]
pub struct PluginAsset {
    pub bytes: Vec<u8>,
    pub content_type: &'static str,
}

pub fn read_plugin_asset(
    plugins_dir: &Path,
    plugin_id: &str,
    asset_path: &str,
) -> Result<PluginAsset, String> {
    super::plugins::validate_plugin_id(plugin_id)?;
    let normalized_path = normalize_relative_path(asset_path)?;
    let plugin_dir = plugins_dir.join(plugin_id);
    let manifest: ConfigManifest = installer::read_manifest(&plugin_dir)
        .map_err(|error| format!("Failed to read manifest for '{plugin_id}': {error}"))?;
    let content_type = authorized_content_type(&manifest, &normalized_path)?;

    let canonical_plugin_dir = plugin_dir
        .canonicalize()
        .map_err(|_| "Plugin asset was not found".to_string())?;
    let full_path = canonical_plugin_dir.join(&normalized_path);
    let canonical_asset = full_path
        .canonicalize()
        .map_err(|_| "Plugin asset was not found".to_string())?;
    if !canonical_asset.starts_with(&canonical_plugin_dir) || !canonical_asset.is_file() {
        return Err("Plugin asset was not found".to_string());
    }
    let metadata = std::fs::metadata(&canonical_asset)
        .map_err(|_| "Plugin asset was not found".to_string())?;
    if metadata.len() > MAX_PLUGIN_ASSET_BYTES {
        return Err("Plugin asset exceeds the 8 MiB limit".to_string());
    }
    let bytes =
        std::fs::read(canonical_asset).map_err(|_| "Plugin asset was not found".to_string())?;
    Ok(PluginAsset {
        bytes,
        content_type,
    })
}

pub fn read_plugin_asset_text(
    plugins_dir: &Path,
    plugin_id: &str,
    asset_path: &str,
) -> Result<String, String> {
    let asset = read_plugin_asset(plugins_dir, plugin_id, asset_path)?;
    String::from_utf8(asset.bytes).map_err(|_| "Plugin asset is not valid UTF-8".to_string())
}

fn authorized_content_type(
    manifest: &ConfigManifest,
    normalized_path: &Path,
) -> Result<&'static str, String> {
    if is_declared_ui_module(manifest, normalized_path) {
        return match normalized_path.extension().and_then(|value| value.to_str()) {
            Some("js" | "mjs") => Ok("text/javascript; charset=utf-8"),
            _ => Err("Plugin UI modules must be JavaScript bundles".to_string()),
        };
    }
    if is_locale_asset(normalized_path) {
        return Ok("application/json; charset=utf-8");
    }
    Err("Plugin asset is not declared for UI use".to_string())
}

fn is_declared_ui_module(manifest: &ConfigManifest, normalized_path: &Path) -> bool {
    manifest
        .ui_extensions
        .as_deref()
        .unwrap_or_default()
        .iter()
        .filter_map(|entry| normalize_relative_path(&entry.module).ok())
        .any(|module| module == normalized_path)
}

fn is_locale_asset(path: &Path) -> bool {
    let components = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .collect::<Vec<_>>();
    if components.len() != 2 || components[0] != "locales" {
        return false;
    }
    let Some(language) = components[1].strip_suffix(".json") else {
        return false;
    };
    !language.is_empty()
        && language.len() <= 35
        && language
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn normalize_relative_path(value: &str) -> Result<PathBuf, String> {
    if value.is_empty() || value.len() > 512 {
        return Err("Invalid plugin asset path".to_string());
    }
    let normalized_separators = value.replace('\\', "/");
    let mut normalized = PathBuf::new();
    for component in Path::new(&normalized_separators).components() {
        match component {
            Component::CurDir => {}
            Component::Normal(segment) if !segment.is_empty() => normalized.push(segment),
            _ => return Err("Invalid plugin asset path".to_string()),
        }
    }
    if normalized.as_os_str().is_empty() {
        return Err("Invalid plugin asset path".to_string());
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests;
