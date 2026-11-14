use crate::database_operations::{validate_database, DatabaseOperation};
use crate::models::ConnectionParams;
use sqlx::{Executor, Row};

pub(super) async fn execute(
    params: &ConnectionParams,
    operation: DatabaseOperation,
) -> Result<(), String> {
    let database = params.database.primary();
    validate_database(
        database,
        &["mysql", "sys", "information_schema", "performance_schema"],
    )?;
    if params.read_only {
        return Err(crate::application::read_only::WRITE_BLOCKED.into());
    }
    let pool = crate::pool_manager::get_mysql_pool(params).await?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    // DDL implicitly commits. Never return altered FK/session state to the pool,
    // including when an error or cancellation interrupts the operation.
    conn.close_on_drop();
    let q = |name: &str| format!("`{}`", name.replace('`', "``"));
    let target = q(database);
    if operation == DatabaseOperation::Drop {
        (&mut *conn)
            .execute(format!("DROP DATABASE {target}").as_str())
            .await
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    let external_references: i64 = sqlx::query_scalar("SELECT count(*) FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA = ? AND TABLE_SCHEMA <> ?")
        .bind(database).bind(database).fetch_one(&mut *conn).await.map_err(|e| e.to_string())?;
    if external_references > 0 {
        return Err(
            "Another database has foreign keys referencing this database; no changes were made"
                .into(),
        );
    }
    let tables = sqlx::query("SELECT CAST(TABLE_NAME AS CHAR CHARACTER SET utf8mb4) AS TABLE_NAME, CAST(TABLE_TYPE AS CHAR CHARACTER SET utf8mb4) AS TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE DESC, TABLE_NAME")
        .bind(database).fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
    for row in &tables {
        let kind: String = row.try_get("TABLE_TYPE").map_err(|e| e.to_string())?;
        if !matches!(
            kind.as_str(),
            "BASE TABLE" | "VIEW" | "SEQUENCE" | "SYSTEM VERSIONED"
        ) || (operation == DatabaseOperation::Truncate && kind == "SYSTEM VERSIONED")
        {
            return Err(format!(
                "This operation does not support table type {kind}; no changes were made"
            ));
        }
    }
    sqlx::query("SET SESSION FOREIGN_KEY_CHECKS = 0")
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    for row in tables {
        let name: String = row.try_get("TABLE_NAME").map_err(|e| e.to_string())?;
        let kind: String = row.try_get("TABLE_TYPE").map_err(|e| e.to_string())?;
        let verb = match (operation, kind.as_str()) {
            (DatabaseOperation::Truncate, "BASE TABLE") => "TRUNCATE TABLE",
            (DatabaseOperation::Empty, "VIEW") => "DROP VIEW",
            (DatabaseOperation::Empty, "BASE TABLE" | "SYSTEM VERSIONED") => "DROP TABLE",
            (DatabaseOperation::Empty, "SEQUENCE") => "DROP SEQUENCE",
            _ => continue,
        };
        (&mut *conn).execute(format!("{verb} {target}.{}", q(&name)).as_str()).await
            .map_err(|e| format!("Operation stopped at {name}: {e}. Earlier MySQL DDL changes may already be committed."))?;
    }
    if operation == DatabaseOperation::Empty {
        let routines = sqlx::query("SELECT CAST(ROUTINE_NAME AS CHAR CHARACTER SET utf8mb4) AS ROUTINE_NAME, CAST(ROUTINE_TYPE AS CHAR CHARACTER SET utf8mb4) AS ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?")
            .bind(database).fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
        for row in routines {
            let name: String = row.try_get("ROUTINE_NAME").map_err(|e| e.to_string())?;
            let kind: String = row.try_get("ROUTINE_TYPE").map_err(|e| e.to_string())?;
            let verb = if kind == "FUNCTION" {
                "DROP FUNCTION"
            } else {
                "DROP PROCEDURE"
            };
            (&mut *conn)
                .execute(format!("{verb} {target}.{}", q(&name)).as_str())
                .await
                .map_err(|e| e.to_string())?;
        }
        let events =
            sqlx::query("SELECT CAST(EVENT_NAME AS CHAR CHARACTER SET utf8mb4) AS EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ?")
                .bind(database)
                .fetch_all(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
        for row in events {
            let name: String = row.try_get("EVENT_NAME").map_err(|e| e.to_string())?;
            (&mut *conn)
                .execute(format!("DROP EVENT {target}.{}", q(&name)).as_str())
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
