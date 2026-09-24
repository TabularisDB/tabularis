use super::zip_layout::preflight_zip;
use super::{
    is_safe_relative_path, package_id, validate_definition_json, validate_manifest_json,
    validate_runtime_version,
};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Cursor, Read};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveLimits {
    archive_bytes: usize,
    expanded_bytes: u64,
    archive_entries: usize,
    expansion_ratio: u64,
    definition_bytes: u64,
    manifest_bytes: u64,
}

/// Constructible only after complete validation; never a deserializable command argument.
pub struct ValidatedThemePackage {
    pub(super) manifest: Value,
    pub(super) definitions: BTreeMap<String, Value>,
    pub(super) files: BTreeMap<String, Vec<u8>>,
}

impl ValidatedThemePackage {
    pub fn manifest(&self) -> &Value {
        &self.manifest
    }
    pub fn definitions(&self) -> &BTreeMap<String, Value> {
        &self.definitions
    }
}

struct PathRecord {
    spelling: String,
    directory: bool,
    explicit: bool,
}

fn record_path(
    paths: &mut BTreeMap<String, PathRecord>,
    path: &str,
    directory: bool,
    explicit: bool,
) -> Result<(), String> {
    let key = path.to_ascii_lowercase();
    if let Some(previous) = paths.get_mut(&key) {
        if previous.spelling != path
            || previous.directory != directory
            || (previous.explicit && explicit)
        {
            return Err("Duplicate, case-colliding or overlapping archive paths".into());
        }
        previous.explicit |= explicit;
    } else {
        paths.insert(
            key,
            PathRecord {
                spelling: path.into(),
                directory,
                explicit,
            },
        );
    }
    Ok(())
}

fn record_entry(
    paths: &mut BTreeMap<String, PathRecord>,
    path: &str,
    directory: bool,
) -> Result<(), String> {
    let mut prefix = String::new();
    let components: Vec<_> = path.split('/').collect();
    for component in &components[..components.len() - 1] {
        if !prefix.is_empty() {
            prefix.push('/');
        }
        prefix.push_str(component);
        record_path(paths, &prefix, true, false)?;
    }
    record_path(paths, path, directory, true)
}

fn read_entry<R: Read>(
    reader: &mut R,
    limit: u64,
    check_cancelled: &impl Fn() -> Result<(), String>,
) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    let mut buffer = [0u8; 65536];
    loop {
        check_cancelled()?;
        let count = reader
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        if output.len() as u64 + count as u64 > limit {
            return Err("Theme archive entry exceeds the byte limit".into());
        }
        output.extend_from_slice(&buffer[..count]);
    }
    Ok(output)
}

/// Validate a universal ZIP entirely before creating staging or touching an installation.
pub fn validate_theme_archive(
    bytes: &[u8],
    expected_name: &str,
    expected_version: &str,
    host_version: &str,
    check_cancelled: &impl Fn() -> Result<(), String>,
) -> Result<ValidatedThemePackage, String> {
    check_cancelled()?;
    let limits: ArchiveLimits =
        serde_json::from_str(include_str!("../../../packages/web-ui/src/schemas/theme-limits-v1.json"))
            .map_err(|error| error.to_string())?;
    if bytes.len() > limits.archive_bytes {
        return Err("Theme archive exceeds the download byte limit".into());
    }
    let (entry_count, directory_start) = preflight_zip(bytes, limits.archive_entries)?;
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|error| error.to_string())?;
    if archive.len() != entry_count || archive.central_directory_start() != directory_start {
        return Err("Ambiguous ZIP directory interpretation".into());
    }
    let mut paths = BTreeMap::new();
    let mut files = BTreeMap::new();
    let mut expanded = 0u64;
    for index in 0..archive.len() {
        check_cancelled()?;
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let directory = entry.is_dir();
        let name = entry.name().to_owned();
        let path = if directory {
            name.strip_suffix('/').unwrap_or(&name)
        } else {
            &name
        };
        if !is_safe_relative_path(path) {
            return Err("Unsafe theme archive path".into());
        }
        let mode = entry.unix_mode().unwrap_or(0);
        let file_type = mode & 0o170000;
        if entry.encrypted()
            || entry.is_symlink()
            || !matches!(file_type, 0 | 0o100000 | 0o040000)
            || (file_type == 0o040000 && !directory)
            || (file_type == 0o100000 && directory)
            || (!directory && mode & 0o111 != 0)
        {
            return Err("Encrypted, linked, special or executable theme archive entry".into());
        }
        record_entry(&mut paths, path, directory)?;
        if directory {
            if entry.size() != 0 {
                return Err("Theme archive directory contains data".into());
            }
            continue;
        }
        let file_limit = if path == ".tabularium" {
            limits.manifest_bytes
        } else {
            limits.definition_bytes
        };
        if entry.size() > file_limit {
            return Err("Theme archive entry exceeds the byte limit".into());
        }
        expanded = expanded
            .checked_add(entry.size())
            .ok_or("Theme archive size overflow")?;
        if expanded > limits.expanded_bytes {
            return Err("Theme archive exceeds the expanded byte limit".into());
        }
        if entry.size()
            > entry
                .compressed_size()
                .saturating_mul(limits.expansion_ratio)
        {
            return Err("Theme archive exceeds the expansion ratio limit".into());
        }
        let data = read_entry(&mut entry, file_limit, check_cancelled)?;
        if data.len() as u64 != entry.size() {
            return Err("Theme archive entry size mismatch".into());
        }
        files.insert(path.to_owned(), data);
    }
    let manifest = validate_manifest_json(
        files
            .get(".tabularium")
            .ok_or("Missing root .tabularium manifest")?,
    )?;
    if package_id(&manifest)? != expected_name
        || manifest.get("version").and_then(Value::as_str) != Some(expected_version)
    {
        return Err("Theme archive identity/version does not match the requested release".into());
    }
    validate_runtime_version(&manifest, host_version)?;
    let variants = manifest
        .get("theme_variants")
        .and_then(Value::as_array)
        .ok_or("Missing theme variants")?;
    let mut allowed = BTreeSet::from([
        ".tabularium".to_string(),
        "README.md".to_string(),
        "LICENSE".to_string(),
        "LICENSE.txt".to_string(),
    ]);
    let mut definitions = BTreeMap::new();
    for variant in variants {
        check_cancelled()?;
        let path = variant
            .get("file")
            .and_then(Value::as_str)
            .ok_or("Missing theme definition path")?;
        let definition = validate_definition_json(
            files
                .get(path)
                .ok_or("Referenced theme definition is missing")?,
        )?;
        definitions.insert(path.to_owned(), definition);
        allowed.insert(path.to_owned());
    }
    for (path, contents) in &files {
        if !allowed.contains(path) {
            return Err("Unexpected theme archive payload".into());
        }
        if matches!(path.as_str(), "README.md" | "LICENSE" | "LICENSE.txt")
            && (contents.contains(&0) || std::str::from_utf8(contents).is_err())
        {
            return Err("Theme documentation must be UTF-8 text".into());
        }
    }
    for record in paths.values().filter(|record| record.directory) {
        let prefix = format!("{}/", record.spelling);
        if !files.keys().any(|file| file.starts_with(&prefix)) {
            return Err("Unexpected empty theme archive directory".into());
        }
    }
    check_cancelled()?;
    Ok(ValidatedThemePackage {
        manifest,
        definitions,
        files,
    })
}
