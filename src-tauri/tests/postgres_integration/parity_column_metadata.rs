//! Parity tests for column metadata — covers baseline tests from
//! `column_metadata.rs` that are NOT already covered in `parity_tests.rs`.
//!
//! Already covered by `parity_tests.rs`:
//!   - parity_get_columns (basic: all_types table, checks id is PK)
//!
//! New in this file — each test calls `get_columns` through the trait via the
//! harness and uses `assert_parity()` for byte-perfect JSON comparison, then
//! adds structural assertions on the shared result.

use serde_json::Value;

use crate::parity::ParityHarness;

/// Parity equivalent of `test_get_columns_all_types_count`.
/// Verifies the all_types table returns exactly 27 columns from both drivers.
#[tokio::test]
#[ignore]
async fn parity_get_columns_all_types_count() {
    require_pg!();
    let harness = ParityHarness::new().await;

    let result = harness
        .assert_parity("get_columns:all_types:count", |driver, params| async move {
            driver
                .get_columns(&params, "all_types", Some("test_schema"))
                .await
        })
        .await;

    let arr = result.as_array().expect("columns should be an array");
    assert_eq!(arr.len(), 27, "Expected 27 columns in all_types");
}

/// Parity equivalent of `test_get_columns_pk_detection`.
/// Verifies primary key detection and auto-increment flag match between drivers.
#[tokio::test]
#[ignore]
async fn parity_get_columns_pk_detection() {
    require_pg!();
    let harness = ParityHarness::new().await;

    let result = harness
        .assert_parity(
            "get_columns:all_types:pk_detection",
            |driver, params| async move {
                driver
                    .get_columns(&params, "all_types", Some("test_schema"))
                    .await
            },
        )
        .await;

    let arr = result.as_array().expect("columns should be an array");

    let id_col = arr
        .iter()
        .find(|c| c.get("name").and_then(|n| n.as_str()) == Some("id"))
        .expect("id column should exist");
    assert_eq!(
        id_col.get("is_pk").and_then(|v| v.as_bool()),
        Some(true),
        "id should be primary key"
    );
    assert_eq!(
        id_col.get("is_auto_increment").and_then(|v| v.as_bool()),
        Some(true),
        "SERIAL id should be auto_increment"
    );
    assert_eq!(
        id_col.get("data_type").and_then(|v| v.as_str()),
        Some("integer"),
        "SERIAL resolves to integer"
    );

    // Non-PK columns should not be marked as PK
    let text_col = arr
        .iter()
        .find(|c| c.get("name").and_then(|n| n.as_str()) == Some("col_text"))
        .expect("col_text should exist");
    assert_eq!(
        text_col.get("is_pk").and_then(|v| v.as_bool()),
        Some(false),
        "col_text should not be PK"
    );
    assert_eq!(
        text_col.get("is_auto_increment").and_then(|v| v.as_bool()),
        Some(false),
        "col_text should not be auto_increment"
    );
}

/// Parity equivalent of `test_get_columns_nullable_detection`.
/// Verifies nullable flag matches between drivers.
#[tokio::test]
#[ignore]
async fn parity_get_columns_nullable_detection() {
    require_pg!();
    let harness = ParityHarness::new().await;

    let result = harness
        .assert_parity(
            "get_columns:all_types:nullable",
            |driver, params| async move {
                driver
                    .get_columns(&params, "all_types", Some("test_schema"))
                    .await
            },
        )
        .await;

    let arr = result.as_array().expect("columns should be an array");

    // id (SERIAL PRIMARY KEY) is NOT NULL
    let id_col = arr
        .iter()
        .find(|c| c.get("name").and_then(|n| n.as_str()) == Some("id"))
        .unwrap();
    assert_eq!(
        id_col.get("is_nullable").and_then(|v| v.as_bool()),
        Some(false),
        "PK should not be nullable"
    );

    // col_text has no NOT NULL constraint
    let text_col = arr
        .iter()
        .find(|c| c.get("name").and_then(|n| n.as_str()) == Some("col_text"))
        .unwrap();
    assert_eq!(
        text_col.get("is_nullable").and_then(|v| v.as_bool()),
        Some(true),
        "col_text should be nullable"
    );
}

/// Parity equivalent of `test_get_columns_type_detection`.
/// Verifies data type strings match between drivers for multiple column types.
#[tokio::test]
#[ignore]
async fn parity_get_columns_type_detection() {
    require_pg!();
    let harness = ParityHarness::new().await;

    let result = harness
        .assert_parity(
            "get_columns:all_types:type_detection",
            |driver, params| async move {
                driver
                    .get_columns(&params, "all_types", Some("test_schema"))
                    .await
            },
        )
        .await;

    let arr = result.as_array().expect("columns should be an array");
    let find = |name: &str| -> &Value {
        arr.iter()
            .find(|c| c.get("name").and_then(|n| n.as_str()) == Some(name))
            .unwrap_or_else(|| panic!("column '{}' should exist", name))
    };

    assert_eq!(
        find("col_text").get("data_type").and_then(|v| v.as_str()),
        Some("text")
    );
    assert_eq!(
        find("col_int").get("data_type").and_then(|v| v.as_str()),
        Some("integer")
    );
    assert_eq!(
        find("col_bigint").get("data_type").and_then(|v| v.as_str()),
        Some("bigint")
    );
    assert_eq!(
        find("col_bool").get("data_type").and_then(|v| v.as_str()),
        Some("boolean")
    );
    assert_eq!(
        find("col_uuid").get("data_type").and_then(|v| v.as_str()),
        Some("uuid")
    );
    assert_eq!(
        find("col_jsonb").get("data_type").and_then(|v| v.as_str()),
        Some("jsonb")
    );
    assert_eq!(
        find("col_bytea").get("data_type").and_then(|v| v.as_str()),
        Some("bytea")
    );
    assert_eq!(
        find("col_timestamptz")
            .get("data_type")
            .and_then(|v| v.as_str()),
        Some("timestamp with time zone")
    );
}

/// Parity equivalent of `test_get_columns_character_max_length`.
/// Verifies that character_maximum_length is reported identically.
#[tokio::test]
#[ignore]
async fn parity_get_columns_character_max_length() {
    require_pg!();
    let harness = ParityHarness::new().await;

    let result = harness
        .assert_parity(
            "get_columns:all_types:char_max_length",
            |driver, params| async move {
                driver
                    .get_columns(&params, "all_types", Some("test_schema"))
                    .await
            },
        )
        .await;

    let arr = result.as_array().expect("columns should be an array");

    let varchar_col = arr
        .iter()
        .find(|c| c.get("name").and_then(|n| n.as_str()) == Some("col_varchar"))
        .expect("col_varchar should exist");
    assert_eq!(
        varchar_col.get("character_maximum_length"),
        Some(&serde_json::Value::from(255)),
        "PG driver returns character_maximum_length for varchar(n)"
    );

    let text_col = arr
        .iter()
        .find(|c| c.get("name").and_then(|n| n.as_str()) == Some("col_text"))
        .expect("col_text should exist");
    assert!(
        text_col.get("character_maximum_length").is_none()
            || text_col.get("character_maximum_length") == Some(&Value::Null),
        "TEXT has no max length"
    );
}

/// Parity equivalent of `test_get_columns_enum_type`.
/// Verifies enum type representation matches between drivers.
#[tokio::test]
#[ignore]
async fn parity_get_columns_enum_type() {
    require_pg!();
    let harness = ParityHarness::new().await;

    let result = harness
        .assert_parity("get_columns:with_enum", |driver, params| async move {
            driver
                .get_columns(&params, "with_enum", Some("test_schema"))
                .await
        })
        .await;

    let arr = result.as_array().expect("columns should be an array");
    let mood_col = arr
        .iter()
        .find(|c| c.get("name").and_then(|n| n.as_str()) == Some("current_mood"))
        .expect("current_mood column should exist");

    let data_type = mood_col
        .get("data_type")
        .and_then(|v| v.as_str())
        .expect("data_type should be a string");
    // The PG driver resolves enum types — the plugin must match exactly.
    // The assert_parity() already guarantees the strings are equal;
    // this structural check just documents the expected format.
    assert!(
        data_type.contains("mood")
            || data_type.starts_with("enum(")
            || data_type == "USER-DEFINED",
        "Enum column data_type should contain 'mood', start with 'enum(', or be 'USER-DEFINED', got: {}",
        data_type
    );
}
