use futures::StreamExt;
use serde_json::Value;

use crate::models::ConnectionParams;
use crate::pool_manager::get_postgres_pool;

use super::extract::extract_value;

/// Streams the rows produced by `query` against a PostgreSQL connection. See
/// the MySQL counterpart for the contract of `on_row`.
///
/// With the `session_id` of a tab inside a transaction, the query runs as one
/// cursor on that tab's pinned connection, so the export sees its uncommitted
/// changes. The connection stays pinned throughout, so cancelling the export
/// leaves the transaction open.
pub async fn stream_query<F>(
    params: &ConnectionParams,
    query: &str,
    session_id: Option<&str>,
    mut on_row: F,
) -> Result<(), String>
where
    F: FnMut(&[String], &[Value]) -> Result<(), String> + Send,
{
    if let Some(id) = session_id {
        let mut slot = super::session::lock(id).await;
        if let Some(client) = slot.client() {
            // A savepoint keeps a failing export from aborting the user's transaction.
            client
                .batch_execute("SAVEPOINT tabularis_read")
                .await
                .map_err(|e| e.to_string())?;
            let streamed = stream_rows(client, query, &mut on_row).await;
            let end = match streamed {
                Ok(()) => "RELEASE SAVEPOINT tabularis_read",
                Err(_) => "ROLLBACK TO SAVEPOINT tabularis_read; RELEASE SAVEPOINT tabularis_read",
            };
            let ended = client.batch_execute(end).await.map_err(|e| e.to_string());
            slot.touch();
            return streamed.and(ended);
        }
    }

    let pool = get_postgres_pool(params).await?;
    let client = pool
        .get()
        .await
        .map_err(|e| format!("failed to get postgres client: {:?}", e))?;
    stream_rows(&client, query, &mut on_row).await
}

async fn stream_rows<F>(
    client: &tokio_postgres::Client,
    query: &str,
    on_row: &mut F,
) -> Result<(), String>
where
    F: FnMut(&[String], &[Value]) -> Result<(), String> + Send,
{
    let bind_params: Vec<i32> = vec![];
    let mut rows = std::pin::pin!(client
        .query_raw(query, &bind_params)
        .await
        .map_err(|e| format!("failed to execute postgres query: {:?}", e))?);

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
