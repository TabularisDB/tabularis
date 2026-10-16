use crate::fs_path::{file_uri_to_path, sanitize_database_selection, sanitize_local_file_path};
use crate::models::DatabaseSelection;

#[test]
fn leaves_plain_paths_alone() {
    assert_eq!(
        sanitize_local_file_path(r"C:\Users\Administrator\Downloads\companies.db"),
        r"C:\Users\Administrator\Downloads\companies.db"
    );
    assert_eq!(sanitize_local_file_path("  /tmp/data.db  "), "/tmp/data.db");
    assert_eq!(
        sanitize_local_file_path("/home/u/my%20db.db"),
        "/home/u/my%20db.db"
    );
    assert_eq!(sanitize_local_file_path("filedata.db"), "filedata.db");
}

#[test]
fn strips_ascii_and_curly_quotes() {
    assert_eq!(
        sanitize_local_file_path(r#""C:\Users\Administrator\Downloads\companies.db""#),
        r"C:\Users\Administrator\Downloads\companies.db"
    );
    assert_eq!(
        sanitize_local_file_path("'C:/data/file.parquet'"),
        "C:/data/file.parquet"
    );
    assert_eq!(
        sanitize_local_file_path("`/home/u/sheet.xlsx`"),
        "/home/u/sheet.xlsx"
    );
    assert_eq!(
        sanitize_local_file_path("\u{201C}/tmp/a.csv\u{201D}"),
        "/tmp/a.csv"
    );
}

#[test]
fn strips_nested_matching_quotes() {
    assert_eq!(sanitize_local_file_path(r#"'"/tmp/a.csv"'"#), "/tmp/a.csv");
    assert_eq!(
        sanitize_local_file_path(r#""""/tmp/a.csv""""#),
        "/tmp/a.csv"
    );
}

#[test]
fn strips_invisible_noise() {
    assert_eq!(
        sanitize_local_file_path("\u{FEFF}\u{200B}\"/tmp/a.db\""),
        "/tmp/a.db"
    );
}

#[test]
fn ignores_unmatched_or_internal_quotes() {
    assert_eq!(sanitize_local_file_path(r#""/tmp/a.csv"#), r#""/tmp/a.csv"#);
    assert_eq!(
        sanitize_local_file_path(r#"C:\data\file"name.db"#),
        r#"C:\data\file"name.db"#
    );
    assert_eq!(sanitize_local_file_path(""), "");
    assert_eq!(sanitize_local_file_path("\""), "\"");
}

#[test]
fn converts_file_uris() {
    assert_eq!(
        sanitize_local_file_path("file:///C:/Users/a/companies.db"),
        "C:/Users/a/companies.db"
    );
    assert_eq!(
        sanitize_local_file_path("file:///C|/Users/a/companies.db"),
        "C:/Users/a/companies.db"
    );
    assert_eq!(
        sanitize_local_file_path("file:///home/u/a.db"),
        "/home/u/a.db"
    );
    assert_eq!(
        sanitize_local_file_path("FILE:/home/u/a.db"),
        "/home/u/a.db"
    );
    assert_eq!(
        sanitize_local_file_path(r#""file:///home/u/a.db""#),
        "/home/u/a.db"
    );
}

#[test]
fn drops_localhost_authority() {
    assert_eq!(
        sanitize_local_file_path("file://localhost/home/u/a.db"),
        "/home/u/a.db"
    );
    assert_eq!(
        sanitize_local_file_path("file://localhost/C:/data/a.db"),
        "C:/data/a.db"
    );
}

#[test]
fn keeps_remote_authority_as_unc_path() {
    assert_eq!(
        sanitize_local_file_path("file://server/share/a.db"),
        "//server/share/a.db"
    );
}

#[test]
fn decodes_percent_encoding() {
    assert_eq!(
        sanitize_local_file_path("file:///home/u/my%20db.db"),
        "/home/u/my db.db"
    );
    assert_eq!(
        sanitize_local_file_path("file:///C:/Users/J%C3%BCrgen/a.db"),
        "C:/Users/Jürgen/a.db"
    );
}

#[test]
fn file_uri_to_path_rejects_non_file_values() {
    assert_eq!(file_uri_to_path("/tmp/a.db"), None);
    assert_eq!(file_uri_to_path("file"), None);
    assert_eq!(file_uri_to_path("sqlite:///tmp/a.db"), None);
}

#[test]
fn sanitizes_database_selection_entries() {
    let single = DatabaseSelection::Single(r#"'/tmp/a.db'"#.into());
    assert_eq!(sanitize_database_selection(&single).primary(), "/tmp/a.db");

    let multi =
        DatabaseSelection::Multiple(vec![r#""/tmp/a.csv""#.into(), "`/tmp/b.parquet`".into()]);
    assert_eq!(
        sanitize_database_selection(&multi).as_vec(),
        vec!["/tmp/a.csv".to_string(), "/tmp/b.parquet".to_string()]
    );
}
