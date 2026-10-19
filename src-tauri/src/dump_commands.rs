use crate::commands::{
    expand_k8s_connection_params, expand_ssh_connection_params, find_connection_by_id,
    register_abort_handle, resolve_connection_params_with_id, unregister_abort_handle,
    AbortHandleMap,
};
use crate::drivers::driver_trait::DatabaseDriver;
use crate::dump_utils::DumpDialect;
use crate::models::{ConnectionParams, Pagination, TableColumn};
use crate::pool_manager::{get_mysql_pool, get_postgres_pool, get_sqlite_pool};
use futures::TryStreamExt;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Runtime, State};
use zip::ZipArchive;

#[derive(Debug, Serialize, Deserialize)]
pub struct DumpOptions {
    pub structure: bool,
    pub data: bool,
    pub tables: Option<Vec<String>>, // None = All
}

#[derive(Default)]
pub struct DumpCancellationState {
    pub handles: Arc<Mutex<AbortHandleMap>>,
}

/// Slot key for the cancellation registry. Imports share the dump state
/// but need a distinct slot so `cancel_dump` and `cancel_import` don't
/// alias each other.
fn import_slot_key(connection_id: &str) -> String {
    format!("{}_import", connection_id)
}

pub fn db_backup_slot_key(connection_id: &str) -> String {
    format!("{}_db_backup", connection_id)
}

#[tauri::command]
pub async fn cancel_dump(
    state: State<'_, DumpCancellationState>,
    connection_id: String,
) -> Result<(), String> {
    let entries = {
        let mut handles = state.handles.lock().unwrap();
        handles.remove(&connection_id).unwrap_or_default()
    };
    if entries.is_empty() {
        return Err("No active dump process found".into());
    }
    for handle in entries {
        handle.abort();
    }
    Ok(())
}

pub async fn dump_database_with_handles<R: Runtime>(
    app: &AppHandle<R>,
    handles: &Arc<Mutex<AbortHandleMap>>,
    slot_key: String,
    connection_id: String,
    file_path: String,
    options: DumpOptions,
    schema: Option<String>,
    database: Option<String>,
) -> Result<(), String> {
    let saved_conn = find_connection_by_id(app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(app, &expanded_params).await?;
    let mut params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    // Scope the dump to the selected database on connections that expose multiple
    // databases (e.g. MySQL/MariaDB). Without this the connection pool stays bound
    // to the primary database, so unqualified statements such as `SHOW CREATE TABLE`
    // and `SELECT * FROM table` run against the wrong database.
    if let Some(db) = database.filter(|d| !d.is_empty()) {
        params.database = crate::models::DatabaseSelection::Single(db);
    }
    let driver = saved_conn.params.driver.clone();

    // Spawn the dump process
    let task = tokio::spawn(async move {
        let file = File::create(&file_path).map_err(|e| e.to_string())?;
        let mut writer = BufWriter::new(file);

        // Write header
        writeln!(writer, "-- Tabularis Dump").map_err(|e| e.to_string())?;
        writeln!(writer, "-- Database: {}", params.database).map_err(|e| e.to_string())?;
        writeln!(writer, "-- Date: {}\n", chrono::Local::now().to_rfc3339())
            .map_err(|e| e.to_string())?;

        // Get tables
        let drv = crate::drivers::registry::get_connection_driver(&params).await?;
        // Quoting, schema qualification and literal syntax follow the
        // driver's capabilities, so plugin drivers (backtick quoting,
        // datasets as schemas, ...) get statements their engine accepts.
        let dialect = DumpDialect::from_capabilities(&driver, &drv.manifest().capabilities);
        let schema = dialect.resolve_schema(schema.as_deref());
        // Schema-based drivers use `schema` to scope the listing to a
        // specific schema within the database. Flat multi-db drivers (MySQL,
        // SQLite) pass None — they ignore the schema arg and use
        // params.database to determine which tables to list, avoiding a
        // confusing `WHERE table_schema = 'public'` on a MySQL connection.
        let scoped_schema = dialect.scoped_schema(schema.as_deref());
        let all_tables = drv.get_tables(&params, scoped_schema).await?;

        let tables_to_process: Vec<String> = if let Some(selection) = &options.tables {
            selection.clone()
        } else {
            all_tables.into_iter().map(|t| t.name).collect()
        };

        for table in tables_to_process {
            if options.structure {
                writeln!(
                    writer,
                    "-- Structure for table {}",
                    dialect.table_ref(scoped_schema, &table)
                )
                .map_err(|e| e.to_string())?;
                // A plugin that doesn't implement get_table_ddl must not
                // abort the whole dump over one table's missing structure —
                // the data step below still runs for it, and every other
                // table's structure/data is unaffected. Composing an
                // approximate CREATE TABLE from generic column/FK/index
                // metadata was considered and rejected: a dump file is meant
                // to be restored, and a plausible-looking but subtly wrong
                // DDL statement (missed default, generated column, check
                // constraint) is worse than a visible, honest gap.
                //
                // The DROP TABLE IF EXISTS is written only when DDL is
                // available, not unconditionally before the DDL fetch: writing
                // the DROP first then failing to emit a CREATE TABLE produces a
                // dump file whose import deletes the restore target with no way
                // to recreate it (the builtin drivers wrap import in a
                // transaction that rolls back, but plugin drivers execute each
                // statement independently — the DROP commits and the table is
                // gone). Skipping both when DDL fails leaves the existing table
                // intact.
                match drv.get_table_ddl(&params, &table, scoped_schema).await {
                    Ok(ddl) => {
                        writeln!(
                            writer,
                            "{}",
                            dialect.drop_table_if_exists(scoped_schema, &table)
                        )
                        .map_err(|e| e.to_string())?;
                        writeln!(writer, "{}\n", ddl).map_err(|e| e.to_string())?;
                    }
                    Err(e) => {
                        writeln!(
                            writer,
                            "-- WARNING: could not generate DDL for {}: {} (table left unchanged)\n",
                            dialect.table_ref(scoped_schema, &table),
                            e
                        )
                        .map_err(|e| e.to_string())?;
                    }
                }
            }

            if options.data {
                writeln!(
                    writer,
                    "-- Data for table {}",
                    dialect.table_ref(scoped_schema, &table)
                )
                .map_err(|e| e.to_string())?;
                export_table_data(
                    &mut writer,
                    &drv,
                    &params,
                    &driver,
                    &dialect,
                    &table,
                    scoped_schema,
                )
                .await?;
                writeln!(writer, "\n").map_err(|e| e.to_string())?;
            }
        }

        writer.flush().map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    });

    let abort_handle = Arc::new(task.abort_handle());
    register_abort_handle(handles, slot_key.clone(), abort_handle.clone());

    let result = task.await;

    unregister_abort_handle(handles, &slot_key, &abort_handle);

    match result {
        Ok(res) => res,
        Err(_) => Err("Dump cancelled".into()),
    }
}

#[tauri::command]
pub async fn dump_database<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DumpCancellationState>,
    connection_id: String,
    file_path: String,
    options: DumpOptions,
    schema: Option<String>,
    database: Option<String>,
) -> Result<(), String> {
    dump_database_with_handles(
        &app,
        &state.handles,
        connection_id.clone(),
        connection_id,
        file_path,
        options,
        schema,
        database,
    )
    .await
}

async fn export_table_data(
    writer: &mut BufWriter<File>,
    drv: &Arc<dyn DatabaseDriver>,
    params: &ConnectionParams,
    driver: &str,
    dialect: &DumpDialect,
    table: &str,
    schema: Option<&str>,
) -> Result<(), String> {
    // We need to implement streaming fetch manually here because we need raw values, not JSON strings if possible,
    // or we parse JSON strings back to SQL literals.
    // The current drivers return JSON-like values via `extract_value`.
    // Let's reuse `extract_value` logic but format for SQL.

    // Ideally we should use specific batch size
    let query = format!("SELECT * FROM {}", dialect.table_ref(schema, table));

    match driver {
        "mysql" => {
            use crate::drivers::mysql::extract::extract_value;
            use crate::pool_manager::get_mysql_pool; // Returns String (JSON value or "NULL")
            use sqlx::{Column, TypeInfo};

            let pool = get_mysql_pool(params).await?;
            let mut rows = sqlx::query(&query).fetch(&pool);

            let mut batch = Vec::new();
            while let Some(row) = rows.try_next().await.map_err(|e| e.to_string())? {
                let mut values = Vec::new();
                for i in 0..row.columns().len() {
                    let val = extract_value(&row, i, None);
                    // JSON columns are extracted as parsed values and must be
                    // written back as JSON literals, not as their string content.
                    let is_json_column = row.column(i).type_info().name() == "JSON";
                    values.push(if is_json_column {
                        dialect.escape_json_value(val)
                    } else {
                        dialect.escape_value(val)
                    });
                }
                batch.push(format!("({})", values.join(", ")));

                if batch.len() >= 100 {
                    writeln!(
                        writer,
                        "{}",
                        dialect.insert_into_statement(schema, table, &batch.join(", "))
                    )
                    .map_err(|e| e.to_string())?;
                    batch.clear();
                }
            }
            if !batch.is_empty() {
                writeln!(
                    writer,
                    "{}",
                    dialect.insert_into_statement(schema, table, &batch.join(", "))
                )
                .map_err(|e| e.to_string())?;
            }
        }
        "postgres" => {
            use crate::drivers::postgres::extract::extract_value;
            use crate::pool_manager::get_postgres_pool;

            let pool = get_postgres_pool(params).await?;
            let client = pool.get().await.map_err(|e| e.to_string())?;
            let params: Vec<i32> = vec![];
            let mut rows = std::pin::pin!(client
                .query_raw(&query, &params)
                .await
                .map_err(|e| e.to_string())?);

            let mut batch = Vec::new();

            while let Some(row) = rows.try_next().await.map_err(|e| e.to_string())? {
                let mut values = Vec::new();
                for i in 0..row.columns().len() {
                    let val = extract_value(&row, i, None);
                    let column_type = row.columns()[i].type_();
                    let is_json_column = *column_type == tokio_postgres::types::Type::JSON
                        || *column_type == tokio_postgres::types::Type::JSONB;
                    values.push(if is_json_column {
                        dialect.escape_json_value(val)
                    } else {
                        dialect.escape_value(val)
                    });
                }
                batch.push(format!("({})", values.join(", ")));

                if batch.len() >= 100 {
                    writeln!(
                        writer,
                        "{}",
                        dialect.insert_into_statement(schema, table, &batch.join(", "))
                    )
                    .map_err(|e| e.to_string())?;
                    batch.clear();
                }
            }
            if !batch.is_empty() {
                writeln!(
                    writer,
                    "{}",
                    dialect.insert_into_statement(schema, table, &batch.join(", "))
                )
                .map_err(|e| e.to_string())?;
            }
        }
        "sqlite" => {
            use crate::drivers::sqlite::extract::extract_value;
            use crate::pool_manager::get_sqlite_pool;

            let pool = get_sqlite_pool(params).await?;
            let mut rows = sqlx::query(&query).fetch(&pool);

            let mut batch = Vec::new();
            while let Some(row) = rows.try_next().await.map_err(|e| e.to_string())? {
                let mut values = Vec::new();
                for i in 0..row.columns().len() {
                    let val = extract_value(&row, i, None);
                    values.push(dialect.escape_value(val));
                }
                batch.push(format!("({})", values.join(", ")));

                if batch.len() >= 100 {
                    writeln!(
                        writer,
                        "{}",
                        dialect.insert_into_statement(schema, table, &batch.join(", "))
                    )
                    .map_err(|e| e.to_string())?;
                    batch.clear();
                }
            }
            if !batch.is_empty() {
                writeln!(
                    writer,
                    "{}",
                    dialect.insert_into_statement(schema, table, &batch.join(", "))
                )
                .map_err(|e| e.to_string())?;
            }
        }
        // Any plugin-backed driver: no local pool to stream from (the plugin
        // owns its own pool inside its subprocess), so fall back to the
        // generic RPC surface every driver implements — paginate through
        // `execute_query` instead of a raw `sqlx`/`tokio-postgres` client.
        _ => {
            // `schema` is already scoped by `DumpDialect::scoped_schema`: it
            // is `None` for a plugin without schemas, whose "schema" RPC
            // parameter may mean something else entirely (e.g. a database
            // selector), so the plugin's own default is left alone.
            let fallback_schema = schema;
            let json_columns =
                json_column_names(&drv.get_columns(params, table, fallback_schema).await?);

            let mut batch = Vec::new();
            let mut page = 1u32;
            loop {
                let result = drv
                    .execute_query(params, &query, Some(1000), page, fallback_schema)
                    .await?;
                let fetched = result.rows.len() as u32;

                for row in result.rows {
                    batch.push(format_row_values(
                        row,
                        &result.columns,
                        &json_columns,
                        dialect,
                    ));

                    if batch.len() >= 100 {
                        writeln!(
                            writer,
                            "{}",
                            dialect.insert_into_statement(schema, table, &batch.join(", "))
                        )
                        .map_err(|e| e.to_string())?;
                        batch.clear();
                    }
                }

                let has_more = plugin_dump_has_more(result.pagination, fetched, 1000);
                if fetched == 0 || !has_more {
                    break;
                }
                page += 1;
            }
            if !batch.is_empty() {
                writeln!(
                    writer,
                    "{}",
                    dialect.insert_into_statement(schema, table, &batch.join(", "))
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(())
}

/// Whether the plugin-driver fallback's paginated fetch loop (in
/// `export_table_data`) should request another page.
///
/// A plugin's `execute_query` RPC may not populate `pagination` at all —
/// defaulting the "no pagination info" case to `false` (as if the table
/// were exhausted) would silently truncate a dump the moment a table has
/// more rows than one page, with no error raised. Falling back to whether
/// the page came back full instead matches `export.rs`'s established
/// pattern for the same "driver doesn't report pagination" gap: it may
/// cost one extra empty-page fetch when a table's row count is an exact
/// multiple of the page size, but it never drops rows.
fn plugin_dump_has_more(pagination: Option<Pagination>, fetched: u32, page_size: u32) -> bool {
    pagination
        .map(|p| p.has_more)
        .unwrap_or(fetched >= page_size)
}

/// Column names whose PostgreSQL type is `json`/`jsonb`. Used to decide
/// which cells in a row fetched through the generic (plugin-driver)
/// `execute_query` RPC need `escape_json_column_value` rather than
/// `escape_sql_value` — see `export_table_data`'s fallback arm. Unlike the
/// builtin drivers' own extraction (which sees the source column type
/// directly), `QueryResult` only carries column *names*, so a JSON column
/// can't be told apart from a plain text column by inspecting a cell's
/// value alone — both arrive as a `serde_json::Value::String`.
fn json_column_names(columns: &[TableColumn]) -> HashSet<String> {
    columns
        .iter()
        .filter(|c| {
            let t = c.data_type.to_ascii_lowercase();
            t == "json" || t == "jsonb"
        })
        .map(|c| c.name.clone())
        .collect()
}

/// Formats one row from the generic `execute_query` RPC into a parenthesized
/// SQL value list, e.g. `(1, 'Alice', NULL)`. `columns` must be the same
/// `QueryResult.columns` the row's values came from, in the same order.
fn format_row_values(
    row: Vec<serde_json::Value>,
    columns: &[String],
    json_columns: &HashSet<String>,
    dialect: &DumpDialect,
) -> String {
    let values: Vec<String> = row
        .into_iter()
        .zip(columns.iter())
        .map(|(val, col_name)| {
            if json_columns.contains(col_name) {
                dialect.escape_json_value(val)
            } else {
                dialect.escape_value(val)
            }
        })
        .collect();
    format!("({})", values.join(", "))
}

#[derive(Debug, Serialize, Clone)]
pub struct ImportProgress {
    pub statements_executed: usize,
    pub total_statements: usize,
    pub percentage: f32,
    pub current_operation: String,
}

// Stream-based statement parser that yields statements as they are read
struct SqlStatementStream<R: BufRead> {
    reader: R,
    current_statement: String,
    line_buffer: String,
}

impl<R: BufRead> SqlStatementStream<R> {
    fn new(reader: R) -> Self {
        Self {
            reader,
            current_statement: String::new(),
            line_buffer: String::new(),
        }
    }

    fn next_statement(&mut self) -> Result<Option<String>, String> {
        loop {
            self.line_buffer.clear();
            let bytes_read = self
                .reader
                .read_line(&mut self.line_buffer)
                .map_err(|e| e.to_string())?;

            if bytes_read == 0 {
                // EOF - return last statement if any
                if self.current_statement.trim().is_empty() {
                    return Ok(None);
                } else {
                    let stmt = self.current_statement.trim().to_string();
                    self.current_statement.clear();
                    return Ok(Some(stmt));
                }
            }

            let trimmed = self.line_buffer.trim();

            // Skip comments and empty lines
            if trimmed.starts_with("--") || trimmed.is_empty() {
                continue;
            }

            self.current_statement.push_str(&self.line_buffer);

            // Check if statement is complete
            if trimmed.ends_with(';') {
                let stmt = self.current_statement.trim().to_string();
                self.current_statement.clear();
                if !stmt.is_empty() {
                    return Ok(Some(stmt));
                }
            }
        }
    }
}

// Helper macro for streaming execution with progress
macro_rules! execute_statements_streaming {
    ($executor_macro:ident, $stream:expr, $app:expr) => {{
        // Larger batch for better performance - execute and emit progress every 500 statements
        const PROGRESS_EMIT_INTERVAL: usize = 500;
        let mut executed = 0;
        let mut since_last_progress = 0;

        while let Some(stmt) = $stream.next_statement()? {
            // Execute statement immediately without batching in memory
            $executor_macro!(&stmt).await.map_err(|e| {
                format!(
                    "Error at statement {}: {}\nQuery: {}",
                    executed + 1,
                    e,
                    stmt
                )
            })?;

            executed += 1;
            since_last_progress += 1;

            // Emit progress only every PROGRESS_EMIT_INTERVAL statements to reduce overhead
            if since_last_progress >= PROGRESS_EMIT_INTERVAL {
                let _ = $app.emit(
                    "import_progress",
                    ImportProgress {
                        statements_executed: executed,
                        total_statements: 0, // 0 indicates unknown total
                        percentage: 0.0,
                        current_operation: format!("Imported {} statements", executed),
                    },
                );
                since_last_progress = 0;
            }
        }

        // Final progress update
        let _ = $app.emit(
            "import_progress",
            ImportProgress {
                statements_executed: executed,
                total_statements: executed,
                percentage: 100.0,
                current_operation: "Import completed".to_string(),
            },
        );

        Ok::<usize, String>(executed)
    }};
}

#[tauri::command]
pub async fn cancel_import(
    state: State<'_, DumpCancellationState>,
    connection_id: String,
) -> Result<(), String> {
    let key = import_slot_key(&connection_id);
    let entries = {
        let mut handles = state.handles.lock().unwrap();
        handles.remove(&key).unwrap_or_default()
    };
    if entries.is_empty() {
        return Err("No active import process found".into());
    }
    for handle in entries {
        handle.abort();
    }
    Ok(())
}

#[tauri::command]
pub async fn import_database<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DumpCancellationState>,
    connection_id: String,
    file_path: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<(), String> {
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded_params = expand_k8s_connection_params(&app, &expanded_params).await?;
    let mut params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    // Scope the import to the selected database on connections that expose multiple
    // databases (e.g. MySQL/MariaDB). Without this the connection pool stays bound
    // to the primary database, so every statement in the dump file is executed
    // against the wrong database. Mirrors the same fix already applied to
    // `dump_database`.
    if let Some(db) = database.filter(|d| !d.is_empty()) {
        params.database = crate::models::DatabaseSelection::Single(db);
    }
    let driver = saved_conn.params.driver.clone();
    // Postgres dump files reference unqualified table names expecting the
    // default `public` schema, so only Postgres(-flavored plugin) statements
    // need that default. A non-Postgres plugin driver's `schema` parameter
    // may mean something else entirely (a database selector, for a
    // MySQL-like plugin with no real schema concept) - defaulting it to
    // "public" there could silently retarget the connection to a database
    // that doesn't exist instead of leaving the plugin's own default alone.
    let pg_schema = schema.clone().unwrap_or_else(|| "public".to_string());
    let app_handle = app.clone();
    let conn_id = connection_id.clone();
    let drv = crate::drivers::registry::get_connection_driver(&params).await?;
    let is_postgres =
        DumpDialect::from_capabilities(&driver, &drv.manifest().capabilities).postgres;

    // Spawn the import process
    let task = tokio::spawn(async move {
        // Open file and create streaming reader
        let file = File::open(&file_path).map_err(|e| e.to_string())?;
        let reader = create_sql_reader(file, &file_path)?;
        let mut stream = SqlStatementStream::new(reader);

        // Emit initial progress
        let _ = app_handle.emit(
            "import_progress",
            ImportProgress {
                statements_executed: 0,
                total_statements: 0,
                percentage: 0.0,
                current_operation: "Starting import...".to_string(),
            },
        );

        // Execute with transaction and optimizations for speed
        match driver.as_str() {
            "mysql" => {
                let pool = get_mysql_pool(&params).await?;
                let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

                // Performance optimizations for MySQL
                sqlx::query("SET FOREIGN_KEY_CHECKS=0")
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
                sqlx::query("SET UNIQUE_CHECKS=0")
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
                sqlx::query("SET AUTOCOMMIT=0")
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;

                macro_rules! execute_statement {
                    ($stmt:expr) => {
                        sqlx::query($stmt).execute(&mut *tx)
                    };
                }

                execute_statements_streaming!(execute_statement, stream, app_handle)?;

                // Restore settings
                sqlx::query("SET FOREIGN_KEY_CHECKS=1")
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
                sqlx::query("SET UNIQUE_CHECKS=1")
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
                sqlx::query("SET AUTOCOMMIT=1")
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;

                tx.commit().await.map_err(|e| e.to_string())?;
            }
            "postgres" => {
                let pool = get_postgres_pool(&params).await?;
                let mut client = pool.get().await.map_err(|e| e.to_string())?;
                let tx = client.transaction().await.map_err(|e| e.to_string())?;

                // Set schema search path so unqualified table names resolve correctly
                tx.execute(&format!("SET search_path TO \"{}\"", pg_schema), &[])
                    .await
                    .map_err(|e| e.to_string())?;

                // Performance optimizations for PostgreSQL
                tx.execute("SET CONSTRAINTS ALL DEFERRED", &[])
                    .await
                    .map_err(|e| e.to_string())?;
                // Temporarily disable synchronous commit for speed (data at risk until commit)
                tx.execute("SET LOCAL synchronous_commit=OFF", &[])
                    .await
                    .map_err(|e| e.to_string())?;

                macro_rules! execute_statement {
                    ($stmt:expr) => {
                        tx.execute($stmt, &[])
                    };
                }

                execute_statements_streaming!(execute_statement, stream, app_handle)?;

                tx.commit().await.map_err(|e| e.to_string())?;
            }
            "sqlite" => {
                let pool = get_sqlite_pool(&params).await?;
                let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

                // Performance optimizations for SQLite
                sqlx::query("PRAGMA foreign_keys=OFF")
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
                sqlx::query("PRAGMA synchronous=OFF")
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
                sqlx::query("PRAGMA journal_mode=MEMORY")
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;

                macro_rules! execute_statement {
                    ($stmt:expr) => {
                        sqlx::query($stmt).execute(&mut *tx)
                    };
                }

                execute_statements_streaming!(execute_statement, stream, app_handle)?;

                // Restore settings
                sqlx::query("PRAGMA foreign_keys=ON")
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
                sqlx::query("PRAGMA synchronous=FULL")
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;

                tx.commit().await.map_err(|e| e.to_string())?;
            }
            // Any plugin-backed driver: no local pool to open a transaction
            // on (the plugin owns its own pool inside its subprocess), and no
            // cross-process RPC for transaction begin/commit/rollback exists
            // yet. Execute each statement independently through the generic
            // RPC surface instead — correct (each call passes a schema so
            // schema-scoping doesn't depend on session state persisting
            // across pooled connections, unlike the builtin arms' `SET
            // search_path`), but NOT atomic: unlike the builtin drivers
            // above, a failure partway through leaves whatever ran so far
            // committed rather than rolling the whole import back. A
            // transactional bulk-execute RPC would need to be added to the
            // plugin protocol to close that gap (followed up separately).
            _ => {
                // Only default to "public" for a Postgres-flavored plugin
                // (see `pg_schema` above).
                let fallback_schema = if is_postgres {
                    Some(pg_schema.as_str())
                } else {
                    schema.as_deref()
                };
                macro_rules! execute_statement {
                    ($stmt:expr) => {
                        drv.execute_query(&params, $stmt, None, 1, fallback_schema)
                    };
                }

                execute_statements_streaming!(execute_statement, stream, app_handle)?;
            }
        }

        Ok::<(), String>(())
    });

    let abort_handle = Arc::new(task.abort_handle());
    let import_key = import_slot_key(&conn_id);
    register_abort_handle(&state.handles, import_key.clone(), abort_handle.clone());

    let result = task.await;

    unregister_abort_handle(&state.handles, &import_key, &abort_handle);

    match result {
        Ok(res) => res,
        Err(_) => Err("Import cancelled".into()),
    }
}

// Creates a BufReader from the file without loading entire content into memory
// For ZIP files, extracts to a string in memory (limitation of zip crate)
// For regular SQL files, uses streaming with a large buffer
fn create_sql_reader(file: File, file_path: &str) -> Result<Box<dyn BufRead + Send>, String> {
    if file_path.ends_with(".zip") {
        // For ZIP files, we need to extract the SQL content to memory
        // The zip crate doesn't support true streaming because by_index requires ownership
        let mut archive =
            ZipArchive::new(file).map_err(|e| format!("Failed to open zip: {}", e))?;

        // Find first .sql file and extract content
        for i in 0..archive.len() {
            let mut zipped_file = archive.by_index(i).map_err(|e| e.to_string())?;
            if zipped_file.name().ends_with(".sql") {
                let mut content = String::new();
                zipped_file
                    .read_to_string(&mut content)
                    .map_err(|e| e.to_string())?;

                // Create a BufReader from the extracted string
                let cursor = std::io::Cursor::new(content.into_bytes());
                return Ok(Box::new(BufReader::new(cursor)));
            }
        }
        Err("No .sql file found in zip archive".into())
    } else {
        // For regular files, use a buffered reader with larger buffer for efficient streaming
        let reader = BufReader::with_capacity(8192 * 16, file); // 128KB buffer
        Ok(Box::new(reader))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn postgres_dialect() -> DumpDialect {
        let pg = crate::drivers::postgres::PostgresDriver::new();
        DumpDialect::from_capabilities("postgres", &pg.manifest().capabilities)
    }

    fn column(name: &str, data_type: &str) -> TableColumn {
        TableColumn {
            name: name.to_string(),
            data_type: data_type.to_string(),
            is_pk: false,
            is_nullable: true,
            is_auto_increment: false,
            is_generated: false,
            default_value: None,
            character_maximum_length: None,
            comment: None,
            numeric_precision: None,
            numeric_scale: None,
        }
    }

    #[test]
    fn test_json_column_names_matches_json_and_jsonb_case_insensitively() {
        let columns = vec![
            column("id", "integer"),
            column("payload", "jsonb"),
            column("meta", "JSON"),
            column("name", "text"),
        ];
        let json_cols = json_column_names(&columns);
        assert_eq!(json_cols.len(), 2);
        assert!(json_cols.contains("payload"));
        assert!(json_cols.contains("meta"));
        assert!(!json_cols.contains("id"));
        assert!(!json_cols.contains("name"));
    }

    #[test]
    fn test_json_column_names_empty_for_no_json_columns() {
        let columns = vec![column("id", "integer"), column("name", "text")];
        assert!(json_column_names(&columns).is_empty());
    }

    #[test]
    fn test_format_row_values_escapes_json_column_differently_from_plain_text() {
        // Same underlying serde_json::Value::String("hi") in two columns:
        // the plain text column keeps it literal, the JSON column re-encodes
        // it as a JSON string literal (surrounding quotes preserved) --
        // this is the whole reason json_column_names exists (#822 dump fix
        // for plugin-backed drivers: QueryResult only carries column names,
        // not types, so this can't be inferred from the value alone).
        let columns = vec!["name".to_string(), "payload".to_string()];
        let mut json_cols = HashSet::new();
        json_cols.insert("payload".to_string());

        let row = vec![json!("hi"), json!("hi")];
        assert_eq!(
            format_row_values(row, &columns, &json_cols, &postgres_dialect()),
            r#"('hi', '"hi"')"#
        );
    }

    #[test]
    fn test_format_row_values_regression_json_object_and_null_round_trip() {
        let columns = vec!["id".to_string(), "payload".to_string(), "note".to_string()];
        let mut json_cols = HashSet::new();
        json_cols.insert("payload".to_string());

        let row = vec![json!(1), json!({"a": 1}), serde_json::Value::Null];
        assert_eq!(
            format_row_values(row, &columns, &json_cols, &postgres_dialect()),
            r#"(1, '{"a":1}', NULL)"#
        );
    }

    fn pagination(has_more: bool) -> Pagination {
        Pagination {
            page: 1,
            page_size: 1000,
            total_rows: None,
            has_more,
        }
    }

    #[test]
    fn test_plugin_dump_has_more_trusts_real_pagination_over_the_fallback() {
        // A full page that the driver explicitly says is the last one must
        // not be reinterpreted as "more rows" just because it's full.
        assert!(!plugin_dump_has_more(Some(pagination(false)), 1000, 1000));
        // A short page the driver explicitly says has more must still be
        // honored, even though the fallback heuristic alone would say no.
        assert!(plugin_dump_has_more(Some(pagination(true)), 10, 1000));
    }

    #[test]
    fn test_plugin_dump_has_more_regression_a_full_page_without_pagination_is_not_treated_as_the_end(
    ) {
        // Regression: a plugin's execute_query RPC that never populates
        // `pagination` used to default this to `false`, silently truncating
        // any table with more rows than one page.
        assert!(plugin_dump_has_more(None, 1000, 1000));
    }

    #[test]
    fn test_plugin_dump_has_more_a_short_page_without_pagination_ends_the_fetch() {
        assert!(!plugin_dump_has_more(None, 10, 1000));
    }

    #[test]
    fn test_plugin_dump_has_more_an_empty_page_without_pagination_ends_the_fetch() {
        assert!(!plugin_dump_has_more(None, 0, 1000));
    }
}
