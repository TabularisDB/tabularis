//! Explicit legacy rule: absent kind means driver (including UI-only drivers).
//! Declarative themes must never reach executable permissions or registration.
use std::io::{Read, Seek};

#[cfg(test)]
#[path = "package_kind_tests.rs"]
mod tests;

pub const KIND_ERROR: &str = "Unsupported package kind for driver installation";

pub fn require_driver_kind(source: &[u8]) -> Result<(), String> {
    let value = crate::theme_packages::parse_bounded_json(source, 4 * 1024 * 1024, 128, 262_144)?;
    if !value.is_object() {
        return Err(KIND_ERROR.into());
    }
    match value.get("kind") {
        None => Ok(()),
        Some(serde_json::Value::String(kind)) if kind == "driver" => Ok(()),
        _ => Err(KIND_ERROR.into()),
    }
}

pub fn validate_archive_kind<R: Read + Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> Result<(), String> {
    let name = if archive.file_names().any(|name| name == ".tabularium") {
        ".tabularium"
    } else {
        "manifest.json"
    };
    let mut source = Vec::new();
    let manifest = archive
        .by_name(name)
        .map_err(|e| format!("Missing driver manifest: {e}"))?;
    if manifest.size() > 4 * 1024 * 1024 {
        return Err("Driver manifest exceeds byte limit".into());
    }
    manifest
        .take(4 * 1024 * 1024 + 1)
        .read_to_end(&mut source)
        .map_err(|e| e.to_string())?;
    require_driver_kind(&source)
}
