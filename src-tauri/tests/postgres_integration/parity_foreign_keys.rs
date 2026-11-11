//! Parity tests for foreign key introspection — covers baseline tests from
//! `foreign_keys.rs` that are NOT already covered in `parity_tests.rs`.
//!
//! Already covered by `parity_tests.rs`:
//!   - parity_get_foreign_keys (basic: orders table, checks user_id FK)
//!
//! New in this file — each test calls `get_foreign_keys` through the trait via
//! the harness and uses `assert_parity()` for byte-perfect JSON comparison.

use crate::parity::ParityHarness;

/// Parity equivalent of `test_get_foreign_keys_composite_table`.
/// Verifies FK introspection on order_items (FK to orders).
#[tokio::test]
#[ignore]
async fn parity_get_foreign_keys_composite_table() {
    require_pg!();
    let harness = ParityHarness::new().await;

    let result = harness
        .assert_parity(
            "get_foreign_keys:order_items",
            |driver, params| async move {
                driver
                    .get_foreign_keys(&params, "order_items", Some("test_schema"))
                    .await
            },
        )
        .await;

    let arr = result.as_array().expect("foreign keys should be an array");
    let order_fk = arr
        .iter()
        .find(|f| f.get("column_name").and_then(|v| v.as_str()) == Some("order_id"))
        .expect("Expected FK on order_id");

    assert_eq!(
        order_fk.get("ref_table").and_then(|v| v.as_str()),
        Some("orders"),
        "order_id FK should reference orders"
    );
    assert_eq!(
        order_fk.get("ref_column").and_then(|v| v.as_str()),
        Some("id"),
        "order_id FK should reference id column"
    );
    assert_eq!(
        order_fk.get("on_delete").and_then(|v| v.as_str()),
        Some("CASCADE"),
        "Expected ON DELETE CASCADE"
    );
}

/// Parity equivalent of `test_get_foreign_keys_cross_schema`.
/// Verifies FK introspection on a table referencing another schema.
#[tokio::test]
#[ignore]
async fn parity_get_foreign_keys_cross_schema() {
    require_pg!();
    let harness = ParityHarness::new().await;

    let result = harness
        .assert_parity(
            "get_foreign_keys:with_cross_schema_fk",
            |driver, params| async move {
                driver
                    .get_foreign_keys(&params, "with_cross_schema_fk", Some("test_schema"))
                    .await
            },
        )
        .await;

    let arr = result.as_array().expect("foreign keys should be an array");
    let lookup_fk = arr
        .iter()
        .find(|f| f.get("column_name").and_then(|v| v.as_str()) == Some("lookup_code"))
        .expect("Expected FK on lookup_code");

    assert_eq!(
        lookup_fk.get("ref_table").and_then(|v| v.as_str()),
        Some("lookup"),
        "lookup_code FK should reference lookup table"
    );
    assert_eq!(
        lookup_fk.get("ref_column").and_then(|v| v.as_str()),
        Some("code"),
        "lookup_code FK should reference code column"
    );
    assert_eq!(
        lookup_fk.get("ref_schema").and_then(|v| v.as_str()),
        Some("other_schema"),
        "lookup_code FK should reference other_schema"
    );
}

/// Parity equivalent of `test_get_foreign_keys_table_without_fks`.
/// Verifies a table with no foreign keys returns an empty array from both drivers.
#[tokio::test]
#[ignore]
async fn parity_get_foreign_keys_table_without_fks() {
    require_pg!();
    let harness = ParityHarness::new().await;

    let result = harness
        .assert_parity(
            "get_foreign_keys:crud_scratch:empty",
            |driver, params| async move {
                driver
                    .get_foreign_keys(&params, "crud_scratch", Some("test_schema"))
                    .await
            },
        )
        .await;

    let arr = result.as_array().expect("foreign keys should be an array");
    assert!(arr.is_empty(), "crud_scratch has no foreign keys");
}
