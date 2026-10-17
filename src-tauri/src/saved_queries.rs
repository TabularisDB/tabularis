use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};
use uuid::Uuid;

use crate::query_history::atomic_write;
use crate::saved_query_folders::{self, SavedQueryFolder};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SavedQueryMeta {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub connection_id: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    /// `None` means Unfiled. Omitted from meta.json when unset so files from
    /// before folders existed keep their exact shape.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SavedQuery {
    pub id: String,
    pub name: String,
    pub sql: String,
    pub connection_id: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub folder_id: Option<String>,
}

fn get_queries_dir<R: Runtime>(_app: &AppHandle<R>) -> Result<PathBuf, String> {
    let config_dir = crate::paths::get_app_config_dir();
    let queries_dir = config_dir.join("saved_queries");
    if !queries_dir.exists() {
        fs::create_dir_all(&queries_dir).map_err(|e| e.to_string())?;
    }
    Ok(queries_dir)
}

fn get_meta_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = get_queries_dir(app)?;
    Ok(dir.join("meta.json"))
}

fn read_meta<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<SavedQueryMeta>, String> {
    let path = get_meta_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn write_meta<R: Runtime>(app: &AppHandle<R>, meta: &Vec<SavedQueryMeta>) -> Result<(), String> {
    let path = get_meta_path(app)?;
    let content = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    atomic_write(&path, content.as_bytes())
}

fn get_folders_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(get_queries_dir(app)?.join("folders.json"))
}

/// Strict read, for commands that change folders: a corrupt file must not be
/// silently overwritten.
fn read_folders<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<SavedQueryFolder>, String> {
    saved_query_folders::read_folders_file(&get_folders_path(app)?)
}

/// Lenient read, for commands that only display or return folders: a corrupt
/// file degrades to no folders (queries show as Unfiled) instead of failing.
fn read_folders_or_empty<R: Runtime>(app: &AppHandle<R>) -> Vec<SavedQueryFolder> {
    match get_folders_path(app) {
        Ok(path) => saved_query_folders::read_folders_file_lenient(&path),
        Err(_) => Vec::new(),
    }
}

fn write_folders<R: Runtime>(
    app: &AppHandle<R>,
    folders: &[SavedQueryFolder],
) -> Result<(), String> {
    saved_query_folders::write_folders_file(&get_folders_path(app)?, folders)
}

#[tauri::command]
pub async fn get_saved_queries<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<Vec<SavedQuery>, String> {
    let meta_list = read_meta(&app)?;
    let folders = read_folders_or_empty(&app);
    let dir = get_queries_dir(&app)?;

    let mut results = Vec::new();

    for meta in meta_list {
        if meta.connection_id == connection_id {
            let folder_id = saved_query_folders::resolve_folder_id(&meta, &folders);
            let file_path = dir.join(&meta.filename);
            let sql = if file_path.exists() {
                fs::read_to_string(file_path).unwrap_or_default()
            } else {
                String::new()
            };

            results.push(SavedQuery {
                id: meta.id,
                name: meta.name,
                sql,
                connection_id: meta.connection_id,
                database: meta.database,
                created_at: meta.created_at,
                updated_at: meta.updated_at,
                folder_id,
            });
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn save_query<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    name: String,
    sql: String,
    database: Option<String>,
) -> Result<SavedQuery, String> {
    let mut meta_list = read_meta(&app)?;
    let dir = get_queries_dir(&app)?;

    let id = Uuid::new_v4().to_string();
    let filename = format!("{}.sql", id);
    let file_path = dir.join(&filename);

    fs::write(file_path, &sql).map_err(|e| e.to_string())?;

    let now = Utc::now().to_rfc3339();

    let new_meta = SavedQueryMeta {
        id: id.clone(),
        name: name.clone(),
        filename,
        connection_id: connection_id.clone(),
        database: database.clone(),
        created_at: Some(now.clone()),
        updated_at: Some(now.clone()),
        folder_id: None,
    };

    meta_list.push(new_meta);
    write_meta(&app, &meta_list)?;

    Ok(SavedQuery {
        id,
        name,
        sql,
        connection_id,
        database,
        created_at: Some(now.clone()),
        updated_at: Some(now),
        folder_id: None,
    })
}

#[tauri::command]
pub async fn update_saved_query<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    name: String,
    sql: String,
    database: Option<String>,
) -> Result<SavedQuery, String> {
    let mut meta_list = read_meta(&app)?;
    let folders = read_folders_or_empty(&app);
    let dir = get_queries_dir(&app)?;

    let idx = meta_list
        .iter()
        .position(|m| m.id == id)
        .ok_or("Query not found")?;

    let now = Utc::now().to_rfc3339();

    // Update metadata
    meta_list[idx].name = name.clone();
    meta_list[idx].database = database.clone();
    meta_list[idx].updated_at = Some(now.clone());
    write_meta(&app, &meta_list)?;

    // Update SQL file
    let file_path = dir.join(&meta_list[idx].filename);
    fs::write(file_path, &sql).map_err(|e| e.to_string())?;

    Ok(SavedQuery {
        id: meta_list[idx].id.clone(),
        name,
        sql,
        connection_id: meta_list[idx].connection_id.clone(),
        database,
        created_at: meta_list[idx].created_at.clone(),
        updated_at: Some(now),
        folder_id: saved_query_folders::resolve_folder_id(&meta_list[idx], &folders),
    })
}

/// Set `database = Some(database)` on entries matching `connection_id` whose
/// `database` is currently `None`. Returns the count of entries updated.
pub fn backfill_missing_database(
    meta_list: &mut [SavedQueryMeta],
    connection_id: &str,
    database: &str,
) -> usize {
    let mut updated = 0usize;
    for meta in meta_list.iter_mut() {
        if meta.connection_id == connection_id && meta.database.is_none() {
            meta.database = Some(database.to_string());
            updated += 1;
        }
    }
    updated
}

/// Backfill `database` on saved queries for a connection where it is currently `None`.
/// Used when a connection transitions from single-db to multi-db: existing favorites
/// without an explicit database get associated with the original single database.
pub fn backfill_missing_database_for_connection<R: Runtime>(
    app: &AppHandle<R>,
    connection_id: &str,
    database: &str,
) -> Result<usize, String> {
    let mut meta_list = read_meta(app)?;
    let updated = backfill_missing_database(&mut meta_list, connection_id, database);
    if updated > 0 {
        write_meta(app, &meta_list)?;
    }
    Ok(updated)
}

#[tauri::command]
pub async fn delete_saved_query<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let mut meta_list = read_meta(&app)?;
    let dir = get_queries_dir(&app)?;

    let idx = meta_list
        .iter()
        .position(|m| m.id == id)
        .ok_or("Query not found")?;
    let meta = meta_list.remove(idx);

    write_meta(&app, &meta_list)?;

    let file_path = dir.join(&meta.filename);
    if file_path.exists() {
        let _ = fs::remove_file(file_path);
    }

    Ok(())
}

#[tauri::command]
pub async fn get_saved_query_folders<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<Vec<SavedQueryFolder>, String> {
    Ok(read_folders_or_empty(&app)
        .into_iter()
        .filter(|f| f.connection_id == connection_id)
        .collect())
}

#[tauri::command]
pub async fn create_saved_query_folder<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    name: String,
) -> Result<SavedQueryFolder, String> {
    let mut folders = read_folders(&app)?;
    let folder = saved_query_folders::create_folder(
        &mut folders,
        &connection_id,
        &name,
        &Utc::now().to_rfc3339(),
    )?;
    write_folders(&app, &folders)?;
    Ok(folder)
}

#[tauri::command]
pub async fn rename_saved_query_folder<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    name: String,
) -> Result<SavedQueryFolder, String> {
    let mut folders = read_folders(&app)?;
    let folder = saved_query_folders::rename_folder(&mut folders, &id, &name)?;
    write_folders(&app, &folders)?;
    Ok(folder)
}

/// Only empty folders can be deleted; see `saved_query_folders::delete_folder`.
#[tauri::command]
pub async fn delete_saved_query_folder<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let mut folders = read_folders(&app)?;
    let metas = read_meta(&app)?;
    saved_query_folders::delete_folder(&mut folders, &metas, &id)?;
    write_folders(&app, &folders)
}

/// Moves a saved query into a folder, or to Unfiled when `folder_id` is null.
#[tauri::command]
pub async fn move_saved_query<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    folder_id: Option<String>,
) -> Result<(), String> {
    let mut metas = read_meta(&app)?;
    let folders = read_folders(&app)?;
    saved_query_folders::move_query(&mut metas, &folders, &id, folder_id.as_deref())?;
    write_meta(&app, &metas)
}
