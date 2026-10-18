//! DDL generation tests.

use crate::helpers::pg_params;
use tabularis_lib::drivers::driver_trait::DatabaseDriver;
use tabularis_lib::drivers::postgres::PostgresDriver;
use tabularis_lib::models::ColumnDefinition;

#[tokio::test]
#[ignore]
async fn test_get_create_table_sql() {
    require_pg!();
    let _params = pg_params();

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

    let sql_statements = PostgresDriver::new()
        .get_create_table_sql("ddl_test_table", columns, Some("test_schema"))
        .await
        .expect("get_create_table_sql should succeed");

    assert!(
        !sql_statements.is_empty(),
        "Should return at least one SQL statement"
    );
    let sql = sql_statements.join("; ");
    let lower = sql.to_lowercase();

    assert!(
        lower.contains("create table"),
        "Should contain CREATE TABLE"
    );
    assert!(
        lower.contains("ddl_test_table"),
        "Should contain table name"
    );
    assert!(
        lower.contains("serial") || lower.contains("generated"),
        "Should handle auto-increment"
    );
    assert!(
        lower.contains("not null"),
        "Should contain NOT NULL for non-nullable columns"
    );
    assert!(
        lower.contains("varchar(255)") || lower.contains("character varying(255)"),
        "Should preserve varchar type"
    );
}

#[tokio::test]
#[ignore]
async fn test_get_add_column_sql() {
    require_pg!();

    let column = ColumnDefinition {
        name: "new_col".to_string(),
        data_type: "INTEGER".to_string(),
        is_nullable: true,
        is_pk: false,
        is_auto_increment: false,
        default_value: Some("0".to_string()),
        comment: None,
    };

    let sql_statements = PostgresDriver::new()
        .get_add_column_sql("all_types", column, Some("test_schema"))
        .await
        .expect("get_add_column_sql should succeed");

    assert!(!sql_statements.is_empty());
    let sql = sql_statements.join("; ");
    let lower = sql.to_lowercase();

    assert!(lower.contains("alter table"), "Should contain ALTER TABLE");
    assert!(lower.contains("add column"), "Should contain ADD COLUMN");
    assert!(lower.contains("new_col"), "Should contain column name");
    assert!(lower.contains("integer"), "Should contain type");
}

#[tokio::test]
#[ignore]
async fn test_get_alter_column_rename() {
    require_pg!();

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

    let sql_statements = PostgresDriver::new()
        .get_alter_column_sql("all_types", old_column, new_column, Some("test_schema"))
        .await
        .expect("get_alter_column_sql for rename should succeed");

    assert!(!sql_statements.is_empty());
    let sql = sql_statements.join("; ");
    let lower = sql.to_lowercase();

    assert!(
        lower.contains("rename column") || lower.contains("alter column"),
        "Should rename"
    );
    assert!(lower.contains("old_name"), "Should reference old name");
    assert!(lower.contains("new_name"), "Should reference new name");
}

#[tokio::test]
#[ignore]
async fn test_get_alter_column_type_change() {
    require_pg!();

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

    let sql_statements = PostgresDriver::new()
        .get_alter_column_sql("all_types", old_column, new_column, Some("test_schema"))
        .await
        .expect("get_alter_column_sql for type change should succeed");

    assert!(!sql_statements.is_empty());
    let sql = sql_statements.join("; ");
    let lower = sql.to_lowercase();

    assert!(
        lower.contains("type") || lower.contains("alter column"),
        "Should change type, got: {}",
        sql
    );
}

#[tokio::test]
#[ignore]
async fn test_get_create_index_sql() {
    require_pg!();

    let sql_statements = PostgresDriver::new()
        .get_create_index_sql(
            "all_types",
            "idx_ddl_test",
            vec!["col_text".to_string(), "col_int".to_string()],
            false, // not unique
            Some("test_schema"),
        )
        .await
        .expect("get_create_index_sql should succeed");

    assert!(!sql_statements.is_empty());
    let sql = sql_statements.join("; ");
    let lower = sql.to_lowercase();

    assert!(
        lower.contains("create index"),
        "Should contain CREATE INDEX"
    );
    assert!(lower.contains("idx_ddl_test"), "Should contain index name");
    assert!(lower.contains("col_text"), "Should contain first column");
    assert!(lower.contains("col_int"), "Should contain second column");
}

#[tokio::test]
#[ignore]
async fn test_get_create_index_sql_unique() {
    require_pg!();

    let sql_statements = PostgresDriver::new()
        .get_create_index_sql(
            "all_types",
            "idx_ddl_unique_test",
            vec!["col_varchar".to_string()],
            true, // unique
            Some("test_schema"),
        )
        .await
        .expect("get_create_index_sql unique should succeed");

    let sql = sql_statements.join("; ");
    let lower = sql.to_lowercase();

    assert!(
        lower.contains("create unique index"),
        "Should contain CREATE UNIQUE INDEX"
    );
}

#[tokio::test]
#[ignore]
async fn test_get_create_foreign_key_sql() {
    require_pg!();
    let params = pg_params();

    let sql_statements = PostgresDriver::new()
        .get_create_foreign_key_sql(
            &params,
            "crud_scratch",
            "fk_ddl_test",
            "value",
            "all_types",
            "id",
            None,
            None,
            Some("test_schema"),
        )
        .await
        .expect("get_create_foreign_key_sql should succeed");

    assert!(!sql_statements.is_empty());
    let sql = sql_statements.join("; ");
    let lower = sql.to_lowercase();

    assert!(lower.contains("alter table"), "Should contain ALTER TABLE");
    assert!(
        lower.contains("add constraint"),
        "Should contain ADD CONSTRAINT"
    );
    assert!(lower.contains("foreign key"), "Should contain FOREIGN KEY");
    assert!(lower.contains("references"), "Should contain REFERENCES");
}
