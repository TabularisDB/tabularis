use super::extract_value;
use crate::drivers::common::encode_blob;
use sqlx::sqlite::SqlitePoolOptions;

async fn fetch_single_row(query: &str) -> sqlx::sqlite::SqliteRow {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("should connect to in-memory sqlite");

    let row = sqlx::query(query)
        .fetch_one(&pool)
        .await
        .expect("query should return one row");

    pool.close().await;
    row
}

#[tokio::test]
async fn extracts_null_values() {
    let row = fetch_single_row("SELECT NULL AS value").await;
    assert_eq!(extract_value(&row, 0, None), serde_json::Value::Null);
}

#[tokio::test]
async fn extracts_text_values_before_numeric_fallbacks() {
    let row = fetch_single_row("SELECT '2026-04-15 12:34:56' AS value").await;
    assert_eq!(
        extract_value(&row, 0, None),
        serde_json::Value::String("2026-04-15 12:34:56".to_string())
    );
}

#[tokio::test]
async fn extracts_integer_values() {
    let row = fetch_single_row("SELECT 42 AS value").await;
    assert_eq!(extract_value(&row, 0, None), serde_json::Value::from(42));
}

#[tokio::test]
async fn extracts_blob_values() {
    let row = fetch_single_row("SELECT X'6869' AS value").await;
    assert_eq!(
        extract_value(&row, 0, None),
        serde_json::Value::String(encode_blob(b"hi"))
    );
}

#[tokio::test]
async fn extracts_finite_and_infinite_float_values() {
    let row = fetch_single_row("SELECT 1.5 AS finite, 9e999 AS pos_inf, -9e999 AS neg_inf").await;
    assert_eq!(extract_value(&row, 0, None), serde_json::json!(1.5));
    assert_eq!(
        extract_value(&row, 1, None),
        serde_json::Value::String("Infinity".to_string())
    );
    assert_eq!(
        extract_value(&row, 2, None),
        serde_json::Value::String("-Infinity".to_string())
    );
}

#[tokio::test]
async fn extracts_infinite_real_column_rows_distinct_from_null() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("should connect to in-memory sqlite");

    sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, v REAL)")
        .execute(&pool)
        .await
        .expect("create table should succeed");
    sqlx::query("INSERT INTO t VALUES (1, 9e999), (2, -9e999), (3, NULL), (4, 1.5)")
        .execute(&pool)
        .await
        .expect("insert should succeed");

    let rows = sqlx::query("SELECT id, v FROM t ORDER BY id")
        .fetch_all(&pool)
        .await
        .expect("select should succeed");

    let extracted: Vec<(serde_json::Value, serde_json::Value)> = rows
        .iter()
        .map(|r| (extract_value(r, 0, None), extract_value(r, 1, None)))
        .collect();

    assert_eq!(
        extracted,
        vec![
            (
                serde_json::json!(1),
                serde_json::Value::String("Infinity".to_string())
            ),
            (
                serde_json::json!(2),
                serde_json::Value::String("-Infinity".to_string())
            ),
            (serde_json::json!(3), serde_json::Value::Null),
            (serde_json::json!(4), serde_json::json!(1.5)),
        ]
    );

    pool.close().await;
}
