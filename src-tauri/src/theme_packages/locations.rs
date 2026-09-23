//! Disk layout is based on package kind, not on registry URL.
use super::{catalog, files, lifecycle, validation};
use std::path::{Path, PathBuf};

pub(super) const KIND: &str = "theme";
pub(super) const ORIGIN_FILE: &str = ".tabularis-origin";

pub(super) fn directory_name() -> &'static str {
    crate::plugins::layout::kind_directory(KIND)
}

/// Host-written provenance preserves existing selection IDs without encoding
/// the registry into directory names. Manually copied packages need no metadata.
pub(super) fn package_registry(folder: &Path) -> Result<String, String> {
    let path = folder.join(ORIGIN_FILE);
    match std::fs::symlink_metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(lifecycle::local_registry_key()),
        Err(e) => Err(e.to_string()),
        Ok(_) => {
            let key = files::read_file(&path, 64)?;
            if !validation::is_registry_namespace(&key) {
                return Err("Invalid installed theme provenance".into());
            }
            Ok(key)
        }
    }
}

pub(super) fn is_theme_package(folder: &Path) -> Result<bool, String> {
    let source = files::read_file(&folder.join(".tabularium"), 64 * 1024)?;
    let value = super::json::parse_bounded_json(source.as_bytes(), 64 * 1024, 128, 262_144)?;
    Ok(value["kind"] == "theme"
        && validation::package_id(&value).ok() == folder.file_name().and_then(|name| name.to_str()))
}

pub(super) fn resolve_package(root: &Path, package: &str) -> Result<PathBuf, String> {
    lifecycle::validate_package_name(package)?;
    let plugins = root.join(catalog::PACKAGES_DIR);
    let typed = plugins.join(directory_name()).join(package);
    // Do not fall back around corrupt/symlinked canonical paths.
    let path = match std::fs::symlink_metadata(&typed) {
        Ok(_) => typed,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if crate::plugins::layout::is_kind_directory(package) {
                return Err("Kind directory names cannot be flat theme packages".into());
            }
            plugins.join(package)
        }
        Err(e) => return Err(e.to_string()),
    };
    files::check_path(&path)?;
    if !is_theme_package(&path)? {
        return Err("Package is not a theme".into());
    }
    Ok(path)
}
