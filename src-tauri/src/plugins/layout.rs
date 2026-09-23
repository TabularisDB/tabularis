//! Kind-first discovery. Installers always write under the kind directory;
//! flat bundles remain readable for manual and historical installations.
use super::installer::{has_manifest, read_manifest};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

/// Folder aliases are independent of the manifest kind. New kinds keep their name.
pub(crate) fn kind_directory(kind: &str) -> &str {
    match kind {
        "theme" => "themes",
        "driver" => "drivers",
        other => other,
    }
}

/// Containers must never be mistaken for removable flat package bundles.
pub(crate) fn is_kind_directory(name: &str) -> bool {
    ["theme", "driver"]
        .iter()
        .any(|kind| kind_directory(kind) == name)
}

pub(crate) fn driver_destination(root: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
    {
        return Err("Invalid driver package identity".into());
    }
    Ok(root.join(kind_directory("driver")).join(id))
}

/// Include corrupt driver manifests so startup can report them, but never
/// attempt to activate explicitly declarative/unsupported package kinds.
pub(crate) fn driver_candidates(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut paths = Vec::new();
    for parent in [root.join(kind_directory("driver")), root.to_path_buf()] {
        let entries = match fs::read_dir(&parent) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.to_string()),
        };
        let mut children = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if (parent == root && is_kind_directory(&entry.file_name().to_string_lossy()))
                || entry.file_name().to_string_lossy().starts_with('.')
                || !entry.file_type().map_err(|e| e.to_string())?.is_dir()
                || !has_manifest(&path)
            {
                continue;
            }
            if read_manifest::<serde_json::Value>(&path)
                .is_err_and(|e| e == super::package_kind::KIND_ERROR)
            {
                continue;
            }
            children.push(path);
        }
        children.sort();
        paths.extend(children);
    }
    Ok(paths)
}

pub(crate) fn driver_identity(path: &Path) -> Option<String> {
    let manifest = read_manifest::<serde_json::Value>(path).ok()?;
    manifest
        .get("id")
        .and_then(serde_json::Value::as_str)
        .or_else(|| manifest.get("name").and_then(serde_json::Value::as_str))
        .map(str::to_owned)
}

pub(crate) fn driver_directories(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut seen = HashSet::new();
    Ok(driver_candidates(root)?
        .into_iter()
        .filter(|path| {
            let id = driver_identity(path)
                .unwrap_or_else(|| path.file_name().unwrap().to_string_lossy().into_owned());
            seen.insert(id)
        })
        .collect())
}

pub(crate) fn resolve_driver(root: &Path, id: &str) -> Result<PathBuf, String> {
    driver_destination(root, id)?;
    driver_directories(root)?
        .into_iter()
        .find(|path| driver_identity(path).as_deref() == Some(id))
        .ok_or_else(|| format!("Plugin '{}' is not installed", id))
}

#[cfg(test)]
#[path = "layout_tests.rs"]
mod tests;
