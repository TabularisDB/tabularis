use serde_json::json;

use crate::drivers::driver_trait::{DatabaseDriver, DriverCapabilities, SqlDialect};
use crate::drivers::sql_syntax::{
    quote_string_literal, LiteralStyle, QuoteEscape, QuoteKind, SqlSyntax, SqlSyntaxDescriptor,
    StringEscape, FORMATTER_LANGUAGES, MAX_QUOTES, MAX_STRING_PREFIXES, MAX_WORDS, MAX_WORD_LEN,
};

/// The GoogleSQL descriptor the BigQuery plugin ships, shared with the
/// frontend tests.
pub(crate) const GOOGLESQL_DESCRIPTOR: &str =
    include_str!("../../../tests/fixtures/sql-syntax/googlesql.json");

/// Capabilities of a plugin that declares the GoogleSQL descriptor on top of
/// the `mysql` legacy fallback, as the BigQuery plugin does.
pub(crate) fn googlesql_capabilities() -> DriverCapabilities {
    let descriptor: serde_json::Value = serde_json::from_str(GOOGLESQL_DESCRIPTOR).unwrap();
    capabilities_from(json!({
        "identifier_quote": "`",
        "sql_dialect": "mysql",
        "sql_syntax": descriptor,
    }))
}

fn capabilities_from(overrides: serde_json::Value) -> DriverCapabilities {
    let mut caps = serde_json::to_value(DriverCapabilities::default()).unwrap();
    for (key, value) in overrides.as_object().unwrap() {
        caps[key] = value.clone();
    }
    serde_json::from_value(caps).unwrap()
}

fn descriptor(value: serde_json::Value) -> SqlSyntaxDescriptor {
    capabilities_from(json!({ "sql_syntax": value }))
        .sql_syntax
        .expect("descriptor parsed")
}

#[test]
fn googlesql_descriptor_parses_every_field() {
    let caps = googlesql_capabilities();
    let desc = caps.sql_syntax.as_ref().unwrap();
    assert_eq!(desc.extends, Some(SqlDialect::Generic));
    assert_eq!(desc.quotes.as_ref().unwrap().len(), 3);
    assert_eq!(desc.string_escape, Some(StringEscape::Backslash));
    assert_eq!(desc.formatter.as_deref(), Some("bigquery"));
    assert!(desc
        .keywords
        .as_ref()
        .unwrap()
        .contains(&"QUALIFY".to_string()));
    assert!(desc
        .functions
        .as_ref()
        .unwrap()
        .contains(&"SAFE.".to_string()));

    let syntax = SqlSyntax::resolve(&caps);
    assert!(syntax.declared);
    // `extends` wins over the legacy `sql_dialect` fallback.
    assert_eq!(syntax.dialect, Some(SqlDialect::Generic));
    assert!(syntax.hash_comments);
    assert!(syntax.triple_quoted_strings);
    assert!(syntax.script_blocks);
    assert!(!syntax.like_escape);
    assert!(!syntax.executable_comments);
    assert!(!syntax.line_comment_requires_space);
    assert_eq!(syntax.string_escape, LiteralStyle::Backslash);
    assert_eq!(syntax.string_prefixes, ["r", "b", "rb", "br"]);
    for open in ["'", "\"", "`"] {
        assert!(syntax.backslash_in(open), "{open}");
    }
    assert_eq!(syntax.quote("`").unwrap().kind, QuoteKind::Identifier);
}

#[test]
fn descriptor_round_trips_to_the_frontend_sanitized() {
    let caps = capabilities_from(json!({
        "sql_syntax": {
            "extends": "postgres",
            "hash_comments": true,
            "quotes": [{ "open": "[", "kind": "identifier" }],
            "keywords": ["QUALIFY"],
            "formatter": "not-a-formatter",
            "future_field": 1
        }
    }));
    let serialized = serde_json::to_value(&caps).unwrap();
    assert_eq!(
        serialized["sql_syntax"],
        json!({
            "extends": "postgres",
            "hash_comments": true,
            "quotes": [{ "open": "[", "close": "]", "kind": "identifier", "escape": "double" }],
            "keywords": ["QUALIFY"]
        })
    );
}

#[test]
fn without_sql_syntax_every_preset_resolves_unchanged() {
    for dialect in [
        None,
        Some(SqlDialect::Postgres),
        Some(SqlDialect::Mysql),
        Some(SqlDialect::Mssql),
        Some(SqlDialect::Sqlite),
        Some(SqlDialect::Oracle),
        Some(SqlDialect::Generic),
    ] {
        let caps = DriverCapabilities {
            sql_dialect: dialect,
            ..Default::default()
        };
        let syntax = SqlSyntax::resolve(&caps);
        assert_eq!(syntax, SqlSyntax::preset(dialect));
        assert!(!syntax.declared);
        assert!(syntax.like_escape);
        assert_eq!(syntax.hash_comments, dialect == Some(SqlDialect::Mysql));
        let expected_style = if dialect == Some(SqlDialect::Mysql) {
            LiteralStyle::Mysql
        } else {
            LiteralStyle::Standard
        };
        assert_eq!(syntax.string_escape, expected_style);
    }
}

#[test]
fn builtin_drivers_declare_no_sql_syntax() {
    for driver in [
        Box::new(crate::drivers::postgres::PostgresDriver::new()) as Box<dyn DatabaseDriver>,
        Box::new(crate::drivers::mysql::MysqlDriver::new()),
        Box::new(crate::drivers::sqlite::SqliteDriver::new()),
    ] {
        let caps = &driver.manifest().capabilities;
        assert!(caps.sql_syntax.is_none());
        assert!(serde_json::to_value(caps)
            .unwrap()
            .get("sql_syntax")
            .is_none());
    }
}

#[test]
fn extends_defaults_to_sql_dialect() {
    let caps = capabilities_from(json!({
        "sql_dialect": "mysql",
        "sql_syntax": { "string_escape": "standard" }
    }));
    let syntax = SqlSyntax::resolve(&caps);
    assert_eq!(syntax.dialect, Some(SqlDialect::Mysql));
    assert!(syntax.hash_comments);
    assert!(syntax.executable_comments);
    assert_eq!(syntax.string_escape, LiteralStyle::Standard);
}

#[test]
fn unknown_extends_falls_back_to_sql_dialect() {
    let caps = capabilities_from(json!({
        "sql_dialect": "postgres",
        "sql_syntax": { "extends": "bigquery", "hash_comments": true }
    }));
    assert_eq!(caps.sql_syntax.as_ref().unwrap().extends, None);
    let syntax = SqlSyntax::resolve(&caps);
    assert_eq!(syntax.dialect, Some(SqlDialect::Postgres));
    assert!(syntax.dollar_quoting);
    assert!(syntax.hash_comments);
}

#[test]
fn non_object_sql_syntax_is_ignored_without_failing_the_manifest() {
    for value in [json!("googlesql"), json!(42), json!([1]), json!(true)] {
        let caps = capabilities_from(json!({ "sql_dialect": "mysql", "sql_syntax": value }));
        assert!(caps.sql_syntax.is_none());
        assert_eq!(caps.sql_dialect, Some(SqlDialect::Mysql));
    }
    let caps = capabilities_from(json!({ "sql_syntax": null }));
    assert!(caps.sql_syntax.is_none());
}

#[test]
fn invalid_fields_are_dropped_one_by_one() {
    let desc = descriptor(json!({
        "hash_comments": "yes",
        "triple_quoted_strings": true,
        "string_escape": "mysql",
        "like_escape": false,
        "formatter": "<script>",
        "string_prefixes": ["r", "raw"],
        "keywords": ["OK", "DROP TABLE x;"],
        "functions": ["FN"],
    }));
    assert_eq!(desc.hash_comments, None);
    assert_eq!(desc.triple_quoted_strings, Some(true));
    assert_eq!(desc.string_escape, None);
    assert_eq!(desc.like_escape, Some(false));
    assert_eq!(desc.formatter, None);
    assert_eq!(desc.string_prefixes, None);
    assert_eq!(desc.keywords, None);
    assert_eq!(desc.functions, Some(vec!["FN".to_string()]));
}

#[test]
fn quote_rules_are_validated() {
    let quotes = |value: serde_json::Value| descriptor(json!({ "quotes": value })).quotes;
    // Close is derived from open; escape defaults to doubling.
    let parsed = quotes(json!([
        { "open": "'", "kind": "string" },
        { "open": "[", "close": "]", "kind": "identifier", "escape": "none" }
    ]))
    .unwrap();
    assert_eq!(parsed[0].close, "'");
    assert_eq!(parsed[0].escape, QuoteEscape::Double);
    assert_eq!(parsed[1].close, "]");
    assert_eq!(parsed[1].escape, QuoteEscape::None);

    for invalid in [
        json!([]),
        json!("'"),
        json!([{ "open": "{", "kind": "string" }]),
        json!([{ "open": "'", "kind": "string", "close": "\"" }]),
        json!([{ "open": "'" }]),
        json!([{ "open": "'", "kind": "comment" }]),
        json!([{ "open": "'", "kind": "string", "escape": "quote" }]),
        json!([{ "open": "'", "kind": "string" }, { "open": "'", "kind": "string" }]),
        serde_json::Value::Array(vec![
            json!({ "open": "'", "kind": "string" });
            MAX_QUOTES + 1
        ]),
    ] {
        assert_eq!(quotes(invalid.clone()), None, "{invalid}");
    }
}

#[test]
fn word_lists_are_bounded() {
    let keywords = |value: serde_json::Value| descriptor(json!({ "keywords": value })).keywords;
    assert_eq!(
        keywords(json!([
            "QUALIFY",
            "QUALIFY",
            "FOR SYSTEM_TIME AS OF",
            "SAFE.",
            "_x$1"
        ])),
        Some(vec![
            "QUALIFY".to_string(),
            "FOR SYSTEM_TIME AS OF".to_string(),
            "SAFE.".to_string(),
            "_x$1".to_string(),
        ])
    );
    let too_long = "A".repeat(MAX_WORD_LEN + 1);
    for invalid in [
        json!([""]),
        json!(["1ST"]),
        json!(["TRAILING "]),
        json!(["TWO  SPACES"]),
        json!(["QUOTE'"]),
        json!([too_long]),
        json!([1]),
        serde_json::Value::Array(vec![json!("K"); MAX_WORDS + 1]),
    ] {
        assert_eq!(keywords(invalid.clone()), None, "{invalid}");
    }
}

#[test]
fn string_prefixes_are_lowercased_and_deduplicated() {
    let desc = descriptor(json!({ "string_prefixes": ["R", "r", "Rb"] }));
    assert_eq!(
        desc.string_prefixes,
        Some(vec!["r".to_string(), "rb".to_string()])
    );
}

#[test]
fn quote_string_literal_follows_the_style() {
    let value = "O'Brien \\ a\r\nb\0";
    assert_eq!(
        quote_string_literal(value, LiteralStyle::Standard),
        "'O''Brien \\ a\r\nb\0'"
    );
    assert_eq!(
        quote_string_literal(value, LiteralStyle::Mysql),
        "'O''Brien \\\\ a\r\nb\\0'"
    );
    assert_eq!(
        quote_string_literal(value, LiteralStyle::Backslash),
        "'O\\'Brien \\\\ a\\r\\nb\0'"
    );
}

#[test]
fn limits_match_the_manifest_schema() {
    // The frontend (`src/utils/sqlSyntax.ts`) is checked against the same
    // schema, so the two sides cannot drift apart.
    let schema: serde_json::Value =
        serde_json::from_str(include_str!("../../../plugins/manifest.schema.json")).unwrap();
    let props = &schema["properties"]["capabilities"]["properties"]["sql_syntax"]["properties"];
    assert_eq!(props["quotes"]["maxItems"], json!(MAX_QUOTES));
    assert_eq!(
        props["string_prefixes"]["maxItems"],
        json!(MAX_STRING_PREFIXES)
    );
    assert_eq!(props["keywords"]["maxItems"], json!(MAX_WORDS));
    assert_eq!(
        props["functions"]["items"]["maxLength"],
        json!(MAX_WORD_LEN)
    );
    assert_eq!(props["formatter"]["enum"], json!(FORMATTER_LANGUAGES));
}
