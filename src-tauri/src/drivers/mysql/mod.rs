pub mod extract;
pub mod types;

use crate::models::{
    ConnectionParams, ExplainNode, ExplainPlan, ForeignKey, Index, Pagination, QueryResult,
    RoutineInfo, RoutineParameter, TableColumn, TableInfo, ViewInfo,
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

        final_query = crate::drivers::common::build_paginated_query(query, l, page);

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

// ---------------------------------------------------------------------------
// EXPLAIN QUERY
// ---------------------------------------------------------------------------

/// Server capabilities detected via `SELECT VERSION()`.
struct MysqlCapabilities {
    /// EXPLAIN FORMAT=JSON (MySQL 5.6+ / MariaDB 10.1+)
    supports_json_format: bool,
    /// EXPLAIN ANALYZE (MySQL 8.0.18+ only)
    supports_explain_analyze: bool,
    /// ANALYZE FORMAT=JSON (MariaDB 10.1+ only)
    supports_analyze_format: bool,
}

fn parse_mysql_version(version_str: &str) -> MysqlCapabilities {
    let is_mariadb = version_str.to_lowercase().contains("mariadb");

    // Extract "5.5.24" from "5.5.24-55-log" or "10.5.22-MariaDB"
    let version_part = version_str.split('-').next().unwrap_or("");
    let parts: Vec<u32> = version_part
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();
    let ver = (
        parts.first().copied().unwrap_or(0),
        parts.get(1).copied().unwrap_or(0),
        parts.get(2).copied().unwrap_or(0),
    );

    if is_mariadb {
        MysqlCapabilities {
            supports_json_format: ver >= (10, 1, 0),
            supports_explain_analyze: false,
            supports_analyze_format: ver >= (10, 1, 0),
        }
    } else {
        MysqlCapabilities {
            supports_json_format: ver >= (5, 6, 0),
            supports_explain_analyze: ver >= (8, 0, 18),
            supports_analyze_format: false,
        }
    }
}

pub async fn explain_query(
    params: &ConnectionParams,
    query: &str,
    analyze: bool,
    schema: Option<&str>,
) -> Result<ExplainPlan, String> {
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

    // Detect server version to skip unsupported EXPLAIN variants
    let caps = {
        let mut vc = pool.acquire().await.map_err(|e| e.to_string())?;
        let ver_row = sqlx::query("SELECT VERSION()")
            .fetch_one(&mut *vc)
            .await
            .ok();
        let ver_str: String = ver_row
            .and_then(|r| r.try_get(0).ok())
            .unwrap_or_default();
        log::debug!("MySQL/MariaDB version: {}", ver_str);
        parse_mysql_version(&ver_str)
    };

    // EXPLAIN ANALYZE — MySQL 8.0.18+ text tree with estimated + actual data
    if analyze && caps.supports_explain_analyze {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        let analyze_sql = format!("EXPLAIN ANALYZE {}", query);
        if let Ok(rows) = sqlx::query(&analyze_sql).fetch_all(&mut *conn).await {
            let mut lines = Vec::new();
            for row in &rows {
                if let Ok(line) = row.try_get::<String, _>(0) {
                    lines.push(line);
                }
            }
            if !lines.is_empty() {
                let raw_output = lines.join("\n");
                let mut counter: u32 = 0;
                let root = parse_mysql_analyze_text(&raw_output, &mut counter);
                let has_analyze = has_analyze_data_recursive(&root);

                return Ok(ExplainPlan {
                    root,
                    planning_time_ms: None,
                    execution_time_ms: None,
                    original_query: query.to_string(),
                    driver: "mysql".to_string(),
                    has_analyze_data: has_analyze,
                    raw_output: Some(raw_output),
                });
            }
        }
    }

    // ANALYZE FORMAT=JSON — MariaDB 10.1+ (executes the query and returns JSON
    // with both estimated and r_* actual fields)
    if analyze && caps.supports_analyze_format {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        let maria_sql = format!("ANALYZE FORMAT=JSON {}", query);
        if let Ok(row) = sqlx::query(&maria_sql).fetch_one(&mut *conn).await {
            if let Ok(raw_json) = row.try_get::<String, _>(0) {
                if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&raw_json) {
                    if let Some(query_block) = json_val.get("query_block") {
                        let mut counter: u32 = 0;
                        let root = parse_mysql_query_block(query_block, &mut counter);
                        let has_analyze = has_analyze_data_recursive(&root);

                        // MariaDB: query_optimization.r_total_time_ms
                        let planning_time_ms = json_val
                            .get("query_optimization")
                            .and_then(|qo| qo.get("r_total_time_ms"))
                            .and_then(|v| v.as_f64());

                        return Ok(ExplainPlan {
                            root,
                            planning_time_ms,
                            execution_time_ms: None,
                            original_query: query.to_string(),
                            driver: "mysql".to_string(),
                            has_analyze_data: has_analyze,
                            raw_output: Some(raw_json),
                        });
                    }
                }
            }
        }
    }

    // EXPLAIN FORMAT=JSON — MySQL 5.6+ / MariaDB 10.1+
    if caps.supports_json_format {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        let json_sql = format!("EXPLAIN FORMAT=JSON {}", query);
        let json_result: Result<String, String> = async {
            let row = sqlx::query(&json_sql)
                .fetch_one(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
            row.try_get::<String, _>(0).map_err(|e| e.to_string())
        }
        .await;

        if let Ok(raw_json) = json_result {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&raw_json) {
                if let Some(query_block) = json_val.get("query_block") {
                    let mut counter: u32 = 0;
                    let root = parse_mysql_query_block(query_block, &mut counter);
                    let has_analyze = has_analyze_data_recursive(&root);

                    return Ok(ExplainPlan {
                        root,
                        planning_time_ms: None,
                        execution_time_ms: None,
                        original_query: query.to_string(),
                        driver: "mysql".to_string(),
                        has_analyze_data: has_analyze,
                        raw_output: Some(raw_json),
                    });
                }
            }
        }
    }

    // Tabular fallback — works on all MySQL/MariaDB versions
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let explain_sql = format!("EXPLAIN {}", query);
    let rows = sqlx::query(&explain_sql)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let (root, raw) = parse_mysql_tabular_explain(&rows);
    Ok(ExplainPlan {
        root,
        planning_time_ms: None,
        execution_time_ms: None,
        original_query: query.to_string(),
        driver: "mysql".to_string(),
        has_analyze_data: false,
        raw_output: Some(raw),
    })
}

/// Parse the tabular output from plain `EXPLAIN` (for MySQL/MariaDB without FORMAT=JSON).
///
/// MySQL 5.5:  id, select_type, table, type, possible_keys, key, key_len, ref, rows, Extra
/// MySQL 5.7+: id, select_type, table, partitions, type, possible_keys, key, key_len, ref, rows, filtered, Extra
///
/// Uses column-name lookup + `mysql_row_str` / `mysql_row_str_opt` to handle
/// MySQL versions that return VARBINARY instead of VARCHAR.
fn parse_mysql_tabular_explain(rows: &[sqlx::mysql::MySqlRow]) -> (ExplainNode, String) {
    let mut raw_lines = Vec::new();
    let mut children = Vec::new();

    /// Find a column index by name (case-insensitive).
    fn col_idx(row: &sqlx::mysql::MySqlRow, name: &str) -> Option<usize> {
        row.columns()
            .iter()
            .position(|c| c.name().eq_ignore_ascii_case(name))
    }

    for (i, row) in rows.iter().enumerate() {
        let select_type = col_idx(row, "select_type")
            .map(|idx| mysql_row_str(row, idx))
            .unwrap_or_default();
        let table = col_idx(row, "table")
            .and_then(|idx| mysql_row_str_opt(row, idx))
            .unwrap_or_default();
        let access_type = col_idx(row, "type")
            .and_then(|idx| mysql_row_str_opt(row, idx))
            .unwrap_or_default();
        let possible_keys = col_idx(row, "possible_keys")
            .and_then(|idx| mysql_row_str_opt(row, idx));
        let key = col_idx(row, "key")
            .and_then(|idx| mysql_row_str_opt(row, idx));
        let plan_rows: Option<i64> = col_idx(row, "rows")
            .and_then(|idx| {
                row.try_get::<Option<i64>, _>(idx)
                    .unwrap_or(None)
                    .or_else(|| {
                        // Fallback: read as string and parse
                        mysql_row_str_opt(row, idx)
                            .and_then(|s| s.parse::<i64>().ok())
                    })
            });
        let filtered: Option<f64> = col_idx(row, "filtered")
            .and_then(|idx| {
                row.try_get::<Option<f64>, _>(idx)
                    .unwrap_or(None)
                    .or_else(|| {
                        mysql_row_str_opt(row, idx)
                            .and_then(|s| s.parse::<f64>().ok())
                    })
            });
        let extra = col_idx(row, "Extra")
            .and_then(|idx| mysql_row_str_opt(row, idx));

        let node_type = match access_type.as_str() {
            "ALL" => "Full Table Scan",
            "index" => "Index Scan",
            "range" => "Range Scan",
            "ref" => "Index Lookup",
            "eq_ref" => "Unique Index Lookup",
            "const" | "system" => "Const Lookup",
            "fulltext" => "Fulltext Search",
            "" => "Unknown",
            other => other,
        }
        .to_string();

        raw_lines.push(format!(
            "{}\t{}\t{}\t{}\t{}\t{}",
            select_type,
            table,
            access_type,
            key.as_deref().unwrap_or("-"),
            plan_rows.unwrap_or(0),
            extra.as_deref().unwrap_or("")
        ));

        let mut node_extra = std::collections::HashMap::new();
        if let Some(pk) = &possible_keys {
            node_extra.insert(
                "possible_keys".to_string(),
                serde_json::Value::String(pk.clone()),
            );
        }
        if let Some(f) = filtered {
            node_extra.insert(
                "filtered".to_string(),
                serde_json::Value::Number(
                    serde_json::Number::from_f64(f)
                        .unwrap_or(serde_json::Number::from(0)),
                ),
            );
        }
        if let Some(e) = &extra {
            node_extra.insert(
                "extra".to_string(),
                serde_json::Value::String(e.clone()),
            );
        }
        node_extra.insert(
            "select_type".to_string(),
            serde_json::Value::String(select_type),
        );

        children.push(ExplainNode {
            id: format!("node_{}", i + 1),
            node_type,
            relation: if table.is_empty() { None } else { Some(table) },
            startup_cost: None,
            total_cost: None,
            plan_rows: plan_rows.map(|r| r as f64),
            actual_rows: None,
            actual_time_ms: None,
            actual_loops: None,
            buffers_hit: None,
            buffers_read: None,
            filter: extra.clone(),
            index_condition: key,
            join_type: None,
            hash_condition: None,
            extra: node_extra,
            children: vec![],
        });
    }

    let root = ExplainNode {
        id: "node_0".to_string(),
        node_type: "Query".to_string(),
        relation: None,
        startup_cost: None,
        total_cost: None,
        plan_rows: None,
        actual_rows: None,
        actual_time_ms: None,
        actual_loops: None,
        buffers_hit: None,
        buffers_read: None,
        filter: None,
        index_condition: None,
        join_type: None,
        hash_condition: None,
        extra: std::collections::HashMap::new(),
        children,
    };

    (root, raw_lines.join("\n"))
}

/// Parse a JSON value that might be a string number or a numeric value.
fn parse_json_number(v: &serde_json::Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()))
}

/// Parse a MariaDB `filesort` JSON object into an ExplainNode.
///
/// MariaDB ANALYZE FORMAT=JSON emits `"filesort": { sort_key, r_total_time_ms,
/// temporary_table | nested_loop, … }` as a nested object — unlike MySQL which
/// uses the boolean flag `"using_filesort": true`.
fn parse_mariadb_filesort(filesort: &serde_json::Value, counter: &mut u32) -> ExplainNode {
    let id = format!("node_{}", counter);
    *counter += 1;

    let actual_time_ms = filesort.get("r_total_time_ms").and_then(|v| v.as_f64());
    let actual_rows = filesort.get("r_output_rows").and_then(|v| v.as_f64());
    let actual_loops = filesort
        .get("r_loops")
        .and_then(|v| v.as_u64())
        .or_else(|| {
            filesort
                .get("r_loops")
                .and_then(|v| v.as_f64())
                .map(|f| f as u64)
        });

    let mut extra = std::collections::HashMap::new();
    for key in &["sort_key", "r_sort_mode", "r_buffer_size"] {
        if let Some(val) = filesort.get(*key) {
            extra.insert(key.to_string(), val.clone());
        }
    }

    // Also capture r_limit and r_used_priority_queue when present
    for key in &["r_limit", "r_used_priority_queue"] {
        if let Some(val) = filesort.get(*key) {
            extra.insert(key.to_string(), val.clone());
        }
    }

    let mut children = Vec::new();
    if let Some(tmp_tbl) = filesort.get("temporary_table") {
        children.push(parse_mariadb_temporary_table(tmp_tbl, counter));
    }
    if let Some(nested_loop) = filesort.get("nested_loop").and_then(|v| v.as_array()) {
        for item in nested_loop {
            children.push(parse_mysql_query_block(item, counter));
        }
    }
    if let Some(order_op) = filesort.get("ordering_operation") {
        children.push(parse_mysql_query_block(order_op, counter));
    }
    // MariaDB: filesort may contain a direct "table" (no nested_loop wrapper)
    if filesort.get("table").is_some()
        && filesort.get("nested_loop").is_none()
        && filesort.get("temporary_table").is_none()
    {
        children.push(parse_mysql_query_block(filesort, counter));
    }

    ExplainNode {
        id,
        node_type: "Filesort".to_string(),
        relation: None,
        startup_cost: None,
        total_cost: None,
        plan_rows: None,
        actual_rows,
        actual_time_ms,
        actual_loops,
        buffers_hit: None,
        buffers_read: None,
        filter: None,
        index_condition: None,
        join_type: None,
        hash_condition: None,
        extra,
        children,
    }
}

/// Parse a MariaDB `temporary_table` JSON wrapper into an ExplainNode.
///
/// MariaDB wraps `nested_loop` (and sometimes `filesort`) inside a
/// `"temporary_table": { … }` object when a temp table is materialised.
fn parse_mariadb_temporary_table(
    tmp_tbl: &serde_json::Value,
    counter: &mut u32,
) -> ExplainNode {
    let id = format!("node_{}", counter);
    *counter += 1;

    let mut children = Vec::new();
    if let Some(nested_loop) = tmp_tbl.get("nested_loop").and_then(|v| v.as_array()) {
        for item in nested_loop {
            children.push(parse_mysql_query_block(item, counter));
        }
    }
    if let Some(filesort) = tmp_tbl.get("filesort") {
        children.push(parse_mariadb_filesort(filesort, counter));
    }

    ExplainNode {
        id,
        node_type: "Temporary Table".to_string(),
        relation: None,
        startup_cost: None,
        total_cost: None,
        plan_rows: None,
        actual_rows: None,
        actual_time_ms: None,
        actual_loops: None,
        buffers_hit: None,
        buffers_read: None,
        filter: None,
        index_condition: None,
        join_type: None,
        hash_condition: None,
        extra: std::collections::HashMap::new(),
        children,
    }
}

/// Parse a MariaDB `subquery_cache` wrapper into an ExplainNode.
///
/// MariaDB wraps correlated/dependent subqueries in `"subquery_cache": {
/// r_loops, r_hit_ratio, query_block: { … } }` when the optimizer can
/// cache repeated evaluations.  The `r_hit_ratio` (0–100) indicates how
/// often the cache was reused.
fn parse_mariadb_subquery_cache(
    cache: &serde_json::Value,
    counter: &mut u32,
) -> ExplainNode {
    let id = format!("node_{}", counter);
    *counter += 1;

    let actual_loops = cache
        .get("r_loops")
        .and_then(|v| v.as_u64())
        .or_else(|| cache.get("r_loops").and_then(|v| v.as_f64()).map(|f| f as u64));

    let mut extra = std::collections::HashMap::new();
    if let Some(hit) = cache.get("r_hit_ratio") {
        extra.insert("r_hit_ratio".to_string(), hit.clone());
    }

    let mut children = Vec::new();
    if let Some(qb) = cache.get("query_block") {
        children.push(parse_mysql_query_block(qb, counter));
    }

    ExplainNode {
        id,
        node_type: "Subquery Cache".to_string(),
        relation: None,
        startup_cost: None,
        total_cost: None,
        plan_rows: None,
        actual_rows: None,
        actual_time_ms: None,
        actual_loops,
        buffers_hit: None,
        buffers_read: None,
        filter: None,
        index_condition: None,
        join_type: None,
        hash_condition: None,
        extra,
        children,
    }
}

/// Generic parser for MariaDB wrapper nodes (materialized, union_result,
/// buffer_result, window_functions_computation, expression_cache,
/// read_sorted_file).  These share a common pattern: an object that may
/// contain nested_loop, table, filesort, query_specifications, or other
/// recursive structures.
fn parse_mariadb_wrapper(
    obj: &serde_json::Value,
    label: &str,
    counter: &mut u32,
) -> ExplainNode {
    let id = format!("node_{}", counter);
    *counter += 1;

    let actual_time_ms = obj.get("r_total_time_ms").and_then(|v| v.as_f64());
    let actual_rows = obj
        .get("r_rows")
        .or_else(|| obj.get("r_output_rows"))
        .and_then(|v| v.as_f64());
    let actual_loops = obj
        .get("r_loops")
        .and_then(|v| v.as_u64())
        .or_else(|| obj.get("r_loops").and_then(|v| v.as_f64()).map(|f| f as u64));

    let mut children = Vec::new();

    // The wrapper may directly contain a table
    if obj.get("table").is_some() {
        children.push(parse_mysql_query_block(obj, counter));
    }

    if let Some(nl) = obj.get("nested_loop").and_then(|v| v.as_array()) {
        for item in nl {
            children.push(parse_mysql_query_block(item, counter));
        }
    }
    if let Some(fs) = obj.get("filesort") {
        if fs.is_object() {
            children.push(parse_mariadb_filesort(fs, counter));
        }
    }
    if let Some(tmp) = obj.get("temporary_table") {
        children.push(parse_mariadb_temporary_table(tmp, counter));
    }
    if let Some(qb) = obj.get("query_block") {
        children.push(parse_mysql_query_block(qb, counter));
    }
    if let Some(specs) = obj.get("query_specifications").and_then(|v| v.as_array()) {
        for spec in specs {
            children.push(parse_mysql_query_block(spec, counter));
        }
    }
    if let Some(order_op) = obj.get("ordering_operation") {
        children.push(parse_mysql_query_block(order_op, counter));
    }
    if let Some(group_op) = obj.get("grouping_operation") {
        children.push(parse_mysql_query_block(group_op, counter));
    }
    if let Some(subs) = obj.get("attached_subqueries").and_then(|v| v.as_array()) {
        for sq in subs {
            children.push(parse_mysql_query_block(sq, counter));
        }
    }

    ExplainNode {
        id,
        node_type: label.to_string(),
        relation: None,
        startup_cost: None,
        total_cost: obj.get("cost").and_then(parse_json_number),
        plan_rows: None,
        actual_rows,
        actual_time_ms,
        actual_loops,
        buffers_hit: None,
        buffers_read: None,
        filter: None,
        index_condition: None,
        join_type: None,
        hash_condition: None,
        extra: std::collections::HashMap::new(),
        children,
    }
}

fn parse_mysql_query_block(block: &serde_json::Value, counter: &mut u32) -> ExplainNode {
    let id = format!("node_{}", counter);
    *counter += 1;

    // Determine node type from the query block structure
    let (node_type, relation, plan_rows, startup_cost, total_cost, filter) = if let Some(table) =
        block.get("table")
    {
        let access = table
            .get("access_type")
            .and_then(|v| v.as_str())
            .unwrap_or("ALL");
        let node_type = match access {
            "ALL" => "Full Table Scan",
            "index" => "Index Scan",
            "range" => "Range Scan",
            "ref" => "Index Lookup",
            "eq_ref" => "Unique Index Lookup",
            "const" | "system" => "Const Lookup",
            "fulltext" => "Fulltext Search",
            other => other,
        }
        .to_string();
        let rel = table
            .get("table_name")
            .and_then(|v| v.as_str())
            .map(String::from);

        // Rows: MySQL 8 uses rows_examined_per_scan, MariaDB uses rows
        let rows = table
            .get("rows_examined_per_scan")
            .and_then(|v| v.as_f64())
            .or_else(|| table.get("rows").and_then(|v| v.as_f64()));

        // Cost: MySQL 8 uses cost_info.prefix_cost / read_cost;
        // MariaDB puts "cost" directly on the table object.
        let cost_info = table.get("cost_info");
        let startup = cost_info
            .and_then(|c| c.get("read_cost"))
            .and_then(parse_json_number);
        let total = cost_info
            .and_then(|c| c.get("prefix_cost"))
            .and_then(parse_json_number)
            .or(startup)
            .or_else(|| table.get("cost").and_then(parse_json_number));

        let filt = table
            .get("attached_condition")
            .and_then(|v| v.as_str())
            .map(String::from);
        (node_type, rel, rows, startup, total, filt)
    } else {
        // Non-table node: detect operation type from child keys
        let node_type = if block
            .get("using_filesort")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            "Filesort".to_string()
        } else if block.get("grouping_operation").is_some() {
            "Group".to_string()
        } else if block.get("duplicates_removal").is_some() {
            "Duplicate Removal".to_string()
        } else if block.get("having_condition").is_some() {
            "Having Filter".to_string()
        } else if block.get("window_functions_computation").is_some() {
            "Window Functions".to_string()
        } else {
            "Query Block".to_string()
        };

        // Extract cost from block-level cost_info (MySQL) or direct "cost" (MariaDB)
        let cost_info = block.get("cost_info");
        let total = cost_info
            .and_then(|c| {
                c.get("query_cost")
                    .or_else(|| c.get("sort_cost"))
                    .or_else(|| c.get("prefix_cost"))
            })
            .and_then(parse_json_number)
            .or_else(|| block.get("cost").and_then(parse_json_number));

        let filt = block
            .get("having_condition")
            .and_then(|v| v.as_str())
            .map(String::from);

        (node_type, None, None, None, total, filt)
    };

    // Collect extra fields from the table object
    let known_keys: &[&str] = &[
        "access_type",
        "table_name",
        "rows_examined_per_scan",
        "rows",
        "cost_info",
        "attached_condition",
        "key",
        "possible_keys",
        "used_key_parts",
    ];
    let mut extra = std::collections::HashMap::new();
    if let Some(table) = block.get("table").and_then(|t| t.as_object()) {
        for (k, v) in table {
            if !known_keys.contains(&k.as_str()) {
                extra.insert(k.clone(), v.clone());
            }
        }
    }
    if let Some(table) = block.get("table") {
        if let Some(key) = table.get("key").and_then(|v| v.as_str()) {
            extra.insert(
                "key".to_string(),
                serde_json::Value::String(key.to_string()),
            );
        }
    }

    // Parse children from nested_loop, ordering_operation, subqueries, etc.
    let mut children = Vec::new();

    if let Some(nested_loop) = block.get("nested_loop").and_then(|v| v.as_array()) {
        for item in nested_loop {
            if item.get("table").is_some() {
                children.push(parse_mysql_query_block(item, counter));
            } else if let Some(rsf) = item.get("read_sorted_file") {
                children.push(parse_mariadb_wrapper(rsf, "Read Sorted File", counter));
            } else if let Some(fs) = item.get("filesort") {
                if fs.is_object() {
                    children.push(parse_mariadb_filesort(fs, counter));
                }
            } else if let Some(tmp) = item.get("temporary_table") {
                children.push(parse_mariadb_temporary_table(tmp, counter));
            } else if let Some(mat) = item.get("materialized") {
                children.push(parse_mariadb_wrapper(mat, "Materialized Subquery", counter));
            } else if let Some(buf) = item.get("buffer_result") {
                children.push(parse_mariadb_wrapper(buf, "Buffer Result", counter));
            }
        }
    }

    if let Some(order_op) = block.get("ordering_operation") {
        children.push(parse_mysql_query_block(order_op, counter));
    }

    if let Some(group_op) = block.get("grouping_operation") {
        children.push(parse_mysql_query_block(group_op, counter));
    }

    if let Some(dup_op) = block.get("duplicates_removal") {
        children.push(parse_mysql_query_block(dup_op, counter));
    }

    if let Some(subqueries) = block
        .get("optimized_away_subqueries")
        .and_then(|v| v.as_array())
    {
        for sq in subqueries {
            children.push(parse_mysql_query_block(sq, counter));
        }
    }

    if let Some(attached) = block
        .get("attached_subqueries")
        .and_then(|v| v.as_array())
    {
        for sq in attached {
            children.push(parse_mysql_query_block(sq, counter));
        }
    }

    // MariaDB: "subqueries" array — each entry may be a subquery_cache wrapper
    // or a direct query_block.
    if let Some(subqueries) = block.get("subqueries").and_then(|v| v.as_array()) {
        for sq in subqueries {
            if let Some(cache) = sq.get("subquery_cache") {
                children.push(parse_mariadb_subquery_cache(cache, counter));
            } else if sq.get("query_block").is_some() || sq.get("table").is_some() {
                children.push(parse_mysql_query_block(sq, counter));
            }
        }
    }

    // MariaDB: filesort as nested object (not the boolean using_filesort flag)
    if let Some(filesort) = block.get("filesort") {
        if filesort.is_object() {
            children.push(parse_mariadb_filesort(filesort, counter));
        }
    }

    // MariaDB: temporary_table wrapper around nested_loop
    if let Some(tmp_tbl) = block.get("temporary_table") {
        children.push(parse_mariadb_temporary_table(tmp_tbl, counter));
    }

    // MariaDB: materialized subquery (e.g. IN (SELECT …) materialised as temp table)
    if let Some(mat) = block.get("materialized") {
        children.push(parse_mariadb_wrapper(mat, "Materialized Subquery", counter));
    }

    // MariaDB / MySQL: union_result — combines rows from UNION branches
    if let Some(union_res) = block.get("union_result") {
        children.push(parse_mariadb_wrapper(union_res, "Union Result", counter));
    }

    // MariaDB: buffer_result (SQL_BUFFER_RESULT hint)
    if let Some(buf) = block.get("buffer_result") {
        children.push(parse_mariadb_wrapper(buf, "Buffer Result", counter));
    }

    // MariaDB: window_functions_computation (window functions)
    if let Some(wf) = block.get("window_functions_computation") {
        children.push(parse_mariadb_wrapper(wf, "Window Functions", counter));
    }

    // MariaDB: expression_cache (cached subquery results)
    if let Some(ec) = block.get("expression_cache") {
        children.push(parse_mariadb_wrapper(ec, "Expression Cache", counter));
    }

    // MariaDB: read_sorted_file (after filesort writes to disk)
    if let Some(rsf) = block.get("read_sorted_file") {
        children.push(parse_mariadb_wrapper(rsf, "Read Sorted File", counter));
    }

    // MariaDB: query_specifications inside union_result
    if let Some(specs) = block.get("query_specifications").and_then(|v| v.as_array()) {
        for spec in specs {
            children.push(parse_mysql_query_block(spec, counter));
        }
    }

    let index_condition = block
        .get("table")
        .and_then(|t| t.get("key"))
        .and_then(|v| v.as_str())
        .map(String::from);

    // MariaDB ANALYZE data: r_total_time_ms, r_rows, r_loops.
    // Table objects may use r_table_time_ms + r_other_time_ms instead of
    // r_total_time_ms. Non-table nodes (query_block) carry these at block level.
    let table_obj = block.get("table");
    let actual_time_ms = table_obj
        .and_then(|t| t.get("r_total_time_ms"))
        .and_then(|v| v.as_f64())
        .or_else(|| {
            // MariaDB tables: r_table_time_ms + r_other_time_ms
            let tbl = table_obj?;
            let table_ms = tbl.get("r_table_time_ms").and_then(|v| v.as_f64());
            let other_ms = tbl.get("r_other_time_ms").and_then(|v| v.as_f64());
            match (table_ms, other_ms) {
                (Some(t), Some(o)) => Some(t + o),
                (Some(t), None) => Some(t),
                _ => None,
            }
        })
        // Fallback: block-level r_total_time_ms (non-table nodes)
        .or_else(|| block.get("r_total_time_ms").and_then(|v| v.as_f64()));
    let actual_rows = table_obj
        .and_then(|t| t.get("r_rows"))
        .and_then(|v| v.as_f64())
        .or_else(|| block.get("r_rows").and_then(|v| v.as_f64()));
    let actual_loops = table_obj
        .and_then(|t| t.get("r_loops"))
        .and_then(|v| v.as_u64())
        .or_else(|| {
            table_obj
                .and_then(|t| t.get("r_loops"))
                .and_then(|v| v.as_f64())
                .map(|f| f as u64)
        })
        // Fallback: block-level r_loops
        .or_else(|| block.get("r_loops").and_then(|v| v.as_u64()))
        .or_else(|| {
            block
                .get("r_loops")
                .and_then(|v| v.as_f64())
                .map(|f| f as u64)
        });

    ExplainNode {
        id,
        node_type,
        relation,
        startup_cost,
        total_cost,
        plan_rows,
        actual_rows,
        actual_time_ms,
        actual_loops,
        buffers_hit: None,
        buffers_read: None,
        filter,
        index_condition,
        join_type: None,
        hash_condition: None,
        extra,
        children,
    }
}

// ---------------------------------------------------------------------------
// EXPLAIN ANALYZE text parser (MySQL 8.0.18+)
// ---------------------------------------------------------------------------

struct AnalyzeParsedLine {
    depth: usize,
    node_type: String,
    relation: Option<String>,
    filter: Option<String>,
    index_condition: Option<String>,
    join_type: Option<String>,
    est_cost: Option<f64>,
    est_rows: Option<f64>,
    actual_time_ms: Option<f64>,
    actual_rows: Option<f64>,
    actual_loops: Option<u64>,
}

/// Check recursively whether any node in the tree has actual analyze data.
fn has_analyze_data_recursive(node: &ExplainNode) -> bool {
    if node.actual_rows.is_some() || node.actual_time_ms.is_some() {
        return true;
    }
    node.children.iter().any(has_analyze_data_recursive)
}

/// Parse MySQL EXPLAIN ANALYZE text output into a plan tree.
///
/// Each line looks like:
/// `    -> Table scan on t1  (cost=1.25 rows=10) (actual time=0.045..0.145 rows=10 loops=1)`
fn parse_mysql_analyze_text(text: &str, counter: &mut u32) -> ExplainNode {
    let mut parsed_lines: Vec<AnalyzeParsedLine> = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            continue;
        }

        // Count leading spaces for depth (4 spaces = 1 level)
        let leading = trimmed.len() - trimmed.trim_start().len();
        let depth = leading / 4;

        let content = trimmed.trim_start();

        // Lines must start with "-> "
        let desc_rest = match content.strip_prefix("-> ") {
            Some(r) => r,
            None => continue,
        };

        // Description ends at double-space-paren "  ("
        let desc_end = desc_rest.find("  (").unwrap_or(desc_rest.len());
        let description = &desc_rest[..desc_end];
        let metrics = &desc_rest[desc_end..];

        let (est_cost, est_rows) = parse_analyze_estimated(metrics);
        let (actual_time_ms, actual_rows, actual_loops) = parse_analyze_actual(metrics);
        let (node_type, relation, filter, index_condition, join_type) =
            map_analyze_description(description);

        parsed_lines.push(AnalyzeParsedLine {
            depth,
            node_type,
            relation,
            filter,
            index_condition,
            join_type,
            est_cost,
            est_rows,
            actual_time_ms,
            actual_rows,
            actual_loops,
        });
    }

    if parsed_lines.is_empty() {
        let id = format!("node_{}", counter);
        *counter += 1;
        return ExplainNode {
            id,
            node_type: "Query".to_string(),
            relation: None,
            startup_cost: None,
            total_cost: None,
            plan_rows: None,
            actual_rows: None,
            actual_time_ms: None,
            actual_loops: None,
            buffers_hit: None,
            buffers_read: None,
            filter: None,
            index_condition: None,
            join_type: None,
            hash_condition: None,
            extra: std::collections::HashMap::new(),
            children: vec![],
        };
    }

    let (mut roots, _) = build_analyze_tree(&parsed_lines, 0, -1, counter);
    if roots.len() == 1 {
        roots.remove(0)
    } else {
        // Multiple roots — wrap in a Query node
        let id = format!("node_{}", counter);
        *counter += 1;
        ExplainNode {
            id,
            node_type: "Query".to_string(),
            relation: None,
            startup_cost: None,
            total_cost: None,
            plan_rows: None,
            actual_rows: None,
            actual_time_ms: None,
            actual_loops: None,
            buffers_hit: None,
            buffers_read: None,
            filter: None,
            index_condition: None,
            join_type: None,
            hash_condition: None,
            extra: std::collections::HashMap::new(),
            children: roots,
        }
    }
}

/// Recursively build a tree from parsed lines using indentation depth.
fn build_analyze_tree(
    lines: &[AnalyzeParsedLine],
    start: usize,
    parent_depth: i32,
    counter: &mut u32,
) -> (Vec<ExplainNode>, usize) {
    let mut children = Vec::new();
    let mut i = start;

    while i < lines.len() {
        let depth = lines[i].depth as i32;
        if depth <= parent_depth {
            break;
        }

        let id = format!("node_{}", counter);
        *counter += 1;

        let (grandchildren, next_i) = build_analyze_tree(lines, i + 1, depth, counter);

        children.push(ExplainNode {
            id,
            node_type: lines[i].node_type.clone(),
            relation: lines[i].relation.clone(),
            startup_cost: None,
            total_cost: lines[i].est_cost,
            plan_rows: lines[i].est_rows,
            actual_rows: lines[i].actual_rows,
            actual_time_ms: lines[i].actual_time_ms,
            actual_loops: lines[i].actual_loops,
            buffers_hit: None,
            buffers_read: None,
            filter: lines[i].filter.clone(),
            index_condition: lines[i].index_condition.clone(),
            join_type: lines[i].join_type.clone(),
            hash_condition: None,
            extra: std::collections::HashMap::new(),
            children: grandchildren,
        });

        i = next_i;
    }

    (children, i)
}

/// Extract estimated cost and rows from "(cost=X rows=Y)" section.
fn parse_analyze_estimated(s: &str) -> (Option<f64>, Option<f64>) {
    // Find "(cost=" that is NOT inside "(actual"
    let idx = match s.find("(cost=") {
        Some(i) => i,
        None => return (None, None),
    };
    let section = &s[idx..];
    let end = match section.find(')') {
        Some(e) => e,
        None => return (None, None),
    };
    let inner = &section[1..end]; // "cost=X rows=Y"
    let mut cost = None;
    let mut rows = None;
    for part in inner.split_whitespace() {
        if let Some(val) = part.strip_prefix("cost=") {
            cost = val.parse().ok();
        } else if let Some(val) = part.strip_prefix("rows=") {
            rows = val.parse().ok();
        }
    }
    (cost, rows)
}

/// Extract actual time, rows, loops from "(actual time=X..Y rows=Z loops=W)" section.
fn parse_analyze_actual(s: &str) -> (Option<f64>, Option<f64>, Option<u64>) {
    let idx = match s.find("(actual time=") {
        Some(i) => i,
        None => return (None, None, None),
    };
    let section = &s[idx..];
    let end = match section.find(')') {
        Some(e) => e,
        None => return (None, None, None),
    };
    let inner = &section[1..end]; // "actual time=X..Y rows=Z loops=W"
    let mut time_ms = None;
    let mut rows = None;
    let mut loops = None;
    for part in inner.split_whitespace() {
        if let Some(val) = part.strip_prefix("time=") {
            // Use end time (after "..") as total time
            if let Some(dot_pos) = val.find("..") {
                time_ms = val[dot_pos + 2..].parse().ok();
            } else {
                time_ms = val.parse().ok();
            }
        } else if let Some(val) = part.strip_prefix("rows=") {
            rows = val.parse().ok();
        } else if let Some(val) = part.strip_prefix("loops=") {
            loops = val.parse().ok();
        }
    }
    (time_ms, rows, loops)
}

/// Map an EXPLAIN ANALYZE description to (node_type, relation, filter, index_condition, join_type).
fn map_analyze_description(
    desc: &str,
) -> (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    let lower = desc.to_lowercase();
    let relation = extract_on_relation(desc);
    let index_cond = extract_using_index(desc);

    let (node_type, filter, join_type) = if lower.starts_with("table scan") {
        ("Full Table Scan".into(), None, None)
    } else if lower.starts_with("covering index scan") {
        ("Index Only Scan".into(), None, None)
    } else if lower.starts_with("index range scan") || lower.starts_with("range scan") {
        ("Range Scan".into(), None, None)
    } else if lower.starts_with("index scan") {
        ("Index Scan".into(), None, None)
    } else if lower.starts_with("single-row index lookup") {
        ("Unique Index Lookup".into(), None, None)
    } else if lower.starts_with("index lookup") || lower.starts_with("multi-range index lookup") {
        ("Index Lookup".into(), None, None)
    } else if lower.starts_with("constant row") {
        ("Const Lookup".into(), None, None)
    } else if lower.starts_with("nested loop") {
        let jt = if lower.contains("inner") {
            Some("Inner".into())
        } else if lower.contains("left") {
            Some("Left".into())
        } else if lower.contains("semijoin") {
            Some("Semi".into())
        } else if lower.contains("antijoin") || lower.contains("anti") {
            Some("Anti".into())
        } else {
            None
        };
        ("Nested Loop".into(), None, jt)
    } else if lower.contains("hash join") {
        let jt = if lower.contains("left") {
            Some("Left".into())
        } else {
            Some("Inner".into())
        };
        ("Hash Join".into(), None, jt)
    } else if lower.starts_with("filter:") {
        let filt = desc
            .get(7..)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        ("Filter".into(), filt, None)
    } else if lower.starts_with("sort:") || lower.starts_with("sort row") {
        ("Sort".into(), None, None)
    } else if lower.starts_with("limit:") || lower.starts_with("limit ") {
        ("Limit".into(), None, None)
    } else if lower.starts_with("group aggregate") || lower.starts_with("aggregate") {
        ("Aggregate".into(), None, None)
    } else if lower.starts_with("temporary table") || lower.starts_with("materialize") {
        ("Materialize".into(), None, None)
    } else if lower.starts_with("stream results") || lower.starts_with("stream") {
        ("Stream".into(), None, None)
    } else if lower.starts_with("window aggregate") || lower.starts_with("window") {
        ("Window".into(), None, None)
    } else {
        (desc.to_string(), None, None)
    };

    (node_type, relation, filter, index_cond, join_type)
}

/// Extract table/relation name from "... on <table> ..." pattern.
fn extract_on_relation(desc: &str) -> Option<String> {
    let pos = desc.find(" on ")?;
    let after = &desc[pos + 4..];
    let end = after
        .find(|c: char| c == ' ' || c == '(')
        .unwrap_or(after.len());
    let name = after[..end].trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

/// Extract index name from "... using <index> ..." pattern.
fn extract_using_index(desc: &str) -> Option<String> {
    let lower = desc.to_lowercase();
    let pos = lower.find(" using ")?;
    let after = &desc[pos + 7..];
    let end = after
        .find(|c: char| c == ' ' || c == '(')
        .unwrap_or(after.len());
    let name = after[..end].trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
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
                    manage_tables: true,
                    readonly: false,
                },
                is_builtin: true,
                default_username: "root".to_string(),
                color: "#f97316".to_string(),
                icon: "mysql".to_string(),
                settings: vec![],
                ui_extensions: None,
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

    async fn ping(&self, params: &crate::models::ConnectionParams) -> Result<(), String> {
        let conn_id = params.connection_id.as_deref();
        if !crate::pool_manager::has_pool(params, conn_id).await {
            return Err("No active connection pool".into());
        }
        let pool = crate::pool_manager::get_mysql_pool_with_id(params, conn_id).await?;
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        sqlx::Connection::ping(&mut *conn).await.map_err(|e| e.to_string())
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

    async fn explain_query(&self, params: &crate::models::ConnectionParams, query: &str, analyze: bool, schema: Option<&str>) -> Result<crate::models::ExplainPlan, String> {
        explain_query(params, query, analyze, schema).await
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: parse a MariaDB ANALYZE FORMAT=JSON string and return the root node.
    fn parse_json(json: &str) -> ExplainNode {
        let val: serde_json::Value = serde_json::from_str(json).expect("invalid JSON");
        let qb = val.get("query_block").expect("missing query_block");
        let mut counter = 0u32;
        parse_mysql_query_block(qb, &mut counter)
    }

    /// Helper: flatten a tree into a vec in pre-order.
    fn flatten(node: &ExplainNode) -> Vec<&ExplainNode> {
        let mut out = vec![node];
        for child in &node.children {
            out.extend(flatten(child));
        }
        out
    }

    // -- MariaDB filesort → temporary_table → nested_loop → table ------------

    #[test]
    fn test_mariadb_filesort_temporary_table() {
        let root = parse_json(r#"{
            "query_block": {
                "select_id": 1,
                "cost": 0.87,
                "r_loops": 1,
                "r_total_time_ms": 3.22,
                "filesort": {
                    "sort_key": "count(0) desc",
                    "r_loops": 1,
                    "r_total_time_ms": 0.02,
                    "r_output_rows": 4,
                    "r_buffer_size": "360",
                    "r_sort_mode": "sort_key,rowid",
                    "temporary_table": {
                        "nested_loop": [
                            {
                                "table": {
                                    "table_name": "audit_log",
                                    "access_type": "ALL",
                                    "rows": 5131,
                                    "r_rows": 5146,
                                    "cost": 0.87,
                                    "r_table_time_ms": 1.77,
                                    "r_other_time_ms": 1.41,
                                    "attached_condition": "audit_log.`action` = 'login'"
                                }
                            }
                        ]
                    }
                }
            }
        }"#);

        let nodes = flatten(&root);
        assert_eq!(nodes.len(), 4, "expected 4 nodes: QueryBlock → Filesort → TempTable → TableScan");

        // Root: Query Block with block-level timing
        assert_eq!(root.node_type, "Query Block");
        assert!((root.total_cost.unwrap() - 0.87).abs() < 0.01);
        assert!((root.actual_time_ms.unwrap() - 3.22).abs() < 0.01);

        // Filesort with sort_key extra
        let filesort = &root.children[0];
        assert_eq!(filesort.node_type, "Filesort");
        assert!((filesort.actual_time_ms.unwrap() - 0.02).abs() < 0.01);
        assert_eq!(
            filesort.extra.get("sort_key").and_then(|v| v.as_str()),
            Some("count(0) desc")
        );

        // Temporary Table
        let tmp = &filesort.children[0];
        assert_eq!(tmp.node_type, "Temporary Table");

        // Table scan with r_table_time_ms + r_other_time_ms
        let scan = &tmp.children[0];
        assert_eq!(scan.node_type, "Full Table Scan");
        assert_eq!(scan.relation.as_deref(), Some("audit_log"));
        assert!((scan.plan_rows.unwrap() - 5131.0).abs() < 0.1);
        assert!((scan.actual_rows.unwrap() - 5146.0).abs() < 0.1);
        assert_eq!(
            scan.filter.as_deref(),
            Some("audit_log.`action` = 'login'")
        );
        // r_table_time_ms(1.77) + r_other_time_ms(1.41) = 3.18
        assert!((scan.actual_time_ms.unwrap() - 3.18).abs() < 0.01);
    }

    // -- Simple table scan without wrappers ------------------------------------

    #[test]
    fn test_simple_table_scan() {
        let root = parse_json(r#"{
            "query_block": {
                "select_id": 1,
                "table": {
                    "table_name": "users",
                    "access_type": "ALL",
                    "rows": 1000,
                    "filtered": 100,
                    "r_rows": 998,
                    "r_total_time_ms": 0.5
                }
            }
        }"#);

        assert_eq!(root.node_type, "Full Table Scan");
        assert_eq!(root.relation.as_deref(), Some("users"));
        assert!((root.plan_rows.unwrap() - 1000.0).abs() < 0.1);
        assert!((root.actual_time_ms.unwrap() - 0.5).abs() < 0.01);
    }

    // -- Nested loop join (two tables) ----------------------------------------

    #[test]
    fn test_nested_loop_join() {
        let root = parse_json(r#"{
            "query_block": {
                "select_id": 1,
                "cost": 5.0,
                "nested_loop": [
                    {
                        "table": {
                            "table_name": "orders",
                            "access_type": "ALL",
                            "rows": 100
                        }
                    },
                    {
                        "table": {
                            "table_name": "items",
                            "access_type": "ref",
                            "rows": 5
                        }
                    }
                ]
            }
        }"#);

        assert_eq!(root.node_type, "Query Block");
        assert_eq!(root.children.len(), 2);
        assert_eq!(root.children[0].relation.as_deref(), Some("orders"));
        assert_eq!(root.children[0].node_type, "Full Table Scan");
        assert_eq!(root.children[1].relation.as_deref(), Some("items"));
        assert_eq!(root.children[1].node_type, "Index Lookup");
    }

    // -- Materialized subquery -------------------------------------------------

    #[test]
    fn test_materialized_subquery() {
        let root = parse_json(r#"{
            "query_block": {
                "select_id": 1,
                "nested_loop": [
                    {
                        "table": {
                            "table_name": "orders",
                            "access_type": "ALL",
                            "rows": 100
                        }
                    }
                ],
                "materialized": {
                    "query_block": {
                        "select_id": 2,
                        "table": {
                            "table_name": "big_lookup",
                            "access_type": "ALL",
                            "rows": 50000
                        }
                    }
                }
            }
        }"#);

        let nodes = flatten(&root);
        // QueryBlock → orders (from nested_loop) + Materialized → QueryBlock → big_lookup
        assert_eq!(nodes.len(), 4);

        let mat = nodes.iter().find(|n| n.node_type == "Materialized Subquery");
        assert!(mat.is_some(), "should have Materialized Subquery node");

        let big = nodes.iter().find(|n| n.relation.as_deref() == Some("big_lookup"));
        assert!(big.is_some(), "should have big_lookup table");
    }

    // -- Union result ---------------------------------------------------------

    #[test]
    fn test_union_result() {
        let root = parse_json(r#"{
            "query_block": {
                "select_id": 1,
                "union_result": {
                    "table_name": "<union1,2>",
                    "access_type": "ALL",
                    "r_loops": 1,
                    "r_total_time_ms": 0.5,
                    "query_specifications": [
                        {
                            "query_block": {
                                "select_id": 1,
                                "table": {
                                    "table_name": "users",
                                    "access_type": "ALL",
                                    "rows": 100
                                }
                            }
                        },
                        {
                            "query_block": {
                                "select_id": 2,
                                "table": {
                                    "table_name": "admins",
                                    "access_type": "ALL",
                                    "rows": 10
                                }
                            }
                        }
                    ]
                }
            }
        }"#);

        let nodes = flatten(&root);
        let union = nodes.iter().find(|n| n.node_type == "Union Result");
        assert!(union.is_some(), "should have Union Result node");
        let u = union.unwrap();
        assert!((u.actual_time_ms.unwrap() - 0.5).abs() < 0.01);
        // Union result should have 2 children (the query_specifications)
        assert_eq!(u.children.len(), 2);
    }

    // -- Having condition -----------------------------------------------------

    #[test]
    fn test_having_condition() {
        let root = parse_json(r#"{
            "query_block": {
                "select_id": 1,
                "cost": 1.5,
                "having_condition": "cnt > 5",
                "filesort": {
                    "sort_key": "cnt desc",
                    "r_loops": 1,
                    "r_total_time_ms": 0.01,
                    "temporary_table": {
                        "nested_loop": [
                            {
                                "table": {
                                    "table_name": "events",
                                    "access_type": "ALL",
                                    "rows": 500
                                }
                            }
                        ]
                    }
                }
            }
        }"#);

        // Root should be "Having Filter" because having_condition is present
        assert_eq!(root.node_type, "Having Filter");
        assert_eq!(root.filter.as_deref(), Some("cnt > 5"));
    }

    // -- MariaDB filesort directly wrapping nested_loop (no temp table) -------

    #[test]
    fn test_filesort_without_temporary_table() {
        let root = parse_json(r#"{
            "query_block": {
                "select_id": 1,
                "filesort": {
                    "sort_key": "t.name",
                    "r_loops": 1,
                    "r_total_time_ms": 0.1,
                    "nested_loop": [
                        {
                            "table": {
                                "table_name": "t",
                                "access_type": "range",
                                "rows": 50
                            }
                        }
                    ]
                }
            }
        }"#);

        assert_eq!(root.node_type, "Query Block");
        let filesort = &root.children[0];
        assert_eq!(filesort.node_type, "Filesort");
        assert_eq!(filesort.children.len(), 1);
        assert_eq!(filesort.children[0].node_type, "Range Scan");
        assert_eq!(filesort.children[0].relation.as_deref(), Some("t"));
    }

    // -- read_sorted_file in nested_loop + subqueries with subquery_cache -----

    #[test]
    fn test_read_sorted_file_in_nested_loop_with_subquery_cache() {
        let root = parse_json(r#"{
            "query_block": {
                "select_id": 1,
                "cost": 0.41,
                "r_loops": 1,
                "r_total_time_ms": 10.94,
                "nested_loop": [
                    {
                        "read_sorted_file": {
                            "r_rows": 20,
                            "filesort": {
                                "sort_key": "p.view_count desc",
                                "r_loops": 1,
                                "r_total_time_ms": 9.95,
                                "r_limit": 20,
                                "r_used_priority_queue": true,
                                "r_output_rows": 21,
                                "r_sort_mode": "sort_key,rowid",
                                "table": {
                                    "table_name": "p",
                                    "access_type": "ALL",
                                    "rows": 1944,
                                    "r_rows": 2000,
                                    "cost": 0.41,
                                    "r_table_time_ms": 1.40,
                                    "r_other_time_ms": 2.02,
                                    "filtered": 100,
                                    "r_filtered": 50.55,
                                    "attached_condition": "p.view_count > (subquery#5)"
                                }
                            }
                        }
                    }
                ],
                "subqueries": [
                    {
                        "subquery_cache": {
                            "r_loops": 2000,
                            "r_hit_ratio": 99,
                            "query_block": {
                                "select_id": 5,
                                "cost": 0.18,
                                "r_loops": 20,
                                "r_total_time_ms": 6.60,
                                "nested_loop": [
                                    {
                                        "table": {
                                            "table_name": "p2",
                                            "access_type": "ref",
                                            "key": "idx_category",
                                            "rows": 97,
                                            "r_rows": 100,
                                            "cost": 0.18,
                                            "r_table_time_ms": 5.91,
                                            "r_other_time_ms": 0.64
                                        }
                                    }
                                ]
                            }
                        }
                    },
                    {
                        "subquery_cache": {
                            "r_loops": 20,
                            "r_hit_ratio": 0,
                            "query_block": {
                                "select_id": 4,
                                "nested_loop": [
                                    {
                                        "table": {
                                            "table_name": "pt",
                                            "access_type": "ref",
                                            "key": "PRIMARY",
                                            "rows": 2,
                                            "r_rows": 2.35
                                        }
                                    }
                                ]
                            }
                        }
                    }
                ]
            }
        }"#);

        let nodes = flatten(&root);

        // Root: Query Block
        assert_eq!(root.node_type, "Query Block");
        assert!((root.actual_time_ms.unwrap() - 10.94).abs() < 0.01);

        // Should have: Read Sorted File + 2 Subquery Cache children
        assert_eq!(root.children.len(), 3);

        // First child: Read Sorted File (from nested_loop)
        let rsf = &root.children[0];
        assert_eq!(rsf.node_type, "Read Sorted File");
        assert!((rsf.actual_rows.unwrap() - 20.0).abs() < 0.1);

        // Inside read_sorted_file: Filesort
        assert_eq!(rsf.children.len(), 1);
        let filesort = &rsf.children[0];
        assert_eq!(filesort.node_type, "Filesort");
        assert!((filesort.actual_time_ms.unwrap() - 9.95).abs() < 0.01);
        assert_eq!(
            filesort.extra.get("sort_key").and_then(|v| v.as_str()),
            Some("p.view_count desc")
        );
        assert_eq!(
            filesort.extra.get("r_limit").and_then(|v| v.as_u64()),
            Some(20)
        );
        assert_eq!(
            filesort.extra.get("r_used_priority_queue").and_then(|v| v.as_bool()),
            Some(true)
        );

        // Inside filesort: direct table "p"
        assert_eq!(filesort.children.len(), 1);
        let table_p = &filesort.children[0];
        assert_eq!(table_p.node_type, "Full Table Scan");
        assert_eq!(table_p.relation.as_deref(), Some("p"));
        assert_eq!(
            table_p.filter.as_deref(),
            Some("p.view_count > (subquery#5)")
        );

        // Second child: Subquery Cache with r_hit_ratio=99
        let cache1 = &root.children[1];
        assert_eq!(cache1.node_type, "Subquery Cache");
        assert_eq!(cache1.actual_loops, Some(2000));
        assert_eq!(
            cache1.extra.get("r_hit_ratio").and_then(|v| v.as_u64()),
            Some(99)
        );
        // Should have a query_block child with table p2
        let p2 = nodes.iter().find(|n| n.relation.as_deref() == Some("p2"));
        assert!(p2.is_some(), "should have table p2 from subquery_cache");
        assert_eq!(p2.unwrap().node_type, "Index Lookup");

        // Third child: Subquery Cache with r_hit_ratio=0
        let cache2 = &root.children[2];
        assert_eq!(cache2.node_type, "Subquery Cache");
        assert_eq!(cache2.actual_loops, Some(20));
        assert_eq!(
            cache2.extra.get("r_hit_ratio").and_then(|v| v.as_u64()),
            Some(0)
        );
        let pt = nodes.iter().find(|n| n.relation.as_deref() == Some("pt"));
        assert!(pt.is_some(), "should have table pt from subquery_cache");
    }

    // -- Filesort with direct table (no nested_loop / temporary_table) --------

    #[test]
    fn test_filesort_with_direct_table() {
        let root = parse_json(r#"{
            "query_block": {
                "select_id": 1,
                "filesort": {
                    "sort_key": "t.id desc",
                    "r_loops": 1,
                    "r_total_time_ms": 0.5,
                    "r_output_rows": 10,
                    "table": {
                        "table_name": "t",
                        "access_type": "ALL",
                        "rows": 100,
                        "r_rows": 100,
                        "r_table_time_ms": 0.3,
                        "r_other_time_ms": 0.1
                    }
                }
            }
        }"#);

        assert_eq!(root.node_type, "Query Block");
        let filesort = &root.children[0];
        assert_eq!(filesort.node_type, "Filesort");
        assert_eq!(filesort.children.len(), 1);
        let table = &filesort.children[0];
        assert_eq!(table.node_type, "Full Table Scan");
        assert_eq!(table.relation.as_deref(), Some("t"));
        assert!((table.actual_rows.unwrap() - 100.0).abs() < 0.1);
    }
}
