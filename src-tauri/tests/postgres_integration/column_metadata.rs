//! Column metadata tests: get_columns for various table types.

use crate::helpers::pg_params;
use tabularis_lib::drivers::postgres;

#[tokio::test]
#[ignore]
async fn test_get_columns_all_types_count() {
    require_pg!();
    let params = pg_params();

    let columns = postgres::get_columns(&params, "all_types", "test_schema")
        .await
        .expect("get_columns should succeed");

    // all_types has 27 columns (id + 26 typed columns)
    assert_eq!(columns.len(), 27, "Expected 27 columns in all_types");
}

#[tokio::test]
#[ignore]
async fn test_get_columns_pk_detection() {
    require_pg!();
    let params = pg_params();

    let columns = postgres::get_columns(&params, "all_types", "test_schema")
        .await
        .expect("get_columns should succeed");

    let id_col = columns
        .iter()
        .find(|c| c.name == "id")
        .expect("id column should exist");
    assert!(id_col.is_pk, "id should be primary key");
    assert!(
        id_col.is_auto_increment,
        "SERIAL id should be auto_increment"
    );
    assert_eq!(id_col.data_type, "integer", "SERIAL resolves to integer");

    // Non-PK columns should not be marked as PK
    let text_col = columns.iter().find(|c| c.name == "col_text").unwrap();
    assert!(!text_col.is_pk);
    assert!(!text_col.is_auto_increment);
}

#[tokio::test]
#[ignore]
async fn test_table_and_column_comments() {
    require_pg!();
    let params = pg_params();

    let tables = postgres::get_tables(&params, "test_schema")
        .await
        .expect("get_tables should succeed");
    let table = tables
        .iter()
        .find(|table| table.name == "all_types")
        .expect("all_types table should exist");
    assert_eq!(
        table.comment.as_deref(),
        Some("PostgreSQL metadata integration fixture")
    );

    let columns = postgres::get_columns(&params, "all_types", "test_schema")
        .await
        .expect("get_columns should succeed");
    let text_column = columns
        .iter()
        .find(|column| column.name == "col_text")
        .expect("col_text column should exist");
    assert_eq!(
        text_column.comment.as_deref(),
        Some("Free-form text used by metadata tests")
    );
}

#[tokio::test]
#[ignore]
async fn test_get_columns_nullable_detection() {
    require_pg!();
    let params = pg_params();

    let columns = postgres::get_columns(&params, "all_types", "test_schema")
        .await
        .expect("get_columns should succeed");

    // id (SERIAL PRIMARY KEY) is NOT NULL
    let id_col = columns.iter().find(|c| c.name == "id").unwrap();
    assert!(!id_col.is_nullable, "PK should not be nullable");

    // col_text has no NOT NULL constraint
    let text_col = columns.iter().find(|c| c.name == "col_text").unwrap();
    assert!(text_col.is_nullable, "col_text should be nullable");
}

#[tokio::test]
#[ignore]
async fn test_get_columns_type_detection() {
    require_pg!();
    let params = pg_params();

    let columns = postgres::get_columns(&params, "all_types", "test_schema")
        .await
        .expect("get_columns should succeed");

    let find = |name: &str| columns.iter().find(|c| c.name == name).unwrap();

    assert_eq!(find("col_text").data_type, "text");
    assert_eq!(find("col_int").data_type, "integer");
    assert_eq!(find("col_bigint").data_type, "bigint");
    assert_eq!(find("col_bool").data_type, "boolean");
    assert_eq!(find("col_uuid").data_type, "uuid");
    assert_eq!(find("col_jsonb").data_type, "jsonb");
    assert_eq!(find("col_bytea").data_type, "bytea");
    assert_eq!(
        find("col_timestamptz").data_type,
        "timestamp with time zone"
    );
}

#[tokio::test]
#[ignore]
async fn test_get_columns_character_max_length() {
    require_pg!();
    let params = pg_params();

    let columns = postgres::get_columns(&params, "all_types", "test_schema")
        .await
        .expect("get_columns should succeed");

    let varchar_col = columns.iter().find(|c| c.name == "col_varchar").unwrap();
    // KNOWN BEHAVIOR: The PG driver does NOT populate character_maximum_length.
    // This is a driver limitation, not a PostgreSQL limitation (PG does expose this
    // in information_schema). The plugin MUST match this exact behavior (return None).
    // If the built-in driver is fixed later, this test will correctly fail — prompting
    // an update to both the test and the plugin.
    assert_eq!(
        varchar_col.character_maximum_length, None,
        "Built-in PG driver returns None for character_maximum_length (known limitation)"
    );

    let text_col = columns.iter().find(|c| c.name == "col_text").unwrap();
    assert_eq!(
        text_col.character_maximum_length, None,
        "TEXT has no max length"
    );
}

#[tokio::test]
#[ignore]
async fn test_get_columns_enum_type() {
    require_pg!();
    let params = pg_params();

    let columns = postgres::get_columns(&params, "with_enum", "test_schema")
        .await
        .expect("get_columns should succeed");

    let mood_col = columns.iter().find(|c| c.name == "current_mood").unwrap();
    // The PG driver resolves enum types to "enum('val1','val2',...)" format
    assert!(
        mood_col.data_type.contains("mood")
            || mood_col.data_type.starts_with("enum(")
            || mood_col.data_type == "USER-DEFINED",
        "Enum column should have type containing 'mood', start with 'enum(', or be 'USER-DEFINED', got: {}",
        mood_col.data_type
    );
}
