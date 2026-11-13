use crate::database_operations::{validate_database, DatabaseOperation};
use crate::models::{ConnectionParams, DatabaseSelection};

pub(super) async fn execute(
    params: &ConnectionParams,
    operation: DatabaseOperation,
) -> Result<(), String> {
    let database = params.database.primary();
    validate_database(database, &["postgres", "template0", "template1"])?;
    if params.read_only {
        return Err(crate::application::read_only::WRITE_BLOCKED.into());
    }
    if operation == DatabaseOperation::Drop {
        crate::pool_manager::close_pool(params).await;
        let mut admin = params.clone();
        admin.database = DatabaseSelection::Single("postgres".into());
        admin.startup_script = None;
        let pool = crate::pool_manager::get_postgres_pool(&admin).await?;
        let client = pool.get().await.map_err(|e| e.to_string())?;
        // Do not terminate unrelated clients. PostgreSQL reports active sessions
        // and leaves the database intact when it cannot safely drop it.
        client
            .batch_execute(&format!(
                "DROP DATABASE \"{}\"",
                database.replace('"', "\"\"")
            ))
            .await
            .map_err(|e| super::client::format_pg_error(&e))?;
        return Ok(());
    }
    let pool = crate::pool_manager::get_postgres_pool(params).await?;
    let mut client = pool.get().await.map_err(|e| e.to_string())?;
    let tx = client.transaction().await.map_err(|e| e.to_string())?;
    let sql = match operation {
        DatabaseOperation::Empty => include_str!("database_empty.sql"),
        DatabaseOperation::Truncate => include_str!("database_truncate.sql"),
        DatabaseOperation::Drop => unreachable!(),
    };
    tx.batch_execute(sql)
        .await
        .map_err(|e| super::client::format_pg_error(&e))?;
    tx.commit().await.map_err(|e| e.to_string())
}
