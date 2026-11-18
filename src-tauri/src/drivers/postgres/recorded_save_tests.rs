use super::recorded_save::{
    image_select_sql, restore_update_sql, unsupported_reason, ColumnMeta, TableMeta,
    UNSUPPORTED_KEY_MISMATCH, UNSUPPORTED_NOT_A_BASE_TABLE, UNSUPPORTED_NO_PRIMARY_KEY,
    UNSUPPORTED_UNKNOWN_COLUMN,
};
use serde_json::json;
use std::collections::HashMap;

fn meta(relkind: &str, pk: &[&str], columns: &[&str]) -> TableMeta {
    TableMeta {
        relkind: relkind.to_string(),
        has_triggers: false,
        pk_columns: pk.iter().map(|c| c.to_string()).collect(),
        columns: columns
            .iter()
            .map(|c| {
                (
                    c.to_string(),
                    ColumnMeta {
                        data_type: "text".to_string(),
                        generated: false,
                    },
                )
            })
            .collect(),
    }
}

fn key(columns: &[&str]) -> HashMap<String, serde_json::Value> {
    columns.iter().map(|c| (c.to_string(), json!(1))).collect()
}

#[test]
fn accepts_an_ordinary_table_addressed_by_its_full_key() {
    let meta = meta("r", &["id"], &["id", "status"]);
    assert_eq!(
        unsupported_reason(Some(&meta), &key(&["id"]), &["status".to_string()]),
        None
    );
}

#[test]
fn accepts_a_composite_key_in_any_order() {
    let meta = meta("r", &["a", "b"], &["a", "b", "v"]);
    assert_eq!(
        unsupported_reason(Some(&meta), &key(&["b", "a"]), &["v".to_string()]),
        None
    );
}

#[test]
fn rejects_missing_views_and_partitioned_tables() {
    assert_eq!(
        unsupported_reason(None, &key(&["id"]), &[]),
        Some(UNSUPPORTED_NOT_A_BASE_TABLE)
    );
    for kind in ["v", "m", "p", "f"] {
        let meta = meta(kind, &["id"], &["id", "v"]);
        assert_eq!(
            unsupported_reason(Some(&meta), &key(&["id"]), &["v".to_string()]),
            Some(UNSUPPORTED_NOT_A_BASE_TABLE),
            "relkind {kind}"
        );
    }
}

#[test]
fn rejects_a_table_without_a_primary_key() {
    let meta = meta("r", &[], &["v"]);
    assert_eq!(
        unsupported_reason(Some(&meta), &key(&["v"]), &["v".to_string()]),
        Some(UNSUPPORTED_NO_PRIMARY_KEY)
    );
}

#[test]
fn rejects_a_key_that_is_not_exactly_the_primary_key() {
    let meta = meta("r", &["a", "b"], &["a", "b", "v"]);
    for map in [key(&["a"]), key(&["a", "b", "v"]), key(&["a", "v"])] {
        assert_eq!(
            unsupported_reason(Some(&meta), &map, &["v".to_string()]),
            Some(UNSUPPORTED_KEY_MISMATCH)
        );
    }
}

#[test]
fn rejects_unknown_columns() {
    let meta = meta("r", &["id"], &["id"]);
    assert_eq!(
        unsupported_reason(Some(&meta), &key(&["id"]), &["ghost".to_string()]),
        Some(UNSUPPORTED_UNKNOWN_COLUMN)
    );
}

#[test]
fn image_select_reads_text_with_a_size_guard_and_optional_lock() {
    let columns = vec!["we\"ird".to_string(), "b".to_string()];
    let sql = image_select_sql("s", "t", &columns, "\"id\" = $1", true);
    assert!(sql.starts_with("SELECT (\"we\"\"ird\" IS NULL), CASE WHEN octet_length(\"we\"\"ird\"::text) > 65536 THEN NULL ELSE \"we\"\"ird\"::text END, (\"b\" IS NULL)"));
    assert!(sql.ends_with("FROM \"s\".\"t\" WHERE \"id\" = $1 FOR UPDATE"));
    assert!(!image_select_sql("s", "t", &columns, "\"id\" = $1", false).contains("FOR UPDATE"));
}

#[test]
fn restore_update_casts_text_parameters_to_the_column_type() {
    let sql = restore_update_sql(
        "s",
        "t",
        &[("price", "numeric(10,2)"), ("blob", "bytea")],
        "\"id\" = $3",
    );
    assert_eq!(
        sql,
        "UPDATE \"s\".\"t\" SET \"price\" = CAST($1 AS numeric(10,2)), \"blob\" = CAST($2 AS bytea) WHERE \"id\" = $3"
    );
}
