use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[cfg(test)]
mod tests;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerDirectoryListing {
    pub path: Option<String>,
    pub parent: Option<String>,
    pub entries: Vec<ServerPathEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerPathEntry {
    pub name: String,
    pub path: String,
    pub kind: ServerPathKind,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ServerPathKind {
    File,
    Directory,
}

pub fn canonicalize_roots(roots: &[PathBuf]) -> Result<Arc<[PathBuf]>, String> {
    let mut canonical = Vec::with_capacity(roots.len());
    for root in roots {
        let path = fs::canonicalize(root).map_err(|error| {
            format!(
                "Failed to resolve server file browser root {}: {error}",
                root.display()
            )
        })?;
        if !path.is_dir() {
            return Err(format!(
                "Server file browser root is not a directory: {}",
                path.display()
            ));
        }
        if !canonical.contains(&path) {
            canonical.push(path);
        }
    }
    Ok(canonical.into())
}

pub fn resolve_save_target(
    roots: &[PathBuf],
    directory: &str,
    file_name: &str,
) -> Result<String, String> {
    if roots.is_empty() {
        return Err("Server file browsing is disabled".to_string());
    }
    let file_name_path = Path::new(file_name);
    if file_name.trim().is_empty()
        || file_name_path.file_name().and_then(|name| name.to_str()) != Some(file_name)
    {
        return Err("Choose a valid file name without directory separators".to_string());
    }
    let directory = fs::canonicalize(directory)
        .map_err(|error| format!("Failed to resolve server directory: {error}"))?;
    if !directory.is_dir() || !roots.iter().any(|root| directory.starts_with(root)) {
        return Err("The requested path is outside the configured browser roots".to_string());
    }
    path_text(&directory.join(file_name))
        .ok_or_else(|| "The selected server path is not valid UTF-8".to_string())
}

pub fn validate_save_target(roots: &[PathBuf], target: &str) -> Result<String, String> {
    let target = Path::new(target);
    let directory = target
        .parent()
        .and_then(path_text)
        .ok_or_else(|| "Choose a valid server directory".to_string())?;
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Choose a valid file name".to_string())?;
    resolve_save_target(roots, &directory, file_name)
}

pub fn list_directory(
    roots: &[PathBuf],
    requested_path: Option<&str>,
) -> Result<ServerDirectoryListing, String> {
    if roots.is_empty() {
        return Err("Server file browsing is disabled".to_string());
    }

    let Some(requested_path) = requested_path else {
        return Ok(root_listing(roots));
    };
    let directory = fs::canonicalize(requested_path)
        .map_err(|error| format!("Failed to resolve server path: {error}"))?;
    if !directory.is_dir() {
        return Err("The requested server path is not a directory".to_string());
    }
    let root = roots
        .iter()
        .find(|root| directory.starts_with(root))
        .ok_or_else(|| "The requested path is outside the configured browser roots".to_string())?;

    let mut entries = fs::read_dir(&directory)
        .map_err(|error| format!("Failed to read server directory: {error}"))?
        .filter_map(Result::ok)
        .filter_map(|entry| server_entry(entry.path(), root))
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| {
        entry_rank(&left.kind)
            .cmp(&entry_rank(&right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    let parent = if directory == *root {
        None
    } else {
        directory.parent().and_then(path_text)
    };
    Ok(ServerDirectoryListing {
        path: path_text(&directory),
        parent,
        entries,
    })
}

fn root_listing(roots: &[PathBuf]) -> ServerDirectoryListing {
    ServerDirectoryListing {
        path: None,
        parent: None,
        entries: roots
            .iter()
            .filter_map(|path| {
                Some(ServerPathEntry {
                    name: path_text(path)?,
                    path: path_text(path)?,
                    kind: ServerPathKind::Directory,
                })
            })
            .collect(),
    }
}

fn server_entry(path: PathBuf, root: &Path) -> Option<ServerPathEntry> {
    let canonical = fs::canonicalize(path).ok()?;
    if !canonical.starts_with(root) {
        return None;
    }
    let kind = if canonical.is_dir() {
        ServerPathKind::Directory
    } else if canonical.is_file() {
        ServerPathKind::File
    } else {
        return None;
    };
    Some(ServerPathEntry {
        name: canonical.file_name()?.to_string_lossy().into_owned(),
        path: path_text(&canonical)?,
        kind,
    })
}

fn entry_rank(kind: &ServerPathKind) -> u8 {
    match kind {
        ServerPathKind::Directory => 0,
        ServerPathKind::File => 1,
    }
}

fn path_text(path: &Path) -> Option<String> {
    path.to_str().map(str::to_owned)
}
