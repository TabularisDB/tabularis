use super::catalog_models::{PersonalDocument, ThemeCatalog, ThemeContribution};
use super::{
    files, legacy, validate_definition_json, validate_manifest_json, validate_runtime_version,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashSet};
use std::path::{Path, PathBuf};

pub(super) const PERSONAL_DIR: &str = "theme-personal-v1";
/// Installed packages live in `plugins/<kind-folder>/<package>/`. Flat packages
/// remain a read fallback; manifests keep declarative themes out of drivers.
pub(super) const PACKAGES_DIR: &str = "plugins";
const CATALOG_BYTES: usize = 32 * 1024 * 1024;

pub(super) fn revision(source: &str) -> String {
    format!("{:x}", Sha256::digest(source.as_bytes()))
}

pub(super) fn label<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Missing theme field {key}"))
}

pub(super) fn legacy_mode(value: &Value) -> String {
    match value.pointer("/monacoTheme/base").and_then(Value::as_str) {
        Some("vs" | "hc-light") => "light",
        Some("hc-black") => "high-contrast",
        _ => "dark",
    }
    .into()
}

fn legacy_entry(source: String, builtin: bool) -> Result<ThemeContribution, String> {
    let value = legacy::parse_legacy(&source)?;
    let id = label(&value, "id")?.to_string();
    if !builtin {
        legacy::existing_personal_id(&id)?;
    }
    Ok(ThemeContribution {
        id,
        name: label(&value, "name")?.into(),
        revision: revision(&source),
        origin: json!({"kind": if builtin { "builtin" } else { "personal" }}),
        read_only: builtin,
        mode: legacy_mode(&value),
        format: "legacy".into(),
        source,
        available: true,
        editor: None,
    })
}

pub(super) fn personal_entry(source: &str) -> Result<ThemeContribution, String> {
    let document: PersonalDocument = serde_json::from_value(super::json::parse_bounded_json(
        source.as_bytes(),
        legacy::LEGACY_BYTES * 2,
        128,
        262_144,
    )?)
    .map_err(|e| e.to_string())?;
    if document.storage_version != 1 {
        return Err("Unsupported personal theme storage version".into());
    }
    legacy::personal_id(&document.id)?;
    validate_name(&document.name)?;
    let mode = match document.format.as_str() {
        "v1" => {
            if document.editor.is_some() {
                return Err("V1 personal themes cannot override host editor resolution".into());
            }
            label(
                &validate_definition_json(document.source.as_bytes())?,
                "mode",
            )?
            .to_string()
        }
        "legacy" => {
            let value = legacy::parse_legacy(&document.source)?;
            if label(&value, "id")? != document.id {
                return Err("Personal snapshot identity mismatch".into());
            }
            if let Some(editor) = &document.editor {
                super::snapshot::validate_editor_snapshot(editor)?;
            }
            document
                .editor
                .as_ref()
                .map(super::snapshot::snapshot_mode)
                .unwrap_or_else(|| legacy_mode(&value))
        }
        _ => return Err("Unsupported personal theme source format".into()),
    };
    Ok(ThemeContribution {
        id: document.id,
        name: document.name,
        revision: revision(source),
        origin: json!({"kind":"personal"}),
        read_only: false,
        mode,
        format: document.format,
        source: document.source,
        available: true,
        editor: document.editor,
    })
}

pub(super) fn validate_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() || name.chars().count() > 128 || name.chars().any(char::is_control) {
        return Err("Theme name must contain 1–128 printable characters".into());
    }
    Ok(())
}

fn package_files(
    root: &Path,
    current: &Path,
    paths: &mut BTreeSet<String>,
    bytes: &mut u64,
) -> Result<(), String> {
    for entry in files::directory(current)? {
        files::check_path(&entry.path())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let relative = entry
            .path()
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if (!super::is_safe_relative_path(&relative) && relative != super::locations::ORIGIN_FILE)
            || !paths.insert(relative.to_ascii_lowercase())
            || paths.len() > 129
        {
            return Err("Invalid, colliding or excessive installed package paths".into());
        }
        if metadata.is_dir() {
            package_files(root, &entry.path(), paths, bytes)?;
        } else if metadata.is_file() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if metadata.permissions().mode() & 0o111 != 0 {
                    return Err("Executable theme payload is forbidden".into());
                }
            }
            *bytes += metadata.len();
            if metadata.len() > 256 * 1024 || *bytes > 16 * 1024 * 1024 + 64 {
                return Err("Installed theme exceeds file limits".into());
            }
        } else {
            return Err("Installed themes may only contain regular files".into());
        }
    }
    Ok(())
}

fn package_entries(
    folder: &Path,
    host_version: &str,
    read_budget: &mut usize,
) -> Result<Vec<ThemeContribution>, String> {
    let registry = super::locations::package_registry(folder)?;
    let source = files::read_budgeted_file(&folder.join(".tabularium"), 64 * 1024, read_budget)?;
    let manifest = validate_manifest_json(source.as_bytes())?;
    validate_runtime_version(&manifest, host_version)?;
    let package = super::package_id(&manifest)?;
    if folder.file_name().and_then(|s| s.to_str()) != Some(package) {
        return Err("Installed package identity mismatch".into());
    }
    let version = label(&manifest, "version")?;
    let mut paths = BTreeSet::new();
    package_files(folder, folder, &mut paths, &mut 0)?;
    let mut allowed: HashSet<String> = [".tabularium", "readme.md", "license", "license.txt", super::locations::ORIGIN_FILE]
        .into_iter()
        .map(String::from)
        .collect();
    let variants = manifest["theme_variants"]
        .as_array()
        .ok_or("Missing variants")?;
    for variant in variants {
        let file = label(variant, "file")?;
        allowed.insert(file.to_ascii_lowercase());
        let mut parent = Path::new(file).parent();
        while let Some(path) = parent {
            if path.as_os_str().is_empty() {
                break;
            }
            allowed.insert(
                path.to_string_lossy()
                    .to_ascii_lowercase()
                    .replace('\\', "/"),
            );
            parent = path.parent();
        }
    }
    if paths.iter().any(|path| !allowed.contains(path)) {
        return Err("Unexpected installed theme payload".into());
    }
    let disabled_path = folder
        .parent()
        .ok_or("Missing namespace")?
        .join(format!(".disabled-{package}"));
    let available = match std::fs::symlink_metadata(&disabled_path) {
        Ok(_) => {
            if files::read_file(&disabled_path, 1)? != "1" {
                return Err("Invalid disabled theme marker".into());
            }
            false
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => true,
        Err(e) => return Err(e.to_string()),
    };
    for name in ["README.md", "LICENSE", "LICENSE.txt"] {
        let path = folder.join(name);
        if std::fs::symlink_metadata(&path).is_ok() {
            let text = files::read_budgeted_file(&path, 256 * 1024, read_budget)?;
            if text.contains('\0') {
                return Err("Theme documentation must be UTF-8 text".into());
            }
        }
    }
    let mut result = Vec::new();
    for variant in variants {
        let variant_id = label(variant, "id")?;
        let definition = files::read_budgeted_file(
            &folder.join(label(variant, "file")?),
            256 * 1024,
            read_budget,
        )?;
        let value = validate_definition_json(definition.as_bytes())?;
        result.push(ThemeContribution {
            id: format!("theme:{registry}:{package}:{variant_id}"),
            name: label(variant, "name")?.into(), revision: revision(&format!("{source}\n{definition}")),
            origin: json!({"kind":"installed", "identity":{"registryKey":registry,"packageName":package,"variantId":variant_id},"packageVersion":version}),
            read_only: true, mode: label(&value, "mode")?.into(), format: "v1".into(),
            source: definition, available, editor: None,
        });
    }
    Ok(result)
}

fn issue(catalog: &mut ThemeCatalog, error: &str) {
    if catalog.issues.len() < 128 {
        catalog.issues.push(error.chars().take(512).collect());
    }
}

fn append(catalog: &mut ThemeCatalog, remaining: &mut usize, entry: ThemeContribution) {
    if entry.source.len() > *remaining || catalog.themes.len() >= 4096 {
        issue(
            catalog,
            "Theme catalog budget exhausted; remaining sources are unavailable, not deleted",
        );
    } else {
        *remaining -= entry.source.len();
        catalog.themes.push(entry);
    }
}

/// Bounded native snapshot; never repairs files, creates directories or writes preferences.
/// `root` holds personal and historical themes (config dir); `data_root` holds
/// installed packages under [`PACKAGES_DIR`] (data dir).
pub fn read_theme_catalog(root: &Path, data_root: &Path, host_version: &str) -> ThemeCatalog {
    let mut catalog = ThemeCatalog::default();
    let mut remaining = CATALOG_BYTES;
    let mut read_budget = CATALOG_BYTES;
    for value in legacy::builtin_themes() {
        match legacy_entry(value.to_string(), true) {
            Ok(entry) => append(&mut catalog, &mut remaining, entry),
            Err(error) => issue(&mut catalog, &error),
        }
    }
    for (directory, modern) in [("themes", false), (PERSONAL_DIR, true)] {
        match files::directory(&root.join(directory)) {
            Ok(entries) => {
                for entry in entries.into_iter().take(4096) {
                    if read_budget == 0 {
                        break;
                    }
                    if entry.path().extension().and_then(|s| s.to_str()) != Some("json") {
                        continue;
                    }
                    let result = files::read_budgeted_file(
                        &entry.path(),
                        legacy::LEGACY_BYTES * if modern { 2 } else { 1 },
                        &mut read_budget,
                    )
                    .and_then(|source| {
                        if modern {
                            personal_entry(&source)
                        } else {
                            legacy_entry(source, false)
                        }
                    });
                    match result {
                        Ok(theme) => append(&mut catalog, &mut remaining, theme),
                        Err(error) => issue(&mut catalog, &error),
                    }
                }
            }
            Err(error) => issue(&mut catalog, &error),
        }
    }
    let plugins = data_root.join(PACKAGES_DIR);
    let mut packages_seen = HashSet::new();
    // Hold the canonical lock across BOTH scans: mutations of flat bundles
    // also serialize here, so a migration cannot expose stale fallback data.
    let catalog_lock = files::package_read_lock(&plugins.join(super::locations::directory_name()));
    if let Err(error) = &catalog_lock { issue(&mut catalog, error); }
    for (parent, typed) in [(plugins.join(super::locations::directory_name()), true), (plugins, false)] {
        if catalog_lock.is_err() { break; }
        let _lock = match files::package_read_lock(&parent) {
            Ok(lock) => lock,
            Err(error) => {
                issue(&mut catalog, &error);
                // A busy canonical directory must not expose stale flat copies.
                break;
            }
        };
        match files::directory(&parent) {
            Ok(packages) => {
                for package in packages.into_iter().take(4096) {
                    if read_budget == 0 { break; }
                    let name = package.file_name().to_string_lossy().into_owned();
                    if name.starts_with('.') || packages_seen.contains(&name) { continue; }
                    if !typed {
                        if crate::plugins::layout::is_kind_directory(&name) { continue; }
                        let manifest = package.path().join(".tabularium");
                        if !manifest.exists() { continue; }
                        let kind = files::read_budgeted_file(&manifest, 64 * 1024, &mut read_budget)
                            .and_then(|source| super::json::parse_bounded_json(source.as_bytes(), 64 * 1024, 128, 262_144));
                        match kind {
                            Ok(value) if value["kind"] == "theme" => (),
                            Ok(_) => continue,
                            Err(error) => { issue(&mut catalog, &error); continue; }
                        }
                    }
                    // Canonical names shadow the fallback even when invalid.
                    packages_seen.insert(name);
                    match package_entries(&package.path(), host_version, &mut read_budget) {
                        Ok(entries) => {
                            for entry in entries { append(&mut catalog, &mut remaining, entry); }
                        }
                        Err(error) => issue(&mut catalog, &error),
                    }
                }
            }
            Err(error) => { issue(&mut catalog, &error); break; }
        }
    }
    let mut seen = HashSet::new();
    let mut collisions = HashSet::new();
    for theme in &catalog.themes {
        if !seen.insert(theme.id.clone()) {
            collisions.insert(theme.id.clone());
        }
    }
    if !collisions.is_empty() {
        issue(
            &mut catalog,
            "Colliding personal theme IDs are unavailable; original files were retained",
        );
    }
    catalog
        .themes
        .retain(|theme| !collisions.contains(&theme.id));
    catalog
}

/// Lookup only in the personal directory. IDs never become caller-controlled paths.
pub(super) fn legacy_path(root: &Path, id: &str) -> Result<Option<PathBuf>, String> {
    legacy::existing_personal_id(id)?;
    let mut found = None;
    for entry in files::directory(&root.join("themes"))? {
        if entry.path().extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let source = match files::read_file(&entry.path(), legacy::LEGACY_BYTES) {
            Ok(source) => source,
            Err(_) => continue,
        };
        if legacy::parse_legacy(&source)
            .ok()
            .and_then(|value| value["id"].as_str().map(String::from))
            .as_deref()
            == Some(id)
        {
            if found.is_some() {
                return Err("Ambiguous personal theme identity".into());
            }
            found = Some(entry.path());
        }
    }
    Ok(found)
}
