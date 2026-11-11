//! Foreign key introspection tests.

use crate::helpers::pg_params;
use tabularis_lib::drivers::postgres;

#[tokio::test]
#[ignore]
async fn test_get_foreign_keys_basic() {
    require_pg!();
    let params = pg_params();

    let fks = postgres::get_foreign_keys(&params, "orders", "test_schema")
        .await
        .expect("get_foreign_keys should succeed");

    assert!(!fks.is_empty(), "orders table should have foreign keys");

    let user_fk = fks.iter().find(|f| f.column_name == "user_id");
    assert!(user_fk.is_some(), "Expected FK on user_id column");
    let user_fk = user_fk.unwrap();
    assert_eq!(user_fk.ref_table, "all_types");
    assert_eq!(user_fk.ref_column, "id");
    assert_eq!(
        user_fk.on_delete.as_deref(),
        Some("CASCADE"),
        "Expected ON DELETE CASCADE"
    );
}

#[tokio::test]
#[ignore]
async fn test_get_foreign_keys_composite_table() {
    require_pg!();
    let params = pg_params();

    let fks = postgres::get_foreign_keys(&params, "order_items", "test_schema")
        .await
        .expect("get_foreign_keys should succeed");

    let order_fk = fks.iter().find(|f| f.column_name == "order_id");
    assert!(order_fk.is_some(), "Expected FK on order_id");
    let order_fk = order_fk.unwrap();
    assert_eq!(order_fk.ref_table, "orders");
    assert_eq!(order_fk.ref_column, "id");
    assert_eq!(order_fk.on_delete.as_deref(), Some("CASCADE"));
}

#[tokio::test]
#[ignore]
async fn test_get_foreign_keys_cross_schema() {
    require_pg!();
    let params = pg_params();

    let fks = postgres::get_foreign_keys(&params, "with_cross_schema_fk", "test_schema")
        .await
        .expect("get_foreign_keys should succeed");

    let lookup_fk = fks.iter().find(|f| f.column_name == "lookup_code");
    assert!(lookup_fk.is_some(), "Expected FK on lookup_code");
    let lookup_fk = lookup_fk.unwrap();
    assert_eq!(lookup_fk.ref_table, "lookup");
    assert_eq!(lookup_fk.ref_column, "code");
    assert_eq!(lookup_fk.ref_schema.as_deref(), Some("other_schema"));
}

#[tokio::test]
#[ignore]
async fn test_get_foreign_keys_table_without_fks() {
    require_pg!();
    let params = pg_params();

    let fks = postgres::get_foreign_keys(&params, "crud_scratch", "test_schema")
        .await
        .expect("get_foreign_keys should succeed");

    assert!(fks.is_empty(), "crud_scratch has no foreign keys");
}
