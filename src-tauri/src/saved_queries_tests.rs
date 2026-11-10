#[cfg(test)]
mod tests {
    use crate::saved_queries::{backfill_missing_database, SavedQueryMeta};

    fn make_meta(id: &str, connection_id: &str, database: Option<&str>) -> SavedQueryMeta {
        SavedQueryMeta {
            id: id.into(),
            name: format!("query-{}", id),
            filename: format!("{}.sql", id),
            connection_id: connection_id.into(),
            database: database.map(|s| s.into()),
            created_at: None,
            updated_at: None,
            folder_id: None,
        }
    }

    #[test]
    fn backfills_only_entries_with_none_database() {
        let mut meta = vec![
            make_meta("1", "conn-a", None),
            make_meta("2", "conn-a", Some("existing")),
            make_meta("3", "conn-a", None),
        ];
        let updated = backfill_missing_database(&mut meta, "conn-a", "app");
        assert_eq!(updated, 2);
        assert_eq!(meta[0].database.as_deref(), Some("app"));
        assert_eq!(meta[1].database.as_deref(), Some("existing"));
        assert_eq!(meta[2].database.as_deref(), Some("app"));
    }

    #[test]
    fn ignores_entries_from_other_connections() {
        let mut meta = vec![
            make_meta("1", "conn-a", None),
            make_meta("2", "conn-b", None),
        ];
        let updated = backfill_missing_database(&mut meta, "conn-a", "app");
        assert_eq!(updated, 1);
        assert_eq!(meta[0].database.as_deref(), Some("app"));
        assert!(meta[1].database.is_none());
    }

    #[test]
    fn returns_zero_when_nothing_to_backfill() {
        let mut meta = vec![
            make_meta("1", "conn-a", Some("app")),
            make_meta("2", "conn-a", Some("app")),
        ];
        let updated = backfill_missing_database(&mut meta, "conn-a", "other");
        assert_eq!(updated, 0);
        assert_eq!(meta[0].database.as_deref(), Some("app"));
        assert_eq!(meta[1].database.as_deref(), Some("app"));
    }

    #[test]
    fn handles_empty_list() {
        let mut meta: Vec<SavedQueryMeta> = Vec::new();
        let updated = backfill_missing_database(&mut meta, "conn-a", "app");
        assert_eq!(updated, 0);
        assert!(meta.is_empty());
    }

    #[test]
    fn does_not_overwrite_empty_string_database() {
        // An empty string is not None — we should not treat it as missing.
        let mut meta = vec![make_meta("1", "conn-a", Some(""))];
        let updated = backfill_missing_database(&mut meta, "conn-a", "app");
        assert_eq!(updated, 0);
        assert_eq!(meta[0].database.as_deref(), Some(""));
    }
}
