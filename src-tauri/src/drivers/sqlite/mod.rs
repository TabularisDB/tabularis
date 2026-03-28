pub mod extract;
pub mod types;

use crate::models::{
    ConnectionParams, ForeignKey, Index, Pagination, QueryResult, RoutineInfo, RoutineParameter,
    TableColumn, TableInfo, ViewInfo,
};
use crate::pool_manager::get_sqlite_pool;
use extract::extract_value;
use sqlx::{Column, Row};

// Helper function to escape double quotes in identifiers for SQLite
fn escape_identifier(name: &str) -> String {
    name.replace('"', "\"\"")
}

pub async fn get_schemas(_params: &ConnectionParams) -> Result<Vec<String>, String> {
    Ok(vec![])
}

pub async fn get_databases(_params: &ConnectionParams) -> Result<Vec<String>, String> {
    // SQLite doesn't support multiple databases in the same connection
    Ok(vec![])
}

pub async fn get_tables(params: &ConnectionParams) -> Result<Vec<TableInfo>, String> {
    log::debug!("SQLite: Fetching tables for database: {}", params.database);
    let pool = get_sqlite_pool(params).await?;
    let rows = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    let tables: Vec<TableInfo> = rows
        .iter()
        .map(|r| TableInfo {
            name: r.try_get("name").unwrap_or_default(),
        })
        .collect();
    log::debug!(
        "SQLite: Found {} tables in {}",
        tables.len(),
        params.database
    );
    Ok(tables)
}

pub async fn get_columns(
    params: &ConnectionParams,
    table_name: &str,
) -> Result<Vec<TableColumn>, String> {
    let pool = get_sqlite_pool(params).await?;

    // PRAGMA table_info doesn't explicitly say "AUTO_INCREMENT"
    // But INTEGER PRIMARY KEY is implicitly so in sqlite.
    // Also if 'pk' > 0 and type is INTEGER.
    let query = format!("PRAGMA table_info('{}')", table_name);

    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| {
            let pk: i32 = r.try_get("pk").unwrap_or(0);
            let notnull: i32 = r.try_get("notnull").unwrap_or(0);
            let dtype: String = r.try_get("type").unwrap_or_default();
            let dflt_value: Option<String> = r.try_get("dflt_value").ok();

            let _is_auto = pk > 0 && dtype.to_uppercase().contains("INT");

            TableColumn {
                name: r.try_get("name").unwrap_or_default(),
                data_type: r.try_get("type").unwrap_or_default(),
                is_pk: pk > 0,
                is_nullable: notnull == 0,
                is_auto_increment: false,
                default_value: dflt_value,
                character_maximum_length: None,
            }
        })
        .collect())
}

pub async fn get_routines(_params: &ConnectionParams) -> Result<Vec<RoutineInfo>, String> {
    // SQLite does not support stored procedures
    Ok(vec![])
}

pub async fn get_routine_parameters(
    _params: &ConnectionParams,
    _routine_name: &str,
) -> Result<Vec<RoutineParameter>, String> {
    Ok(vec![])
}

pub async fn get_routine_definition(
    _params: &ConnectionParams,
    _routine_name: &str,
    _routine_type: &str,
) -> Result<String, String> {
    Err("SQLite does not support stored procedures".to_string())
}

pub async fn get_foreign_keys(
    params: &ConnectionParams,
    table_name: &str,
) -> Result<Vec<ForeignKey>, String> {
    let pool = get_sqlite_pool(params).await?;

    let query = format!("PRAGMA foreign_key_list('{}')", table_name);
    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    // id, seq, table, from, to, on_update, on_delete, match
    Ok(rows
        .iter()
        .map(|r| {
            let id: i32 = r.try_get("id").unwrap_or(0);
            ForeignKey {
                name: format!(
                    "fk_{}_{}",
                    id,
                    r.try_get::<String, _>("table").unwrap_or_default()
                ), // SQLite FKs don't always have named constraints exposed easily here, but we construct one
                column_name: r.try_get("from").unwrap_or_default(),
                ref_table: r.try_get("table").unwrap_or_default(),
                ref_column: r.try_get("to").unwrap_or_default(),
                on_update: r.try_get("on_update").ok(),
                on_delete: r.try_get("on_delete").ok(),
            }
        })
        .collect())
}

// Batch function: Get all columns for all tables (SQLite must iterate but reuses connection)
pub async fn get_all_columns_batch(
    params: &ConnectionParams,
    table_names: &[String],
) -> Result<std::collections::HashMap<String, Vec<TableColumn>>, String> {
    use std::collections::HashMap;
    let pool = get_sqlite_pool(params).await?;
    let mut result: HashMap<String, Vec<TableColumn>> = HashMap::new();

    for table_name in table_names {
        let query = format!("PRAGMA table_info('{}')", table_name);
        let rows = sqlx::query(&query)
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

        let columns: Vec<TableColumn> = rows
            .iter()
            .map(|r| {
                let pk: i32 = r.try_get("pk").unwrap_or(0);
                let notnull: i32 = r.try_get("notnull").unwrap_or(0);
                let dflt_value: Option<String> = r.try_get("dflt_value").ok();
                TableColumn {
                    name: r.try_get("name").unwrap_or_default(),
                    data_type: r.try_get("type").unwrap_or_default(),
                    is_pk: pk > 0,
                    is_nullable: notnull == 0,
                    is_auto_increment: false, // SQLite doesn't expose this via table_info easily, typically AUTOINCREMENT on INTEGER PRIMARY KEY
                    default_value: dflt_value,
                    character_maximum_length: None,
                }
            })
            .collect();

        result.insert(table_name.clone(), columns);
    }

    Ok(result)
}

// Batch function: Get all foreign keys for all tables (SQLite must iterate but reuses connection)
pub async fn get_all_foreign_keys_batch(
    params: &ConnectionParams,
    table_names: &[String],
) -> Result<std::collections::HashMap<String, Vec<ForeignKey>>, String> {
    use std::collections::HashMap;
    let pool = get_sqlite_pool(params).await?;
    let mut result: HashMap<String, Vec<ForeignKey>> = HashMap::new();

    for table_name in table_names {
        let query = format!("PRAGMA foreign_key_list('{}')", table_name);
        let rows = sqlx::query(&query)
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

        let fks: Vec<ForeignKey> = rows
            .iter()
            .map(|r| {
                let id: i32 = r.try_get("id").unwrap_or(0);
                ForeignKey {
                    name: format!(
                        "fk_{}_{}",
                        id,
                        r.try_get::<String, _>("table").unwrap_or_default()
                    ),
                    column_name: r.try_get("from").unwrap_or_default(),
                    ref_table: r.try_get("table").unwrap_or_default(),
                    ref_column: r.try_get("to").unwrap_or_default(),
                    on_update: r.try_get("on_update").ok(),
                    on_delete: r.try_get("on_delete").ok(),
                }
            })
            .collect();

        result.insert(table_name.clone(), fks);
    }

    Ok(result)
}

pub async fn get_indexes(
    params: &ConnectionParams,
    table_name: &str,
) -> Result<Vec<Index>, String> {
    let pool = get_sqlite_pool(params).await?;

    let list_query = format!("PRAGMA index_list('{}')", table_name);
    let indexes = sqlx::query(&list_query)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();

    for idx_row in indexes {
        let name: String = idx_row.try_get("name").unwrap_or_default();
        let unique: i32 = idx_row.try_get("unique").unwrap_or(0);
        let origin: String = idx_row.try_get("origin").unwrap_or_default(); // pk for primary key

        let info_query = format!("PRAGMA index_info('{}')", name);
        let info_rows = sqlx::query(&info_query)
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

        for info in info_rows {
            result.push(Index {
                name: name.clone(),
                column_name: info.try_get("name").unwrap_or_default(),
                is_unique: unique > 0,
                is_primary: origin == "pk",
                seq_in_index: info.try_get::<i32, _>("seqno").unwrap_or(0),
            });
        }
    }

    Ok(result)
}

pub async fn save_blob_column_to_file(
    params: &ConnectionParams,
    table: &str,
    col_name: &str,
    pk_col: &str,
    pk_val: serde_json::Value,
    file_path: &str,
) -> Result<(), String> {
    let pool = get_sqlite_pool(params).await?;

    let query = format!(
        "SELECT \"{}\" FROM \"{}\" WHERE \"{}\" = ?",
        col_name, table, pk_col
    );

    let row = match pk_val {
        serde_json::Value::Number(n) => {
            if n.is_i64() {
                sqlx::query(&query).bind(n.as_i64()).fetch_one(&pool).await
            } else {
                sqlx::query(&query).bind(n.as_f64()).fetch_one(&pool).await
            }
        }
        serde_json::Value::String(s) => sqlx::query(&query).bind(s).fetch_one(&pool).await,
        _ => return Err("Unsupported PK type".into()),
    }
    .map_err(|e| e.to_string())?;

    let bytes: Vec<u8> = row.try_get(0).map_err(|e| e.to_string())?;
    std::fs::write(file_path, bytes).map_err(|e| e.to_string())
}

pub async fn fetch_blob_column_as_data_url(
    params: &ConnectionParams,
    table: &str,
    col_name: &str,
    pk_col: &str,
    pk_val: serde_json::Value,
) -> Result<String, String> {
    let pool = get_sqlite_pool(params).await?;

    let query = format!(
        "SELECT \"{}\" FROM \"{}\" WHERE \"{}\" = ?",
        col_name, table, pk_col
    );

    let row = match pk_val {
        serde_json::Value::Number(n) => {
            if n.is_i64() {
                sqlx::query(&query).bind(n.as_i64()).fetch_one(&pool).await
            } else {
                sqlx::query(&query).bind(n.as_f64()).fetch_one(&pool).await
            }
        }
        serde_json::Value::String(s) => sqlx::query(&query).bind(s).fetch_one(&pool).await,
        _ => return Err("Unsupported PK type".into()),
    }
    .map_err(|e| e.to_string())?;

    let bytes: Vec<u8> = row.try_get(0).map_err(|e| e.to_string())?;
    Ok(crate::drivers::common::encode_blob_full(&bytes))
}

pub async fn delete_record(
    params: &ConnectionParams,
    table: &str,
    pk_col: &str,
    pk_val: serde_json::Value,
) -> Result<u64, String> {
    let pool = get_sqlite_pool(params).await?;

    let query = format!("DELETE FROM \"{}\" WHERE \"{}\" = ?", table, pk_col);

    let result = match pk_val {
        serde_json::Value::Number(n) => {
            if n.is_i64() {
                sqlx::query(&query).bind(n.as_i64()).execute(&pool).await
            } else {
                sqlx::query(&query).bind(n.as_f64()).execute(&pool).await
            }
        }
        serde_json::Value::String(s) => sqlx::query(&query).bind(s).execute(&pool).await,
        _ => return Err("Unsupported PK type".into()),
    };

    result.map(|r| r.rows_affected()).map_err(|e| e.to_string())
}

pub async fn update_record(
    params: &ConnectionParams,
    table: &str,
    pk_col: &str,
    pk_val: serde_json::Value,
    col_name: &str,
    new_val: serde_json::Value,
    max_blob_size: u64,
) -> Result<u64, String> {
    let pool = get_sqlite_pool(params).await?;

    let mut qb = sqlx::QueryBuilder::new(format!("UPDATE \"{}\" SET \"{}\" = ", table, col_name));

    match new_val {
        serde_json::Value::Number(n) => {
            if n.is_i64() {
                qb.push_bind(n.as_i64());
            } else {
                qb.push_bind(n.as_f64());
            }
        }
        serde_json::Value::String(s) => {
            // Check for special sentinel value to use DEFAULT
            if s == "__USE_DEFAULT__" {
                qb.push("DEFAULT");
            } else if let Some(bytes) =
                crate::drivers::common::decode_blob_wire_format(&s, max_blob_size)
            {
                // Blob wire format: decode to raw bytes so the DB stores binary data,
                // not the internal wire format string.
                qb.push_bind(bytes);
            } else {
                qb.push_bind(s);
            }
        }
        serde_json::Value::Bool(b) => {
            qb.push_bind(b);
        }
        serde_json::Value::Null => {
            qb.push("NULL");
        }
        _ => return Err("Unsupported Value type".into()),
    }

    qb.push(format!(" WHERE \"{}\" = ", pk_col));

    match pk_val {
        serde_json::Value::Number(n) => {
            if n.is_i64() {
                qb.push_bind(n.as_i64());
            } else {
                qb.push_bind(n.as_f64());
            }
        }
        serde_json::Value::String(s) => {
            qb.push_bind(s);
        }
        _ => return Err("Unsupported PK type".into()),
    }

    let query = qb.build();
    let result = query.execute(&pool).await.map_err(|e| e.to_string())?;
    Ok(result.rows_affected())
}

pub async fn insert_record(
    params: &ConnectionParams,
    table: &str,
    data: std::collections::HashMap<String, serde_json::Value>,
    max_blob_size: u64,
) -> Result<u64, String> {
    let pool = get_sqlite_pool(params).await?;

    let mut cols = Vec::new();
    let mut vals = Vec::new();

    for (k, v) in data {
        cols.push(format!("\"{}\"", k));
        vals.push(v);
    }

    // Allow empty inserts for auto-generated values (e.g., auto-increment PKs)
    let mut qb = if cols.is_empty() {
        sqlx::QueryBuilder::new(format!("INSERT INTO \"{}\" DEFAULT VALUES", table))
    } else {
        let mut qb = sqlx::QueryBuilder::new(format!(
            "INSERT INTO \"{}\" ({}) VALUES (",
            table,
            cols.join(", ")
        ));

        let mut separated = qb.separated(", ");
        for val in vals {
            match val {
                serde_json::Value::Number(n) => {
                    if n.is_i64() {
                        separated.push_bind(n.as_i64());
                    } else {
                        separated.push_bind(n.as_f64());
                    }
                }
                serde_json::Value::String(s) => {
                    if let Some(bytes) =
                        crate::drivers::common::decode_blob_wire_format(&s, max_blob_size)
                    {
                        // Blob wire format: decode to raw bytes so the DB stores binary data.
                        separated.push_bind(bytes);
                    } else {
                        separated.push_bind(s);
                    }
                }
                serde_json::Value::Bool(b) => {
                    separated.push_bind(b);
                }
                serde_json::Value::Null => {
                    separated.push("NULL");
                }
                _ => return Err("Unsupported value type".into()),
            }
        }
        separated.push_unseparated(")");
        qb
    };

    let query = qb.build();
    let result = query.execute(&pool).await.map_err(|e| e.to_string())?;
    Ok(result.rows_affected())
}

/// Extracts ORDER BY clause from a SQL query (case-insensitive)
fn extract_order_by(query: &str) -> String {
    let query_upper = query.to_uppercase();
    if let Some(pos) = query_upper.rfind("ORDER BY") {
        // Return the ORDER BY clause from the original query (preserving case)
        query[pos..].trim().to_string()
    } else {
        String::new()
    }
}

/// Removes ORDER BY clause from a SQL query
fn remove_order_by(query: &str) -> String {
    let query_upper = query.to_uppercase();
    if let Some(pos) = query_upper.rfind("ORDER BY") {
        query[..pos].trim().to_string()
    } else {
        query.to_string()
    }
}

pub async fn get_table_ddl(params: &ConnectionParams, table_name: &str) -> Result<String, String> {
    let pool = get_sqlite_pool(params).await?;
    let query = "SELECT sql FROM sqlite_master WHERE type='table' AND name = ?";
    let row: (String,) = sqlx::query_as(query)
        .bind(table_name)
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(format!("{};", row.0))
}

pub async fn execute_query(
    params: &ConnectionParams,
    query: &str,
    limit: Option<u32>,
    page: u32,
) -> Result<QueryResult, String> {
    let pool = get_sqlite_pool(params).await?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let is_select = query.trim_start().to_uppercase().starts_with("SELECT");
    let mut pagination: Option<Pagination> = None;
    let final_query: String;
    let mut manual_limit = limit;

    if is_select && limit.is_some() {
        let l = limit.unwrap();
        let offset = (page - 1) * l;

        // Use LIMIT +1 trick to detect has_more without a COUNT query
        let order_by_clause = extract_order_by(query);

        if !order_by_clause.is_empty() {
            let query_without_order = remove_order_by(query);
            final_query = format!(
                "SELECT * FROM ({}) {} LIMIT {} OFFSET {}",
                query_without_order, order_by_clause, l + 1, offset
            );
        } else {
            final_query = format!("SELECT * FROM ({}) LIMIT {} OFFSET {}", query, l + 1, offset);
        }

        pagination = Some(Pagination {
            page,
            page_size: l,
            total_rows: None,
            has_more: false, // will be updated after streaming
        });

        manual_limit = None;
    } else {
        final_query = query.to_string();
    }

    // Streaming
    let mut rows_stream = sqlx::query(&final_query).fetch(&mut *conn);

    let mut columns: Vec<String> = Vec::new();
    let mut json_rows = Vec::new();
    let mut truncated = false;

    use futures::stream::StreamExt;

    while let Some(result) = rows_stream.next().await {
        match result {
            Ok(row) => {
                if columns.is_empty() {
                    columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                }

                if let Some(l) = manual_limit {
                    if json_rows.len() >= l as usize {
                        truncated = true;
                        break;
                    }
                }

                let mut json_row = Vec::new();
                for (i, _) in row.columns().iter().enumerate() {
                    let val = extract_value(&row, i, None);
                    json_row.push(val);
                }
                json_rows.push(json_row);
            }
            Err(e) => return Err(e.to_string()),
        }
    }

    // Apply LIMIT +1 result: if we got page_size+1 rows, has_more=true
    if let Some(ref mut p) = pagination {
        let has_more = json_rows.len() > p.page_size as usize;
        if has_more {
            json_rows.truncate(p.page_size as usize);
        }
        p.has_more = has_more;
        truncated = has_more;
    }

    Ok(QueryResult {
        columns,
        rows: json_rows,
        affected_rows: 0,
        truncated,
        pagination,
    })
}

pub async fn get_views(params: &ConnectionParams) -> Result<Vec<ViewInfo>, String> {
    log::debug!("SQLite: Fetching views for database: {}", params.database);
    let pool = get_sqlite_pool(params).await?;
    let rows = sqlx::query("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name ASC")
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let views: Vec<ViewInfo> = rows
        .iter()
        .map(|r| ViewInfo {
            name: r.try_get("name").unwrap_or_default(),
            definition: None,
        })
        .collect();
    log::debug!("SQLite: Found {} views in {}", views.len(), params.database);
    Ok(views)
}

pub async fn get_view_definition(
    params: &ConnectionParams,
    view_name: &str,
) -> Result<String, String> {
    let pool = get_sqlite_pool(params).await?;
    let query = "SELECT sql FROM sqlite_master WHERE type='view' AND name = ?";
    let row = sqlx::query(query)
        .bind(view_name)
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("Failed to get view definition: {}", e))?;

    let definition: String = row.try_get("sql").unwrap_or_default();
    Ok(definition)
}

pub async fn create_view(
    params: &ConnectionParams,
    view_name: &str,
    definition: &str,
) -> Result<(), String> {
    let pool = get_sqlite_pool(params).await?;
    let escaped_name = escape_identifier(view_name);
    let query = format!("CREATE VIEW \"{}\" AS {}", escaped_name, definition);
    sqlx::query(&query)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create view: {}", e))?;
    Ok(())
}

pub async fn alter_view(
    params: &ConnectionParams,
    view_name: &str,
    definition: &str,
) -> Result<(), String> {
    let pool = get_sqlite_pool(params).await?;
    // SQLite does not support ALTER VIEW, so we must drop and recreate
    let escaped_name = escape_identifier(view_name);
    let drop_query = format!("DROP VIEW IF EXISTS \"{}\"", escaped_name);
    sqlx::query(&drop_query)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to drop view: {}", e))?;

    let create_query = format!("CREATE VIEW \"{}\" AS {}", escaped_name, definition);
    sqlx::query(&create_query)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create view: {}", e))?;

    Ok(())
}

pub async fn drop_view(params: &ConnectionParams, view_name: &str) -> Result<(), String> {
    let pool = get_sqlite_pool(params).await?;
    let escaped_name = escape_identifier(view_name);
    let query = format!("DROP VIEW IF EXISTS \"{}\"", escaped_name);
    sqlx::query(&query)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to drop view: {}", e))?;
    Ok(())
}

pub async fn get_view_columns(
    params: &ConnectionParams,
    view_name: &str,
) -> Result<Vec<TableColumn>, String> {
    let pool = get_sqlite_pool(params).await?;

    let query = format!("PRAGMA table_info('{}')", view_name);

    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| {
            let pk: i32 = r.try_get("pk").unwrap_or(0);
            let notnull: i32 = r.try_get("notnull").unwrap_or(0);
            let dflt_value: Option<String> = r.try_get("dflt_value").ok();
            TableColumn {
                name: r.try_get("name").unwrap_or_default(),
                data_type: r.try_get("type").unwrap_or_default(),
                is_pk: pk > 0,
                is_nullable: notnull == 0,
                is_auto_increment: false,
                default_value: dflt_value,
                character_maximum_length: None,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ConnectionParams, DatabaseSelection};
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use tempfile::NamedTempFile;

    async fn setup_test_db() -> (ConnectionParams, NamedTempFile) {
        let file = NamedTempFile::new().expect("Failed to create temp file");
        let path = file.path().to_str().unwrap().to_string();

        let params = ConnectionParams {
            driver: "sqlite".to_string(),
            database: DatabaseSelection::Single(path.clone()),
            host: None,
            port: None,
            username: None,
            password: None,
            ssl_mode: None,
            ssh_enabled: None,
            ssh_connection_id: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_password: None,
            ssh_key_file: None,
            ssh_key_passphrase: None,
            save_in_keychain: None,
            connection_id: None,
        };

        // Initialize DB with a table
        // Use .filename() to handle Windows paths correctly (avoids backslash issues in URLs)
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true);

        let pool = SqlitePoolOptions::new()
            .connect_with(options)
            .await
            .expect("Failed to connect to test DB");

        sqlx::query("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)")
            .execute(&pool)
            .await
            .expect("Failed to create table");

        sqlx::query("INSERT INTO users (name) VALUES ('Alice'), ('Bob')")
            .execute(&pool)
            .await
            .expect("Failed to insert data");

        // Close this pool so the file isn't locked (though SQLite handles concurrent reads usually)
        pool.close().await;

        // We return the file handle too so it doesn't get deleted until the test ends
        (params, file)
    }

    #[tokio::test]
    async fn test_view_lifecycle() {
        let (params, _file) = setup_test_db().await;

        // 1. Create View
        let view_name = "view_users";
        // Note: SQLite view definitions are stored as written
        let definition = "SELECT name FROM users";
        create_view(&params, view_name, definition)
            .await
            .expect("Failed to create view");

        // 2. Get Views
        let views = get_views(&params).await.expect("Failed to get views");
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].name, view_name);

        // 3. Get View Definition
        let def = get_view_definition(&params, view_name)
            .await
            .expect("Failed to get definition");
        // SQLite stores the full "CREATE VIEW ..." statement in 'sql' column usually,
        // OR just the definition depending on normalization.
        // The get_view_definition implementation returns 'sql' column from sqlite_master.
        // It usually is "CREATE VIEW view_users AS SELECT name FROM users"
        assert!(def.to_uppercase().contains("CREATE VIEW"));
        assert!(def.to_uppercase().contains("SELECT NAME FROM USERS"));

        // 4. Get View Columns
        let cols = get_view_columns(&params, view_name)
            .await
            .expect("Failed to get columns");
        assert_eq!(cols.len(), 1);
        assert_eq!(cols[0].name, "name");

        // 5. Alter View (Drop & Recreate)
        let new_def = "SELECT id, name FROM users";
        alter_view(&params, view_name, new_def)
            .await
            .expect("Failed to alter view");

        let cols_after = get_view_columns(&params, view_name)
            .await
            .expect("Failed to get columns after alter");
        assert_eq!(cols_after.len(), 2);

        // 6. Drop View
        drop_view(&params, view_name)
            .await
            .expect("Failed to drop view");
        let views_final = get_views(&params).await.expect("Failed to get views final");
        assert_eq!(views_final.len(), 0);

        // Cleanup: Close the pool created by the functions (via pool_manager)
        crate::pool_manager::close_pool(&params).await;
    }
}

// ============================================================
// Plugin wrapper
// ============================================================

use crate::drivers::driver_trait::{DatabaseDriver, DriverCapabilities, PluginManifest};
use async_trait::async_trait;
use std::collections::HashMap;

pub struct SqliteDriver {
    manifest: PluginManifest,
}

impl SqliteDriver {
    pub fn new() -> Self {
        Self {
            manifest: PluginManifest {
                id: "sqlite".to_string(),
                name: "SQLite".to_string(),
                version: "1.0.0".to_string(),
                description: "SQLite file-based databases".to_string(),
                default_port: None,
                capabilities: DriverCapabilities {
                    schemas: false,
                    views: true,
                    routines: false,
                    file_based: true,
                    folder_based: false,
                    connection_string: false,
                    connection_string_example: String::new(),
                    identifier_quote: "\"".into(),
                    alter_primary_key: true,
                    auto_increment_keyword: "AUTOINCREMENT".into(),
                    serial_type: String::new(),
                    inline_pk: true,
                    alter_column: false,
                    create_foreign_keys: false,
                    no_connection_required: false,
                },
                is_builtin: true,
                default_username: String::new(),
                color: "#06b6d4".to_string(),
                icon: "sqlite".to_string(),
                settings: vec![],
            },
        }
    }
}

#[async_trait]
impl DatabaseDriver for SqliteDriver {
    fn manifest(&self) -> &PluginManifest { &self.manifest }

    fn get_data_types(&self) -> Vec<crate::models::DataTypeInfo> {
        types::get_data_types()
    }

    fn build_connection_url(&self, params: &crate::models::ConnectionParams) -> Result<String, String> {
        // Normalize path separators for URL format (Windows backslashes → forward slashes)
        let path = params.database.to_string().replace('\\', "/");
        // Windows absolute paths (e.g. C:/path/file) need sqlite:///C:/... (3 slashes = empty authority + abs path)
        // Unix absolute paths already start with / so sqlite:// + /path = sqlite:///path
        if path.len() >= 2 && path.chars().nth(1) == Some(':') {
            Ok(format!("sqlite:///{}", path))
        } else {
            Ok(format!("sqlite://{}", path))
        }
    }

    async fn test_connection(&self, params: &crate::models::ConnectionParams) -> Result<(), String> {
        // Use pool manager directly to avoid URL formatting issues with Windows paths
        crate::pool_manager::get_sqlite_pool(params).await?;
        Ok(())
    }

    async fn get_databases(&self, params: &crate::models::ConnectionParams) -> Result<Vec<String>, String> {
        get_databases(params).await
    }

    async fn get_schemas(&self, params: &crate::models::ConnectionParams) -> Result<Vec<String>, String> {
        get_schemas(params).await
    }

    async fn get_tables(&self, params: &crate::models::ConnectionParams, _schema: Option<&str>) -> Result<Vec<crate::models::TableInfo>, String> {
        get_tables(params).await
    }

    async fn get_columns(&self, params: &crate::models::ConnectionParams, table: &str, _schema: Option<&str>) -> Result<Vec<crate::models::TableColumn>, String> {
        get_columns(params, table).await
    }

    async fn get_foreign_keys(&self, params: &crate::models::ConnectionParams, table: &str, _schema: Option<&str>) -> Result<Vec<crate::models::ForeignKey>, String> {
        get_foreign_keys(params, table).await
    }

    async fn get_indexes(&self, params: &crate::models::ConnectionParams, table: &str, _schema: Option<&str>) -> Result<Vec<crate::models::Index>, String> {
        get_indexes(params, table).await
    }

    async fn get_views(&self, params: &crate::models::ConnectionParams, _schema: Option<&str>) -> Result<Vec<crate::models::ViewInfo>, String> {
        get_views(params).await
    }

    async fn get_view_definition(&self, params: &crate::models::ConnectionParams, view_name: &str, _schema: Option<&str>) -> Result<String, String> {
        get_view_definition(params, view_name).await
    }

    async fn get_view_columns(&self, params: &crate::models::ConnectionParams, view_name: &str, _schema: Option<&str>) -> Result<Vec<crate::models::TableColumn>, String> {
        get_view_columns(params, view_name).await
    }

    async fn create_view(&self, params: &crate::models::ConnectionParams, view_name: &str, definition: &str, _schema: Option<&str>) -> Result<(), String> {
        create_view(params, view_name, definition).await
    }

    async fn alter_view(&self, params: &crate::models::ConnectionParams, view_name: &str, definition: &str, _schema: Option<&str>) -> Result<(), String> {
        alter_view(params, view_name, definition).await
    }

    async fn drop_view(&self, params: &crate::models::ConnectionParams, view_name: &str, _schema: Option<&str>) -> Result<(), String> {
        drop_view(params, view_name).await
    }

    async fn get_routines(&self, params: &crate::models::ConnectionParams, _schema: Option<&str>) -> Result<Vec<crate::models::RoutineInfo>, String> {
        get_routines(params).await
    }

    async fn get_routine_parameters(&self, params: &crate::models::ConnectionParams, routine_name: &str, _schema: Option<&str>) -> Result<Vec<crate::models::RoutineParameter>, String> {
        get_routine_parameters(params, routine_name).await
    }

    async fn get_routine_definition(&self, params: &crate::models::ConnectionParams, routine_name: &str, routine_type: &str, _schema: Option<&str>) -> Result<String, String> {
        get_routine_definition(params, routine_name, routine_type).await
    }

    async fn execute_query(&self, params: &crate::models::ConnectionParams, query: &str, limit: Option<u32>, page: u32, _schema: Option<&str>) -> Result<crate::models::QueryResult, String> {
        execute_query(params, query, limit, page).await
    }

    async fn insert_record(&self, params: &crate::models::ConnectionParams, table: &str, data: std::collections::HashMap<String, serde_json::Value>, _schema: Option<&str>, max_blob_size: u64) -> Result<u64, String> {
        insert_record(params, table, data, max_blob_size).await
    }

    async fn update_record(&self, params: &crate::models::ConnectionParams, table: &str, pk_col: &str, pk_val: serde_json::Value, col_name: &str, new_val: serde_json::Value, _schema: Option<&str>, max_blob_size: u64) -> Result<u64, String> {
        update_record(params, table, pk_col, pk_val, col_name, new_val, max_blob_size).await
    }

    async fn delete_record(&self, params: &crate::models::ConnectionParams, table: &str, pk_col: &str, pk_val: serde_json::Value, _schema: Option<&str>) -> Result<u64, String> {
        delete_record(params, table, pk_col, pk_val).await
    }

    async fn save_blob_to_file(&self, params: &crate::models::ConnectionParams, table: &str, col_name: &str, pk_col: &str, pk_val: serde_json::Value, _schema: Option<&str>, file_path: &str) -> Result<(), String> {
        save_blob_column_to_file(params, table, col_name, pk_col, pk_val, file_path).await
    }

    async fn fetch_blob_as_data_url(&self, params: &crate::models::ConnectionParams, table: &str, col_name: &str, pk_col: &str, pk_val: serde_json::Value, _schema: Option<&str>) -> Result<String, String> {
        fetch_blob_column_as_data_url(params, table, col_name, pk_col, pk_val).await
    }

    async fn get_create_table_sql(
        &self,
        table_name: &str,
        columns: Vec<crate::models::ColumnDefinition>,
        _schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let mut col_defs = Vec::new();
        let mut pk_cols = Vec::new();
        let single_pk = columns.iter().filter(|c| c.is_pk).count() == 1;
        for col in &columns {
            let mut def = format!("\"{}\" {}", col.name.replace('"', "\"\""), col.data_type);
            if col.is_pk && single_pk {
                def.push_str(" PRIMARY KEY");
                if col.is_auto_increment {
                    def.push_str(" AUTOINCREMENT");
                }
            }
            if !col.is_nullable && !(col.is_pk && single_pk) {
                def.push_str(" NOT NULL");
            }
            if let Some(default) = &col.default_value {
                def.push_str(&format!(" DEFAULT {}", default));
            }
            col_defs.push(def);
            if col.is_pk && !single_pk {
                pk_cols.push(format!("\"{}\"", col.name.replace('"', "\"\"")));
            }
        }
        if !pk_cols.is_empty() {
            col_defs.push(format!("PRIMARY KEY ({})", pk_cols.join(", ")));
        }
        Ok(vec![format!(
            "CREATE TABLE \"{}\" (\n  {}\n)",
            table_name.replace('"', "\"\""),
            col_defs.join(",\n  ")
        )])
    }

    async fn get_add_column_sql(
        &self,
        table: &str,
        column: crate::models::ColumnDefinition,
        _schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let mut def = format!(
            "ALTER TABLE \"{}\" ADD COLUMN \"{}\" {}",
            table.replace('"', "\"\""),
            column.name.replace('"', "\"\""),
            column.data_type
        );
        if !column.is_nullable {
            def.push_str(" NOT NULL");
        }
        if let Some(default) = &column.default_value {
            def.push_str(&format!(" DEFAULT {}", default));
        }
        Ok(vec![def])
    }

    async fn get_alter_column_sql(
        &self,
        table: &str,
        old_column: crate::models::ColumnDefinition,
        new_column: crate::models::ColumnDefinition,
        _schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        if old_column.name != new_column.name {
            return Ok(vec![format!(
                "ALTER TABLE \"{}\" RENAME COLUMN \"{}\" TO \"{}\"",
                table.replace('"', "\"\""),
                old_column.name.replace('"', "\"\""),
                new_column.name.replace('"', "\"\"")
            )]);
        }
        Err("SQLite only supports renaming columns. Other column modifications require recreating the table.".into())
    }

    async fn get_create_index_sql(
        &self,
        table: &str,
        index_name: &str,
        columns: Vec<String>,
        is_unique: bool,
        _schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let unique = if is_unique { "UNIQUE " } else { "" };
        let cols: Vec<String> = columns
            .iter()
            .map(|c| format!("\"{}\"", c.replace('"', "\"\"")))
            .collect();
        Ok(vec![format!(
            "CREATE {}INDEX \"{}\" ON \"{}\" ({})",
            unique,
            index_name.replace('"', "\"\""),
            table.replace('"', "\"\""),
            cols.join(", ")
        )])
    }

    async fn get_create_foreign_key_sql(
        &self,
        _table: &str,
        _fk_name: &str,
        _column: &str,
        _ref_table: &str,
        _ref_column: &str,
        _on_delete: Option<&str>,
        _on_update: Option<&str>,
        _schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        Err("SQLite does not support adding foreign keys to existing tables. Foreign keys must be defined at table creation time.".into())
    }

    async fn drop_index(
        &self,
        params: &crate::models::ConnectionParams,
        _table: &str,
        index_name: &str,
        _schema: Option<&str>,
    ) -> Result<(), String> {
        let sql = format!("DROP INDEX \"{}\"", index_name.replace('"', "\"\""));
        execute_query(params, &sql, None, 1).await?;
        Ok(())
    }

    async fn drop_foreign_key(
        &self,
        _params: &crate::models::ConnectionParams,
        _table: &str,
        _fk_name: &str,
        _schema: Option<&str>,
    ) -> Result<(), String> {
        Err("SQLite does not support dropping foreign keys".into())
    }

    async fn get_all_columns_batch(&self, params: &crate::models::ConnectionParams, _schema: Option<&str>) -> Result<HashMap<String, Vec<crate::models::TableColumn>>, String> {
        let tables = get_tables(params).await?;
        let names: Vec<String> = tables.into_iter().map(|t| t.name).collect();
        get_all_columns_batch(params, &names).await
    }

    async fn get_all_foreign_keys_batch(&self, params: &crate::models::ConnectionParams, _schema: Option<&str>) -> Result<HashMap<String, Vec<crate::models::ForeignKey>>, String> {
        let tables = get_tables(params).await?;
        let names: Vec<String> = tables.into_iter().map(|t| t.name).collect();
        get_all_foreign_keys_batch(params, &names).await
    }

    async fn get_schema_snapshot(&self, params: &crate::models::ConnectionParams, _schema: Option<&str>) -> Result<Vec<crate::models::TableSchema>, String> {
        let tables = get_tables(params).await?;
        let names: Vec<String> = tables.iter().map(|t| t.name.clone()).collect();
        let mut columns_map = get_all_columns_batch(params, &names).await?;
        let mut fks_map = get_all_foreign_keys_batch(params, &names).await?;
        Ok(tables.into_iter().map(|t| crate::models::TableSchema {
            name: t.name.clone(),
            columns: columns_map.remove(&t.name).unwrap_or_default(),
            foreign_keys: fks_map.remove(&t.name).unwrap_or_default(),
        }).collect())
    }
}
