use crate::database_operations::DatabaseOperation;
use crate::models::ConnectionParams;
use sqlx::Row;

pub(super) async fn execute(
    params: &ConnectionParams,
    operation: DatabaseOperation,
) -> Result<(), String> {
    if params.read_only {
        return Err(crate::application::read_only::WRITE_BLOCKED.into());
    }
    if operation == DatabaseOperation::Drop {
        return Err("SQLite has no DROP DATABASE operation".into());
    }
    let pool = crate::pool_manager::get_sqlite_pool(params).await?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    conn.close_on_drop();
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    let mut tx = sqlx::Connection::begin(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    // table_list excludes virtual-table shadow storage; dropping/deleting the
    // virtual table itself lets its module maintain that storage correctly.
    let rows = sqlx::query("SELECT name, type FROM pragma_table_list WHERE schema = 'main' AND type IN ('table', 'virtual', 'view') AND name NOT GLOB 'sqlite_*' ORDER BY type DESC")
        .fetch_all(&mut *tx).await.map_err(|e| e.to_string())?;
    let q = |name: &str| format!("\"{}\"", name.replace('"', "\"\""));
    for row in rows {
        let name: String = row.get("name");
        let kind: String = row.get("type");
        let verb = match (operation, kind.as_str()) {
            (DatabaseOperation::Truncate, "view") => continue,
            (DatabaseOperation::Truncate, _) => "DELETE FROM",
            (DatabaseOperation::Empty, "view") => "DROP VIEW",
            _ => "DROP TABLE",
        };
        sqlx::query(&format!("{verb} main.{}", q(&name)))
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    if operation == DatabaseOperation::Truncate {
        let tables: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_list WHERE schema = 'main' AND type IN ('table', 'virtual') AND name NOT GLOB 'sqlite_*'")
            .fetch_all(&mut *tx).await.map_err(|e| e.to_string())?;
        for table in tables {
            let count: i64 =
                sqlx::query_scalar(&format!("SELECT count(*) FROM main.{}", q(&table)))
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
            if count != 0 {
                return Err(
                    "A DELETE trigger repopulated a table; the operation was rolled back".into(),
                );
            }
        }
    }
    if operation == DatabaseOperation::Truncate {
        let sequence: i64 =
            sqlx::query_scalar("SELECT count(*) FROM sqlite_schema WHERE name = 'sqlite_sequence'")
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        if sequence > 0 {
            sqlx::query("DELETE FROM sqlite_sequence")
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().await.map_err(|e| e.to_string())
}
