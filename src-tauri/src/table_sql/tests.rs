use std::io::Cursor;

use super::*;
use crate::drivers::sql_syntax::LiteralStyle;
use crate::dump_utils::DumpDialect;

fn dialect(quote: &str, escape: LiteralStyle, postgres: bool) -> DumpDialect {
    DumpDialect {
        identifier_quote: quote.to_string(),
        schema_qualified: postgres,
        postgres,
        string_escape: escape,
        boolean_keywords: postgres,
    }
}

fn postgres() -> DumpDialect {
    dialect("\"", LiteralStyle::Standard, true)
}

fn mysql() -> DumpDialect {
    dialect("`", LiteralStyle::Mysql, false)
}

fn header() -> TableSqlHeader {
    TableSqlHeader {
        format_version: FORMAT_VERSION,
        tabularis_version: "0.30.0".to_string(),
        driver: "postgres".to_string(),
        driver_version: Some("1.0.0".to_string()),
        source: "shop.public.orders".to_string(),
        table: "orders".to_string(),
        content: TableSqlContent::StructureAndData,
        structure_source: StructureSource::Driver,
        rows: 128400,
        exported: "2026-09-03T14:21:07Z".to_string(),
    }
}

fn items(sql: &str, dialect: &DumpDialect) -> Vec<TableSqlItem> {
    let mut reader = TableSqlReader::new(Cursor::new(sql.as_bytes().to_vec()), dialect);
    let mut out = Vec::new();
    while let Some(item) = reader.next_item().unwrap() {
        out.push(item);
    }
    out
}

fn statements(sql: &str, dialect: &DumpDialect) -> Vec<String> {
    items(sql, dialect)
        .into_iter()
        .filter_map(|item| match item {
            TableSqlItem::Statement { sql, .. } => Some(sql),
            TableSqlItem::Section(_) => None,
        })
        .collect()
}

mod header {
    use super::*;

    #[test]
    fn renders_one_key_per_line_in_order() {
        assert_eq!(
            header().render(),
            "-- Tabularis table export\n\
             -- Format: tabularis-table-sql/1\n\
             -- Tabularis: 0.30.0\n\
             -- Driver: postgres\n\
             -- Driver-Version: 1.0.0\n\
             -- Source: shop.public.orders\n\
             -- Table: orders\n\
             -- Content: structure_and_data\n\
             -- Structure-Source: driver\n\
             -- Rows: 128400\n\
             -- Exported: 2026-09-03T14:21:07Z\n\n"
        );
    }

    #[test]
    fn round_trips_through_the_parser() {
        let text = format!(
            "{}{}\nCREATE TABLE x (id int);\n",
            header().render(),
            section_marker("structure")
        );
        let parsed = TableSqlHeader::parse(&mut Cursor::new(text)).unwrap();
        assert_eq!(parsed, header());
    }

    #[test]
    fn keeps_values_on_one_line() {
        let mut value = header();
        value.table = "odd\nname".to_string();
        let parsed = TableSqlHeader::parse(&mut Cursor::new(value.render())).unwrap();
        assert_eq!(parsed.table, "odd name");
    }

    #[test]
    fn ignores_unknown_keys_and_a_byte_order_mark() {
        let text = "\u{feff}-- Tabularis table export\n-- Format: tabularis-table-sql/1\n-- Future-Key: x\n-- Driver: sqlite\n-- Table: t\n-- Content: structure_only\n-- Rows: 9\n";
        let parsed = TableSqlHeader::parse(&mut Cursor::new(text)).unwrap();
        assert_eq!(parsed.driver, "sqlite");
        assert_eq!(parsed.content, TableSqlContent::StructureOnly);
        assert_eq!(parsed.rows, 0, "structure-only exports carry no rows");
        assert_eq!(parsed.structure_source, StructureSource::Driver);
        assert_eq!(parsed.driver_version, None);
    }

    #[test]
    fn reads_a_generated_structure_source() {
        let mut value = header();
        value.structure_source = StructureSource::Generated;
        let parsed = TableSqlHeader::parse(&mut Cursor::new(value.render())).unwrap();
        assert_eq!(parsed.structure_source, StructureSource::Generated);
    }

    #[test]
    fn refuses_a_plain_sql_script() {
        let error = TableSqlHeader::parse(&mut Cursor::new(
            "-- Tabularis Dump\nCREATE TABLE t (id int);\n",
        ))
        .unwrap_err();
        assert_eq!(error, NOT_A_TABLE_EXPORT);
        let error =
            TableSqlHeader::parse(&mut Cursor::new("CREATE TABLE t (id int);\n")).unwrap_err();
        assert_eq!(error, NOT_A_TABLE_EXPORT);
        let error = TableSqlHeader::parse(&mut Cursor::new("")).unwrap_err();
        assert_eq!(error, NOT_A_TABLE_EXPORT);
    }

    #[test]
    fn refuses_a_newer_format() {
        let text = header()
            .render()
            .replace("tabularis-table-sql/1", "tabularis-table-sql/2");
        let error = TableSqlHeader::parse(&mut Cursor::new(text)).unwrap_err();
        assert!(error.contains("Update Tabularis"), "{error}");
    }

    #[test]
    fn accepts_a_newer_minor_version() {
        let text = header()
            .render()
            .replace("tabularis-table-sql/1", "tabularis-table-sql/1.4");
        assert_eq!(
            TableSqlHeader::parse(&mut Cursor::new(text))
                .unwrap()
                .format_version,
            1
        );
    }

    #[test]
    fn refuses_an_unknown_format_name() {
        let text = header()
            .render()
            .replace("tabularis-table-sql/1", "other/1");
        assert!(TableSqlHeader::parse(&mut Cursor::new(text))
            .unwrap_err()
            .contains("Unknown table export format"));
    }

    #[test]
    fn names_a_missing_required_line() {
        let text = "-- Tabularis table export\n-- Format: tabularis-table-sql/1\n-- Driver: mysql\n-- Content: structure_only\n";
        let error = TableSqlHeader::parse(&mut Cursor::new(text)).unwrap_err();
        assert!(error.contains("table"), "{error}");
    }

    #[test]
    fn refuses_unknown_content() {
        let text = header().render().replace("structure_and_data", "data_only");
        assert!(TableSqlHeader::parse(&mut Cursor::new(text))
            .unwrap_err()
            .contains("content"));
    }
}

mod ddl {
    use super::*;

    #[test]
    fn strips_the_schema_from_postgres_ddl() {
        let ddl = "CREATE TABLE \"public\".\"orders\" (\n  \"id\" integer NOT NULL\n);";
        assert_eq!(
            unqualify_ddl(ddl, &postgres(), Some("public"), "orders"),
            "CREATE TABLE \"orders\" (\n  \"id\" integer NOT NULL\n);"
        );
    }

    #[test]
    fn leaves_unqualified_ddl_alone() {
        let ddl = "CREATE TABLE `orders` (\n  `id` int NOT NULL\n);";
        assert_eq!(unqualify_ddl(ddl, &mysql(), Some("shop"), "orders"), ddl);
        assert_eq!(unqualify_ddl(ddl, &postgres(), None, "orders"), ddl);
    }

    #[test]
    fn honours_a_plugin_identifier_quote() {
        let dialect = dialect("[", LiteralStyle::Standard, false);
        let dialect = DumpDialect {
            schema_qualified: true,
            ..dialect
        };
        let ddl = format!(
            "CREATE TABLE {} (x int);",
            dialect.table_ref(Some("dbo"), "t")
        );
        assert_eq!(
            unqualify_ddl(&ddl, &dialect, Some("dbo"), "t"),
            format!("CREATE TABLE {} (x int);", dialect.quote_identifier("t"))
        );
    }

    #[test]
    fn terminates_statements() {
        assert_eq!(
            terminate_statements("CREATE TABLE t (id int)\n"),
            "CREATE TABLE t (id int);"
        );
        assert_eq!(
            terminate_statements("CREATE TABLE t (id int);\n\n"),
            "CREATE TABLE t (id int);"
        );
    }
}

mod insert {
    use super::*;

    #[test]
    fn writes_an_explicit_column_list_and_one_row_per_line() {
        let rows = vec![
            vec!["1".to_string(), "'a'".to_string()],
            vec!["2".to_string(), "NULL".to_string()],
        ];
        assert_eq!(
            render_insert(
                &postgres(),
                "orders",
                &["id".to_string(), "note".to_string()],
                &rows
            ),
            "INSERT INTO \"orders\" (\"id\", \"note\") VALUES\n(1, 'a'),\n(2, NULL);"
        );
        assert_eq!(
            render_insert(
                &mysql(),
                "orders",
                &["id".to_string()],
                &[vec!["1".to_string()]]
            ),
            "INSERT INTO `orders` (`id`) VALUES\n(1);"
        );
    }

    #[test]
    fn host_rendering_reads_back_through_the_reader() {
        let dialect = mysql();
        let text = dialect.escape_value(serde_json::json!("it's; a\nline \\ end;"));
        let sql = render_insert(&dialect, "t", &["v".to_string()], &[vec![text]]);
        assert_eq!(
            statements(&sql, &dialect),
            vec![sql.trim_end_matches(';').to_string()]
        );
    }
}

mod reader {
    use super::*;

    #[test]
    fn reports_sections_and_statements_with_their_lines() {
        let sql = "-- Tabularis table export\n-- Table: t\n\n-- @section structure\nCREATE TABLE \"t\" (\n  id int\n);\n\n-- @section data\nINSERT INTO \"t\" (\"id\") VALUES\n(1);\n-- @end\nSELECT 'after end';\n";
        assert_eq!(
            items(sql, &postgres()),
            vec![
                TableSqlItem::Section("structure".to_string()),
                TableSqlItem::Statement {
                    sql: "CREATE TABLE \"t\" (\n  id int\n)".to_string(),
                    line: 5,
                },
                TableSqlItem::Section("data".to_string()),
                TableSqlItem::Statement {
                    sql: "INSERT INTO \"t\" (\"id\") VALUES\n(1)".to_string(),
                    line: 10,
                },
            ]
        );
    }

    #[test]
    fn keeps_semicolons_quotes_and_line_breaks_inside_text() {
        let sql = "INSERT INTO t VALUES ('a;\n;\n-- not a comment', 'it''s');\nINSERT INTO t VALUES ('x');\n";
        assert_eq!(
            statements(sql, &postgres()),
            vec![
                "INSERT INTO t VALUES ('a;\n;\n-- not a comment', 'it''s')".to_string(),
                "INSERT INTO t VALUES ('x')".to_string(),
            ]
        );
    }

    #[test]
    fn follows_backslash_escapes_only_where_the_dialect_has_them() {
        let sql = "INSERT INTO t VALUES ('a\\';b');\n";
        assert_eq!(
            statements(sql, &mysql()),
            vec!["INSERT INTO t VALUES ('a\\';b')".to_string()]
        );
        // Standard strings: the backslash is plain text and the quote closes.
        assert_eq!(
            statements("INSERT INTO t VALUES ('a\\');\n", &postgres()),
            vec!["INSERT INTO t VALUES ('a\\')".to_string()]
        );
    }

    #[test]
    fn skips_semicolons_in_quoted_identifiers() {
        let sql = "CREATE TABLE `odd;name` (`x``;` int);\n";
        assert_eq!(
            statements(sql, &mysql()),
            vec!["CREATE TABLE `odd;name` (`x``;` int)".to_string()]
        );
    }

    #[test]
    fn splits_several_statements_on_one_line() {
        let sql = "CREATE TABLE t (id int); CREATE INDEX i ON t (id);\n";
        assert_eq!(
            statements(sql, &postgres()),
            vec![
                "CREATE TABLE t (id int)".to_string(),
                "CREATE INDEX i ON t (id)".to_string()
            ]
        );
    }

    #[test]
    fn returns_a_last_statement_without_terminator() {
        assert_eq!(
            statements("SELECT 1", &postgres()),
            vec!["SELECT 1".to_string()]
        );
        assert!(statements("-- only a comment\n\n", &postgres()).is_empty());
    }
}
