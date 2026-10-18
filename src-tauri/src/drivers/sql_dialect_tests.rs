use crate::drivers::driver_trait::{DriverCapabilities, SqlDialect};
use crate::drivers::sql_dialect::parse_or_generic;

fn capabilities_with(dialect: serde_json::Value) -> serde_json::Value {
    let mut capabilities = serde_json::to_value(DriverCapabilities::default()).unwrap();
    capabilities["sql_dialect"] = dialect;
    capabilities
}

#[test]
fn bigquery_is_not_a_host_dialect() {
    // GoogleSQL is declared through `sql_syntax`; a manifest that names it as
    // a dialect still loads, as generic.
    let caps: DriverCapabilities =
        serde_json::from_value(capabilities_with(serde_json::json!("bigquery"))).unwrap();
    assert_eq!(caps.sql_dialect, Some(SqlDialect::Generic));
}

#[test]
fn known_dialects_parse_unchanged() {
    for (name, dialect) in [
        ("postgres", SqlDialect::Postgres),
        ("mysql", SqlDialect::Mysql),
        ("mssql", SqlDialect::Mssql),
        ("sqlite", SqlDialect::Sqlite),
        ("oracle", SqlDialect::Oracle),
        ("generic", SqlDialect::Generic),
    ] {
        assert_eq!(parse_or_generic(name), dialect);
    }
}

#[test]
fn unknown_dialect_falls_back_to_generic() {
    assert_eq!(parse_or_generic("snowflake"), SqlDialect::Generic);
    assert_eq!(parse_or_generic("BigQuery"), SqlDialect::Generic);
    let caps: DriverCapabilities =
        serde_json::from_value(capabilities_with(serde_json::json!("future-dialect"))).unwrap();
    assert_eq!(caps.sql_dialect, Some(SqlDialect::Generic));
}

#[test]
fn missing_or_null_dialect_stays_none() {
    let caps: DriverCapabilities =
        serde_json::from_value(capabilities_with(serde_json::Value::Null)).unwrap();
    assert_eq!(caps.sql_dialect, None);

    let mut without = serde_json::to_value(DriverCapabilities::default()).unwrap();
    without.as_object_mut().unwrap().remove("sql_dialect");
    let caps: DriverCapabilities = serde_json::from_value(without).unwrap();
    assert_eq!(caps.sql_dialect, None);
}

#[test]
fn non_string_dialect_is_rejected() {
    let result =
        serde_json::from_value::<DriverCapabilities>(capabilities_with(serde_json::json!(42)));
    assert!(result.is_err());
}
