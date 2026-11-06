use std::cmp::Ordering;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::productivity::atomic_write;
use crate::sql_file::MAX_SQL_FILE_BYTES;

pub const MAX_ENTRIES_PER_DIRECTORY: usize = 1000;
pub const MAX_RELATIVE_DEPTH: usize = 16;
pub const MAX_LINKED_FOLDERS: usize = 16;
pub const SQL_FILE_EXTENSIONS: [&str; 3] = ["sql", "psql", "pgsql"];

/// Stable error codes. The frontend maps them to translated messages.
pub const LINKED_FOLDERS_FILE_UNREADABLE: &str = "linked_folders_file_unreadable";
pub const LINKED_FOLDER_NOT_FOUND: &str = "linked_folder_not_found";
pub const LINKED_FOLDER_UNAVAILABLE: &str = "linked_folder_unavailable";
pub const LINKED_FOLDER_LIMIT_REACHED: &str = "linked_folder_limit_reached";
pub const LINKED_PATH_OUTSIDE_ROOT: &str = "linked_path_outside_root";
pub const LINKED_PATH_NOT_SQL_FILE: &str = "linked_path_not_sql_file";
pub const LINKED_DIRECTORY_UNREADABLE: &str = "linked_directory_unreadable";
pub const LINKED_FILE_UNREADABLE: &str = "linked_file_unreadable";
pub const LINKED_FILE_CONFLICT_MODIFIED: &str = "linked_file_conflict_modified";
pub const LINKED_FILE_CONFLICT_MISSING: &str = "linked_file_conflict_missing";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedFolder {
    pub id: String,
    pub name: String,
    /// Canonical absolute path of the linked root.
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedFolderStatus {
    #[serde(flatten)]
    pub folder: LinkedFolder,
    /// False when the root was moved, deleted or became unreadable.
    pub available: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkedEntryKind {
    Directory,
    File,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedEntry {
    pub name: String,
    /// Path below the root, always `/`-separated.
    pub relative_path: String,
    pub kind: LinkedEntryKind,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedDirectoryListing {
    pub entries: Vec<LinkedEntry>,
    /// True when the directory held more than [`MAX_ENTRIES_PER_DIRECTORY`].
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedFileContent {
    /// Canonical absolute path: the stable identity of the file.
    pub path: String,
    pub content: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedFileSaved {
    pub path: String,
    pub version: String,
}

#[derive(Serialize, Deserialize)]
struct LinksFile {
    version: u32,
    folders: Vec<LinkedFolder>,
}

pub fn links_file_path(config_dir: &Path) -> PathBuf {
    config_dir.join("linked_folders.json")
}

fn load_links(store: &Path) -> Result<Vec<LinkedFolder>, String> {
    let content = match fs::read_to_string(store) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(LINKED_FOLDERS_FILE_UNREADABLE.to_string()),
    };
    serde_json::from_str::<LinksFile>(&content)
        .map(|file| file.folders)
        .map_err(|_| LINKED_FOLDERS_FILE_UNREADABLE.to_string())
}

fn save_links(store: &Path, folders: Vec<LinkedFolder>) -> Result<(), String> {
    let file = LinksFile {
        version: 1,
        folders,
    };
    let content = serde_json::to_string_pretty(&file).map_err(|error| error.to_string())?;
    atomic_write(store, content.as_bytes())
}

fn path_text(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| LINKED_PATH_OUTSIDE_ROOT.to_string())
}

fn is_sql_file_name(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            SQL_FILE_EXTENSIONS
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
        .unwrap_or(false)
}

/// SHA-256 of the file content, as lowercase hex.
pub fn content_version(content: &str) -> String {
    let digest = Sha256::digest(content.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Splits a `/`-separated relative path into plain names. Empty means the root.
/// Absolute paths, `.`/`..` and anything deeper than [`MAX_RELATIVE_DEPTH`] are
/// rejected.
pub fn split_relative_path(relative: &str) -> Result<Vec<&str>, String> {
    if relative.is_empty() {
        return Ok(Vec::new());
    }
    let segments: Vec<&str> = relative.split('/').collect();
    if segments.len() > MAX_RELATIVE_DEPTH {
        return Err(LINKED_PATH_OUTSIDE_ROOT.to_string());
    }
    for segment in &segments {
        let mut components = Path::new(segment).components();
        let plain = matches!(
            (components.next(), components.next()),
            (Some(Component::Normal(_)), None)
        );
        if !plain {
            return Err(LINKED_PATH_OUTSIDE_ROOT.to_string());
        }
    }
    Ok(segments)
}

fn find_folder(store: &Path, id: &str) -> Result<LinkedFolder, String> {
    load_links(store)?
        .into_iter()
        .find(|folder| folder.id == id)
        .ok_or_else(|| LINKED_FOLDER_NOT_FOUND.to_string())
}

fn canonical_root(folder: &LinkedFolder) -> Result<PathBuf, String> {
    let root = fs::canonicalize(&folder.path).map_err(|_| LINKED_FOLDER_UNAVAILABLE.to_string())?;
    if !root.is_dir() {
        return Err(LINKED_FOLDER_UNAVAILABLE.to_string());
    }
    Ok(root)
}

/// Resolves an existing entry below `root`, following symlinks only when the
/// target stays inside the root.
fn resolve_existing(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let mut candidate = root.to_path_buf();
    for segment in split_relative_path(relative)? {
        candidate.push(segment);
    }
    let resolved =
        fs::canonicalize(&candidate).map_err(|_| LINKED_FILE_CONFLICT_MISSING.to_string())?;
    if !resolved.starts_with(root) {
        return Err(LINKED_PATH_OUTSIDE_ROOT.to_string());
    }
    Ok(resolved)
}

pub fn link_folder(store: &Path, path: &str) -> Result<LinkedFolder, String> {
    let requested = Path::new(path.trim());
    if !requested.is_absolute() {
        return Err(LINKED_FOLDER_UNAVAILABLE.to_string());
    }
    let root = fs::canonicalize(requested).map_err(|_| LINKED_FOLDER_UNAVAILABLE.to_string())?;
    if !root.is_dir() || fs::read_dir(&root).is_err() {
        return Err(LINKED_FOLDER_UNAVAILABLE.to_string());
    }
    let root_text = path_text(&root)?;

    let mut folders = load_links(store)?;
    if let Some(existing) = folders.iter().find(|folder| folder.path == root_text) {
        return Ok(existing.clone());
    }
    if folders.len() >= MAX_LINKED_FOLDERS {
        return Err(LINKED_FOLDER_LIMIT_REACHED.to_string());
    }
    let name = root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&root_text)
        .to_string();
    let folder = LinkedFolder {
        id: Uuid::new_v4().to_string(),
        name,
        path: root_text,
    };
    folders.push(folder.clone());
    save_links(store, folders)?;
    Ok(folder)
}

pub fn unlink_folder(store: &Path, id: &str) -> Result<(), String> {
    let mut folders = load_links(store)?;
    let before = folders.len();
    folders.retain(|folder| folder.id != id);
    if folders.len() == before {
        return Ok(());
    }
    save_links(store, folders)
}

/// Linked folders for the panel. An unreadable store degrades to no links and
/// is left untouched so a later link never overwrites it silently.
pub fn list_linked_folders(store: &Path) -> Result<Vec<LinkedFolderStatus>, String> {
    Ok(load_links(store)?
        .into_iter()
        .map(|folder| {
            let available = canonical_root(&folder).is_ok();
            LinkedFolderStatus { folder, available }
        })
        .collect())
}

fn compare_entries(a: &LinkedEntry, b: &LinkedEntry) -> Ordering {
    let rank = |entry: &LinkedEntry| match entry.kind {
        LinkedEntryKind::Directory => 0,
        LinkedEntryKind::File => 1,
    };
    rank(a)
        .cmp(&rank(b))
        .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        .then_with(|| a.name.cmp(&b.name))
}

pub fn list_linked_directory(
    store: &Path,
    id: &str,
    relative: &str,
) -> Result<LinkedDirectoryListing, String> {
    let root = canonical_root(&find_folder(store, id)?)?;
    let directory = resolve_existing(&root, relative).map_err(|error| match error.as_str() {
        LINKED_FILE_CONFLICT_MISSING => LINKED_DIRECTORY_UNREADABLE.to_string(),
        _ => error,
    })?;
    if !directory.is_dir() {
        return Err(LINKED_DIRECTORY_UNREADABLE.to_string());
    }
    // A directory at the depth limit is listed but its children are files only.
    let at_depth_limit = split_relative_path(relative)?.len() + 1 >= MAX_RELATIVE_DEPTH;
    let reader = fs::read_dir(&directory).map_err(|_| LINKED_DIRECTORY_UNREADABLE.to_string())?;

    let mut entries = Vec::new();
    let mut truncated = false;
    for item in reader {
        let Ok(item) = item else { continue };
        let Ok(name) = item.file_name().into_string() else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        // `canonicalize` resolves symlinks; anything leaving the root is hidden.
        let Ok(resolved) = fs::canonicalize(item.path()) else {
            continue;
        };
        if !resolved.starts_with(&root) {
            continue;
        }
        let kind = if resolved.is_dir() {
            if at_depth_limit {
                continue;
            }
            LinkedEntryKind::Directory
        } else if resolved.is_file() && is_sql_file_name(&name) {
            LinkedEntryKind::File
        } else {
            continue;
        };
        if entries.len() >= MAX_ENTRIES_PER_DIRECTORY {
            truncated = true;
            break;
        }
        let relative_path = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };
        entries.push(LinkedEntry {
            name,
            relative_path,
            kind,
        });
    }
    entries.sort_by(compare_entries);
    Ok(LinkedDirectoryListing { entries, truncated })
}

fn read_file_content(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|_| LINKED_FILE_UNREADABLE.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_SQL_FILE_BYTES {
        return Err(LINKED_FILE_UNREADABLE.to_string());
    }
    fs::read_to_string(path).map_err(|_| LINKED_FILE_UNREADABLE.to_string())
}

fn require_sql_file_name(relative: &str) -> Result<(), String> {
    let name = split_relative_path(relative)?
        .last()
        .copied()
        .ok_or_else(|| LINKED_PATH_NOT_SQL_FILE.to_string())?;
    if is_sql_file_name(name) {
        Ok(())
    } else {
        Err(LINKED_PATH_NOT_SQL_FILE.to_string())
    }
}

pub fn read_linked_sql_file(
    store: &Path,
    id: &str,
    relative: &str,
) -> Result<LinkedFileContent, String> {
    require_sql_file_name(relative)?;
    let root = canonical_root(&find_folder(store, id)?)?;
    let path = resolve_existing(&root, relative).map_err(|error| match error.as_str() {
        LINKED_FILE_CONFLICT_MISSING => LINKED_FILE_UNREADABLE.to_string(),
        _ => error,
    })?;
    let content = read_file_content(&path)?;
    Ok(LinkedFileContent {
        path: path_text(&path)?,
        version: content_version(&content),
        content,
    })
}

/// Writes a linked file. Without `overwrite`, the file on disk must still match
/// `expected_version`; a changed or deleted file is reported as a conflict and
/// nothing is written.
pub fn write_linked_sql_file(
    store: &Path,
    id: &str,
    relative: &str,
    content: &str,
    expected_version: Option<&str>,
    overwrite: bool,
) -> Result<LinkedFileSaved, String> {
    require_sql_file_name(relative)?;
    let root = canonical_root(&find_folder(store, id)?)?;
    let segments = split_relative_path(relative)?;
    let (file_name, parents) = segments
        .split_last()
        .ok_or_else(|| LINKED_PATH_NOT_SQL_FILE.to_string())?;

    let mut directory = root.clone();
    for segment in parents {
        directory.push(segment);
    }
    let directory =
        fs::canonicalize(&directory).map_err(|_| LINKED_FILE_CONFLICT_MISSING.to_string())?;
    if !directory.starts_with(&root) || !directory.is_dir() {
        return Err(LINKED_PATH_OUTSIDE_ROOT.to_string());
    }
    let target = directory.join(file_name);

    // Inspect the leaf without following it: a dangling symlink is not a new file.
    match fs::symlink_metadata(&target) {
        Ok(_) => {
            let resolved =
                fs::canonicalize(&target).map_err(|_| LINKED_FILE_CONFLICT_MISSING.to_string())?;
            if !resolved.starts_with(&root) {
                return Err(LINKED_PATH_OUTSIDE_ROOT.to_string());
            }
            if !overwrite {
                let current = read_file_content(&resolved)?;
                if expected_version != Some(content_version(&current).as_str()) {
                    return Err(LINKED_FILE_CONFLICT_MODIFIED.to_string());
                }
            }
            write_content(&resolved, content)?;
            Ok(LinkedFileSaved {
                path: path_text(&resolved)?,
                version: content_version(content),
            })
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if !overwrite {
                return Err(LINKED_FILE_CONFLICT_MISSING.to_string());
            }
            write_content(&target, content)?;
            Ok(LinkedFileSaved {
                path: path_text(&target)?,
                version: content_version(content),
            })
        }
        Err(_) => Err(LINKED_FILE_UNREADABLE.to_string()),
    }
}

fn write_content(path: &Path, content: &str) -> Result<(), String> {
    fs::write(path, content)
        .map_err(|error| format!("Failed to write SQL file {}: {error}", path.display()))
}

#[cfg(test)]
#[path = "linked_folders_tests.rs"]
mod tests;
