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
            export_select(
                &dialect("\"", true),
                Some("public"),
                "orders",
                &columns,
                &[]
            ),
            "SELECT \"id\", \"total\" FROM \"public\".\"orders\" ORDER BY \"id\""
        );
    }

    #[test]
    fn uses_the_plugin_identifier_quote() {
        let columns = [column("a", false, false)];
        assert_eq!(
            export_select(&dialect("`", false), Some("ignored"), "t", &columns, &[]),
            "SELECT `a` FROM `t`"
        );
    }

    fn typed(name: &str, data_type: &str) -> TableColumn {
        TableColumn {
            data_type: data_type.to_string(),
            ..column(name, false, false)
        }
    }

    #[test]
    fn reads_postgres_columns_as_text_and_binary_columns_as_hex() {
        let columns = [
            typed("id", "integer"),
            typed("raw", "bytea"),
            TableColumn {
                is_generated: true,
                ..typed("doubled", "integer")
            },
        ];
        let reads = column_reads("postgres", &columns);
        assert_eq!(reads, [ColumnRead::Text, ColumnRead::Text]);
        assert_eq!(
            export_select(&dialect("\"", true), Some("public"), "t", &columns, &reads),
            "SELECT \"id\"::text AS \"id\", \"raw\"::text AS \"raw\" FROM \"public\".\"t\""
        );

        let columns = [
            typed("id", "int"),
            typed("raw", "BLOB"),
            typed("hash", "varbinary(16)"),
            typed("flags", "bit(8)"),
            typed("name", "varchar(20)"),
            typed("amount", "decimal(65,30)"),
        ];
        let reads = column_reads("mysql", &columns);
        assert_eq!(
            reads,
            [
                ColumnRead::Value,
                ColumnRead::Hex,
                ColumnRead::Hex,
                ColumnRead::Hex,
                ColumnRead::Value,
                ColumnRead::Text
            ]
        );
        assert_eq!(
            export_select(&dialect("`", false), None, "t", &columns[..2], &reads[..2]),
            "SELECT `id`, CASE WHEN `raw` IS NULL THEN NULL ELSE HEX(`raw`) END AS `raw` FROM `t`"
        );
        assert_eq!(
            export_select(&dialect("`", false), None, "t", &columns[5..], &reads[5..]),
            "SELECT CAST(`amount` AS CHAR) AS `amount` FROM `t`"
        );

        // Any SQLite column can hold a blob, whatever its declared type.
        let columns = [typed("a", "INTEGER"), typed("b", "blob"), typed("c", "")];
        let reads = column_reads("sqlite", &columns);
        assert_eq!(reads, [ColumnRead::Quoted; 3]);
        assert_eq!(
            export_select(
                &dialect("\"", false),
                None,
                "t",
                &columns[1..2],
                &reads[1..2]
            ),
            "SELECT CASE typeof(\"b\") \
             WHEN 'text' THEN 'T' || (SELECT encoding FROM pragma_encoding) || ':' || hex(\"b\") \
             WHEN 'real' THEN CASE WHEN abs(\"b\") = 9e999 \
             THEN CASE WHEN \"b\" > 0 THEN '9e999' ELSE '-9e999' END \
             WHEN CAST(printf('%!.15g', \"b\") AS REAL) = \"b\" THEN printf('%!.15g', \"b\") \
             WHEN CAST(printf('%!.16g', \"b\") AS REAL) = \"b\" THEN printf('%!.16g', \"b\") \
             WHEN CAST(printf('%!.17g', \"b\") AS REAL) = \"b\" THEN printf('%!.17g', \"b\") \
             ELSE quote(\"b\") END \
             ELSE quote(\"b\") END AS \"b\" FROM \"t\""
        );
        // The key is the table's own column, not the text alias of the same
        // name: rows stay in key order and the key's index can be used.
        let keyed = [column("id", true, false), typed("v", "")];
        let reads = column_reads("sqlite", &keyed);
        assert!(
            export_select(&dialect("\"", false), None, "t", &keyed, &reads)
                .ends_with(" FROM \"t\" ORDER BY \"t\".\"id\"")
        );
        let reads = column_reads("postgres", &keyed);
        assert!(
            export_select(&dialect("\"", true), Some("public"), "t", &keyed, &reads)
                .ends_with(" FROM \"public\".\"t\" ORDER BY \"public\".\"t\".\"id\"")
        );
        // Plugins render their own values.
        assert_eq!(
            column_reads("duckdb", &[typed("raw", "blob")]),
            [ColumnRead::Value]
        );
    }

    #[test]
    fn renders_hex_and_text_reads() {
        let mysql = DumpDialect {
            string_escape: LiteralStyle::Mysql,
            ..dialect("`", false)
        };
        let cell = |value: serde_json::Value, is_json: bool| SqlCell { value, is_json };
        let render_cell = |cell: SqlCell, read: ColumnRead, dialect: &DumpDialect| {
            render_row(vec![cell], &[read], dialect).remove(0)
        };
        assert_eq!(
            render_cell(
                cell(serde_json::json!("DEADBEEF00"), false),
                ColumnRead::Hex,
                &mysql
            ),
            "X'DEADBEEF00'"
        );
        assert_eq!(
            render_cell(cell(serde_json::json!(""), false), ColumnRead::Hex, &mysql),
            "X''"
        );
        // A BIT value's hex has no leading zero.
        assert_eq!(
            render_cell(cell(serde_json::json!("5"), false), ColumnRead::Hex, &mysql),
            "X'05'"
        );
        assert_eq!(
            render_cell(
                cell(serde_json::Value::Null, false),
                ColumnRead::Hex,
                &mysql
            ),
            "NULL"
        );
        // Anything that isn't plain hex is written as a normal literal.
        assert_eq!(
            render_cell(
                cell(serde_json::json!("x'; DROP"), false),
                ColumnRead::Hex,
                &mysql
            ),
            "'x''; DROP'"
        );
        // A JSON column read as text is already JSON text: written as is.
        let postgres = dialect("\"", true);
        assert_eq!(
            render_cell(
                cell(serde_json::json!("{\"k\": 1}"), true),
                ColumnRead::Text,
                &postgres
            ),
            "'{\"k\": 1}'"
        );
        assert_eq!(
            render_cell(
                cell(serde_json::json!("{\"k\": 1}"), true),
                ColumnRead::Value,
                &postgres
            ),
            "'\"{\\\"k\\\": 1}\"'"
        );
    }

    #[test]
    fn writes_sqlite_quote_literals_as_they_are() {
        let sqlite = dialect("\"", false);
        let cell = |value: &str| SqlCell {
            value: serde_json::json!(value),
            is_json: false,
        };
        let literals = [
            "NULL",
            "'hello'",
            "'it''s\né'",
            "''",
            "42",
            "-9223372036854775808",
            "3.00000000000000044e-01",
            "1.0e+300",
            "9e999",
            "-9e999",
            "X'DEADBEEF'",
            "X''",
        ];
        let row = literals.iter().map(|literal| cell(literal)).collect();
        assert_eq!(
            render_row(row, &[ColumnRead::Quoted; 12], &sqlite),
            literals
        );
        // Text read as hex: a string when it is valid text without a NUL,
        // else its exact bytes.
        for (value, literal) in [
            ("TUTF-8:6869", "'hi'"),
            ("TUTF-8:", "''"),
            ("TUTF-8:69742773", "'it''s'"),
            ("TUTF-8:F09F9880", "'\u{1f600}'"),
            ("TUTF-8:FF", "CAST(X'FF' AS TEXT)"),
            ("TUTF-8:610062", "CAST(X'610062' AS TEXT)"),
            ("TUTF-16le:68006900", "'hi'"),
            ("TUTF-16be:00680069", "'hi'"),
            ("TUTF-16le:00D8", "CAST(X'00D8' AS TEXT)"),
        ] {
            assert_eq!(
                render_row(vec![cell(value)], &[ColumnRead::Quoted], &sqlite),
                [literal]
            );
        }
        // Anything that isn't one of those forms is written as a string.
        for value in [
            "X'GG'",
            "1; DROP TABLE t",
            "-",
            "'a'b'",
            "Inf",
            "1e",
            "TUTF-8:6",
            "TUTF-8:ZZ",
            "TUTF-32:00",
            "T",
        ] {
            assert_eq!(
                render_row(vec![cell(value)], &[ColumnRead::Quoted], &sqlite),
                [format!("'{}'", value.replace('\'', "''"))]
            );
        }
    }

    #[test]
    fn falls_back_to_star_without_column_metadata() {
        assert_eq!(
            export_select(&dialect("\"", false), None, "t", &[], &[]),
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
        fixture_for("sqlite")
    }

    /// Two SQLite files saved as connections `source` and `target` of `driver`.
    fn fixture_for(driver: &str) -> Fixture {
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
                    params: params_for(&path, driver),
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

    fn params_for(path: &Path, driver: &str) -> ConnectionParams {
        ConnectionParams {
            driver: driver.to_string(),
            database: DatabaseSelection::Single(path.to_string_lossy().into_owned()),
            ..Default::default()
        }
    }

    impl Fixture {
        fn params(&self, id: &str) -> ConnectionParams {
            params_for(&self.dir.join(format!("{id}.sqlite")), "sqlite")
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
    async fn keeps_binary_values_past_the_read_preview() {
        // The grid reads at most a 10 KB preview of a blob; the export must
        // carry the whole value.
        let fixture = fixture().await;
        fixture
            .run(
                "source",
                "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price REAL, active INTEGER, note BLOB)",
            )
            .await;
        fixture
            .run(
                "source",
                "INSERT INTO items VALUES (1, 'big', NULL, 1, zeroblob(20000)), (2, 'small', NULL, 0, X'DEADBEEF00'), (3, 'empty', NULL, 0, X''), (4, 'none', NULL, 0, NULL)",
            )
            .await;
        fixture
            .run(
                "source",
                "UPDATE items SET note = randomblob(20000) WHERE id = 1",
            )
            .await;
        let (path, _) = fixture.export(TableSqlContent::StructureAndData).await;
        fixture.import(&path, IfTableExists::Fail).await.unwrap();

        let hex = "SELECT id, hex(note), length(note), typeof(note) FROM items ORDER BY id";
        assert_eq!(
            fixture.run("target", hex).await.rows,
            fixture.run("source", hex).await.rows
        );
    }

    #[tokio::test]
    async fn keeps_the_storage_class_of_every_value() {
        // SQLite stores text, numbers and blobs in any column, whatever its
        // declared type; each value must come back exactly as it was
        // stored, in every column affinity.
        let fixture = fixture().await;
        fixture
            .run(
                "source",
                "CREATE TABLE items (id INTEGER PRIMARY KEY, i INTEGER, r REAL, n NUMERIC, t TEXT, b BLOB, u)",
            )
            .await;
        let values = [
            "'hello'",
            "42",
            "1.5",
            "X'DEADBEEF'",
            "NULL",
            "9223372036854775807",
            "-9223372036854775808",
            "9007199254740993",
            "1e999",
            "-1e999",
            "-0.0",
            "2.0",
            "0.30000000000000004",
            "1e300",
            "5e-324",
            "'007'",
            "''",
            "X''",
            "X'00'",
            "'it''s' || char(10) || 'caf\u{e9} \u{1f600}'",
            "'Inf'",
            "'{\"k\":  1}'",
            "1.7976931348623157e308",
            "-1.7976931348623157e308",
            "2.2250738585072014e-308",
            "123456789012345678.0",
            "CAST(X'FF' AS TEXT)",
            "CAST(X'C328' AS TEXT)",
            "'a' || char(0) || 'b'",
        ];
        for (id, value) in values.iter().enumerate() {
            fixture
                .run(
                    "source",
                    &format!(
                        "INSERT INTO items VALUES ({id}, {value}, {value}, {value}, {value}, {value}, {value})"
                    ),
                )
                .await;
        }
        // 20 KB, past the grid's blob preview.
        fixture
            .run(
                "source",
                "INSERT INTO items (id, b, u) VALUES (100, randomblob(20000), zeroblob(20000))",
            )
            .await;
        let (path, _) = fixture.export(TableSqlContent::StructureAndData).await;
        fixture.import(&path, IfTableExists::Fail).await.unwrap();

        let columns = ["i", "r", "n", "t", "b", "u"]
            .iter()
            .map(|column| format!("quote({column}), typeof({column}), hex({column})"))
            .collect::<Vec<_>>()
            .join(", ");
        let compare = format!("SELECT id, {columns} FROM items ORDER BY id");
        let source = fixture.run("source", &compare).await.rows;
        assert_eq!(source.len(), values.len() + 1);
        assert_eq!(fixture.run("target", &compare).await.rows, source);

        // The untyped and BLOB columns hold every storage class.
        let classes = "SELECT group_concat(DISTINCT typeof(u)), group_concat(DISTINCT typeof(b)) FROM (SELECT u, b FROM items ORDER BY id)";
        assert_eq!(
            fixture.run("source", classes).await.rows,
            [[
                serde_json::json!("text,integer,real,blob,null"),
                serde_json::json!("text,integer,real,blob,null")
            ]]
        );
        let edges =
            "SELECT quote(u), typeof(u) FROM items WHERE id IN (5, 6, 7, 8, 9, 12) ORDER BY id";
        assert_eq!(
            serde_json::to_value(fixture.run("target", edges).await.rows).unwrap(),
            serde_json::json!([
                ["9223372036854775807", "integer"],
                ["-9223372036854775808", "integer"],
                ["9007199254740993", "integer"],
                ["9.0e+999", "real"],
                ["-9.0e+999", "real"],
                ["3.00000000000000044e-01", "real"]
            ])
        );
        // The largest doubles stay finite.
        let reals = "SELECT quote(u), typeof(u) FROM items WHERE id BETWEEN 22 AND 25 ORDER BY id";
        assert_eq!(
            serde_json::to_value(fixture.run("target", reals).await.rows).unwrap(),
            serde_json::json!([
                ["1.797693134862315708e+308", "real"],
                ["-1.797693134862315708e+308", "real"],
                ["2.22507385850720138e-308", "real"],
                ["1.2345678901234568e+17", "real"]
            ])
        );
        // Text that isn't valid UTF-8 or holds a NUL keeps every byte.
        let texts = "SELECT typeof(u), hex(u) FROM items WHERE id BETWEEN 26 AND 28 ORDER BY id";
        assert_eq!(
            serde_json::to_value(fixture.run("target", texts).await.rows).unwrap(),
            serde_json::json!([["text", "FF"], ["text", "C328"], ["text", "610062"]])
        );

        // Rows come out in key order (10 after 9, not after 1).
        let text = fs::read_to_string(&path).unwrap();
        let ids = text
            .lines()
            .filter_map(|line| line.strip_prefix('('))
            .map(|line| line.split(',').next().unwrap().parse::<i64>().unwrap())
            .collect::<Vec<_>>();
        let mut sorted = ids.clone();
        sorted.sort();
        assert_eq!(ids.len(), values.len() + 1);
        assert_eq!(ids, sorted);
        // ...read along the key, without sorting the whole table.
        let columns =
            ["id", "i", "r", "n", "t", "b", "u"].map(|name| column(name, name == "id", false));
        let reads = column_reads("sqlite", &columns);
        let select = export_select(&dialect("\"", false), None, "items", &columns, &reads);
        let plan = fixture
            .run("source", &format!("EXPLAIN QUERY PLAN {select}"))
            .await
            .rows;
        assert!(!format!("{plan:?}").contains("TEMP B-TREE"), "{plan:?}");
    }

    /// A plugin driver as the host sees it, over JSON-RPC, answered by the
    /// built-in SQLite driver. With `own_methods` it also implements the
    /// optional `get_table_ddl` and `render_insert_statements`; its INSERTs
    /// then carry a `/* plugin */` marker, one row each.
    async fn register_sqlite_plugin(id: &str, own_methods: bool) {
        use crate::drivers::sqlite::SqliteDriver;

        let mut manifest = SqliteDriver::new().manifest().clone();
        manifest.id = id.to_string();
        manifest.name = id.to_string();
        manifest.is_builtin = false;
        let driver = crate::plugins::driver::test_driver_with_manifest(manifest, move |request| {
            let sqlite = SqliteDriver::new();
            let args = request.params;
            let text = |key: &str| args[key].as_str().map(str::to_string);
            let params = || {
                let mut params: ConnectionParams =
                    serde_json::from_value(args["params"].clone()).unwrap();
                params.driver = "sqlite".to_string();
                params
            };
            fn to_json(value: impl serde::Serialize) -> Result<serde_json::Value, String> {
                serde_json::to_value(value).map_err(|e| e.to_string())
            }
            tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current().block_on(async {
                    let schema = text("schema");
                    match request.method.as_str() {
                        "get_tables" => {
                            to_json(sqlite.get_tables(&params(), schema.as_deref()).await?)
                        }
                        "get_columns" => to_json(
                            sqlite
                                .get_columns(&params(), &text("table").unwrap(), schema.as_deref())
                                .await?,
                        ),
                        "execute_query" => to_json(
                            sqlite
                                .execute_query(
                                    &params(),
                                    &text("query").unwrap(),
                                    args["limit"].as_u64().map(|limit| limit as u32),
                                    args["page"].as_u64().unwrap_or(1) as u32,
                                    schema.as_deref(),
                                )
                                .await?,
                        ),
                        "get_create_table_sql" => to_json(
                            sqlite
                                .get_create_table_sql(
                                    &text("table_name").unwrap(),
                                    serde_json::from_value(args["columns"].clone()).unwrap(),
                                    schema.as_deref(),
                                )
                                .await?,
                        ),
                        "get_table_ddl" if own_methods => to_json(
                            sqlite
                                .get_table_ddl(&params(), &text("table").unwrap(), schema.as_deref())
                                .await?,
                        ),
                        "render_insert_statements" if own_methods => {
                            let columns: Vec<String> =
                                serde_json::from_value(args["columns"].clone()).unwrap();
                            let rows: Vec<Vec<serde_json::Value>> =
                                serde_json::from_value(args["rows"].clone()).unwrap();
                            let dialect = dialect("\"", false);
                            let names = columns
                                .iter()
                                .map(|column| dialect.quote_identifier(column))
                                .collect::<Vec<_>>()
                                .join(", ");
                            let table = dialect.quote_identifier(&text("table").unwrap());
                            to_json(
                                rows.into_iter()
                                    .map(|row| {
                                        let values = row
                                            .into_iter()
                                            .map(|value| {
                                                SqlCell {
                                                    value,
                                                    is_json: false,
                                                }
                                                .render(&dialect)
                                            })
                                            .collect::<Vec<_>>()
                                            .join(", ");
                                        format!(
                                            "/* plugin */ INSERT INTO {table} ({names}) VALUES ({values});"
                                        )
                                    })
                                    .collect::<Vec<_>>(),
                            )
                        }
                        _ => Err("Method not found (-32601)".to_string()),
                    }
                })
            })
        });
        crate::drivers::registry::register_driver(driver).await;
    }

    /// Exports and imports a table through a fake plugin driver and returns
    /// the file plus `query`'s rows on the target and the source. The driver
    /// is registered only for the round trip, under the registry test lock,
    /// so the registry's own tests never see it.
    async fn plugin_round_trip(
        id: &str,
        own_methods: bool,
        query: &str,
    ) -> (
        String,
        Vec<Vec<serde_json::Value>>,
        Vec<Vec<serde_json::Value>>,
    ) {
        let _guard = crate::drivers::registry::REGISTRY_TEST_LOCK.lock().await;
        register_sqlite_plugin(id, own_methods).await;
        let fixture = fixture_for(id);
        fixture.seed().await;
        let (path, result) = fixture.export(TableSqlContent::StructureAndData).await;
        assert_eq!(result.rows, 1203);
        let imported = fixture.import(&path, IfTableExists::Fail).await.unwrap();
        assert_eq!(imported.rows, 1203);
        assert_eq!(fixture.rows("target").await, fixture.rows("source").await);
        let target = fixture.run("target", query).await.rows;
        let source = fixture.run("source", query).await.rows;
        crate::drivers::registry::unregister_driver(id).await;
        (fs::read_to_string(&path).unwrap(), target, source)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn round_trips_through_a_plugin_without_optional_methods() {
        // The generated structure keeps the primary key.
        let pk = "SELECT name FROM pragma_table_info('items') WHERE pk = 1";
        let (text, target, _) = plugin_round_trip("table-transfer-plain-plugin", false, pk).await;

        assert!(text.contains("-- Driver: table-transfer-plain-plugin\n"));
        assert!(text.contains("-- Driver-Version: "));
        assert!(text.contains("-- Structure-Source: generated\n"));
        assert!(!text.contains("/* plugin */"));
        // The host renderer batches 500 rows per INSERT.
        assert_eq!(text.matches("INSERT INTO").count(), 3);
        assert_eq!(target, [[serde_json::json!("id")]]);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn round_trips_through_a_plugin_with_its_own_ddl_and_literals() {
        let ddl = "SELECT sql FROM sqlite_master WHERE name = 'items'";
        let (text, target, source) =
            plugin_round_trip("table-transfer-own-plugin", true, ddl).await;

        assert!(text.contains("-- Driver: table-transfer-own-plugin\n"));
        assert!(text.contains("-- Structure-Source: driver\n"));
        // Every INSERT is the plugin's own.
        assert_eq!(text.matches("/* plugin */ INSERT INTO").count(), 1203);
        assert_eq!(text.matches("INSERT INTO").count(), 1203);
        assert_eq!(target, source);
    }

    #[tokio::test]
    async fn keeps_the_table_indexes() {
        let fixture = fixture().await;
        fixture.seed().await;
        for index in [
            "CREATE INDEX items_name ON items (name)",
            "CREATE UNIQUE INDEX items_note ON items (note, id)",
            "CREATE INDEX items_active ON items (price DESC) WHERE active = 1",
        ] {
            fixture.run("source", index).await;
        }
        let (path, _) = fixture.export(TableSqlContent::StructureAndData).await;
        fixture.import(&path, IfTableExists::Fail).await.unwrap();

        let indexes = "SELECT name, sql FROM sqlite_master WHERE type = 'index' ORDER BY name";
        let source = fixture.run("source", indexes).await.rows;
        assert_eq!(source.len(), 3);
        assert_eq!(fixture.run("target", indexes).await.rows, source);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancelling_an_export_leaves_no_file() {
        let fixture = fixture().await;
        fixture
            .run(
                "source",
                "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, price REAL, active INTEGER, note TEXT)",
            )
            .await;
        fixture
            .run(
                "source",
                "WITH RECURSIVE seq(v) AS (SELECT 1 UNION ALL SELECT v + 1 FROM seq WHERE v < 300000) INSERT INTO items SELECT v, printf('%.200c', 'x'), v, 1, NULL FROM seq",
            )
            .await;
        let state = Arc::new(ExportCancellationState::default());
        let path = fixture.dir.join("items.sql");
        let task = {
            let runtime = fixture.runtime.clone();
            let state = state.clone();
            let path = path.clone();
            tokio::spawn(async move {
                export_table(
                    &runtime,
                    &state,
                    None,
                    "source".to_string(),
                    TableExportOptions {
                        table: "items".to_string(),
                        content: TableSqlContent::StructureAndData,
                        schema: None,
                        database: None,
                    },
                    TableExportDestination::ServerPath(path),
                )
                .await
            })
        };
        // Cancel once rows are being written.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        while fixture.leftovers().is_empty() && std::time::Instant::now() < deadline {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        assert!(!fixture.leftovers().is_empty(), "the export never started");
        crate::application::generic_exports::cancel_export(&state, None, "source").unwrap();

        let result = task.await.unwrap();
        assert_eq!(result.unwrap_err(), TABLE_EXPORT_CANCELLED);
        assert!(!path.exists());
        // The aborted task drops its scratch files as it unwinds.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !fixture.leftovers().is_empty() && std::time::Instant::now() < deadline {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert!(
            fixture.leftovers().is_empty(),
            "scratch files remain: {:?}",
            fixture.leftovers()
        );
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

    impl Fixture {
        /// A valid export of `items` with one INSERT per row, so the import
        /// runs long enough to be cancelled half way.
        fn long_export(&self, rows: usize) -> PathBuf {
            let path = self.dir.join("items-long.sql");
            let mut text = header(TableSqlContent::StructureAndData).render();
            text.push_str(&section_marker(SECTION_STRUCTURE));
            text.push_str("\nCREATE TABLE \"items\" (id INTEGER PRIMARY KEY, name TEXT);\n");
            text.push('\n');
            text.push_str(&section_marker(SECTION_DATA));
            text.push('\n');
            for id in 1..=rows {
                text.push_str(&format!(
                    "INSERT INTO \"items\" (\"id\", \"name\") VALUES ({id}, 'row {id}');\n"
                ));
            }
            text.push_str(end_marker());
            text.push('\n');
            fs::write(&path, text).unwrap();
            path
        }

        /// Starts an import of `path` into the target, waits until `ready`
        /// says it is under way, cancels it and returns its result.
        async fn cancel_import_when<F, Fut>(
            &self,
            path: &Path,
            if_exists: IfTableExists,
            ready: F,
        ) -> Result<TableImportResult, String>
        where
            F: Fn() -> Fut,
            Fut: std::future::Future<Output = bool>,
        {
            let state = DumpCancellationState::default();
            let runtime = self.runtime.clone();
            let task_state = DumpCancellationState {
                handles: state.handles.clone(),
            };
            let task_path = path.to_path_buf();
            let import = tokio::spawn(async move {
                import_table(
                    &runtime,
                    &task_state,
                    None,
                    "target".to_string(),
                    TableImportSource::ServerPath(task_path),
                    TableImportOptions {
                        if_exists,
                        schema: None,
                        database: None,
                    },
                )
                .await
            });
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
            while !ready().await {
                if import.is_finished() {
                    panic!(
                        "the import ended before it could be cancelled: {:?}",
                        import.await.unwrap()
                    );
                }
                assert!(
                    std::time::Instant::now() < deadline,
                    "the import never got under way"
                );
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
            cancel_table_import(&state, None, "target").unwrap();
            import.await.unwrap()
        }

        async fn target_tables(&self) -> Vec<Vec<serde_json::Value>> {
            self.run(
                "target",
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'items'",
            )
            .await
            .rows
        }

        /// Rows in the target's `items`, or none while the import holds the
        /// database or the table isn't there yet.
        async fn target_count(&self) -> Option<i64> {
            crate::drivers::sqlite::execute_query(
                &self.params("target"),
                "SELECT COUNT(*) FROM items",
                None,
                1,
            )
            .await
            .ok()
            .and_then(|result| result.rows.first()?.first()?.as_i64())
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancelling_removes_the_table_the_import_created() {
        let fixture = fixture().await;
        let path = fixture.long_export(50_000);

        let error = fixture
            .cancel_import_when(&path, IfTableExists::Fail, || async {
                fixture.target_count().await.is_some()
            })
            .await
            .unwrap_err();

        assert_eq!(error, "Import cancelled");
        assert!(
            fixture.target_tables().await.is_empty(),
            "the table created by the cancelled import is still there"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancelling_keeps_a_table_that_existed_before() {
        let fixture = fixture().await;
        fixture
            .run(
                "target",
                "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)",
            )
            .await;
        fixture
            .run("target", "INSERT INTO items VALUES (-1, 'kept')")
            .await;
        let path = fixture.long_export(50_000);

        let error = fixture
            .cancel_import_when(&path, IfTableExists::Append, || async {
                fixture.target_count().await.is_some_and(|count| count > 1)
            })
            .await
            .unwrap_err();

        assert_eq!(error, "Import cancelled");
        assert_eq!(fixture.target_tables().await.len(), 1);
        assert_eq!(
            fixture
                .run("target", "SELECT name FROM items WHERE id = -1")
                .await
                .rows,
            vec![vec![serde_json::json!("kept")]]
        );
    }

    impl Fixture {
        async fn created_table(&self, table: &str) -> CreatedTable {
            let params = self.params("target");
            let drv = crate::drivers::registry::get_connection_driver(&params)
                .await
                .unwrap();
            let capabilities = drv.manifest().capabilities.clone();
            CreatedTable {
                dialect: DumpDialect::from_capabilities("sqlite", &capabilities),
                drv,
                params,
                capabilities,
                table: table.to_string(),
                schema: None,
            }
        }
    }

    #[tokio::test]
    async fn cleanup_counts_a_table_that_was_never_created_as_removed() {
        // A cancel can land after the slot is armed but before CREATE TABLE ran.
        let fixture = fixture().await;
        assert!(fixture.created_table("items").await.remove().await);

        fixture
            .run("target", "CREATE TABLE items (id INTEGER PRIMARY KEY)")
            .await;
        assert!(fixture.created_table("items").await.remove().await);
        assert!(fixture.target_tables().await.is_empty());
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
