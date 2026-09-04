use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};
use uuid::Uuid;

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
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_saved_queries<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<Vec<SavedQuery>, String> {
    let meta_list = read_meta(&app)?;
    let dir = get_queries_dir(&app)?;

    let mut results = Vec::new();

    for meta in meta_list {
        if meta.connection_id == connection_id {
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
