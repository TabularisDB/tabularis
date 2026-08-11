use crate::models::{ConnectionParams, DatabaseSelection, SavedConnection};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, Executor, SqliteConnection};
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

const SQLITE_EXTENSIONS: [&str; 3] = ["db", "sqlite", "sqlite3"];

pub(crate) fn normalize_sqlite_path(raw_path: &str) -> Result<PathBuf, String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err("Choose a file name for the SQLite database.".to_string());
    }

    let mut path = expand_sqlite_filename(trimmed);
    if path.file_name().is_none() {
        return Err("Choose a valid SQLite database file name.".to_string());
    }

    match path.extension().and_then(|extension| extension.to_str()) {
        None => {
            path.set_extension("db");
        }
        Some(extension)
            if SQLITE_EXTENSIONS
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed)) => {}
        Some(_) => {
            return Err(
                "SQLite databases must use a .db, .sqlite, or .sqlite3 extension.".to_string(),
            );
        }
    }

    Ok(path)
}

pub(crate) fn expand_sqlite_filename(value: &str) -> PathBuf {
    let home = directories::BaseDirs::new().map(|dirs| dirs.home_dir().to_path_buf());
    expand_sqlite_filename_with_home(value, home.as_deref())
}

pub(crate) fn expand_sqlite_filename_with_home(value: &str, home: Option<&Path>) -> PathBuf {
    let home_relative = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"));

    match (home_relative, home) {
        (Some(relative), Some(home)) => home.join(relative),
        _ => PathBuf::from(value),
    }
}

fn connection_name(path: &Path) -> Result<String, String> {
    path.file_stem()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "Choose a valid SQLite database file name.".to_string())
}

pub(crate) async fn initialize_sqlite_file(path: &Path) -> Result<(), String> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                format!(
                    "A file already exists at {}. Choose another name or add it as an existing SQLite connection.",
                    path.display()
                )
            } else {
                format!("Failed to create {}: {error}", path.display())
            }
        })?;

    let options = SqliteConnectOptions::new().filename(path);
    let result: Result<(), String> = async {
        let mut connection = SqliteConnection::connect_with(&options)
            .await
            .map_err(|error| error.to_string())?;
        connection
            .execute("PRAGMA user_version = 0")
            .await
            .map_err(|error| error.to_string())?;
        connection.close().await.map_err(|error| error.to_string())
    }
    .await;

    if let Err(error) = result {
        let _ = fs::remove_file(path);
        return Err(format!(
            "Failed to initialize SQLite database at {}: {error}",
            path.display()
        ));
    }

    Ok(())
}

#[tauri::command]
pub async fn create_sqlite_file(path: String) -> Result<String, String> {
    let path = normalize_sqlite_path(&path)?;
    initialize_sqlite_file(&path).await?;

    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "The selected SQLite database path is not valid UTF-8.".to_string())
}

#[tauri::command]
pub async fn create_sqlite_database<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<SavedConnection, String> {
    let database_path = create_sqlite_file(path).await?;
    let path = PathBuf::from(&database_path);
    let name = connection_name(&path)?;
    let params = ConnectionParams {
        driver: "sqlite".to_string(),
        database: DatabaseSelection::Single(database_path),
        ..ConnectionParams::default()
    };

    match crate::commands::save_connection(app, name, params, None, None).await {
        Ok(connection) => Ok(connection),
        Err(error) => {
            if let Err(cleanup_error) = fs::remove_file(&path) {
                return Err(format!(
                    "Failed to save the SQLite connection: {error}. The new database could not be removed: {cleanup_error}"
                ));
            }
            Err(format!("Failed to save the SQLite connection: {error}"))
        }
    }
}
