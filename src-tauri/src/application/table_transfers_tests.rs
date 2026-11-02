use super::*;
use crate::drivers::sql_syntax::LiteralStyle;
use crate::runtime::events::NoopRuntimeEvents;
use crate::runtime::paths::FixedRuntimePaths;
use crate::table_sql::NOT_A_TABLE_EXPORT;

struct NoopSecrets;

impl crate::runtime::secrets::RuntimeSecrets for NoopSecrets {
    fn get(&self, _account: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    fn set(&self, _account: &str, _value: &str) -> Result<(), String> {
        Ok(())
    }

    fn delete(&self, _account: &str) -> Result<(), String> {
        Ok(())
    }
}

fn header(content: TableSqlContent) -> TableSqlHeader {
    TableSqlHeader {
        format_version: FORMAT_VERSION,
        tabularis_version: "0.30.0".to_string(),
        driver: "sqlite".to_string(),
        driver_version: None,
        source: "main.items".to_string(),
        table: "items".to_string(),
        content,
        structure_source: StructureSource::Driver,
        rows: 2,
        exported: "2026-10-30T10:00:00Z".to_string(),
    }
}

fn column(name: &str, is_pk: bool, is_generated: bool) -> TableColumn {
    TableColumn {
        name: name.to_string(),
        data_type: "integer".to_string(),
        is_pk,
        is_nullable: !is_pk,
        is_auto_increment: false,
        is_generated,
        default_value: None,
        character_maximum_length: None,
        numeric_precision: None,
        numeric_scale: None,
        comment: None,
        full_type: None,
    }
}

fn dialect(quote: &str, postgres: bool) -> DumpDialect {
    DumpDialect {
        identifier_quote: quote.to_string(),
        schema_qualified: postgres,
        postgres,
        string_escape: LiteralStyle::Standard,
        boolean_keywords: postgres,
    }
}

mod plan {
    use super::*;

    const DATA: TableSqlContent = TableSqlContent::StructureAndData;

    #[test]
    fn creates_a_missing_table_in_every_mode() {
        for mode in [
            IfTableExists::Fail,
            IfTableExists::DropAndRecreate,
            IfTableExists::Append,
        ] {
            assert_eq!(
                plan_import(&header(DATA), mode, false, true).unwrap(),
                ImportPlan {
                    drop_first: false,
                    run_structure: true
                },
                "{mode:?}"
            );
        }
    }

    #[test]
    fn fails_on_an_existing_table_by_default() {
        let error = plan_import(&header(DATA), IfTableExists::Fail, true, true).unwrap_err();
        assert!(error.contains("already exists"), "{error}");
    }

    #[test]
    fn drops_then_recreates() {
        assert_eq!(
            plan_import(&header(DATA), IfTableExists::DropAndRecreate, true, true).unwrap(),
            ImportPlan {
                drop_first: true,
                run_structure: true
            }
        );
    }

    #[test]
    fn appends_without_the_structure_section() {
        assert_eq!(
            plan_import(&header(DATA), IfTableExists::Append, true, false).unwrap(),
            ImportPlan {
                drop_first: false,
                run_structure: false
            },
            "appending needs no table management"
        );
    }

    #[test]
    fn refuses_to_append_a_structure_only_file() {
        let error = plan_import(
            &header(TableSqlContent::StructureOnly),
            IfTableExists::Append,
            true,
            true,
        )
        .unwrap_err();
        assert!(error.contains("structure only"), "{error}");
    }

    #[test]
    fn refuses_structure_work_without_table_management() {
        assert!(plan_import(&header(DATA), IfTableExists::Fail, false, false).is_err());
        assert!(plan_import(&header(DATA), IfTableExists::DropAndRecreate, true, false).is_err());
    }
}

mod target {
    use super::*;

    #[test]
    fn accepts_the_same_driver() {
        assert!(check_import_target(
            &header(TableSqlContent::StructureAndData),
            "sqlite",
            &DriverCapabilities::default()
        )
        .is_ok());
    }

    #[test]
    fn refuses_another_driver() {
        let error = check_import_target(
            &header(TableSqlContent::StructureAndData),
            "duckdb",
            &DriverCapabilities::default(),
        )
        .unwrap_err();
        assert!(
            error.contains("\"sqlite\"") && error.contains("\"duckdb\""),
            "{error}"
        );
    }

    #[test]
    fn refuses_read_only_connections_and_opted_out_plugins() {
        let readonly = DriverCapabilities {
            readonly: true,
            ..Default::default()
        };
        assert!(check_import_target(
            &header(TableSqlContent::StructureAndData),
            "sqlite",
            &readonly
        )
        .unwrap_err()
        .contains("read-only"));
        let opted_out = DriverCapabilities {
            table_import: Some(false),
            ..Default::default()
        };
        assert!(check_import_target(
            &header(TableSqlContent::StructureAndData),
            "sqlite",
            &opted_out
        )
        .is_err());
        let opted_in = DriverCapabilities {
            table_import: Some(true),
            ..Default::default()
        };
        assert!(check_import_target(
            &header(TableSqlContent::StructureAndData),
            "sqlite",
            &opted_in
        )
        .is_ok());
    }
}

mod select {
    use super::*;

    #[test]
    fn orders_by_the_primary_key_and_skips_generated_columns() {
        let columns = [
            column("id", true, false),
            column("total", false, false),
            column("doubled", false, true),
        ];
        assert_eq!(
            export_select(&dialect("\"", true), Some("public"), "orders", &columns),
            "SELECT \"id\", \"total\" FROM \"public\".\"orders\" ORDER BY \"id\""
        );
    }

    #[test]
    fn uses_the_plugin_identifier_quote() {
        let columns = [column("a", false, false)];
        assert_eq!(
            export_select(&dialect("`", false), Some("ignored"), "t", &columns),
            "SELECT `a` FROM `t`"
        );
    }

    #[test]
    fn falls_back_to_star_without_column_metadata() {
        assert_eq!(
            export_select(&dialect("\"", false), None, "t", &[]),
            "SELECT * FROM \"t\""
        );
    }

    #[test]
    fn labels_the_source() {
        assert_eq!(
            source_label("shop", Some("public"), "orders"),
            "shop.public.orders"
        );
        assert_eq!(source_label("/tmp/shop.db", None, "orders"), "shop.orders");
        assert_eq!(
            source_label("C:\\data\\shop.sqlite", None, "orders"),
            "shop.orders"
        );
        assert_eq!(source_label("/tmp/noext", None, "t"), "noext.t");
        assert_eq!(source_label("", None, "orders"), "orders");
    }

    #[test]
    fn names_downloads_after_the_table_and_time() {
        let name = download_file_name("my orders");
        assert!(
            name.starts_with("my_orders_") && name.ends_with(".sql"),
            "{name}"
        );
        assert_eq!(
            name.len(),
            "my_orders_".len() + "yyyyMMdd-HHmmss".len() + ".sql".len()
        );
    }
}

mod preview {
    use super::*;

    #[test]
    fn reads_the_header_and_the_structure_section() {
        let text = format!(
            "{}-- @section structure\nCREATE TABLE \"items\" (id integer);\n\n-- @section data\nINSERT INTO \"items\" (\"id\") VALUES\n(1);\n-- @end\n",
            header(TableSqlContent::StructureAndData).render()
        );
        let (parsed, structure, truncated) = read_preview(text.as_bytes()).unwrap();
        assert_eq!(parsed.table, "items");
        assert_eq!(structure, "CREATE TABLE \"items\" (id integer);");
        assert!(!truncated);
    }

    #[test]
    fn refuses_plain_scripts() {
        assert_eq!(
            read_preview(b"CREATE TABLE t (id int);").unwrap_err(),
            NOT_A_TABLE_EXPORT
        );
    }

    #[test]
    fn describes_failures() {
        assert_eq!(
            import_failure("data", Some(12), "syntax error", 500, false),
            "Import failed in the data section at line 12: syntax error\n500 rows were inserted before the error."
        );
        assert_eq!(
            import_failure("structure", Some(3), "boom", 0, true),
            "Import failed in the structure section at line 3: boom\nThe table created by this import was removed."
        );
        assert!(import_failure("", None, "bad file", 0, false)
            .starts_with("Import failed in the header section: bad file"));
    }
}

/// End to end on SQLite: the built-in streaming path, the file on disk, and
/// the import into another database.
mod sqlite_round_trip {
    use super::*;

    struct Fixture {
        _temp: tempfile::TempDir,
        runtime: RuntimeContext,
        dir: PathBuf,
    }

    async fn fixture() -> Fixture {
        crate::drivers::registry::register_driver(crate::drivers::sqlite::SqliteDriver::new())
            .await;
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().to_path_buf();
        let runtime = RuntimeContext::new(
            Arc::new(FixedRuntimePaths::new(dir.clone(), dir.clone())),
            Arc::new(NoopRuntimeEvents),
            Arc::new(NoopSecrets),
        );
        let connections = ["source", "target"]
            .into_iter()
            .map(|id| {
                let path = dir.join(format!("{id}.sqlite"));
                File::create(&path).unwrap();
                crate::models::SavedConnection {
                    id: id.to_string(),
                    name: id.to_string(),
                    params: params_for(&path),
                    plugin_secret_keys: Vec::new(),
                    group_id: None,
                    sort_order: None,
                    detect_json_in_text_columns: None,
                    appearance: None,
                    tag_ids: None,
                    environment: None,
                }
            })
            .collect();
        crate::persistence::save_connections_file(
            &runtime.paths.connections_file(),
            &crate::models::ConnectionsFile {
                connections,
                ..Default::default()
            },
        )
        .unwrap();
        Fixture {
            _temp: temp,
            runtime,
            dir,
        }
    }

    fn params_for(path: &Path) -> ConnectionParams {
        ConnectionParams {
            driver: "sqlite".to_string(),
            database: DatabaseSelection::Single(path.to_string_lossy().into_owned()),
            ..Default::default()
        }
    }

    impl Fixture {
        fn params(&self, id: &str) -> ConnectionParams {
            params_for(&self.dir.join(format!("{id}.sqlite")))
        }

        async fn run(&self, id: &str, sql: &str) -> crate::models::QueryResult {
            crate::drivers::sqlite::execute_query(&self.params(id), sql, None, 1)
                .await
                .unwrap()
        }

        async fn rows(&self, id: &str) -> Vec<Vec<serde_json::Value>> {
            self.run(
                id,
                "SELECT id, name, price, active, note FROM items ORDER BY id",
            )
            .await
            .rows
        }

        async fn seed(&self) {
            self.run(
                "source",
                "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price REAL, active INTEGER, note TEXT)",
            )
            .await;
            self.run(
                "source",
                "INSERT INTO items VALUES (1, 'it''s; a \"quote\"', 12.5, 1, 'line one\nline two;\n;'), (2, 'plain', NULL, 0, NULL)",
            )
            .await;
            self.run(
                "source",
                "WITH RECURSIVE seq(v) AS (SELECT 3 UNION ALL SELECT v + 1 FROM seq WHERE v < 1203) INSERT INTO items SELECT v, 'row ' || v, v * 1.5, v % 2, NULL FROM seq",
            )
            .await;
        }

        async fn export(&self, content: TableSqlContent) -> (PathBuf, TableExportResult) {
            let path = self.dir.join(format!("items-{}.sql", content.as_str()));
            let result = export_table(
                &self.runtime,
                &ExportCancellationState::default(),
                None,
                "source".to_string(),
                TableExportOptions {
                    table: "items".to_string(),
                    content,
                    schema: None,
                    database: None,
                },
                TableExportDestination::ServerPath(path.clone()),
            )
            .await
            .unwrap();
            (path, result)
        }

        async fn import(
            &self,
            path: &Path,
            if_exists: IfTableExists,
        ) -> Result<TableImportResult, String> {
            import_table(
                &self.runtime,
                &DumpCancellationState::default(),
                None,
                "target".to_string(),
                TableImportSource::ServerPath(path.to_path_buf()),
                TableImportOptions {
                    if_exists,
                    schema: None,
                    database: None,
                },
            )
            .await
        }

        fn leftovers(&self) -> Vec<String> {
            fs::read_dir(&self.dir)
                .unwrap()
                .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
                .filter(|name| name.starts_with('.'))
                .collect()
        }
    }

    #[tokio::test]
    async fn imports_a_table_whose_definition_has_comments() {
        // SQLite keeps the user's comments in the stored CREATE TABLE text,
        // and the export writes that text as is.
        let fixture = fixture().await;
        fixture
            .run(
                "source",
                "CREATE TABLE items (\n  id INTEGER PRIMARY KEY, -- the user's id; never reused\n  name TEXT NOT NULL, /* shown; required */\n  price REAL, active INTEGER, note TEXT\n)",
            )
            .await;
        fixture
            .run(
                "source",
                "INSERT INTO items VALUES (1, 'a', 1.5, 1, NULL), (2, 'b', NULL, 0, 'x')",
            )
            .await;
        let (path, _) = fixture.export(TableSqlContent::StructureAndData).await;

        let imported = fixture.import(&path, IfTableExists::Fail).await.unwrap();
        assert_eq!(imported.rows, 2);
        assert_eq!(fixture.rows("target").await, fixture.rows("source").await);
    }

    #[tokio::test]
    async fn exports_and_imports_structure_and_data() {
        let fixture = fixture().await;
        fixture.seed().await;
        let (path, result) = fixture.export(TableSqlContent::StructureAndData).await;
        assert_eq!(result.rows, 1203);
        assert_eq!(result.structure_source, StructureSource::Driver);
        assert!(result.file.is_none());
        assert_eq!(result.bytes, fs::metadata(&path).unwrap().len());
        assert!(
            fixture.leftovers().is_empty(),
            "scratch files remain: {:?}",
            fixture.leftovers()
        );

        let text = fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("-- Tabularis table export\n-- Format: tabularis-table-sql/1\n"));
        assert!(text.contains("-- Driver: sqlite\n"));
        assert!(text.contains("-- Table: items\n"));
        assert!(text.contains("-- Rows: 1203\n"));
        assert!(text.contains("-- @section structure\n"));
        assert!(text.contains("-- @section data\nINSERT INTO \"items\" (\"id\", \"name\", \"price\", \"active\", \"note\") VALUES\n(1, "));
        assert_eq!(
            text.matches("INSERT INTO").count(),
            3,
            "1203 rows in batches of 500"
        );
        assert!(text.trim_end().ends_with("-- @end"));
        assert!(!text.contains("DROP TABLE"));

        let preview = preview_table_import(
            &fixture.runtime,
            None,
            "target".to_string(),
            TableImportSource::ServerPath(path.clone()),
        )
        .await
        .unwrap();
        assert_eq!(preview.header.rows, 1203);
        assert!(preview.structure.contains("CREATE TABLE"));
        assert!(!preview.structure.contains("INSERT"));
        assert_eq!(preview.problem, None);

        let imported = fixture.import(&path, IfTableExists::Fail).await.unwrap();
        assert_eq!(imported.table, "items");
        assert_eq!(imported.rows, 1203);
        assert_eq!(fixture.rows("target").await, fixture.rows("source").await);
    }

    #[tokio::test]
    async fn applies_the_if_exists_modes() {
        let fixture = fixture().await;
        fixture.seed().await;
        let (path, _) = fixture.export(TableSqlContent::StructureAndData).await;
        fixture.import(&path, IfTableExists::Fail).await.unwrap();

        let error = fixture
            .import(&path, IfTableExists::Fail)
            .await
            .unwrap_err();
        assert!(error.contains("already exists"), "{error}");

        fixture
            .run("target", "DELETE FROM items WHERE id > 10")
            .await;
        fixture
            .import(&path, IfTableExists::DropAndRecreate)
            .await
            .unwrap();
        assert_eq!(fixture.rows("target").await.len(), 1203);

        fixture.run("target", "DELETE FROM items").await;
        let appended = fixture.import(&path, IfTableExists::Append).await.unwrap();
        assert_eq!(appended.rows, 1203);
        assert_eq!(
            appended.statements, 3,
            "append runs the three INSERT batches and skips the structure section"
        );
        assert_eq!(fixture.rows("target").await, fixture.rows("source").await);
    }

    #[tokio::test]
    async fn exports_structure_only() {
        let fixture = fixture().await;
        fixture.seed().await;
        let (path, result) = fixture.export(TableSqlContent::StructureOnly).await;
        assert_eq!(result.rows, 0);
        let text = fs::read_to_string(&path).unwrap();
        assert!(
            text.contains("-- Content: structure_only\n-- Structure-Source: driver\n-- Rows: 0\n")
        );
        assert!(!text.contains("-- @section data"));
        assert!(!text.contains("INSERT"));

        let error = fixture
            .import(&path, IfTableExists::Append)
            .await
            .unwrap_err();
        assert!(error.contains("structure only"), "{error}");
        fixture.import(&path, IfTableExists::Fail).await.unwrap();
        assert!(fixture.rows("target").await.is_empty());
    }

    #[tokio::test]
    async fn a_failed_fresh_import_leaves_no_table_behind() {
        let fixture = fixture().await;
        fixture.seed().await;
        let (path, _) = fixture.export(TableSqlContent::StructureAndData).await;
        let broken = fs::read_to_string(&path).unwrap().replacen(
            "INSERT INTO \"items\"",
            "INSERT INTO \"items\" (\"missing_column\") VALUES (1);\nINSERT INTO \"items\"",
            1,
        );
        let broken_path = fixture.dir.join("broken.sql");
        fs::write(&broken_path, broken).unwrap();

        let error = fixture
            .import(&broken_path, IfTableExists::Fail)
            .await
            .unwrap_err();
        assert!(
            error.starts_with("Import failed in the data section at line"),
            "{error}"
        );
        assert!(
            error.contains("The table created by this import was removed."),
            "{error}"
        );
        let tables = fixture
            .run(
                "target",
                "SELECT name FROM sqlite_master WHERE type = 'table'",
            )
            .await;
        assert!(tables.rows.is_empty(), "{:?}", tables.rows);
    }

    #[tokio::test]
    async fn a_failed_append_keeps_the_table_and_reports_the_inserted_rows() {
        let fixture = fixture().await;
        fixture.seed().await;
        let (path, _) = fixture.export(TableSqlContent::StructureAndData).await;
        fixture.import(&path, IfTableExists::Fail).await.unwrap();
        fixture
            .run("target", "DELETE FROM items WHERE id > 500")
            .await;

        // The first batch (ids 1-500) collides with the rows still there.
        let error = fixture
            .import(&path, IfTableExists::Append)
            .await
            .unwrap_err();
        assert!(
            error.contains("0 rows were inserted before the error."),
            "{error}"
        );
        assert_eq!(fixture.rows("target").await.len(), 500);
    }

    #[tokio::test]
    async fn refuses_files_from_another_driver_and_plain_scripts_before_writing() {
        let fixture = fixture().await;
        fixture.seed().await;
        let (path, _) = fixture.export(TableSqlContent::StructureAndData).await;
        let foreign = fs::read_to_string(&path)
            .unwrap()
            .replace("-- Driver: sqlite", "-- Driver: postgres");
        let foreign_path = fixture.dir.join("foreign.sql");
        fs::write(&foreign_path, foreign).unwrap();

        let preview = preview_table_import(
            &fixture.runtime,
            None,
            "target".to_string(),
            TableImportSource::ServerPath(foreign_path.clone()),
        )
        .await
        .unwrap();
        assert!(preview.problem.unwrap().contains("\"postgres\""));
        assert!(fixture
            .import(&foreign_path, IfTableExists::Fail)
            .await
            .unwrap_err()
            .contains("\"postgres\""));

        let script_path = fixture.dir.join("script.sql");
        fs::write(&script_path, "CREATE TABLE items (id INTEGER);\n").unwrap();
        assert_eq!(
            fixture
                .import(&script_path, IfTableExists::Fail)
                .await
                .unwrap_err(),
            NOT_A_TABLE_EXPORT
        );

        let tables = fixture
            .run(
                "target",
                "SELECT name FROM sqlite_master WHERE type = 'table'",
            )
            .await;
        assert!(tables.rows.is_empty());
    }

    #[tokio::test]
    async fn a_failed_export_leaves_no_file() {
        let fixture = fixture().await;
        let path = fixture.dir.join("missing.sql");
        let result = export_table(
            &fixture.runtime,
            &ExportCancellationState::default(),
            None,
            "source".to_string(),
            TableExportOptions {
                table: "missing".to_string(),
                content: TableSqlContent::StructureAndData,
                schema: None,
                database: None,
            },
            TableExportDestination::ServerPath(path.clone()),
        )
        .await;
        assert!(result.is_err());
        assert!(!path.exists());
        assert!(fixture.leftovers().is_empty());
    }

    #[tokio::test]
    async fn browser_exports_become_single_use_downloads() {
        let fixture = fixture().await;
        fixture.seed().await;
        let owner = Uuid::new_v4();
        let result = export_table(
            &fixture.runtime,
            &ExportCancellationState::default(),
            Some(owner),
            "source".to_string(),
            TableExportOptions {
                table: "items".to_string(),
                content: TableSqlContent::StructureOnly,
                schema: None,
                database: None,
            },
            TableExportDestination::SessionDownload(owner),
        )
        .await
        .unwrap();
        let Some(GeneratedFile::Download { file_name, .. }) = result.file else {
            panic!("browser exports must use a download token");
        };
        assert!(
            file_name.starts_with("items_") && file_name.ends_with(".sql"),
            "{file_name}"
        );
        assert_eq!(
            fs::read_dir(fixture.dir.join("table-export-jobs"))
                .unwrap()
                .count(),
            0,
            "the intermediate export must be removed after token creation",
        );
    }
}
