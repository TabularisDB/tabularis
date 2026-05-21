use futures::StreamExt;
use serde_json::Value;
use sqlx::{Column, Row};

use crate::models::ConnectionParams;
use crate::pool_manager::get_mysql_pool;

use super::extract::extract_value;

/// Streams the rows produced by `query` against a MySQL connection, calling
/// `on_row` once per row with the column names (captured from the first row)
/// and the values extracted as `serde_json::Value`s.
///
/// The caller is responsible for ranking, formatting, and finishing whatever
/// sink consumes the rows — this function only handles the database stream.
pub async fn stream_query<F>(
    params: &ConnectionParams,
    query: &str,
    mut on_row: F,
) -> Result<(), String>
where
    F: FnMut(&[String], &[Value]) -> Result<(), String> + Send,
{
    let pool = get_mysql_pool(params).await?;
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
