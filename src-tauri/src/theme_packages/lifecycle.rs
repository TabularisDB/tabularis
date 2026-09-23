use super::{
    catalog, files, validate_manifest_json, validate_theme_archive, ThemeCommit, ThemeContribution,
    ValidatedThemePackage,
};
use fs2::FileExt;
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

pub const ARCHIVE_BYTES: usize = 8 * 1024 * 1024;

pub fn local_registry_key() -> String {
    format!("{:x}", Sha256::digest(b"tabularis:local-theme-packages:v1"))
}

pub fn read_local_archive(path: &Path) -> Result<Vec<u8>, String> {
    files::check_path(path)?;
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > ARCHIVE_BYTES as u64 {
        return Err("Local theme archive exceeds its byte limit or is not a regular file".into());
    }
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|e| e.to_string())?
        .take(ARCHIVE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > ARCHIVE_BYTES {
        return Err("Local theme archive exceeds its byte limit".into());
    }
    Ok(bytes)
}

/// Local identity discovery still preflights the ZIP BEFORE library indexing.
pub fn validate_local_archive(
    bytes: &[u8],
    host: &str,
    cancelled: &impl Fn() -> Result<(), String>,
) -> Result<ValidatedThemePackage, String> {
    cancelled()?;
    if bytes.len() > ARCHIVE_BYTES {
        return Err("Theme archive exceeds its byte limit".into());
    }
    super::zip_layout::preflight_zip(bytes, 128)?;
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let manifest = archive.by_name(".tabularium").map_err(|e| e.to_string())?;
    if manifest.size() > 64 * 1024 {
        return Err("Theme manifest exceeds its byte limit".into());
    }
    let mut source = Vec::new();
    manifest
        .take(64 * 1024 + 1)
        .read_to_end(&mut source)
        .map_err(|e| e.to_string())?;
    let value = validate_manifest_json(&source)?;
    validate_theme_archive(
        bytes,
        super::package_id(&value)?,
        catalog::label(&value, "version")?,
        host,
        cancelled,
    )
}

#[derive(Serialize)]
pub struct LocalThemePreview {
    pub digest: String,
    pub manifest: serde_json::Value,
    pub variants: Vec<ThemeContribution>,
}

pub fn local_preview(bytes: &[u8], host: &str) -> Result<LocalThemePreview, String> {
    let package = validate_local_archive(bytes, host, &|| Ok(()))?;
    let key = local_registry_key();
    let name = super::package_id(&package.manifest)?;
    let version = catalog::label(&package.manifest, "version")?;
    let mut variants = Vec::new();
    for variant in package.manifest["theme_variants"]
        .as_array()
        .ok_or("Missing theme variants")?
    {
        let id = catalog::label(variant, "id")?;
        let source = String::from_utf8(package.files[catalog::label(variant, "file")?].clone())
            .map_err(|e| e.to_string())?;
        variants.push(ThemeContribution {
            id: format!("theme:{key}:{name}:{id}"), name: catalog::label(variant, "name")?.into(),
            revision: catalog::revision(&source), origin: json!({"kind":"installed","identity":{"registryKey":key,"packageName":name,"variantId":id},"packageVersion":version}),
            read_only:true, mode:catalog::label(&package.definitions[catalog::label(variant, "file")?], "mode")?.into(), format:"v1".into(), source,
            available:true, editor:None,
        });
    }
    Ok(LocalThemePreview {
        digest: format!("{:x}", Sha256::digest(bytes)),
        manifest: package.manifest,
        variants,
    })
}

pub(super) fn validate_package_name(package: &str) -> Result<(), String> {
    if !super::is_package_slug(package) {
        return Err("Invalid theme package name".into());
    }
    Ok(())
}

fn package_location(
    root: &Path,
    registry: &str,
    package: &str,
) -> Result<(PathBuf, PathBuf), String> {
    validate_package_name(package)?;
    if registry.len() != 64
        || !registry
            .bytes()
            .all(|c| c.is_ascii_digit() || matches!(c, b'a'..=b'f'))
    {
        return Err("Invalid installed theme identity".into());
    }
    let location = super::locations::resolve_package(root, package)?;
    if super::locations::package_registry(&location)? != registry {
        return Err("Installed theme identity changed; refresh the catalog".into());
    }
    let namespace = location.parent().ok_or("Missing theme parent")?.to_path_buf();
    files::check_path(&location)?;
    if !fs::symlink_metadata(&location)
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        return Err("Installed theme package is not a directory".into());
    }
    Ok((namespace, location))
}

fn lock_namespace(namespace: &Path) -> Result<File, String> {
    let path = namespace.join(".lock");
    files::check_path(&path)?;
    match fs::symlink_metadata(&path) {
        Ok(meta) if !meta.is_file() => return Err("Invalid theme storage lock".into()),
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.to_string()),
        _ => (),
    }
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|e| e.to_string())?;
    FileExt::try_lock_exclusive(&file)
        .map_err(|_| "Another theme operation is in progress".to_string())?;
    Ok(file)
}

pub fn set_package_enabled(
    root: &Path,
    registry: &str,
    package: &str,
    enabled: bool,
) -> Result<(), String> {
    let storage = root.join(catalog::PACKAGES_DIR).join(super::locations::directory_name());
    // Serialize flat-bundle mutations with installs into the canonical folder.
    package_location(root, registry, package)?;
    files::create_directory(&storage)?;
    let _lock = lock_namespace(&storage)?;
    let (namespace, _) = package_location(root, registry, package)?;
    let marker = namespace.join(format!(".disabled-{package}"));
    files::check_path(&marker)?;
    if enabled {
        match fs::remove_file(marker) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    } else {
        files::atomic_write(&marker, b"1", true)
    }
}

pub fn remove_package(root: &Path, registry: &str, package: &str) -> Result<ThemeCommit, String> {
    let storage = root.join(catalog::PACKAGES_DIR).join(super::locations::directory_name());
    package_location(root, registry, package)?;
    files::create_directory(&storage)?;
    let _lock = lock_namespace(&storage)?;
    let (namespace, location) = package_location(root, registry, package)?;
    let fallback = root.join(catalog::PACKAGES_DIR).join(package);
    if !crate::plugins::layout::is_kind_directory(package) && fallback != location
        && super::locations::is_theme_package(&fallback).unwrap_or(false) {
        fs::remove_dir_all(&fallback).map_err(|e| e.to_string())?;
    }
    let removed = namespace.join(format!(".removed-{}", uuid::Uuid::new_v4()));
    fs::rename(location, &removed).map_err(|e| e.to_string())?;
    let mut warnings = Vec::new();
    if let Err(error) = fs::remove_dir_all(&removed) {
        warnings.push(format!("Theme removed; deferred cleanup: {error}"));
    }
    // Keep the stable namespace lock and disable marker. Reinstall restores the
    // user's enabled/disabled state; deleting a lock inode could split waiters.
    Ok(ThemeCommit { warnings })
}
