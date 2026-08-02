use crate::sqlite_database::{create_sqlite_file, normalize_sqlite_path};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};
use std::fs;

#[test]
fn appends_db_extension_when_missing() {
    let path = normalize_sqlite_path("/tmp/customer-data").unwrap();

    assert_eq!(path.to_string_lossy(), "/tmp/customer-data.db");
}

#[test]
fn accepts_supported_extensions_case_insensitively() {
    for path in ["data.db", "data.sqlite", "data.sqlite3", "data.SQLITE"] {
        assert_eq!(normalize_sqlite_path(path).unwrap().to_string_lossy(), path);
    }
}

#[test]
fn rejects_unrelated_extensions() {
    let error = normalize_sqlite_path("data.txt").unwrap_err();

    assert!(error.contains(".db, .sqlite, or .sqlite3"));
}

#[tokio::test]
async fn creates_an_openable_empty_sqlite_database() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("empty.sqlite");

    super::sqlite_database::initialize_sqlite_file(&path)
        .await
        .unwrap();

    assert!(path.is_file());
    let options = SqliteConnectOptions::new().filename(&path);
    let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
    let table_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'")
            .fetch_one(&mut connection)
            .await
            .unwrap();
    assert_eq!(table_count.0, 0);
}

#[tokio::test]
async fn create_file_returns_the_normalized_path() {
    let directory = tempfile::tempdir().unwrap();
    let requested_path = directory.path().join("new-database");

    let created_path = create_sqlite_file(requested_path.to_string_lossy().into_owned())
        .await
        .unwrap();

    assert_eq!(
        created_path,
        requested_path.with_extension("db").to_string_lossy()
    );
    assert!(requested_path.with_extension("db").is_file());
}

#[tokio::test]
async fn refuses_to_overwrite_an_existing_file() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("existing.db");
    fs::write(&path, b"keep me").unwrap();

    let error = super::sqlite_database::initialize_sqlite_file(&path)
        .await
        .unwrap_err();

    assert!(error.contains("already exists"));
    assert_eq!(fs::read(path).unwrap(), b"keep me");
}

#[tokio::test]
async fn reports_a_missing_parent_directory() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("missing").join("database.db");

    let error = super::sqlite_database::initialize_sqlite_file(&path)
        .await
        .unwrap_err();

    assert!(error.contains("Failed to create"));
    assert!(!path.exists());
}
