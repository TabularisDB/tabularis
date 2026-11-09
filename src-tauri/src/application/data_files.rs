//! Opening a data file (CSV, TSV, JSON, NDJSON, Parquet, ...) as a table.
//!
//! The engine is a driver that declares the `data_files` capability and
//! implements the `open_data_file` RPC (the DuckDB plugin, today). Each such
//! driver gets one workspace database under `<data dir>/data-files/<driver>/`
//! that only holds relations pointing at the opened files; the caller saves a
//! regular connection to it, so the grid, the SQL editor and exports work on a
//! data file exactly as they do on any other table.

use crate::application::file_transfers::FileTransferStore;
use crate::drivers::driver_trait::{DatabaseDriver, PluginManifest};
use crate::models::{ConnectionParams, DatabaseSelection};
use crate::runtime::RuntimeContext;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use uuid::Uuid;

/// Upload purpose for data files sent from a browser session.
pub const DATA_FILE_PURPOSE: &str = "data-file";

const WORKSPACE_DIRECTORY: &str = "data-files";
const WORKSPACE_DATABASE: &str = "workspace.db";
const UPLOADS_DIRECTORY: &str = "uploads";
const FALLBACK_TABLE_NAME: &str = "data";

/// File extensions accepted for each data file format.
const FORMAT_EXTENSIONS: &[(&str, &[&str])] = &[
    ("csv", &["csv"]),
    ("tsv", &["tsv", "tab"]),
    ("json", &["json"]),
    ("ndjson", &["ndjson", "jsonl"]),
    ("parquet", &["parquet", "pq"]),
    ("xlsx", &["xlsx"]),
];

/// Where the data file comes from.
#[derive(Debug)]
pub enum DataFileSource {
    /// A path the host can read directly (desktop).
    ServerPath(PathBuf),
    /// A file a browser session uploaded with [`DATA_FILE_PURPOSE`].
    SessionUpload { owner: Uuid, token: String },
}

/// A data file exposed in a driver's workspace database.
#[derive(Debug)]
pub struct PreparedDataFile {
    /// Connection parameters of the workspace database holding the file.
    pub params: ConnectionParams,
    pub table: String,
    pub format: &'static str,
}

/// What the frontend needs to show an opened data file.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedDataFile {
    pub connection_id: String,
    /// Id of the driver behind the workspace connection.
    pub driver: String,
    pub table: String,
    pub format: String,
}

/// Data file format for a file name, from its extension (case-insensitive).
pub fn data_file_format(file_name: &str) -> Option<&'static str> {
    let extension = Path::new(file_name).extension()?.to_str()?.to_lowercase();
    FORMAT_EXTENSIONS
        .iter()
        .find(|(_, extensions)| extensions.contains(&extension.as_str()))
        .map(|(format, _)| *format)
}

/// Table name for a data file: its stem, reduced to letters, digits and
/// underscores so it can be typed unquoted in the SQL editor.
pub fn data_file_table_name(file_name: &str) -> String {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or_default();
    let mut name = String::with_capacity(stem.len());
    for character in stem.chars() {
        if character.is_alphanumeric() {
            name.push(character);
        } else if !name.ends_with('_') {
            name.push('_');
        }
    }
    let name = name.trim_matches('_');
    if name.is_empty() {
        return FALLBACK_TABLE_NAME.to_string();
    }
    if name.starts_with(|character: char| character.is_ascii_digit()) {
        return format!("_{name}");
    }
    name.to_string()
}

/// First registered driver, by id, that can open `format`.
pub fn select_data_file_driver<'a>(
    manifests: &'a [PluginManifest],
    format: &str,
) -> Option<&'a PluginManifest> {
    manifests.iter().find(|manifest| {
        manifest.capabilities.file_based
            && manifest
                .capabilities
                .data_files
                .iter()
                .any(|candidate| candidate == format)
    })
}

fn workspace_directory(data_dir: &Path, driver_id: &str) -> Result<PathBuf, String> {
    let is_path_segment = !driver_id.is_empty()
        && driver_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'));
    if !is_path_segment {
        return Err(format!(
            "Driver id '{driver_id}' cannot name a data file workspace"
        ));
    }
    Ok(data_dir.join(WORKSPACE_DIRECTORY).join(driver_id))
}

/// Whether `params` points at the workspace database described by `workspace`.
pub fn is_same_workspace(params: &ConnectionParams, workspace: &ConnectionParams) -> bool {
    params.driver == workspace.driver && params.database.primary() == workspace.database.primary()
}

fn path_text(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| "The data file path is not valid UTF-8".to_string())
}

fn source_file_name(path: &Path) -> Result<String, String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .ok_or_else(|| "The data file has no file name".to_string())
}

fn unsupported_format(file_name: &str) -> String {
    format!("'{file_name}' is not a supported data file")
}

/// Moves a claimed upload to `target`, copying when the two are on different
/// filesystems.
fn move_upload(source: &Path, target: &Path) -> Result<(), String> {
    if fs::rename(source, target).is_ok() {
        return Ok(());
    }
    fs::copy(source, target)
        .map(|_| ())
        .map_err(|error| format!("Failed to store the uploaded data file: {error}"))
}

/// An uploaded data file stored beside the workspace.
struct StoredUpload {
    path: PathBuf,
    /// This upload's own directory, `uploads/<table>/<token>/`.
    directory: PathBuf,
    file_name: String,
}

/// Keeps an uploaded file next to the workspace for as long as its table
/// exists. Every upload gets its own directory, so a file that replaces an
/// earlier one of the same table leaves that one in place until it has opened.
fn store_upload(
    runtime: &RuntimeContext,
    workspace: &Path,
    owner: Uuid,
    token: &str,
) -> Result<StoredUpload, String> {
    let claimed = FileTransferStore::new(runtime.paths.data_dir()).claim_upload(
        owner,
        token,
        DATA_FILE_PURPOSE,
    )?;
    let file_name = source_file_name(Path::new(&claimed.metadata().file_name))?;
    if data_file_format(&file_name).is_none() {
        return Err(unsupported_format(&file_name));
    }
    let directory = workspace
        .join(UPLOADS_DIRECTORY)
        .join(data_file_table_name(&file_name))
        .join(Uuid::new_v4().to_string());
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Failed to store the uploaded data file: {error}"))?;
    let path = directory.join(&file_name);
    if let Err(error) = move_upload(claimed.path(), &path) {
        remove_upload(&directory);
        return Err(error);
    }
    Ok(StoredUpload {
        path,
        directory,
        file_name,
    })
}

/// Removes one upload directory and, when it was the last one, its table's.
fn remove_upload(directory: &Path) {
    let _ = fs::remove_dir_all(directory);
    if let Some(table_directory) = directory.parent() {
        // Fails, as intended, while another upload of the table is still there.
        let _ = fs::remove_dir(table_directory);
    }
}

/// Removes the uploads an opened file has just replaced for its table.
fn remove_replaced_uploads(current: &Path) {
    let Some(entries) = current.parent().and_then(|table| fs::read_dir(table).ok()) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.path() != current {
            if let Err(error) = fs::remove_dir_all(entry.path()) {
                log::warn!("Could not remove a replaced uploaded data file: {error}");
            }
        }
    }
}

/// Removes uploaded files whose table is gone (for example after the user
/// dropped it from the explorer). Best effort: a leftover file is retried on
/// the next open.
async fn remove_unused_uploads(
    driver: &dyn DatabaseDriver,
    params: &ConnectionParams,
    workspace: &Path,
) {
    let Ok(entries) = fs::read_dir(workspace.join(UPLOADS_DIRECTORY)) else {
        return;
    };
    // The driver may expose a file as a view or as a table.
    let listed = match (
        driver.get_views(params, None).await,
        driver.get_tables(params, None).await,
    ) {
        (Ok(views), Ok(tables)) => (views, tables),
        (Err(error), _) | (_, Err(error)) => {
            log::warn!("Could not list data file tables to clean up uploads: {error}");
            return;
        }
    };
    let tables: HashSet<String> = listed
        .0
        .into_iter()
        .map(|view| view.name)
        .chain(listed.1.into_iter().map(|table| table.name))
        .collect();
    for entry in entries.flatten() {
        let unused = entry
            .file_name()
            .to_str()
            .is_some_and(|name| !tables.contains(name));
        if unused {
            if let Err(error) = fs::remove_dir_all(entry.path()) {
                log::warn!("Could not remove an unused uploaded data file: {error}");
            }
        }
    }
}

/// Exposes `source` as a table in the workspace database of `driver`.
pub async fn open_with_driver(
    runtime: &RuntimeContext,
    driver: Arc<dyn DatabaseDriver>,
    source: DataFileSource,
) -> Result<PreparedDataFile, String> {
    let driver_id = driver.manifest().id.clone();
    let workspace = workspace_directory(runtime.paths.data_dir(), &driver_id)?;
    fs::create_dir_all(&workspace)
        .map_err(|error| format!("Failed to create the data file workspace: {error}"))?;

    let (path, upload_directory, file_name) = match source {
        DataFileSource::ServerPath(path) => {
            let path = fs::canonicalize(&path)
                .map_err(|error| format!("Cannot open '{}': {error}", path.display()))?;
            if !path.is_file() {
                return Err(format!("'{}' is not a file", path.display()));
            }
            let file_name = source_file_name(&path)?;
            (path, None, file_name)
        }
        DataFileSource::SessionUpload { owner, token } => {
            let upload = store_upload(runtime, &workspace, owner, &token)?;
            (upload.path, Some(upload.directory), upload.file_name)
        }
    };
    let format = data_file_format(&file_name).ok_or_else(|| unsupported_format(&file_name))?;
    let table = data_file_table_name(&file_name);
    let params = ConnectionParams {
        driver: driver_id,
        database: DatabaseSelection::Single(path_text(&workspace.join(WORKSPACE_DATABASE))?),
        ..ConnectionParams::default()
    };

    let opened = driver
        .open_data_file(&params, &path_text(&path)?, format, &table)
        .await;
    if let Err(error) = opened {
        if let Some(directory) = upload_directory {
            remove_upload(&directory);
        }
        return Err(error);
    }
    if let Some(directory) = upload_directory {
        remove_replaced_uploads(&directory);
    }
    remove_unused_uploads(driver.as_ref(), &params, &workspace).await;

    Ok(PreparedDataFile {
        params,
        table,
        format,
    })
}

/// File name of `source`, without touching an upload.
async fn peek_file_name(
    runtime: &RuntimeContext,
    source: &DataFileSource,
) -> Result<String, String> {
    match source {
        DataFileSource::ServerPath(path) => source_file_name(path),
        DataFileSource::SessionUpload { owner, token } => {
            let reader = FileTransferStore::new(runtime.paths.data_dir())
                .open_upload(*owner, token, DATA_FILE_PURPOSE)
                .await?;
            source_file_name(Path::new(&reader.metadata().file_name))
        }
    }
}

/// Exposes `source` as a table, using the registered driver that declares its
/// format in `capabilities.data_files`.
pub async fn open(
    runtime: &RuntimeContext,
    source: DataFileSource,
) -> Result<PreparedDataFile, String> {
    let file_name = peek_file_name(runtime, &source).await?;
    let format = data_file_format(&file_name).ok_or_else(|| unsupported_format(&file_name))?;
    let manifests = crate::drivers::registry::list_drivers().await;
    let driver_id = select_data_file_driver(&manifests, format)
        .map(|manifest| manifest.id.clone())
        .ok_or_else(|| format!("No installed driver can open {format} data files"))?;
    let driver = crate::drivers::registry::get_driver(&driver_id)
        .await
        .ok_or_else(|| format!("Unsupported driver: {driver_id}"))?;
    open_with_driver(runtime, driver, source).await
}

#[cfg(test)]
#[path = "data_files_tests.rs"]
mod tests;
