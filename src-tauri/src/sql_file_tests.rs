use crate::sql_file::{
    read_sql_file_from_disk, validate_sql_file_path, write_sql_file_to_disk,
};
use std::path::Path;

#[test]
fn validate_rejects_empty_and_blank_paths() {
    assert!(validate_sql_file_path("").is_err());
    assert!(validate_sql_file_path("   ").is_err());
}

#[test]
fn validate_rejects_relative_paths() {
    assert!(validate_sql_file_path("queries/report.sql").is_err());
}

#[test]
fn validate_accepts_absolute_paths_and_trims_whitespace() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("report.sql");
    let input = format!("  {}  ", file.display());
    assert_eq!(validate_sql_file_path(&input).unwrap(), file);
}

#[test]
fn write_then_read_round_trips_content() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("cicio.sql");
    let sql = "SELECT 'è', '日本';\n";

    write_sql_file_to_disk(&file, sql).unwrap();
    assert_eq!(read_sql_file_from_disk(&file, 1024).unwrap(), sql);
}

#[test]
fn write_overwrites_existing_content() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("q.sql");

    write_sql_file_to_disk(&file, "SELECT 1;").unwrap();
    write_sql_file_to_disk(&file, "SELECT 2;").unwrap();
    assert_eq!(read_sql_file_from_disk(&file, 1024).unwrap(), "SELECT 2;");
}

#[test]
fn read_rejects_missing_files_directories_and_oversized_files() {
    let dir = tempfile::tempdir().unwrap();

    assert!(read_sql_file_from_disk(&dir.path().join("missing.sql"), 1024).is_err());
    assert!(read_sql_file_from_disk(dir.path(), 1024).is_err());

    let big = dir.path().join("big.sql");
    write_sql_file_to_disk(&big, "SELECT 1;").unwrap();
    assert!(read_sql_file_from_disk(&big, 4).is_err());
    assert!(read_sql_file_from_disk(Path::new(&big), 1024).is_ok());
}
