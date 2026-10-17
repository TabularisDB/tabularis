#[cfg(test)]
mod tests {
    use crate::saved_queries::SavedQueryMeta;
    use crate::saved_query_folders::*;

    const NOW: &str = "2026-01-01T00:00:00Z";

    fn meta(id: &str, connection_id: &str, folder_id: Option<&str>) -> SavedQueryMeta {
        SavedQueryMeta {
            id: id.into(),
            name: format!("query-{id}"),
            filename: format!("{id}.sql"),
            connection_id: connection_id.into(),
            database: Some("analytics".into()),
            created_at: Some("c".into()),
            updated_at: Some("u".into()),
            folder_id: folder_id.map(Into::into),
        }
    }

    fn folder(id: &str, connection_id: &str, name: &str) -> SavedQueryFolder {
        SavedQueryFolder {
            id: id.into(),
            connection_id: connection_id.into(),
            name: name.into(),
            created_at: None,
        }
    }

    // ---- migration ----

    #[test]
    fn legacy_meta_without_folder_field_loads_as_unfiled() {
        let legacy = r#"[{
            "id": "abc",
            "name": "Old",
            "filename": "abc.sql",
            "connection_id": "c1",
            "database": "db1",
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-02T00:00:00Z"
        }]"#;
        let metas: Vec<SavedQueryMeta> = serde_json::from_str(legacy).unwrap();
        assert_eq!(metas[0].id, "abc");
        assert_eq!(metas[0].filename, "abc.sql");
        assert_eq!(metas[0].connection_id, "c1");
        assert_eq!(metas[0].database.as_deref(), Some("db1"));
        assert_eq!(metas[0].folder_id, None);
        assert_eq!(resolve_folder_id(&metas[0], &[]), None);
    }

    #[test]
    fn legacy_meta_without_optional_fields_still_loads() {
        let minimal = r#"[{"id":"a","name":"n","filename":"a.sql","connection_id":"c"}]"#;
        let metas: Vec<SavedQueryMeta> = serde_json::from_str(minimal).unwrap();
        assert_eq!(metas[0].folder_id, None);
        assert_eq!(metas[0].database, None);
    }

    #[test]
    fn unfiled_meta_serializes_without_a_folder_key() {
        let json = serde_json::to_string(&meta("a", "c1", None)).unwrap();
        assert!(!json.contains("folder_id"));
        let filed = serde_json::to_string(&meta("a", "c1", Some("f1"))).unwrap();
        assert!(filed.contains("\"folder_id\":\"f1\""));
    }

    #[test]
    fn meta_round_trips_with_folder_assignment() {
        let original = vec![meta("a", "c1", Some("f1")), meta("b", "c1", None)];
        let json = serde_json::to_string_pretty(&original).unwrap();
        let back: Vec<SavedQueryMeta> = serde_json::from_str(&json).unwrap();
        assert_eq!(back[0].folder_id.as_deref(), Some("f1"));
        assert_eq!(back[1].folder_id, None);
        assert_eq!(back[0].database.as_deref(), Some("analytics"));
    }

    #[test]
    fn missing_or_empty_folders_file_content_is_valid() {
        let folders: Vec<SavedQueryFolder> = serde_json::from_str("[]").unwrap();
        assert!(folders.is_empty());
    }

    // ---- names ----

    #[test]
    fn validates_and_trims_names() {
        assert_eq!(validate_folder_name("  Reports  ").unwrap(), "Reports");
        assert!(validate_folder_name("").is_err());
        assert!(validate_folder_name("   ").is_err());
        assert!(validate_folder_name("bad\nname").is_err());
        assert!(validate_folder_name("tab\there").is_err());
    }

    #[test]
    fn enforces_the_length_limit_in_characters() {
        assert!(validate_folder_name(&"é".repeat(MAX_FOLDER_NAME_CHARS)).is_ok());
        assert!(validate_folder_name(&"é".repeat(MAX_FOLDER_NAME_CHARS + 1)).is_err());
    }

    // ---- create / rename ----

    #[test]
    fn creates_a_folder_scoped_to_the_connection() {
        let mut folders = Vec::new();
        let created = create_folder(&mut folders, "c1", " Reports ", NOW).unwrap();
        assert_eq!(created.name, "Reports");
        assert_eq!(created.connection_id, "c1");
        assert!(!created.id.is_empty());
        assert_eq!(folders, vec![created]);
    }

    #[test]
    fn rejects_duplicate_names_case_insensitively_within_a_connection() {
        let mut folders = vec![folder("f1", "c1", "Reports")];
        assert!(create_folder(&mut folders, "c1", "reports", NOW).is_err());
        assert!(create_folder(&mut folders, "c2", "reports", NOW).is_ok());
        assert_eq!(folders.len(), 2);
    }

    #[test]
    fn rename_validates_and_updates() {
        let mut folders = vec![folder("f1", "c1", "Reports"), folder("f2", "c1", "Admin")];
        assert_eq!(
            rename_folder(&mut folders, "f1", " Ops ").unwrap().name,
            "Ops"
        );
        assert_eq!(folders[0].name, "Ops");
        assert!(rename_folder(&mut folders, "f1", " ").is_err());
        assert!(rename_folder(&mut folders, "f1", "admin").is_err());
        assert!(rename_folder(&mut folders, "missing", "X").is_err());
        assert_eq!(folders[0].name, "Ops");
    }

    #[test]
    fn rename_allows_changing_only_the_case_of_its_own_name() {
        let mut folders = vec![folder("f1", "c1", "reports")];
        assert_eq!(
            rename_folder(&mut folders, "f1", "Reports").unwrap().name,
            "Reports"
        );
    }

    // ---- delete ----

    #[test]
    fn deletes_an_empty_folder() {
        let mut folders = vec![folder("f1", "c1", "A"), folder("f2", "c1", "B")];
        let metas = vec![meta("q1", "c1", Some("f2"))];
        delete_folder(&mut folders, &metas, "f1").unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].id, "f2");
    }

    #[test]
    fn refuses_to_delete_a_non_empty_folder() {
        let mut folders = vec![folder("f1", "c1", "A")];
        let metas = vec![meta("q1", "c1", Some("f1"))];
        let err = delete_folder(&mut folders, &metas, "f1").unwrap_err();
        assert!(err.contains("not empty"));
        assert_eq!(folders.len(), 1);
        assert_eq!(metas[0].folder_id.as_deref(), Some("f1"));
    }

    #[test]
    fn delete_unknown_folder_fails() {
        let mut folders: Vec<SavedQueryFolder> = Vec::new();
        assert!(delete_folder(&mut folders, &[], "nope").is_err());
    }

    // ---- move ----

    #[test]
    fn moves_into_a_folder_and_back_to_unfiled_keeping_other_fields() {
        let folders = vec![folder("f1", "c1", "A")];
        let mut metas = vec![meta("q1", "c1", None)];
        move_query(&mut metas, &folders, "q1", Some("f1")).unwrap();
        assert_eq!(metas[0].folder_id.as_deref(), Some("f1"));
        assert_eq!(metas[0].id, "q1");
        assert_eq!(metas[0].database.as_deref(), Some("analytics"));
        assert_eq!(metas[0].connection_id, "c1");
        assert_eq!(metas[0].filename, "q1.sql");
        assert_eq!(metas[0].updated_at.as_deref(), Some("u"));

        move_query(&mut metas, &folders, "q1", None).unwrap();
        assert_eq!(metas[0].folder_id, None);
    }

    #[test]
    fn move_rejects_unknown_query_or_folder() {
        let folders = vec![folder("f1", "c1", "A")];
        let mut metas = vec![meta("q1", "c1", None)];
        assert!(move_query(&mut metas, &folders, "nope", Some("f1")).is_err());
        assert!(move_query(&mut metas, &folders, "q1", Some("nope")).is_err());
        assert_eq!(metas[0].folder_id, None);
    }

    #[test]
    fn move_rejects_a_folder_from_another_connection() {
        let folders = vec![folder("f1", "c2", "A")];
        let mut metas = vec![meta("q1", "c1", None)];
        let err = move_query(&mut metas, &folders, "q1", Some("f1")).unwrap_err();
        assert!(err.contains("different connection"));
        assert_eq!(metas[0].folder_id, None);
    }

    #[test]
    fn move_only_touches_the_target_query() {
        let folders = vec![folder("f1", "c1", "A")];
        let mut metas = vec![meta("q1", "c1", None), meta("q2", "c1", None)];
        move_query(&mut metas, &folders, "q2", Some("f1")).unwrap();
        assert_eq!(metas[0].folder_id, None);
        assert_eq!(metas[1].folder_id.as_deref(), Some("f1"));
    }

    // ---- resolve ----

    #[test]
    fn dangling_or_foreign_folder_references_resolve_to_unfiled() {
        let folders = vec![folder("f1", "c2", "Other connection")];
        assert_eq!(
            resolve_folder_id(&meta("q", "c1", Some("gone")), &folders),
            None
        );
        assert_eq!(
            resolve_folder_id(&meta("q", "c1", Some("f1")), &folders),
            None
        );
        assert_eq!(
            resolve_folder_id(&meta("q", "c2", Some("f1")), &folders).as_deref(),
            Some("f1")
        );
    }

    // ---- file helpers ----

    #[test]
    fn missing_folders_file_reads_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("folders.json");
        assert!(read_folders_file(&path).unwrap().is_empty());
        assert!(read_folders_file_lenient(&path).is_empty());
    }

    #[test]
    fn corrupt_folders_file_is_an_error_strictly_but_empty_leniently() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("folders.json");
        std::fs::write(&path, "{ not json").unwrap();

        let err = read_folders_file(&path).unwrap_err();
        assert_eq!(err, FOLDERS_FILE_ERROR);
        assert!(!err.contains("expected"));
        assert!(!err.contains("line 1"));
        assert!(read_folders_file_lenient(&path).is_empty());
        // The bad file is left in place for manual recovery.
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ not json");
    }

    #[test]
    fn a_corrupt_folders_file_leaves_queries_unfiled() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("folders.json");
        std::fs::write(&path, "[{\"id\": 1}]").unwrap();

        let folders = read_folders_file_lenient(&path);
        assert_eq!(
            resolve_folder_id(&meta("q", "c1", Some("f1")), &folders),
            None
        );
    }

    #[test]
    fn writes_folders_atomically_and_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("folders.json");
        let folders = vec![folder("f1", "c1", "Reports"), folder("f2", "c1", "Ops")];

        write_folders_file(&path, &folders).unwrap();
        write_folders_file(&path, &folders[..1]).unwrap();

        assert_eq!(read_folders_file(&path).unwrap(), folders[..1].to_vec());
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(leftovers, vec!["folders.json".to_string()]);
    }
}
