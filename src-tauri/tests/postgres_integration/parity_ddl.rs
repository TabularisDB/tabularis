//! Parity tests for DDL generation — covers ALL 7 baseline tests from
//! `ddl_generation.rs`. None of these were previously covered by parity tests.
//!
//! DDL methods generate SQL without connecting to the database. The parity
//! comparison ensures the plugin generates IDENTICAL DDL strings to the builtin.

use tabularis_lib::models::ColumnDefinition;

use crate::parity::ParityHarness;

/// Parity equivalent of `test_get_create_table_sql`.
/// Verifies CREATE TABLE DDL generation matches between drivers.
#[tokio::test]
#[ignore]
async fn parity_ddl_create_table() {
    require_pg!();
    let harness = ParityHarness::new().await;

    let result = harness
        .assert_parity("get_create_table_sql:basic", |driver, _params| async move {
            let columns = vec![
                ColumnDefinition {
                    name: "id".to_string(),
                    data_type: "SERIAL".to_string(),
                    is_nullable: false,
                    is_pk: true,
                    is_auto_increment: true,
                    default_value: None,
                    comment: None,
                },
                ColumnDefinition {
                    name: "name".to_string(),
                    data_type: "TEXT".to_string(),
                    is_nullable: false,
                    is_pk: false,
                    is_auto_increment: false,
                    default_value: None,
                    comment: None,
                },
                ColumnDefinition {
                    name: "email".to_string(),
                    data_type: "VARCHAR(255)".to_string(),
                    is_nullable: true,
                    is_pk: false,
                    is_auto_increment: false,
                    default_value: Some("'unknown@example.com'".to_string()),
                    comment: None,
                },
            ];
            driver
                .get_create_table_sql("parity_ddl_scratch_table", columns, Some("test_schema"))
                .await
        })
        .await;

    let arr = result
        .as_array()
        .expect("DDL should return array of statements");
    assert!(!arr.is_empty(), "Should return at least one SQL statement");

    let sql: String = arr
        .iter()
        .filter_map(|v| v.as_str())
        .collect::<Vec<_>>()
        .join("; ");
    let lower = sql.to_lowercase();

    assert!(
        lower.contains("create table"),
        "Should contain CREATE TABLE"
    );
    assert!(
        lower.contains("parity_ddl_scratch_table"),
        "Should contain table name"
    );
    assert!(
        lower.contains("serial") || lower.contains("generated"),
        "Should handle auto-increment"
    );
    assert!(lower.contains("not null"), "Should contain NOT NULL");
    assert!(
        lower.contains("varchar(255)") || lower.contains("character varying(255)"),
        "Should preserve varchar type"
    );
}

/// Parity equivalent of `test_get_add_column_sql`.
/// Verifies ADD COLUMN DDL generation matches between drivers.
#[tokio::test]
#[ignore]
async fn parity_ddl_add_column() {
    require_pg!();
    let harness = ParityHarness::new().await;

    let result = harness
        .assert_parity("get_add_column_sql:basic", |driver, _params| async move {
            let column = ColumnDefinition {
                name: "new_col".to_string(),
                data_type: "INTEGER".to_string(),
                is_nullable: true,
                is_pk: false,
                is_auto_increment: false,
                default_value: Some("0".to_string()),
                comment: None,
            };
            driver
                .get_add_column_sql("all_types", column, Some("test_schema"))
                .await
        })
        .await;

    let arr = result
        .as_array()
        .expect("DDL should return array of statements");
    assert!(!arr.is_empty());

    let sql: String = arr
        .iter()
        .filter_map(|v| v.as_str())
        .collect::<Vec<_>>()
        .join("; ");
    let lower = sql.to_lowercase();

    assert!(lower.contains("alter table"), "Should contain ALTER TABLE");
    assert!(lower.contains("add column"), "Should contain ADD COLUMN");
    assert!(lower.contains("new_col"), "Should contain column name");
    assert!(lower.contains("integer"), "Should contain type");
}

/// Parity equivalent of `test_get_alter_column_rename`.
/// Verifies RENAME COLUMN DDL generation matches between drivers.
#[tokio::test]
#[ignore]
async fn parity_ddl_alter_column_rename() {
    require_pg!();
    let harness = ParityHarness::new().await;

    let result = harness
        .assert_parity(
            "get_alter_column_sql:rename",
            |driver, _params| async move {
                let old_column = ColumnDefinition {
                    name: "old_name".to_string(),
                    data_type: "TEXT".to_string(),
                    is_nullable: true,
                    is_pk: false,
                    is_auto_increment: false,
                    default_value: None,
                    comment: None,
                };
                let new_column = ColumnDefinition {
                    name: "new_name".to_string(),
                    data_type: "TEXT".to_string(),
                    is_nullable: true,
                    is_pk: false,
                    is_auto_increment: false,
                    default_value: None,
                    comment: None,
                };
                driver
                    .get_alter_column_sql("all_types", old_column, new_column, Some("test_schema"))
                    .await
            },
        )
        .await;

    let arr = result
        .as_array()
        .expect("DDL should return array of statements");
    assert!(!arr.is_empty());

    let sql: String = arr
        .iter()
        .filter_map(|v| v.as_str())
        .collect::<Vec<_>>()
        .join("; ");
    let lower = sql.to_lowercase();

    assert!(
        lower.contains("rename column") || lower.contains("alter column"),
        "Should rename"
    );
    assert!(lower.contains("old_name"), "Should reference old name");
    assert!(lower.contains("new_name"), "Should reference new name");
}

/// Parity equivalent of `test_get_alter_column_type_change`.
/// Verifies ALTER COLUMN TYPE DDL generation matches between drivers.
#[tokio::test]
#[ignore]
async fn parity_ddl_alter_column_type_change() {
    require_pg!();
    let harness = ParityHarness::new().await;

    let result = harness
        .assert_parity(
            "get_alter_column_sql:type_change",
            |driver, _params| async move {
                let old_column = ColumnDefinition {
                    name: "col_text".to_string(),
                    data_type: "TEXT".to_string(),
                    is_nullable: true,
                    is_pk: false,
                    is_auto_increment: false,
                    default_value: None,
                    comment: None,
                };
                let new_column = ColumnDefinition {
                    name: "col_text".to_string(),
                    data_type: "VARCHAR(500)".to_string(),
                    is_nullable: true,
                    is_pk: false,
                    is_auto_increment: false,
                    default_value: None,
                    comment: None,
                };
                driver
                    .get_alter_column_sql("all_types", old_column, new_column, Some("test_schema"))
                    .await
            },
        )
        .await;

    let arr = result
        .as_array()
        .expect("DDL should return array of statements");
    assert!(!arr.is_empty());

    let sql: String = arr
        .iter()
        .filter_map(|v| v.as_str())
        .collect::<Vec<_>>()
        .join("; ");
    let lower = sql.to_lowercase();

    assert!(
        lower.contains("type") || lower.contains("alter column"),
        "Should change type, got: {}",
        sql
    );
}

/// Parity equivalent of `test_get_create_index_sql`.
/// Verifies CREATE INDEX DDL generation matches between drivers.
#[tokio::test]
#[ignore]
async fn parity_ddl_create_index() {
    require_pg!();
    let harness = ParityHarness::new().await;

    let result = harness
        .assert_parity(
            "get_create_index_sql:multi_column",
            |driver, _params| async move {
                driver
                    .get_create_index_sql(
                        "all_types",
                        "idx_parity_ddl_test",
                        vec!["col_text".to_string(), "col_int".to_string()],
                        false, // not unique
                        Some("test_schema"),
                    )
                    .await
            },
        )
        .await;

    let arr = result
        .as_array()
        .expect("DDL should return array of statements");
    assert!(!arr.is_empty());

    let sql: String = arr
        .iter()
        .filter_map(|v| v.as_str())
        .collect::<Vec<_>>()
        .join("; ");
    let lower = sql.to_lowercase();

    assert!(
        lower.contains("create index"),
        "Should contain CREATE INDEX"
    );
    assert!(
        lower.contains("idx_parity_ddl_test"),
        "Should contain index name"
    );
    assert!(lower.contains("col_text"), "Should contain first column");
    assert!(lower.contains("col_int"), "Should contain second column");
}

/// Parity equivalent of `test_get_create_index_sql_unique`.
/// Verifies CREATE UNIQUE INDEX DDL generation matches between drivers.
#[tokio::test]
#[ignore]
async fn parity_ddl_create_index_unique() {
    require_pg!();
    let harness = ParityHarness::new().await;

    let result = harness
        .assert_parity(
            "get_create_index_sql:unique",
            |driver, _params| async move {
                driver
                    .get_create_index_sql(
                        "all_types",
                        "idx_parity_ddl_unique_test",
                        vec!["col_varchar".to_string()],
                        true, // unique
                        Some("test_schema"),
                    )
                    .await
            },
        )
        .await;

    let arr = result
        .as_array()
        .expect("DDL should return array of statements");
    let sql: String = arr
        .iter()
        .filter_map(|v| v.as_str())
        .collect::<Vec<_>>()
        .join("; ");
    let lower = sql.to_lowercase();

    assert!(
        lower.contains("create unique index"),
        "Should contain CREATE UNIQUE INDEX"
    );
}

/// Parity equivalent of `test_get_create_foreign_key_sql`.
/// Verifies ADD CONSTRAINT FOREIGN KEY DDL generation matches between drivers.
#[tokio::test]
#[ignore]
async fn parity_ddl_create_foreign_key() {
    require_pg!();
    let harness = ParityHarness::new().await;

    let result = harness
        .assert_parity(
            "get_create_foreign_key_sql:basic",
            |driver, params| async move {
                driver
                    .get_create_foreign_key_sql(
                        &params,
                        "crud_scratch",
                        "fk_parity_ddl_test",
                        "value",
                        "all_types",
                        "id",
                        None,
                        None,
                        Some("test_schema"),
                    )
                    .await
            },
        )
        .await;

    let arr = result
        .as_array()
        .expect("DDL should return array of statements");
    assert!(!arr.is_empty());

    let sql: String = arr
        .iter()
        .filter_map(|v| v.as_str())
        .collect::<Vec<_>>()
        .join("; ");
    let lower = sql.to_lowercase();

    assert!(lower.contains("alter table"), "Should contain ALTER TABLE");
    assert!(
        lower.contains("add constraint"),
        "Should contain ADD CONSTRAINT"
    );
    assert!(lower.contains("foreign key"), "Should contain FOREIGN KEY");
    assert!(lower.contains("references"), "Should contain REFERENCES");
}
