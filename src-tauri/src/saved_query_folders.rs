//! Pure rules for saved-query folders. Folders are flat, scoped to one
//! connection and purely organizational: a query's connection, database and
//! SQL never depend on the folder it sits in. Storage lives in
//! `saved_queries/folders.json`; queries reference a folder through
//! `SavedQueryMeta::folder_id`, and `None` means "Unfiled".

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use uuid::Uuid;

use crate::query_history::atomic_write;
use crate::saved_queries::SavedQueryMeta;

/// Maximum folder name length in characters, mirrored by `maxLength` on the
/// frontend input.
pub const MAX_FOLDER_NAME_CHARS: usize = 64;

/// Shown when `folders.json` cannot be read or parsed. Creating, renaming,
/// deleting and moving stop instead of overwriting the file, so the user can
/// repair or remove it.
pub const FOLDERS_FILE_ERROR: &str =
    "The saved query folders file (saved_queries/folders.json) is unreadable. \
     Repair or remove it, then try again.";

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct SavedQueryFolder {
    pub id: String,
    pub connection_id: String,
    pub name: String,
    #[serde(default)]
    pub created_at: Option<String>,
}

/// Trims and validates a folder name, returning the name to store.
pub fn validate_folder_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Folder name cannot be empty".to_string());
    }
    if trimmed.chars().count() > MAX_FOLDER_NAME_CHARS {
        return Err(format!(
            "Folder name cannot exceed {MAX_FOLDER_NAME_CHARS} characters"
        ));
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err("Folder name cannot contain control characters".to_string());
    }
    Ok(trimmed.to_string())
}

fn name_taken(
    folders: &[SavedQueryFolder],
    connection_id: &str,
    name: &str,
    ignore_id: Option<&str>,
) -> bool {
    let wanted = name.to_lowercase();
    folders.iter().any(|f| {
        f.connection_id == connection_id
            && Some(f.id.as_str()) != ignore_id
            && f.name.to_lowercase() == wanted
    })
}

pub fn create_folder(
    folders: &mut Vec<SavedQueryFolder>,
    connection_id: &str,
    name: &str,
    now: &str,
) -> Result<SavedQueryFolder, String> {
    let name = validate_folder_name(name)?;
    if name_taken(folders, connection_id, &name, None) {
        return Err(format!("A folder named \"{name}\" already exists"));
    }
    let folder = SavedQueryFolder {
        id: Uuid::new_v4().to_string(),
        connection_id: connection_id.to_string(),
        name,
        created_at: Some(now.to_string()),
    };
    folders.push(folder.clone());
    Ok(folder)
}

pub fn rename_folder(
    folders: &mut [SavedQueryFolder],
    id: &str,
    name: &str,
) -> Result<SavedQueryFolder, String> {
    let name = validate_folder_name(name)?;
    let idx = folders
        .iter()
        .position(|f| f.id == id)
        .ok_or("Folder not found")?;
    let connection_id = folders[idx].connection_id.clone();
    if name_taken(folders, &connection_id, &name, Some(id)) {
        return Err(format!("A folder named \"{name}\" already exists"));
    }
    folders[idx].name = name;
    Ok(folders[idx].clone())
}

/// Deletion policy: only empty folders can be deleted. A folder that still
/// holds queries is refused so no query is ever deleted or silently moved;
/// the user moves them out first.
pub fn delete_folder(
    folders: &mut Vec<SavedQueryFolder>,
    metas: &[SavedQueryMeta],
    id: &str,
) -> Result<(), String> {
    let idx = folders
        .iter()
        .position(|f| f.id == id)
        .ok_or("Folder not found")?;
    if metas.iter().any(|m| m.folder_id.as_deref() == Some(id)) {
        return Err("Folder is not empty. Move or delete its queries first.".to_string());
    }
    folders.remove(idx);
    Ok(())
}

/// Moves a query into a folder, or to Unfiled when `folder_id` is `None`. The
/// folder must belong to the query's own connection. Nothing else on the
/// query changes, including `updated_at`.
pub fn move_query(
    metas: &mut [SavedQueryMeta],
    folders: &[SavedQueryFolder],
    query_id: &str,
    folder_id: Option<&str>,
) -> Result<(), String> {
    let idx = metas
        .iter()
        .position(|m| m.id == query_id)
        .ok_or("Query not found")?;
    match folder_id {
        None => metas[idx].folder_id = None,
        Some(folder_id) => {
            let folder = folders
                .iter()
                .find(|f| f.id == folder_id)
                .ok_or("Folder not found")?;
            if folder.connection_id != metas[idx].connection_id {
                return Err("Folder belongs to a different connection".to_string());
            }
            metas[idx].folder_id = Some(folder.id.clone());
        }
    }
    Ok(())
}

/// The folder a query should be shown in. A reference to a folder that no
/// longer exists (or belongs to another connection, e.g. from a hand-edited
/// file) falls back to Unfiled instead of hiding the query.
pub fn resolve_folder_id(meta: &SavedQueryMeta, folders: &[SavedQueryFolder]) -> Option<String> {
    let id = meta.folder_id.as_deref()?;
    folders
        .iter()
        .find(|f| f.id == id && f.connection_id == meta.connection_id)
        .map(|f| f.id.clone())
}

/// Reads `folders.json`. A missing file is an empty list. Unreadable or
/// invalid content is an error with a user-facing message; the technical
/// detail goes to the log instead of the UI.
pub fn read_folders_file(path: &Path) -> Result<Vec<SavedQueryFolder>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| {
        log::warn!("Cannot read {}: {}", path.display(), e);
        FOLDERS_FILE_ERROR.to_string()
    })?;
    serde_json::from_str(&content).map_err(|e| {
        log::warn!("Cannot parse {}: {}", path.display(), e);
        FOLDERS_FILE_ERROR.to_string()
    })
}

/// Like `read_folders_file`, but a corrupt or unreadable file degrades to no
/// folders (queries show as Unfiled) so organizational metadata can never hide
/// or block saved queries. The file is left untouched for manual recovery.
pub fn read_folders_file_lenient(path: &Path) -> Vec<SavedQueryFolder> {
    read_folders_file(path).unwrap_or_else(|e| {
        log::warn!(
            "Ignoring unreadable saved-query folders file {}: {}",
            path.display(),
            e
        );
        Vec::new()
    })
}

/// Writes `folders.json` through a temp file and rename so a crash mid-write
/// cannot leave a truncated file.
pub fn write_folders_file(path: &Path, folders: &[SavedQueryFolder]) -> Result<(), String> {
    let content = serde_json::to_string_pretty(folders).map_err(|e| e.to_string())?;
    atomic_write(path, content.as_bytes())
}
