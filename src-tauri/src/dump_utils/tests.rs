use super::*;
use crate::drivers::driver_trait::DatabaseDriver;
use serde_json::json;

fn builtin_drivers() -> Vec<Box<dyn DatabaseDriver>> {
    vec![
        Box::new(crate::drivers::mysql::MysqlDriver::new()),
        Box::new(crate::drivers::postgres::PostgresDriver::new()),
        Box::new(crate::drivers::sqlite::SqliteDriver::new()),
    ]
}

fn dialect_of(drv: &dyn DatabaseDriver) -> DumpDialect {
    DumpDialect::from_capabilities(&drv.manifest().id, &drv.manifest().capabilities)
}

fn dialect_for(id: &str) -> DumpDialect {
    builtin_drivers()
        .into_iter()
        .find(|d| d.manifest().id == id)
        .map(|d| dialect_of(d.as_ref()))
        .unwrap_or_else(|| panic!("no builtin driver {id}"))
}

/// Capabilities of a plugin driver that quotes with backticks and exposes
/// datasets as schemas (a BigQuery-like engine).
fn backtick_schema_plugin() -> DriverCapabilities {
    DriverCapabilities {
        schemas: true,
        identifier_quote: "`".into(),
        sql_dialect: None,
        ..Default::default()
    }
}

/// The table reference `dump_database` writes for `requested` schema.
fn dumped_table_ref(dialect: &DumpDialect, requested: Option<&str>, table: &str) -> String {
    let schema = dialect.resolve_schema(requested);
    dialect.table_ref(dialect.scoped_schema(schema.as_deref()), table)
}

// ---------------------------------------------------------------------------
// Golden tests: the builtin drivers' output is byte-identical to the
// driver-id based implementation this module replaced (copied verbatim
// below as the reference).
// ---------------------------------------------------------------------------

mod legacy {
    pub fn format_table_ref(driver: &str, schema: &str, table: &str) -> String {
        match driver {
            "mysql" => format!("`{}`", table),
            "postgres" | "postgresql" => format!(r#""{}"."{}""#, schema, table),
            _ => format!(r#""{}""#, table),
        }
    }

    pub fn drop_table_if_exists(driver: &str, schema: &str, table: &str) -> String {
        format!(
            "DROP TABLE IF EXISTS {};",
            format_table_ref(driver, schema, table)
        )
    }

    pub fn insert_into_statement(driver: &str, schema: &str, table: &str, values: &str) -> String {
        format!(
            "INSERT INTO {} VALUES {};",
            format_table_ref(driver, schema, table),
            values
        )
    }

    fn is_postgres_driver(driver: &str) -> bool {
        driver == "postgres" || driver == "postgresql"
    }

    fn escape_sql_string(driver: &str, s: &str) -> String {
        match driver {
            "mysql" => format!(
                "'{}'",
                s.replace('\\', "\\\\")
                    .replace('\'', "''")
                    .replace('\0', "\\0")
            ),
            _ => format!("'{}'", s.replace('\'', "''")),
        }
    }

    pub fn escape_sql_value(driver: &str, val: serde_json::Value) -> String {
        match val {
            serde_json::Value::Null => "NULL".to_string(),
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::Bool(b) => {
                if is_postgres_driver(driver) {
                    if b {
                        "TRUE".to_string()
                    } else {
                        "FALSE".to_string()
                    }
                } else if b {
                    "1".to_string()
                } else {
                    "0".to_string()
                }
            }
            serde_json::Value::String(s) => escape_sql_string(driver, &s),
            other => escape_sql_string(driver, &other.to_string()),
        }
    }

    pub fn escape_json_column_value(driver: &str, val: serde_json::Value) -> String {
        match val {
            serde_json::Value::Null => "NULL".to_string(),
            other => escape_sql_string(driver, &other.to_string()),
        }
    }
}

const TABLES: &[&str] = &["users", "Order Items", "naïve_表", "a.b", "x-y"];
const REQUESTED_SCHEMAS: &[Option<&str>] = &[None, Some("public"), Some("app"), Some("mydb")];

fn golden_values() -> Vec<serde_json::Value> {
    vec![
        json!(null),
        json!(0),
        json!(-42),
        json!(12.34),
        json!(true),
        json!(false),
        json!("hello"),
        json!("O'Reilly"),
        json!("Multi\nLine"),
        json!("Back\\slash"),
        json!("a\u{0}b"),
        json!("\\'"),
        json!("中文"),
        json!({"path": "a\\b", "q": "it's"}),
        json!([1, "two", null]),
    ]
}

#[test]
fn builtin_table_refs_match_the_legacy_output() {
    for drv in builtin_drivers() {
        let id = drv.manifest().id.clone();
        let dialect = dialect_of(drv.as_ref());
        for requested in REQUESTED_SCHEMAS {
            // The old command defaulted every driver's schema to "public".
            let legacy_schema = requested.unwrap_or("public");
            let schema = dialect.resolve_schema(*requested);
            let scoped = dialect.scoped_schema(schema.as_deref());
            for table in TABLES {
                assert_eq!(
                    dumped_table_ref(&dialect, *requested, table),
                    legacy::format_table_ref(&id, legacy_schema, table),
                    "{id} {requested:?} {table}"
                );
                assert_eq!(
                    dialect.drop_table_if_exists(scoped, table),
                    legacy::drop_table_if_exists(&id, legacy_schema, table),
                    "{id} {requested:?} {table}"
                );
                assert_eq!(
                    dialect.insert_into_statement(scoped, table, "(1, 'a'), (2, NULL)"),
                    legacy::insert_into_statement(&id, legacy_schema, table, "(1, 'a'), (2, NULL)"),
                    "{id} {requested:?} {table}"
                );
            }
        }
    }
}

#[test]
fn builtin_literals_match_the_legacy_output() {
    for drv in builtin_drivers() {
        let id = drv.manifest().id.clone();
        let dialect = dialect_of(drv.as_ref());
        for value in golden_values() {
            assert_eq!(
                dialect.escape_value(value.clone()),
                legacy::escape_sql_value(&id, value.clone()),
                "{id} {value}"
            );
            assert_eq!(
                dialect.escape_json_value(value.clone()),
                legacy::escape_json_column_value(&id, value.clone()),
                "{id} {value}"
            );
        }
    }
}

#[test]
fn postgresql_plugin_matches_the_legacy_output() {
    // The standalone PostgreSQL plugin declares the postgres dialect and
    // schemas; it must stay schema-qualified and keep TRUE/FALSE literals.
    let caps = DriverCapabilities {
        schemas: true,
        identifier_quote: "\"".into(),
        sql_dialect: Some(SqlDialect::Postgres),
        ..Default::default()
    };
    let dialect = DumpDialect::from_capabilities("postgresql", &caps);
    for requested in REQUESTED_SCHEMAS {
        assert_eq!(
            dumped_table_ref(&dialect, *requested, "products"),
            legacy::format_table_ref("postgresql", requested.unwrap_or("public"), "products")
        );
    }
    for value in golden_values() {
        assert_eq!(
            dialect.escape_value(value.clone()),
            legacy::escape_sql_value("postgresql", value)
        );
    }
}

/// Plugin ids the old command had no special case for; their output came
/// from its `_` fallback arm.
const DIALECTLESS_PLUGIN_IDS: &[&str] = &["informix", "duckdb", "custom", "firebird"];

#[test]
fn dialectless_plugin_literals_match_the_legacy_output() {
    // A plugin with no `sql_dialect` (or `generic`) gets exactly the literals
    // the id-based implementation wrote: 1/0 booleans, backslashes kept.
    for id in DIALECTLESS_PLUGIN_IDS {
        for sql_dialect in [None, Some(SqlDialect::Generic)] {
            for (schemas, quote) in [(false, ""), (false, "\""), (true, "`"), (true, "[")] {
                let caps = DriverCapabilities {
                    schemas,
                    identifier_quote: quote.into(),
                    sql_dialect,
                    ..Default::default()
                };
                let dialect = DumpDialect::from_capabilities(id, &caps);
                for value in golden_values() {
                    assert_eq!(
                        dialect.escape_value(value.clone()),
                        legacy::escape_sql_value(id, value.clone()),
                        "{id} {sql_dialect:?} {value}"
                    );
                    assert_eq!(
                        dialect.escape_json_value(value.clone()),
                        legacy::escape_json_column_value(id, value.clone()),
                        "{id} {sql_dialect:?} {value}"
                    );
                }
            }
        }
    }
}

#[test]
fn dialectless_plugin_with_default_quoting_matches_the_legacy_table_refs() {
    // Without `schemas` and with the default `"` quote, statements are the
    // same as before. Only a plugin that declares another quote or schemas
    // differs, which is the intended fix (see the plugin tests below).
    for id in DIALECTLESS_PLUGIN_IDS {
        for quote in ["", "\""] {
            let caps = DriverCapabilities {
                identifier_quote: quote.into(),
                ..Default::default()
            };
            let dialect = DumpDialect::from_capabilities(id, &caps);
            for requested in REQUESTED_SCHEMAS {
                let legacy_schema = requested.unwrap_or("public");
                let scoped = dialect
                    .scoped_schema(dialect.resolve_schema(*requested).as_deref())
                    .map(str::to_string);
                for table in TABLES {
                    assert_eq!(
                        dumped_table_ref(&dialect, *requested, table),
                        legacy::format_table_ref(id, legacy_schema, table),
                        "{id} {requested:?} {table}"
                    );
                    assert_eq!(
                        dialect.drop_table_if_exists(scoped.as_deref(), table),
                        legacy::drop_table_if_exists(id, legacy_schema, table),
                    );
                    assert_eq!(
                        dialect.insert_into_statement(scoped.as_deref(), table, "(1)"),
                        legacy::insert_into_statement(id, legacy_schema, table, "(1)"),
                    );
                }
            }
        }
    }
}

#[test]
fn postgresql_plugin_without_dialect_or_schemas_matches_the_legacy_output() {
    // An older postgresql manifest with neither `sql_dialect` nor `schemas`
    // is still recognised by id: qualified with "public", TRUE/FALSE.
    let dialect = DumpDialect::from_capabilities("postgresql", &DriverCapabilities::default());
    for requested in REQUESTED_SCHEMAS {
        for table in TABLES {
            assert_eq!(
                dumped_table_ref(&dialect, *requested, table),
                legacy::format_table_ref("postgresql", requested.unwrap_or("public"), table)
            );
        }
    }
    for value in golden_values() {
        assert_eq!(
            dialect.escape_value(value.clone()),
            legacy::escape_sql_value("postgresql", value)
        );
    }
}

// ---------------------------------------------------------------------------
// Builtin output, spelled out
// ---------------------------------------------------------------------------

#[test]
fn builtin_statements() {
    let mysql = dialect_for("mysql");
    let postgres = dialect_for("postgres");
    let sqlite = dialect_for("sqlite");
    assert_eq!(
        mysql.drop_table_if_exists(None, "users"),
        "DROP TABLE IF EXISTS `users`;"
    );
    assert_eq!(
        postgres.drop_table_if_exists(Some("public"), "users"),
        r#"DROP TABLE IF EXISTS "public"."users";"#
    );
    assert_eq!(
        sqlite.insert_into_statement(None, "users", "(1, 'Alice')"),
        r#"INSERT INTO "users" VALUES (1, 'Alice');"#
    );
    assert_eq!(
        postgres.insert_into_statement(Some("app"), "orders", "(1, 100), (2, 200)"),
        r#"INSERT INTO "app"."orders" VALUES (1, 100), (2, 200);"#
    );
}

#[test]
fn flat_drivers_ignore_a_schema_and_postgres_defaults_to_public() {
    let mysql = dialect_for("mysql");
    assert_eq!(mysql.resolve_schema(None), None);
    assert_eq!(mysql.scoped_schema(Some("mydb")), None);
    assert_eq!(mysql.table_ref(Some("mydb"), "users"), "`users`");

    let postgres = dialect_for("postgres");
    assert_eq!(postgres.resolve_schema(None).as_deref(), Some("public"));
    assert_eq!(postgres.resolve_schema(Some("")).as_deref(), Some("public"));
    assert_eq!(postgres.resolve_schema(Some("app")).as_deref(), Some("app"));
}

#[test]
fn embedded_quote_characters_are_doubled() {
    assert_eq!(dialect_for("mysql").table_ref(None, "we`ird"), "`we``ird`");
    assert_eq!(
        dialect_for("postgres").table_ref(Some("s\"x"), "t"),
        r#""s""x"."t""#
    );
}

// ---------------------------------------------------------------------------
// Plugin drivers
// ---------------------------------------------------------------------------

#[test]
fn backtick_plugin_with_schemas_is_quoted_and_qualified() {
    let dialect = DumpDialect::from_capabilities("bigquery", &backtick_schema_plugin());
    assert_eq!(
        dumped_table_ref(&dialect, Some("analytics"), "events"),
        "`analytics`.`events`"
    );
    assert_eq!(
        dialect.drop_table_if_exists(Some("analytics"), "events"),
        "DROP TABLE IF EXISTS `analytics`.`events`;"
    );
    assert_eq!(
        dialect.insert_into_statement(Some("analytics"), "events", "(1)"),
        "INSERT INTO `analytics`.`events` VALUES (1);"
    );
    // No schema requested and no postgres default: the plugin's own default
    // dataset is used, so the reference stays unqualified and no "public"
    // is sent to the plugin.
    assert_eq!(dialect.resolve_schema(None), None);
    assert_eq!(dumped_table_ref(&dialect, None, "events"), "`events`");
    assert_eq!(dialect.scoped_schema(Some("analytics")), Some("analytics"));
}

#[test]
fn plugin_without_schemas_never_receives_a_schema() {
    let caps = DriverCapabilities {
        schemas: false,
        identifier_quote: "`".into(),
        sql_dialect: Some(SqlDialect::Mysql),
        ..Default::default()
    };
    let dialect = DumpDialect::from_capabilities("mariadb", &caps);
    assert_eq!(dialect.scoped_schema(Some("shop")), None);
    assert_eq!(
        dumped_table_ref(&dialect, Some("shop"), "orders"),
        "`orders`"
    );
    // MySQL dialect: backslashes are escape characters, booleans are 1/0.
    assert_eq!(dialect.escape_value(json!("a\\b")), "'a\\\\b'");
    assert_eq!(dialect.escape_value(json!(true)), "1");
}

#[test]
fn empty_identifier_quote_falls_back_to_double_quotes() {
    let caps = DriverCapabilities {
        schemas: true,
        ..Default::default()
    };
    let dialect = DumpDialect::from_capabilities("custom", &caps);
    assert_eq!(dialect.table_ref(Some("s"), "t"), r#""s"."t""#);
}

#[test]
fn boolean_literals_follow_the_dialect() {
    let with = |dialect: Option<SqlDialect>| {
        let caps = DriverCapabilities {
            sql_dialect: dialect,
            ..Default::default()
        };
        DumpDialect::from_capabilities("plugin", &caps).escape_value(json!(true))
    };
    assert_eq!(with(Some(SqlDialect::Postgres)), "TRUE");
    // No or a generic dialect keeps the integers the dump always wrote.
    assert_eq!(with(Some(SqlDialect::Generic)), "1");
    assert_eq!(with(None), "1");
    assert_eq!(with(Some(SqlDialect::Mysql)), "1");
    assert_eq!(with(Some(SqlDialect::Sqlite)), "1");
    assert_eq!(with(Some(SqlDialect::Mssql)), "1");
    assert_eq!(with(Some(SqlDialect::Oracle)), "1");
}

#[test]
fn declared_boolean_literals_override_the_dialect() {
    let declared = |driver_id: &str, dialect: Option<SqlDialect>, style: &str| {
        let mut caps = serde_json::to_value(DriverCapabilities {
            sql_dialect: dialect,
            ..Default::default()
        })
        .unwrap();
        caps["sql_syntax"] = json!({ "boolean_literals": style });
        let caps: DriverCapabilities = serde_json::from_value(caps).unwrap();
        let dump = DumpDialect::from_capabilities(driver_id, &caps);
        (
            dump.escape_value(json!(true)),
            dump.escape_value(json!(false)),
        )
    };
    let keywords = ("TRUE".to_string(), "FALSE".to_string());
    let numeric = ("1".to_string(), "0".to_string());
    assert_eq!(
        declared("plugin", Some(SqlDialect::Mysql), "keywords"),
        keywords
    );
    assert_eq!(
        declared("plugin", Some(SqlDialect::Generic), "keywords"),
        keywords
    );
    assert_eq!(declared("plugin", None, "keywords"), keywords);
    assert_eq!(
        declared("plugin", Some(SqlDialect::Postgres), "numeric"),
        numeric
    );
    assert_eq!(declared("postgresql", None, "numeric"), numeric);
    // An invalid value is ignored: the dialect's default applies.
    assert_eq!(declared("plugin", Some(SqlDialect::Mysql), "yes"), numeric);
    assert_eq!(
        declared("plugin", Some(SqlDialect::Postgres), "yes"),
        keywords
    );
}

#[test]
fn googlesql_dump_writes_boolean_keywords() {
    // GoogleSQL has no implicit INT64 -> BOOL coercion: 1/0 into a BOOL
    // column fails, so the fixture declares keywords on top of `mysql`.
    let caps = crate::drivers::sql_syntax_tests::googlesql_capabilities();
    let dialect = DumpDialect::from_capabilities("bigquery", &caps);
    assert_eq!(
        dialect.insert_into_statement(
            None,
            "flags",
            &format!(
                "({}, {}, {})",
                dialect.escape_value(json!(true)),
                dialect.escape_value(json!(false)),
                dialect.escape_value(json!("it's"))
            )
        ),
        "INSERT INTO `flags` VALUES (TRUE, FALSE, 'it\\'s');"
    );
    // JSON columns keep JSON scalars.
    assert_eq!(dialect.escape_json_value(json!(true)), "'true'");
}

// ---------------------------------------------------------------------------
// Literal escaping (moved from dump_commands)
// ---------------------------------------------------------------------------

#[test]
fn escape_value_common_cases() {
    for id in ["mysql", "postgres", "sqlite"] {
        let d = dialect_for(id);
        assert_eq!(d.escape_value(json!(null)), "NULL");
        assert_eq!(d.escape_value(json!(123)), "123");
        assert_eq!(d.escape_value(json!(12.34)), "12.34");
        assert_eq!(d.escape_value(json!("hello")), "'hello'");
        assert_eq!(d.escape_value(json!("O'Reilly")), "'O''Reilly'");
        assert_eq!(d.escape_value(json!("Multi\nLine")), "'Multi\nLine'");
    }
    // Postgres boolean columns reject integer literals (SQLSTATE 42804).
    assert_eq!(dialect_for("postgres").escape_value(json!(true)), "TRUE");
    assert_eq!(dialect_for("postgres").escape_value(json!(false)), "FALSE");
    for id in ["mysql", "sqlite"] {
        assert_eq!(dialect_for(id).escape_value(json!(true)), "1");
        assert_eq!(dialect_for(id).escape_value(json!(false)), "0");
    }
}

#[test]
fn mysql_doubles_backslashes_and_escapes_nul() {
    let d = dialect_for("mysql");
    assert_eq!(d.escape_value(json!("Back\\slash")), "'Back\\\\slash'");
    assert_eq!(d.escape_value(json!("a\u{0}b")), "'a\\0b'");
    // A backslash followed by a quote must not collapse into `\'`.
    assert_eq!(d.escape_value(json!("\\'")), "'\\\\'''");
}

#[test]
fn postgres_and_sqlite_keep_backslashes_literal() {
    for id in ["postgres", "sqlite"] {
        assert_eq!(
            dialect_for(id).escape_value(json!("Back\\slash")),
            "'Back\\slash'"
        );
    }
}

#[test]
fn nested_values_are_escaped_like_text() {
    assert_eq!(
        dialect_for("mysql").escape_value(json!({"path": "a\\b"})),
        r#"'{"path":"a\\\\b"}'"#
    );
    assert_eq!(
        dialect_for("postgres").escape_value(json!({"path": "a\\b"})),
        r#"'{"path":"a\\b"}'"#
    );
}

#[test]
fn json_column_values_mysql() {
    let d = dialect_for("mysql");
    assert_eq!(
        d.escape_json_value(json!({"html": "<a target=\"_blank\">"})),
        r#"'{"html":"<a target=\\"_blank\\">"}'"#
    );
    assert_eq!(
        d.escape_json_value(json!({"class": "App\\Jobs\\Foo"})),
        r#"'{"class":"App\\\\Jobs\\\\Foo"}'"#
    );
    // A JSON string value keeps its quotes instead of degrading to its content.
    assert_eq!(
        d.escape_json_value(json!("\"[151, 152, 153]\"")),
        r#"'"\\"[151, 152, 153]\\""'"#
    );
    // Scalars stay JSON scalars rather than becoming SQL 1/0.
    assert_eq!(d.escape_json_value(json!(true)), "'true'");
    assert_eq!(d.escape_json_value(json!(42)), "'42'");
    assert_eq!(d.escape_json_value(json!(null)), "NULL");
    assert_eq!(
        d.escape_json_value(json!({"name": "中文"})),
        r#"'{"name":"中文"}'"#
    );
}

#[test]
fn json_column_values_postgres() {
    let d = dialect_for("postgres");
    assert_eq!(
        d.escape_json_value(json!({"html": "<a target=\"_blank\">"})),
        r#"'{"html":"<a target=\"_blank\">"}'"#
    );
    assert_eq!(d.escape_json_value(json!("it's")), r#"'"it''s"'"#);
    assert_eq!(d.escape_json_value(json!(false)), "'false'");
}

#[test]
fn declared_backslash_escape_writes_googlesql_literals() {
    let caps = crate::drivers::sql_syntax_tests::googlesql_capabilities();
    let dialect = DumpDialect::from_capabilities("bigquery", &caps);
    assert_eq!(dialect.string_escape, LiteralStyle::Backslash);
    assert_eq!(dialect.escape_value(json!("it's")), "'it\\'s'");
    assert_eq!(dialect.escape_value(json!("a\\b\nc")), "'a\\\\b\\nc'");
    assert_eq!(
        dialect.escape_json_value(json!({ "k": "v'" })),
        "'{\"k\":\"v\\'\"}'"
    );
    assert_eq!(dialect.table_ref(None, "events"), "`events`");
}

#[test]
fn declared_standard_escape_cannot_weaken_the_mysql_preset() {
    // A mysql base (sql_dialect, or extends) keeps doubling backslashes even
    // when the descriptor declares "standard": the engine still reads `\`
    // as an escape character.
    let standard = || {
        Some(crate::drivers::sql_syntax::SqlSyntaxDescriptor {
            string_escape: Some(crate::drivers::sql_syntax::StringEscape::Standard),
            ..Default::default()
        })
    };
    let via_dialect = DriverCapabilities {
        sql_dialect: Some(SqlDialect::Mysql),
        sql_syntax: standard(),
        ..Default::default()
    };
    let via_extends = DriverCapabilities {
        sql_syntax: Some(crate::drivers::sql_syntax::SqlSyntaxDescriptor {
            extends: Some(SqlDialect::Mysql),
            string_escape: Some(crate::drivers::sql_syntax::StringEscape::Standard),
            ..Default::default()
        }),
        ..Default::default()
    };
    for caps in [via_dialect, via_extends] {
        let dialect = DumpDialect::from_capabilities("plugin", &caps);
        assert_eq!(dialect.escape_value(json!("a\\b")), "'a\\\\b'");
        assert_eq!(dialect.escape_value(json!("a\u{0}b")), "'a\\0b'");
    }
    // On a standard base, "standard" is honoured.
    let generic = DriverCapabilities {
        sql_dialect: Some(SqlDialect::Generic),
        sql_syntax: standard(),
        ..Default::default()
    };
    assert_eq!(
        DumpDialect::from_capabilities("plugin", &generic).escape_value(json!("a\\b")),
        "'a\\b'"
    );
}

#[test]
fn declared_backslash_escape_writes_nul_as_an_escape() {
    let caps = crate::drivers::sql_syntax_tests::googlesql_capabilities();
    let dialect = DumpDialect::from_capabilities("bigquery", &caps);
    assert_eq!(dialect.escape_value(json!("a\u{0}b")), "'a\\0b'");
}
