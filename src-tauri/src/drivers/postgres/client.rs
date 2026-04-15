use deadpool_postgres::{Object as PgObject, Pool as PgPool};
use tokio_postgres::Row as PgRow;

pub(super) fn format_pg_error(e: &tokio_postgres::Error) -> String {
    if let Some(db) = e.as_db_error() {
        let brief = format!("{}: {}", db.severity(), db.message());
        let detail = format!("{:#?}", e);
        format!("{}\n\n{}", brief, detail)
    } else {
        e.to_string()
    }
}

#[inline(always)]
fn map_pg_err<E: std::fmt::Debug + std::fmt::Display>(e: E) -> String {
    let brief = e.to_string();
    let detail = format!("{:#?}", e);
    if detail.len() > brief.len() + 20 {
        format!("{}\n\n{}", brief, detail)
    } else {
        brief
    }
}

#[inline(always)]
pub(super) async fn get_client(pool: &PgPool) -> Result<PgObject, String> {
    pool.get().await.map_err(map_pg_err)
}

#[inline]
pub(super) async fn query_all(
    pool: &PgPool,
    sql: &str,
    params: &[&(dyn tokio_postgres::types::ToSql + Sync)],
) -> Result<Vec<PgRow>, String> {
    let client = get_client(pool).await?;
    client
        .query(sql, params)
        .await
        .map_err(|e| format_pg_error(&e))
}

#[inline]
pub(super) async fn query_one(
    pool: &PgPool,
    sql: &str,
    params: &[&(dyn tokio_postgres::types::ToSql + Sync)],
) -> Result<PgRow, String> {
    let client = get_client(pool).await?;
    client
        .query_one(sql, params)
        .await
        .map_err(|e| format_pg_error(&e))
}

#[inline]
pub(super) async fn execute(
    pool: &PgPool,
    sql: &str,
    params: &[&(dyn tokio_postgres::types::ToSql + Sync)],
) -> Result<u64, String> {
    let client = get_client(pool).await?;
    client
        .execute(sql, params)
        .await
        .map_err(|e| format_pg_error(&e))
}
