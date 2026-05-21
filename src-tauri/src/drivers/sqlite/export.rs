use futures::StreamExt;
use serde_json::Value;
use sqlx::{Column, Row};

use crate::models::ConnectionParams;
use crate::pool_manager::get_sqlite_pool;

use super::extract::extract_value;

/// Streams the rows produced by `query` against a SQLite connection. See the
/// MySQL counterpart for the contract of `on_row`.
pub async fn stream_query<F>(
    params: &ConnectionParams,
    query: &str,
    mut on_row: F,
) -> Result<(), String>
where
    F: FnMut(&[String], &[Value]) -> Result<(), String> + Send,
{
    let pool = get_sqlite_pool(params).await?;
    let mut rows = sqlx::query(query).fetch(&pool);
    let mut headers: Option<Vec<String>> = None;

    while let Some(row_res) = rows.next().await {
        let row = row_res.map_err(|e| e.to_string())?;

        if headers.is_none() {
            headers = Some(row.columns().iter().map(|c| c.name().to_string()).collect());
        }
        let h = headers.as_ref().expect("headers initialized");

        let values: Vec<Value> = (0..row.columns().len())
            .map(|i| extract_value(&row, i, None))
            .collect();

        on_row(h, &values)?;
    }

    Ok(())
}
