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
