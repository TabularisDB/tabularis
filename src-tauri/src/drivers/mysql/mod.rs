pub mod extract;
pub mod types;

use crate::models::{
    ConnectionParams, ForeignKey, Index, Pagination, QueryResult, RoutineInfo, RoutineParameter,
    TableColumn, TableInfo, ViewInfo,
};
use crate::pool_manager::get_mysql_pool;
use extract::extract_value;
use sqlx::{Column, Row};

// Helper function to escape backticks in identifiers for MySQL
fn escape_identifier(name: &str) -> String {
    name.replace('`', "``")
}

/// Read a string from a MySQL row by index.
/// MySQL 8 information_schema returns VARBINARY/BLOB instead of VARCHAR,
/// so try_get::<String> fails silently. This falls back to reading raw bytes.
fn mysql_row_str(row: &sqlx::mysql::MySqlRow, idx: usize) -> String {
    row.try_get::<String, _>(idx).unwrap_or_else(|_| {
        row.try_get::<Vec<u8>, _>(idx)
            .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
            .unwrap_or_default()
    })
}

/// Optional string variant of mysql_row_str.
fn mysql_row_str_opt(row: &sqlx::mysql::MySqlRow, idx: usize) -> Option<String> {
    match row.try_get::<Option<String>, _>(idx) {
        Ok(val) => val,
        Err(_) => row
            .try_get::<Option<Vec<u8>>, _>(idx)
            .ok()
            .flatten()
            .map(|bytes| String::from_utf8_lossy(&bytes).to_string()),
    }
}

pub async fn get_schemas(_params: &ConnectionParams) -> Result<Vec<String>, String> {
    Ok(vec![])
}

pub async fn get_databases(params: &ConnectionParams) -> Result<Vec<String>, String> {
    let pool = get_mysql_pool(params).await?;
    let rows = sqlx::query("SHOW DATABASES")
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(|r| mysql_row_str(r, 0)).collect())
}

pub async fn get_tables(params: &ConnectionParams, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    log::debug!("MySQL: Fetching tables for database: {}", db_name);
    let pool = get_mysql_pool(params).await?;
    let rows = sqlx::query(
        "SELECT table_name as name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name ASC",
    )
    .bind(db_name)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    let tables: Vec<TableInfo> = rows
        .iter()
        .map(|r| TableInfo {
            name: mysql_row_str(r, 0),
        })
        .collect();
    log::debug!(
        "MySQL: Found {} tables in {}",
        tables.len(),
        db_name
    );
    Ok(tables)
}

pub async fn get_columns(
    params: &ConnectionParams,
    table_name: &str,
    schema: Option<&str>,
) -> Result<Vec<TableColumn>, String> {
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    let pool = get_mysql_pool(params).await?;

    let query = r#"
        SELECT column_name, data_type, column_key, is_nullable, extra, column_default, character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = ? AND table_name = ?
        ORDER BY ordinal_position
    "#;

    let rows = sqlx::query(query)
        .bind(db_name)
        .bind(table_name)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| {
            let column_name = mysql_row_str(r, 0);
            let data_type = mysql_row_str(r, 1);
            let key = mysql_row_str(r, 2);
            let null_str = mysql_row_str(r, 3);
            let extra = mysql_row_str(r, 4);
            let default_val = mysql_row_str_opt(r, 5);
            let character_maximum_length: Option<u64> = r.try_get(6).ok();

            let is_auto_increment = extra.contains("auto_increment");

            let default_value = if !is_auto_increment {
                match default_val {
                    Some(val) if !val.is_empty() && !val.eq_ignore_ascii_case("null") => Some(val),
                    _ => None,
                }
            } else {
                None
            };

            TableColumn {
                name: column_name,
                data_type,
                is_pk: key == "PRI",
                is_nullable: null_str == "YES",
                is_auto_increment,
                default_value,
                character_maximum_length,
            }
        })
        .collect())
}

pub async fn get_foreign_keys(
    params: &ConnectionParams,
    table_name: &str,
    schema: Option<&str>,
) -> Result<Vec<ForeignKey>, String> {
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    let pool = get_mysql_pool(params).await?;

    let query = r#"
        SELECT
            kcu.CONSTRAINT_NAME,
            kcu.COLUMN_NAME,
            kcu.REFERENCED_TABLE_NAME,
            kcu.REFERENCED_COLUMN_NAME,
            rc.UPDATE_RULE,
            rc.DELETE_RULE
        FROM information_schema.KEY_COLUMN_USAGE kcu
        JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
        ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
        AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
        WHERE kcu.TABLE_SCHEMA = ?
        AND kcu.TABLE_NAME = ?
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
    "#;

    let rows = sqlx::query(query)
        .bind(db_name)
        .bind(table_name)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| ForeignKey {
            name: mysql_row_str(r, 0),
            column_name: mysql_row_str(r, 1),
            ref_table: mysql_row_str(r, 2),
            ref_column: mysql_row_str(r, 3),
            on_update: mysql_row_str_opt(r, 4),
            on_delete: mysql_row_str_opt(r, 5),
        })
        .collect())
}

// Batch function: Get all columns for all tables in one query
pub async fn get_all_columns_batch(
    params: &ConnectionParams,
    schema: Option<&str>,
) -> Result<std::collections::HashMap<String, Vec<TableColumn>>, String> {
    use std::collections::HashMap;
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    let pool = get_mysql_pool(params).await?;

    let query = r#"
        SELECT table_name, column_name, data_type, column_key, is_nullable, extra, column_default, character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = ?
        ORDER BY table_name, ordinal_position
    "#;

    let rows = sqlx::query(query)
        .bind(db_name)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut result: HashMap<String, Vec<TableColumn>> = HashMap::new();

    for row in &rows {
        let table_name = mysql_row_str(row, 0);
        let column_name = mysql_row_str(row, 1);
        let data_type = mysql_row_str(row, 2);
        let key = mysql_row_str(row, 3);
        let null_str = mysql_row_str(row, 4);
        let extra = mysql_row_str(row, 5);
        let default_val = mysql_row_str_opt(row, 6);
        let character_maximum_length: Option<u64> = row.try_get(7).ok();

        let is_auto_increment = extra.contains("auto_increment");

        let default_value = if !is_auto_increment {
            match default_val {
                Some(val) if !val.is_empty() && !val.eq_ignore_ascii_case("null") => Some(val),
                _ => None,
            }
        } else {
            None
        };

        let column = TableColumn {
            name: column_name,
            data_type,
            is_pk: key == "PRI",
            is_nullable: null_str == "YES",
            is_auto_increment,
            default_value,
            character_maximum_length,
        };

        result
            .entry(table_name)
            .or_insert_with(Vec::new)
            .push(column);
    }

    Ok(result)
}

// Batch function: Get all foreign keys for all tables in one query
pub async fn get_all_foreign_keys_batch(
    params: &ConnectionParams,
    schema: Option<&str>,
) -> Result<std::collections::HashMap<String, Vec<ForeignKey>>, String> {
    use std::collections::HashMap;
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    let pool = get_mysql_pool(params).await?;

    let query = r#"
        SELECT
            kcu.TABLE_NAME,
            kcu.CONSTRAINT_NAME,
            kcu.COLUMN_NAME,
            kcu.REFERENCED_TABLE_NAME,
            kcu.REFERENCED_COLUMN_NAME,
            rc.UPDATE_RULE,
            rc.DELETE_RULE
        FROM information_schema.KEY_COLUMN_USAGE kcu
        JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
        ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
        AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
        WHERE kcu.TABLE_SCHEMA = ?
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
    "#;

    let rows = sqlx::query(query)
        .bind(db_name)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut result: HashMap<String, Vec<ForeignKey>> = HashMap::new();

    for row in &rows {
        let table_name = mysql_row_str(row, 0);

        let fk = ForeignKey {
            name: mysql_row_str(row, 1),
            column_name: mysql_row_str(row, 2),
            ref_table: mysql_row_str(row, 3),
            ref_column: mysql_row_str(row, 4),
            on_update: mysql_row_str_opt(row, 5),
            on_delete: mysql_row_str_opt(row, 6),
        };

        result.entry(table_name).or_insert_with(Vec::new).push(fk);
    }

    Ok(result)
}

pub async fn get_indexes(
    params: &ConnectionParams,
    table_name: &str,
    schema: Option<&str>,
) -> Result<Vec<Index>, String> {
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    let pool = get_mysql_pool(params).await?;

    let query = r#"
        SELECT
            INDEX_NAME,
            COLUMN_NAME,
            NON_UNIQUE,
            SEQ_IN_INDEX
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
        ORDER BY INDEX_NAME, SEQ_IN_INDEX
    "#;

    let rows = sqlx::query(query)
        .bind(db_name)
        .bind(table_name)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| {
            let index_name = mysql_row_str(r, 0);
            let non_unique: i64 = r.try_get(2).unwrap_or(1);
            Index {
                name: index_name.clone(),
                column_name: mysql_row_str(r, 1),
                is_unique: non_unique == 0,
                is_primary: index_name == "PRIMARY",
                seq_in_index: r.try_get::<i64, _>(3).unwrap_or(0) as i32,
            }
        })
        .collect())
}

pub async fn save_blob_column_to_file(
    params: &ConnectionParams,
    table: &str,
    col_name: &str,
    pk_col: &str,
    pk_val: serde_json::Value,
    file_path: &str,
) -> Result<(), String> {
    let pool = get_mysql_pool(params).await?;

    let query = format!(
        "SELECT `{}` FROM `{}` WHERE `{}` = ?",
        col_name, table, pk_col
    );

    let row = match pk_val {
        serde_json::Value::Number(n) => {
            if n.is_i64() {
                sqlx::query(&query).bind(n.as_i64()).fetch_one(&pool).await
            } else if n.is_f64() {
                sqlx::query(&query).bind(n.as_f64()).fetch_one(&pool).await
            } else {
                sqlx::query(&query)
                    .bind(n.to_string())
                    .fetch_one(&pool)
                    .await
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
    let pool = get_mysql_pool(params).await?;

    let query = format!(
        "SELECT `{}` FROM `{}` WHERE `{}` = ?",
        col_name, table, pk_col
    );

    let row = match pk_val {
        serde_json::Value::Number(n) => {
            if n.is_i64() {
                sqlx::query(&query).bind(n.as_i64()).fetch_one(&pool).await
            } else if n.is_f64() {
                sqlx::query(&query).bind(n.as_f64()).fetch_one(&pool).await
            } else {
                sqlx::query(&query)
                    .bind(n.to_string())
                    .fetch_one(&pool)
                    .await
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
    let pool = get_mysql_pool(params).await?;

    let query = format!("DELETE FROM `{}` WHERE `{}` = ?", table, pk_col);

    let result = match pk_val {
        serde_json::Value::Number(n) => {
            if n.is_i64() {
                sqlx::query(&query).bind(n.as_i64()).execute(&pool).await
            } else if n.is_f64() {
                sqlx::query(&query).bind(n.as_f64()).execute(&pool).await
            } else {
                sqlx::query(&query).bind(n.to_string()).execute(&pool).await
            }
        }
        serde_json::Value::String(s) => sqlx::query(&query).bind(s).execute(&pool).await,
        _ => return Err("Unsupported PK type".into()),
    };

    result.map(|r| r.rows_affected()).map_err(|e| e.to_string())
}

/// Checks if a string value looks like WKT (Well-Known Text) geometry format
fn is_wkt_geometry(s: &str) -> bool {
    let s_upper = s.trim().to_uppercase();
    s_upper.starts_with("POINT(")
        || s_upper.starts_with("LINESTRING(")
        || s_upper.starts_with("POLYGON(")
        || s_upper.starts_with("MULTIPOINT(")
        || s_upper.starts_with("MULTILINESTRING(")
        || s_upper.starts_with("MULTIPOLYGON(")
        || s_upper.starts_with("GEOMETRYCOLLECTION(")
        || s_upper.starts_with("GEOMETRY(")
}

/// Checks if a string value is a raw SQL function call (e.g., ST_GeomFromText(...))
/// This is used to detect when user has entered a complete SQL function that should
/// be inserted directly into the query without parameter binding
fn is_raw_sql_function(s: &str) -> bool {
    let trimmed = s.trim().to_uppercase();
    // Check for common SQL spatial function patterns
    // Functions starting with ST_ followed by parenthesis
    if trimmed.starts_with("ST_") {
        return trimmed.contains('(');
    }
    // Legacy function names
    trimmed.starts_with("GEOMFROMTEXT(")
        || trimmed.starts_with("GEOMFROMWKB(")
        || trimmed.starts_with("POINTFROMTEXT(")
        || trimmed.starts_with("POINTFROMWKB(")
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
    let pool = get_mysql_pool(params).await?;

    let mut qb = sqlx::QueryBuilder::new(format!("UPDATE `{}` SET `{}` = ", table, col_name));

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
            } else if is_raw_sql_function(&s) {
                // If it's a raw SQL function (e.g., ST_GeomFromText('POINT(1 2)', 4326))
                // insert it directly without parameter binding
                qb.push(s);
            } else if is_wkt_geometry(&s) {
                // If it's WKT geometry format, wrap with ST_GeomFromText
                qb.push("ST_GeomFromText(");
                qb.push_bind(s);
                qb.push(")");
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
        serde_json::Value::Object(_) | serde_json::Value::Array(_) => {
            let json_str = serde_json::to_string(&new_val).map_err(|e| e.to_string())?;
            qb.push("CAST(");
            qb.push_bind(json_str);
            qb.push(" AS JSON)");
        }
    }

    qb.push(format!(" WHERE `{}` = ", pk_col));

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
    let pool = get_mysql_pool(params).await?;

    let mut cols = Vec::new();
    let mut vals = Vec::new();

    for (k, v) in data {
        cols.push(format!("`{}`", k));
        vals.push(v);
    }

    // Allow empty inserts for auto-generated values (e.g., auto-increment PKs)
    let mut qb = if cols.is_empty() {
        sqlx::QueryBuilder::new(format!("INSERT INTO `{}` () VALUES ()", table))
    } else {
        let mut qb = sqlx::QueryBuilder::new(format!(
            "INSERT INTO `{}` ({}) VALUES (",
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
                        // Blob wire format: decode to raw bytes so the DB stores binary data,
                        // not the internal wire format string.
                        separated.push_bind(bytes);
                    } else if is_raw_sql_function(&s) {
                        // If it's a raw SQL function (e.g., ST_GeomFromText('POINT(1 2)', 4326))
                        // insert it directly without parameter binding
                        separated.push_unseparated(&s);
                    } else if is_wkt_geometry(&s) {
                        // If it's WKT geometry format, wrap with ST_GeomFromText
                        separated.push_unseparated("ST_GeomFromText(");
                        separated.push_bind_unseparated(s);
                        separated.push_unseparated(")");
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
                serde_json::Value::Object(_) | serde_json::Value::Array(_) => {
                    let json_str = serde_json::to_string(&val).map_err(|e| e.to_string())?;
                    separated.push_unseparated("CAST(");
                    separated.push_bind_unseparated(json_str);
                    separated.push_unseparated(" AS JSON)");
                }
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
    let pool = get_mysql_pool(params).await?;
    let query = format!("SHOW CREATE TABLE `{}`", table_name);
    let row = sqlx::query(&query)
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let create_sql = mysql_row_str(&row, 1);
    Ok(format!("{};", create_sql))
}

pub async fn get_views(params: &ConnectionParams, schema: Option<&str>) -> Result<Vec<ViewInfo>, String> {
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    log::debug!("MySQL: Fetching views for database: {}", db_name);
    let pool = get_mysql_pool(params).await?;
    let rows = sqlx::query(
            "SELECT table_name as name FROM information_schema.views WHERE table_schema = ? ORDER BY table_name ASC",
        )
        .bind(db_name)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let views: Vec<ViewInfo> = rows
        .iter()
        .map(|r| ViewInfo {
            name: mysql_row_str(r, 0),
            definition: None,
        })
        .collect();
    log::debug!("MySQL: Found {} views in {}", views.len(), db_name);
    Ok(views)
}

pub async fn get_view_definition(
    params: &ConnectionParams,
    view_name: &str,
) -> Result<String, String> {
    let pool = get_mysql_pool(params).await?;
    let escaped_name = escape_identifier(view_name);
    let query = format!("SHOW CREATE VIEW `{}`", escaped_name);
    let row = sqlx::query(&query)
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("Failed to get view definition: {}", e))?;
    let definition = mysql_row_str(&row, 1);

    Ok(definition)
}

pub async fn create_view(
    params: &ConnectionParams,
    view_name: &str,
    definition: &str,
) -> Result<(), String> {
    let pool = get_mysql_pool(params).await?;
    let escaped_name = escape_identifier(view_name);
    let query = format!("CREATE VIEW `{}` AS {}", escaped_name, definition);
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
    let pool = get_mysql_pool(params).await?;
    let escaped_name = escape_identifier(view_name);
    let query = format!("ALTER VIEW `{}` AS {}", escaped_name, definition);
    sqlx::query(&query)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to alter view: {}", e))?;
    Ok(())
}

pub async fn drop_view(params: &ConnectionParams, view_name: &str) -> Result<(), String> {
    let pool = get_mysql_pool(params).await?;
    let escaped_name = escape_identifier(view_name);
    let query = format!("DROP VIEW IF EXISTS `{}`", escaped_name);
    sqlx::query(&query)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to drop view: {}", e))?;
    Ok(())
}

pub async fn get_view_columns(
    params: &ConnectionParams,
    view_name: &str,
    schema: Option<&str>,
) -> Result<Vec<TableColumn>, String> {
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    // Views in MySQL can be queried like tables for column info
    let pool = get_mysql_pool(params).await?;

    let query = r#"
            SELECT column_name, data_type, column_key, is_nullable, extra, column_default, character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = ? AND table_name = ?
            ORDER BY ordinal_position
        "#;

    let rows = sqlx::query(query)
        .bind(db_name)
        .bind(view_name)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| {
            let column_name = mysql_row_str(r, 0);
            let data_type = mysql_row_str(r, 1);
            let key = mysql_row_str(r, 2);
            let null_str = mysql_row_str(r, 3);
            let extra = mysql_row_str(r, 4);
            let default_val = mysql_row_str_opt(r, 5);
            let character_maximum_length: Option<u64> = r.try_get(6).ok();

            let is_auto_increment = extra.contains("auto_increment");

            let default_value = if !is_auto_increment {
                match default_val {
                    Some(val) if !val.is_empty() && !val.eq_ignore_ascii_case("null") => Some(val),
                    _ => None,
                }
            } else {
                None
            };

            TableColumn {
                name: column_name,
                data_type,
                is_pk: key == "PRI",
                is_nullable: null_str == "YES",
                is_auto_increment,
                default_value,
                character_maximum_length,
            }
        })
        .collect())
}

pub async fn get_routines(params: &ConnectionParams, schema: Option<&str>) -> Result<Vec<RoutineInfo>, String> {
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    let pool = get_mysql_pool(params).await?;
    let query = r#"
            SELECT routine_name, routine_type, routine_definition
            FROM information_schema.routines
            WHERE routine_schema = ?
            ORDER BY routine_name
        "#;

    let rows = sqlx::query(query)
        .bind(db_name)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| RoutineInfo {
            name: mysql_row_str(r, 0),
            routine_type: mysql_row_str(r, 1),
            definition: mysql_row_str_opt(r, 2),
        })
        .collect())
}

pub async fn get_routine_parameters(
    params: &ConnectionParams,
    routine_name: &str,
    schema: Option<&str>,
) -> Result<Vec<RoutineParameter>, String> {
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    let pool = get_mysql_pool(params).await?;

    // 1. Get return type for functions from routines table
    let return_type_query = r#"
            SELECT DATA_TYPE, ROUTINE_TYPE
            FROM information_schema.routines
            WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ?
        "#;

    let routine_info = sqlx::query(return_type_query)
        .bind(db_name)
        .bind(routine_name)
        .fetch_optional(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut parameters = Vec::new();

    if let Some(info) = routine_info {
        let data_type = mysql_row_str(&info, 0);
        let routine_type = mysql_row_str(&info, 1);
        if routine_type == "FUNCTION" {
            if !data_type.is_empty() {
                parameters.push(RoutineParameter {
                    name: "".to_string(), // Empty name for return value
                    data_type,
                    mode: "OUT".to_string(),
                    ordinal_position: 0,
                });
            }
        }
    }

    // 2. Get parameters
    let query = r#"
            SELECT parameter_name, data_type, parameter_mode, ordinal_position
            FROM information_schema.parameters
            WHERE specific_schema = ? AND specific_name = ?
            ORDER BY ordinal_position
        "#;

    let rows = sqlx::query(query)
        .bind(db_name)
        .bind(routine_name)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    parameters.extend(rows.iter().map(|r| RoutineParameter {
        name: mysql_row_str(r, 0),
        data_type: mysql_row_str(r, 1),
        mode: mysql_row_str(r, 2),
        ordinal_position: r.try_get(3).unwrap_or(0),
    }));

    Ok(parameters)
}

pub async fn get_routine_definition(
    params: &ConnectionParams,
    routine_name: &str,
    routine_type: &str,
) -> Result<String, String> {
    let pool = get_mysql_pool(params).await?;
    let query = format!(
        "SHOW CREATE {} `{}`",
        routine_type,
        escape_identifier(routine_name)
    );

    let row = sqlx::query(&query)
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let definition = mysql_row_str(&row, 2);

    Ok(definition)
}

pub async fn execute_query(
    params: &ConnectionParams,
    query: &str,
    limit: Option<u32>,
    page: u32,
    schema: Option<&str>,
) -> Result<QueryResult, String> {
    // Use a per-database pool when a schema override is requested to avoid
    // polluting the shared pool's prepared-statement cache (MySQL invalidates
    // all cached handles on a `USE <db>` command).
    let effective_params;
    let pool = if let Some(db) = schema {
        effective_params = {
            let mut p = params.clone();
            p.database = crate::models::DatabaseSelection::Single(db.to_string());
            p
        };
        get_mysql_pool(&effective_params).await?
    } else {
        get_mysql_pool(params).await?
    };
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let is_select = query.trim_start().to_uppercase().starts_with("SELECT");
    let mut pagination: Option<Pagination> = None;
    let final_query: String;
    let mut manual_limit = limit;
    let mut truncated = false;

    if is_select && limit.is_some() {
        let l = limit.unwrap();
        let offset = (page - 1) * l;

        // Use LIMIT +1 trick to detect has_more without a COUNT query
        let order_by_clause = extract_order_by(query);

        if !order_by_clause.is_empty() {
            let query_without_order = remove_order_by(query);
            final_query = format!(
                "SELECT * FROM ({}) as data_wrapper {} LIMIT {} OFFSET {}",
                query_without_order, order_by_clause, l + 1, offset
            );
        } else {
            final_query = format!(
                "SELECT * FROM ({}) as data_wrapper LIMIT {} OFFSET {}",
                query, l + 1, offset
            );
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

    let mut columns: Vec<String> = Vec::new();
    let mut json_rows = Vec::new();

    // Scope the stream so `conn` borrow is released before the restore step
    {
        use futures::stream::StreamExt;
        let mut rows_stream = sqlx::query(&final_query).fetch(&mut *conn);

        while let Some(result) = rows_stream.next().await {
            match result {
                Ok(row) => {
                    // Initialize columns from the first row
                    if columns.is_empty() {
                        columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                    }

                    // Check limit (only if manual_limit is set)
                    if let Some(l) = manual_limit {
                        if json_rows.len() >= l as usize {
                            truncated = true;
                            break;
                        }
                    }

                    // Map row using type extraction function
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
    } // rows_stream dropped here — conn borrow released

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

// ============================================================
// Plugin wrapper
// ============================================================

use crate::drivers::driver_trait::{DatabaseDriver, DriverCapabilities, PluginManifest};
use async_trait::async_trait;
use std::collections::HashMap;

pub struct MysqlDriver {
    manifest: PluginManifest,
}

impl MysqlDriver {
    pub fn new() -> Self {
        Self {
            manifest: PluginManifest {
                id: "mysql".to_string(),
                name: "MySQL".to_string(),
                version: "1.0.0".to_string(),
                description: "MySQL and MariaDB databases".to_string(),
                default_port: Some(3306),
                capabilities: DriverCapabilities {
                    schemas: false,
                    views: true,
                    routines: true,
                    file_based: false,
                    folder_based: false,
                    connection_string: true,
                    connection_string_example: "mysql://user:pass@localhost:3306/db".into(),
                    identifier_quote: "`".into(),
                    alter_primary_key: true,
                    auto_increment_keyword: "AUTO_INCREMENT".into(),
                    serial_type: String::new(),
                    inline_pk: false,
                    alter_column: true,
                    create_foreign_keys: true,
                    no_connection_required: false,
                },
                is_builtin: true,
                default_username: "root".to_string(),
                color: "#f97316".to_string(),
                icon: "mysql".to_string(),
                settings: vec![],
            },
        }
    }
}

#[async_trait]
impl DatabaseDriver for MysqlDriver {
    fn manifest(&self) -> &PluginManifest { &self.manifest }

    fn get_data_types(&self) -> Vec<crate::models::DataTypeInfo> {
        types::get_data_types()
    }

    fn build_connection_url(&self, params: &crate::models::ConnectionParams) -> Result<String, String> {
        use urlencoding::encode;
        let user = encode(params.username.as_deref().unwrap_or_default());
        let pass = encode(params.password.as_deref().unwrap_or_default());
        Ok(format!(
            "mysql://{}:{}@{}:{}/{}",
            user, pass,
            params.host.as_deref().unwrap_or("localhost"),
            params.port.unwrap_or(3306),
            params.database
        ))
    }

    async fn get_databases(&self, params: &crate::models::ConnectionParams) -> Result<Vec<String>, String> {
        // MySQL requires connecting to information_schema to list databases
        let mut p = params.clone();
        p.database = crate::models::DatabaseSelection::Single("information_schema".to_string());
        p.connection_id = None; // avoid caching under the real connection key
        get_databases(&p).await
    }

    async fn get_schemas(&self, params: &crate::models::ConnectionParams) -> Result<Vec<String>, String> {
        get_schemas(params).await
    }

    async fn get_tables(&self, params: &crate::models::ConnectionParams, schema: Option<&str>) -> Result<Vec<crate::models::TableInfo>, String> {
        get_tables(params, schema).await
    }

    async fn get_columns(&self, params: &crate::models::ConnectionParams, table: &str, schema: Option<&str>) -> Result<Vec<crate::models::TableColumn>, String> {
        get_columns(params, table, schema).await
    }

    async fn get_foreign_keys(&self, params: &crate::models::ConnectionParams, table: &str, schema: Option<&str>) -> Result<Vec<crate::models::ForeignKey>, String> {
        get_foreign_keys(params, table, schema).await
    }

    async fn get_indexes(&self, params: &crate::models::ConnectionParams, table: &str, schema: Option<&str>) -> Result<Vec<crate::models::Index>, String> {
        get_indexes(params, table, schema).await
    }

    async fn get_views(&self, params: &crate::models::ConnectionParams, schema: Option<&str>) -> Result<Vec<crate::models::ViewInfo>, String> {
        get_views(params, schema).await
    }

    async fn get_view_definition(&self, params: &crate::models::ConnectionParams, view_name: &str, _schema: Option<&str>) -> Result<String, String> {
        get_view_definition(params, view_name).await
    }

    async fn get_view_columns(&self, params: &crate::models::ConnectionParams, view_name: &str, schema: Option<&str>) -> Result<Vec<crate::models::TableColumn>, String> {
        get_view_columns(params, view_name, schema).await
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

    async fn get_routines(&self, params: &crate::models::ConnectionParams, schema: Option<&str>) -> Result<Vec<crate::models::RoutineInfo>, String> {
        get_routines(params, schema).await
    }

    async fn get_routine_parameters(&self, params: &crate::models::ConnectionParams, routine_name: &str, schema: Option<&str>) -> Result<Vec<crate::models::RoutineParameter>, String> {
        get_routine_parameters(params, routine_name, schema).await
    }

    async fn get_routine_definition(&self, params: &crate::models::ConnectionParams, routine_name: &str, routine_type: &str, _schema: Option<&str>) -> Result<String, String> {
        get_routine_definition(params, routine_name, routine_type).await
    }

    async fn execute_query(&self, params: &crate::models::ConnectionParams, query: &str, limit: Option<u32>, page: u32, schema: Option<&str>) -> Result<crate::models::QueryResult, String> {
        execute_query(params, query, limit, page, schema).await
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
        for col in &columns {
            let mut def = format!("`{}` {}", escape_identifier(&col.name), col.data_type);
            if !col.is_nullable {
                def.push_str(" NOT NULL");
            }
            if col.is_auto_increment {
                def.push_str(" AUTO_INCREMENT");
            }
            if let Some(default) = &col.default_value {
                def.push_str(&format!(" DEFAULT {}", default));
            }
            col_defs.push(def);
            if col.is_pk {
                pk_cols.push(format!("`{}`", escape_identifier(&col.name)));
            }
        }
        if !pk_cols.is_empty() {
            col_defs.push(format!("PRIMARY KEY ({})", pk_cols.join(", ")));
        }
        Ok(vec![format!(
            "CREATE TABLE `{}` (\n  {}\n)",
            escape_identifier(table_name),
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
            "ALTER TABLE `{}` ADD COLUMN `{}` {}",
            escape_identifier(table),
            escape_identifier(&column.name),
            column.data_type
        );
        if !column.is_nullable {
            def.push_str(" NOT NULL");
        } else {
            def.push_str(" NULL");
        }
        if column.is_auto_increment {
            def.push_str(" AUTO_INCREMENT");
        }
        if let Some(default) = &column.default_value {
            def.push_str(&format!(" DEFAULT {}", default));
        }
        if column.is_pk {
            def.push_str(" PRIMARY KEY");
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
        let mut def = String::new();
        if old_column.name != new_column.name {
            def.push_str(&format!(
                "ALTER TABLE `{}` CHANGE `{}` `{}` {}",
                escape_identifier(table),
                escape_identifier(&old_column.name),
                escape_identifier(&new_column.name),
                new_column.data_type
            ));
        } else {
            def.push_str(&format!(
                "ALTER TABLE `{}` MODIFY COLUMN `{}` {}",
                escape_identifier(table),
                escape_identifier(&new_column.name),
                new_column.data_type
            ));
        }
        if !new_column.is_nullable {
            def.push_str(" NOT NULL");
        } else {
            def.push_str(" NULL");
        }
        if new_column.is_auto_increment {
            def.push_str(" AUTO_INCREMENT");
        }
        if let Some(default) = &new_column.default_value {
            def.push_str(&format!(" DEFAULT {}", default));
        }
        Ok(vec![def])
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
            .map(|c| format!("`{}`", escape_identifier(c)))
            .collect();
        Ok(vec![format!(
            "CREATE {}INDEX `{}` ON `{}` ({})",
            unique,
            escape_identifier(index_name),
            escape_identifier(table),
            cols.join(", ")
        )])
    }

    async fn get_create_foreign_key_sql(
        &self,
        table: &str,
        fk_name: &str,
        column: &str,
        ref_table: &str,
        ref_column: &str,
        on_delete: Option<&str>,
        on_update: Option<&str>,
        _schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let mut sql = format!(
            "ALTER TABLE `{}` ADD CONSTRAINT `{}` FOREIGN KEY (`{}`) REFERENCES `{}` (`{}`)",
            escape_identifier(table),
            escape_identifier(fk_name),
            escape_identifier(column),
            escape_identifier(ref_table),
            escape_identifier(ref_column)
        );
        if let Some(action) = on_delete {
            sql.push_str(&format!(" ON DELETE {}", action));
        }
        if let Some(action) = on_update {
            sql.push_str(&format!(" ON UPDATE {}", action));
        }
        Ok(vec![sql])
    }

    async fn drop_index(
        &self,
        params: &crate::models::ConnectionParams,
        table: &str,
        index_name: &str,
        _schema: Option<&str>,
    ) -> Result<(), String> {
        let sql = format!(
            "DROP INDEX `{}` ON `{}`",
            escape_identifier(index_name),
            escape_identifier(table)
        );
        execute_query(params, &sql, None, 1, None).await?;
        Ok(())
    }

    async fn drop_foreign_key(
        &self,
        params: &crate::models::ConnectionParams,
        table: &str,
        fk_name: &str,
        _schema: Option<&str>,
    ) -> Result<(), String> {
        let sql = format!(
            "ALTER TABLE `{}` DROP FOREIGN KEY `{}`",
            escape_identifier(table),
            escape_identifier(fk_name)
        );
        execute_query(params, &sql, None, 1, None).await?;
        Ok(())
    }

    async fn get_all_columns_batch(&self, params: &crate::models::ConnectionParams, schema: Option<&str>) -> Result<HashMap<String, Vec<crate::models::TableColumn>>, String> {
        get_all_columns_batch(params, schema).await
    }

    async fn get_all_foreign_keys_batch(&self, params: &crate::models::ConnectionParams, schema: Option<&str>) -> Result<HashMap<String, Vec<crate::models::ForeignKey>>, String> {
        get_all_foreign_keys_batch(params, schema).await
    }

    async fn get_schema_snapshot(&self, params: &crate::models::ConnectionParams, schema: Option<&str>) -> Result<Vec<crate::models::TableSchema>, String> {
        let tables = self.get_tables(params, schema).await?;
        let mut columns_map = self.get_all_columns_batch(params, schema).await?;
        let mut fks_map = self.get_all_foreign_keys_batch(params, schema).await?;
        Ok(tables.into_iter().map(|t| crate::models::TableSchema {
            name: t.name.clone(),
            columns: columns_map.remove(&t.name).unwrap_or_default(),
            foreign_keys: fks_map.remove(&t.name).unwrap_or_default(),
        }).collect())
    }
}
