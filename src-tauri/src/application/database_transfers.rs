use super::connection_files::GeneratedFile;
use super::file_transfers::{ClaimedUpload, FileTransferStore};
use crate::commands::{register_abort_handle, unregister_abort_handle, AbortHandleMap};
use crate::drivers::{mysql, postgres, sqlite};
use crate::dump_utils::{drop_table_if_exists, format_table_ref, insert_into_statement};
use crate::models::ConnectionParams;
use crate::pool_manager::{get_mysql_pool, get_postgres_pool, get_sqlite_pool};
use crate::runtime::RuntimeContext;
use futures::TryStreamExt;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio_util::io::ReaderStream;
use uuid::Uuid;
use zip::ZipArchive;

pub const DATABASE_IMPORT_PURPOSE: &str = "database-import";
const SQL_MIME_TYPE: &str = "application/sql";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DatabaseTransferCommand {
    Dump {
        connection_id: String,
        options: DumpOptions,
        schema: Option<String>,
        database: Option<String>,
    },
    CancelDump {
        connection_id: String,
    },
    Import {
        connection_id: String,
        upload_token: String,
        schema: Option<String>,
        database: Option<String>,
    },
    CancelImport {
        connection_id: String,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DumpOptions {
    pub structure: bool,
    pub data: bool,
    pub tables: Option<Vec<String>>,
}

#[derive(Default)]
pub struct DumpCancellationState {
    pub handles: Arc<Mutex<AbortHandleMap>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DumpProgress {
    pub connection_id: String,
    pub tables_processed: usize,
    pub total_tables: usize,
    pub percentage: f32,
    pub current_operation: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ImportProgress {
    pub connection_id: String,
    pub statements_executed: usize,
    pub total_statements: usize,
    pub percentage: f32,
    pub current_operation: String,
}

pub enum DumpDestination {
    ServerPath(PathBuf),
    SessionDownload(Uuid),
}

pub enum ImportSource {
    ServerPath(PathBuf),
    SessionUpload { owner: Uuid, token: String },
}

pub async fn execute(
    runtime: &RuntimeContext,
    state: &DumpCancellationState,
    session_id: Option<Uuid>,
    command: DatabaseTransferCommand,
) -> Result<serde_json::Value, String> {
    match command {
        DatabaseTransferCommand::Dump {
            connection_id,
            options,
            schema,
            database,
        } => {
            let owner = session_id.ok_or_else(|| "A browser session is required".to_string())?;
            json(
                dump_database(
                    runtime,
                    state,
                    session_id,
                    connection_id,
                    DumpDestination::SessionDownload(owner),
                    options,
                    schema,
                    database,
                )
                .await?
                .ok_or_else(|| "The browser dump did not create a download".to_string())?,
            )
        }
        DatabaseTransferCommand::CancelDump { connection_id } => {
            cancel_job(state, session_id, JobKind::Dump, &connection_id)?;
            Ok(serde_json::Value::Null)
        }
        DatabaseTransferCommand::Import {
            connection_id,
            upload_token,
            schema,
            database,
        } => {
            let owner = session_id.ok_or_else(|| "A browser session is required".to_string())?;
            import_database(
                runtime,
                state,
                session_id,
                connection_id,
                ImportSource::SessionUpload {
                    owner,
                    token: upload_token,
                },
                schema,
                database,
            )
            .await?;
            Ok(serde_json::Value::Null)
        }
        DatabaseTransferCommand::CancelImport { connection_id } => {
            cancel_job(state, session_id, JobKind::Import, &connection_id)?;
            Ok(serde_json::Value::Null)
        }
    }
}

pub async fn dump_database(
    runtime: &RuntimeContext,
    state: &DumpCancellationState,
    session_id: Option<Uuid>,
    connection_id: String,
    destination: DumpDestination,
    options: DumpOptions,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Option<GeneratedFile>, String> {
    if !options.structure && !options.data {
        return Err("Select structure, data, or both for the dump".to_string());
    }
    let (driver, mut params) =
        super::connections::resolve_saved_connection_params(runtime, session_id, &connection_id)?;
    if let Some(database) = database.as_ref() {
        params.database = crate::models::DatabaseSelection::Single(database.clone());
    }
    let schema = schema.unwrap_or_else(|| "public".to_string());
    let download_file_name = format!(
        "{}_dump.sql",
        safe_name(database_name(&params, &connection_id)),
    );
    let (file_path, download_owner, temporary) = match destination {
        DumpDestination::ServerPath(path) => (path, None, None),
        DumpDestination::SessionDownload(owner) => {
            let directory = runtime.paths.data_dir().join("database-dump-jobs");
            create_private_directory(&directory)?;
            let path = directory.join(format!(".pending-{}.sql", Uuid::new_v4()));
            let guard = TemporaryFile::new(path.clone());
            (path, Some(owner), Some(guard))
        }
    };
    let runtime_for_task = runtime.clone();
    let connection_for_task = connection_id.clone();
    let task = tokio::spawn(async move {
        write_dump(
            &runtime_for_task,
            session_id,
            &connection_for_task,
            &file_path,
            &params,
            &driver,
            &schema,
            &options,
        )
        .await?;
        Ok::<(PathBuf, Option<Uuid>, Option<TemporaryFile>), String>((
            file_path,
            download_owner,
            temporary,
        ))
    });
    let mut registration = JobRegistration::new(
        state.handles.clone(),
        job_key(session_id, JobKind::Dump, &connection_id),
        Arc::new(task.abort_handle()),
    );
    let result = task.await;
    registration.complete();
    let (file_path, download_owner, temporary) = join_job(result, "Dump")?;

    let Some(owner) = download_owner else {
        return Ok(None);
    };
    let file = tokio::fs::File::open(&file_path)
        .await
        .map_err(|error| error.to_string())?;
    let metadata = FileTransferStore::new(runtime.paths.data_dir())
        .store_download(
            owner,
            "database-dump",
            &download_file_name,
            Some(SQL_MIME_TYPE),
            ReaderStream::new(file),
        )
        .await?;
    drop(temporary);
    Ok(Some(GeneratedFile::Download {
        file_name: metadata.file_name,
        mime_type: metadata.mime_type,
        token: metadata.token,
        size: metadata.size,
    }))
}

pub async fn import_database(
    runtime: &RuntimeContext,
    state: &DumpCancellationState,
    session_id: Option<Uuid>,
    connection_id: String,
    source: ImportSource,
    schema: Option<String>,
    database: Option<String>,
) -> Result<(), String> {
    let (driver, mut params) =
        super::connections::resolve_saved_connection_params(runtime, session_id, &connection_id)?;
    if let Some(database) = database {
        params.database = crate::models::DatabaseSelection::Single(database);
    }
    let schema = schema.unwrap_or_else(|| "public".to_string());
    let (file_path, is_zip, claimed_upload) = resolve_import_source(runtime, source)?;
    let runtime_for_task = runtime.clone();
    let connection_for_task = connection_id.clone();
    let task = tokio::spawn(async move {
        let _claimed_upload = claimed_upload;
        execute_import(
            &runtime_for_task,
            session_id,
            &file_path,
            is_zip,
            &connection_for_task,
            &params,
            &driver,
            &schema,
        )
        .await
    });
    let mut registration = JobRegistration::new(
        state.handles.clone(),
        job_key(session_id, JobKind::Import, &connection_id),
        Arc::new(task.abort_handle()),
    );
    let result = task.await;
    registration.complete();
    join_job(result, "Import")
}

pub fn cancel_job(
    state: &DumpCancellationState,
    session_id: Option<Uuid>,
    kind: JobKind,
    connection_id: &str,
) -> Result<(), String> {
    let key = job_key(session_id, kind, connection_id);
    let entries = state
        .handles
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(&key)
        .unwrap_or_default();
    if entries.is_empty() {
        return Err(format!("No active {} process found", kind.label()));
    }
    for handle in entries {
        handle.abort();
    }
    Ok(())
}

pub fn cancel_session_jobs(state: &DumpCancellationState, session_id: Uuid) {
    let prefix = format!("web:{session_id}:");
    let pending = {
        let mut handles = state
            .handles
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let keys = handles
            .keys()
            .filter(|key| key.starts_with(&prefix))
            .cloned()
            .collect::<Vec<_>>();
        keys.into_iter()
            .flat_map(|key| handles.remove(&key).unwrap_or_default())
            .collect::<Vec<_>>()
    };
    for handle in pending {
        handle.abort();
    }
}

#[derive(Clone, Copy)]
pub enum JobKind {
    Dump,
    Import,
}

impl JobKind {
    fn label(self) -> &'static str {
        match self {
            Self::Dump => "dump",
            Self::Import => "import",
        }
    }
}

async fn write_dump(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    file_path: &Path,
    params: &ConnectionParams,
    driver: &str,
    schema: &str,
    options: &DumpOptions,
) -> Result<(), String> {
    let file = File::create(file_path).map_err(|error| error.to_string())?;
    let mut writer = BufWriter::new(file);
    writeln!(writer, "-- Tabularis Dump").map_err(|error| error.to_string())?;
    let database_label = if session_id.is_some() {
        connection_id
    } else {
        params.database.primary()
    };
    writeln!(writer, "-- Database: {database_label}").map_err(|error| error.to_string())?;
    writeln!(writer, "-- Date: {}\n", chrono::Local::now().to_rfc3339())
        .map_err(|error| error.to_string())?;

    let all_tables = match driver {
        "mysql" => mysql::get_tables(params, None).await?,
        "postgres" => postgres::get_tables(params, schema).await?,
        "sqlite" => sqlite::get_tables(params).await?,
        _ => return Err("Unsupported driver".to_string()),
    };
    let tables = options
        .tables
        .clone()
        .unwrap_or_else(|| all_tables.into_iter().map(|table| table.name).collect());
    emit_progress(
        runtime,
        session_id,
        "dump_progress",
        &DumpProgress {
            connection_id: connection_id.to_string(),
            tables_processed: 0,
            total_tables: tables.len(),
            percentage: 0.0,
            current_operation: "Starting dump...".to_string(),
        },
    );

    for (index, table) in tables.iter().enumerate() {
        if options.structure {
            writeln!(
                writer,
                "-- Structure for table {}",
                format_table_ref(driver, schema, table)
            )
            .map_err(|error| error.to_string())?;
            writeln!(writer, "{}", drop_table_if_exists(driver, schema, table))
                .map_err(|error| error.to_string())?;
            let ddl = match driver {
                "mysql" => mysql::get_table_ddl(params, table).await?,
                "postgres" => postgres::get_table_ddl(params, table, schema).await?,
                "sqlite" => sqlite::get_table_ddl(params, table).await?,
                _ => return Err("Unsupported driver".to_string()),
            };
            writeln!(writer, "{}\n", ddl).map_err(|error| error.to_string())?;
        }
        if options.data {
            writeln!(
                writer,
                "-- Data for table {}",
                format_table_ref(driver, schema, table)
            )
            .map_err(|error| error.to_string())?;
            export_table_data(&mut writer, params, driver, table, schema).await?;
            writeln!(writer).map_err(|error| error.to_string())?;
        }
        let processed = index + 1;
        emit_progress(
            runtime,
            session_id,
            "dump_progress",
            &DumpProgress {
                connection_id: connection_id.to_string(),
                tables_processed: processed,
                total_tables: tables.len(),
                percentage: percentage(processed, tables.len()),
                current_operation: format!("Dumped table {table}"),
            },
        );
    }
    writer.flush().map_err(|error| error.to_string())?;
    Ok(())
}

async fn export_table_data(
    writer: &mut BufWriter<File>,
    params: &ConnectionParams,
    driver: &str,
    table: &str,
    schema: &str,
) -> Result<(), String> {
    let query = format!("SELECT * FROM {}", format_table_ref(driver, schema, table));
    match driver {
        "mysql" => {
            let pool = get_mysql_pool(params).await?;
            let mut rows = sqlx::query(&query).fetch(&pool);
            let mut batch = Vec::new();
            while let Some(row) = rows.try_next().await.map_err(|error| error.to_string())? {
                let values = (0..row.columns().len())
                    .map(|index| escape_sql_value(mysql::extract::extract_value(&row, index, None)))
                    .collect::<Vec<_>>();
                write_insert_batch(writer, driver, schema, table, &mut batch, values)?;
            }
            flush_insert_batch(writer, driver, schema, table, &mut batch)?;
        }
        "postgres" => {
            let pool = get_postgres_pool(params).await?;
            let client = pool.get().await.map_err(|error| error.to_string())?;
            let query_params: Vec<i32> = Vec::new();
            let mut rows = std::pin::pin!(client
                .query_raw(&query, &query_params)
                .await
                .map_err(|error| error.to_string())?);
            let mut batch = Vec::new();
            while let Some(row) = rows.try_next().await.map_err(|error| error.to_string())? {
                let values = (0..row.columns().len())
                    .map(|index| {
                        escape_sql_value(postgres::extract::extract_value(&row, index, None))
                    })
                    .collect::<Vec<_>>();
                write_insert_batch(writer, driver, schema, table, &mut batch, values)?;
            }
            flush_insert_batch(writer, driver, schema, table, &mut batch)?;
        }
        "sqlite" => {
            let pool = get_sqlite_pool(params).await?;
            let mut rows = sqlx::query(&query).fetch(&pool);
            let mut batch = Vec::new();
            while let Some(row) = rows.try_next().await.map_err(|error| error.to_string())? {
                let values = (0..row.columns().len())
                    .map(|index| {
                        escape_sql_value(sqlite::extract::extract_value(&row, index, None))
                    })
                    .collect::<Vec<_>>();
                write_insert_batch(writer, driver, schema, table, &mut batch, values)?;
            }
            flush_insert_batch(writer, driver, schema, table, &mut batch)?;
        }
        _ => return Err("Unsupported driver".to_string()),
    }
    Ok(())
}

fn write_insert_batch(
    writer: &mut BufWriter<File>,
    driver: &str,
    schema: &str,
    table: &str,
    batch: &mut Vec<String>,
    values: Vec<String>,
) -> Result<(), String> {
    batch.push(format!("({})", values.join(", ")));
    if batch.len() >= 100 {
        flush_insert_batch(writer, driver, schema, table, batch)?;
    }
    Ok(())
}

fn flush_insert_batch(
    writer: &mut BufWriter<File>,
    driver: &str,
    schema: &str,
    table: &str,
    batch: &mut Vec<String>,
) -> Result<(), String> {
    if batch.is_empty() {
        return Ok(());
    }
    writeln!(
        writer,
        "{}",
        insert_into_statement(driver, schema, table, &batch.join(", "))
    )
    .map_err(|error| error.to_string())?;
    batch.clear();
    Ok(())
}

fn escape_sql_value(value: serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::Number(number) => number.to_string(),
        serde_json::Value::Bool(value) => if value { "1" } else { "0" }.to_string(),
        serde_json::Value::String(value) => {
            format!("'{}'", value.replace('\\', "\\\\").replace('\'', "''"))
        }
        value => format!("'{}'", value.to_string().replace('\'', "''")),
    }
}

async fn execute_import(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    file_path: &Path,
    is_zip: bool,
    connection_id: &str,
    params: &ConnectionParams,
    driver: &str,
    schema: &str,
) -> Result<(), String> {
    let file = File::open(file_path).map_err(|error| error.to_string())?;
    let (reader, extracted_sql) = create_sql_reader(file, is_zip, runtime.paths.data_dir())?;
    let _extracted_sql = extracted_sql;
    let mut stream = SqlStatementStream::new(reader);
    emit_progress(
        runtime,
        session_id,
        "import_progress",
        &ImportProgress {
            connection_id: connection_id.to_string(),
            statements_executed: 0,
            total_statements: 0,
            percentage: 0.0,
            current_operation: "Starting import...".to_string(),
        },
    );

    match driver {
        "mysql" => {
            let pool = get_mysql_pool(params).await?;
            let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
            for statement in [
                "SET FOREIGN_KEY_CHECKS=0",
                "SET UNIQUE_CHECKS=0",
                "SET AUTOCOMMIT=0",
            ] {
                sqlx::query(statement)
                    .execute(&mut *tx)
                    .await
                    .map_err(|error| error.to_string())?;
            }
            let mut executed = 0;
            while let Some(statement) = stream.next_statement()? {
                sqlx::query(&statement)
                    .execute(&mut *tx)
                    .await
                    .map_err(|error| statement_error(executed, error, &statement))?;
                executed += 1;
                emit_import_interval(runtime, session_id, connection_id, executed);
            }
            for statement in [
                "SET FOREIGN_KEY_CHECKS=1",
                "SET UNIQUE_CHECKS=1",
                "SET AUTOCOMMIT=1",
            ] {
                sqlx::query(statement)
                    .execute(&mut *tx)
                    .await
                    .map_err(|error| error.to_string())?;
            }
            tx.commit().await.map_err(|error| error.to_string())?;
            emit_import_complete(runtime, session_id, connection_id, executed);
        }
        "postgres" => {
            let pool = get_postgres_pool(params).await?;
            let mut client = pool.get().await.map_err(|error| error.to_string())?;
            let tx = client
                .transaction()
                .await
                .map_err(|error| error.to_string())?;
            tx.execute(
                &format!("SET search_path TO \"{}\"", schema.replace('"', "\"\"")),
                &[],
            )
            .await
            .map_err(|error| error.to_string())?;
            tx.execute("SET CONSTRAINTS ALL DEFERRED", &[])
                .await
                .map_err(|error| error.to_string())?;
            tx.execute("SET LOCAL synchronous_commit=OFF", &[])
                .await
                .map_err(|error| error.to_string())?;
            let mut executed = 0;
            while let Some(statement) = stream.next_statement()? {
                tx.execute(&statement, &[])
                    .await
                    .map_err(|error| statement_error(executed, error, &statement))?;
                executed += 1;
                emit_import_interval(runtime, session_id, connection_id, executed);
            }
            tx.commit().await.map_err(|error| error.to_string())?;
            emit_import_complete(runtime, session_id, connection_id, executed);
        }
        "sqlite" => {
            let pool = get_sqlite_pool(params).await?;
            let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
            let mut executed = 0;
            while let Some(statement) = stream.next_statement()? {
                sqlx::query(&statement)
                    .execute(&mut *tx)
                    .await
                    .map_err(|error| statement_error(executed, error, &statement))?;
                executed += 1;
                emit_import_interval(runtime, session_id, connection_id, executed);
            }
            tx.commit().await.map_err(|error| error.to_string())?;
            emit_import_complete(runtime, session_id, connection_id, executed);
        }
        _ => return Err("Unsupported driver".to_string()),
    }
    Ok(())
}

fn emit_import_interval(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    executed: usize,
) {
    if executed % 500 == 0 {
        emit_progress(
            runtime,
            session_id,
            "import_progress",
            &ImportProgress {
                connection_id: connection_id.to_string(),
                statements_executed: executed,
                total_statements: 0,
                percentage: 0.0,
                current_operation: format!("Imported {executed} statements"),
            },
        );
    }
}

fn emit_import_complete(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    executed: usize,
) {
    emit_progress(
        runtime,
        session_id,
        "import_progress",
        &ImportProgress {
            connection_id: connection_id.to_string(),
            statements_executed: executed,
            total_statements: executed,
            percentage: 100.0,
            current_operation: "Import completed".to_string(),
        },
    );
}

fn statement_error(executed: usize, error: impl std::fmt::Display, statement: &str) -> String {
    format!(
        "Error at statement {}: {error}\nQuery: {statement}",
        executed + 1
    )
}

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
            let read = self
                .reader
                .read_line(&mut self.line_buffer)
                .map_err(|error| error.to_string())?;
            if read == 0 {
                if self.current_statement.trim().is_empty() {
                    return Ok(None);
                }
                return Ok(Some(
                    std::mem::take(&mut self.current_statement)
                        .trim()
                        .to_string(),
                ));
            }
            let trimmed = self.line_buffer.trim();
            if trimmed.starts_with("--") || trimmed.is_empty() {
                continue;
            }
            self.current_statement.push_str(&self.line_buffer);
            if trimmed.ends_with(';') {
                return Ok(Some(
                    std::mem::take(&mut self.current_statement)
                        .trim()
                        .to_string(),
                ));
            }
        }
    }
}

fn create_sql_reader(
    file: File,
    is_zip: bool,
    data_dir: &Path,
) -> Result<(Box<dyn BufRead + Send>, Option<TemporaryFile>), String> {
    if !is_zip {
        return Ok((Box::new(BufReader::with_capacity(128 * 1024, file)), None));
    }
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("Failed to open zip: {error}"))?;
    for index in 0..archive.len() {
        let zipped = archive.by_index(index).map_err(|error| error.to_string())?;
        if zipped.name().to_ascii_lowercase().ends_with(".sql") {
            let directory = data_dir.join("database-import-jobs");
            create_private_directory(&directory)?;
            let path = directory.join(format!(".extracted-{}.sql", Uuid::new_v4()));
            let guard = TemporaryFile::new(path.clone());
            let mut extracted = File::create(&path).map_err(|error| error.to_string())?;
            let max_bytes = super::file_transfers::MAX_FILE_TRANSFER_BYTES;
            let copied = std::io::copy(&mut zipped.take(max_bytes + 1), &mut extracted)
                .map_err(|error| error.to_string())?;
            extracted.flush().map_err(|error| error.to_string())?;
            if copied > max_bytes {
                return Err(format!(
                    "Extracted SQL exceeds the {max_bytes} byte import limit"
                ));
            }
            drop(extracted);
            let reader = File::open(&path).map_err(|error| error.to_string())?;
            return Ok((
                Box::new(BufReader::with_capacity(128 * 1024, reader)),
                Some(guard),
            ));
        }
    }
    Err("No .sql file found in zip archive".to_string())
}

fn resolve_import_source(
    runtime: &RuntimeContext,
    source: ImportSource,
) -> Result<(PathBuf, bool, Option<ClaimedUpload>), String> {
    match source {
        ImportSource::ServerPath(path) => {
            let is_zip = has_zip_extension(&path);
            Ok((path, is_zip, None))
        }
        ImportSource::SessionUpload { owner, token } => {
            let claimed = FileTransferStore::new(runtime.paths.data_dir()).claim_upload(
                owner,
                &token,
                DATABASE_IMPORT_PURPOSE,
            )?;
            let is_zip = claimed
                .metadata()
                .file_name
                .to_ascii_lowercase()
                .ends_with(".zip");
            Ok((claimed.path().to_path_buf(), is_zip, Some(claimed)))
        }
    }
}

fn has_zip_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
}

fn emit_progress<T: Serialize>(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    event: &str,
    payload: &T,
) {
    let Ok(payload) = serde_json::to_value(payload) else {
        return;
    };
    let _ = if let Some(session_id) = session_id {
        runtime.events.emit_to(session_id, event, payload)
    } else {
        runtime.events.emit(event, payload)
    };
}

fn percentage(processed: usize, total: usize) -> f32 {
    if total == 0 {
        100.0
    } else {
        processed as f32 * 100.0 / total as f32
    }
}

fn job_key(session_id: Option<Uuid>, kind: JobKind, connection_id: &str) -> String {
    match session_id {
        Some(session_id) => format!("web:{session_id}:{}:{connection_id}", kind.label()),
        None => format!("desktop:{}:{connection_id}", kind.label()),
    }
}

fn join_job<T>(
    result: Result<Result<T, String>, tokio::task::JoinError>,
    label: &str,
) -> Result<T, String> {
    match result {
        Ok(result) => result,
        Err(error) if error.is_cancelled() => Err(format!("{label} cancelled")),
        Err(error) => Err(format!("{label} task failed: {error}")),
    }
}

fn json<T: Serialize>(value: T) -> Result<serde_json::Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

fn database_name<'a>(params: &'a ConnectionParams, fallback: &'a str) -> &'a str {
    match &params.database {
        crate::models::DatabaseSelection::Single(value) => value,
        crate::models::DatabaseSelection::Multiple(values) => {
            values.first().map_or(fallback, String::as_str)
        }
    }
}

fn safe_name(value: &str) -> String {
    super::file_transfers::safe_file_name(value).replace([' ', '.'], "_")
}

fn create_private_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

struct TemporaryFile {
    path: PathBuf,
}

impl TemporaryFile {
    fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

struct JobRegistration {
    handles: Arc<Mutex<AbortHandleMap>>,
    key: String,
    handle: Arc<tokio::task::AbortHandle>,
    completed: bool,
}

impl JobRegistration {
    fn new(
        handles: Arc<Mutex<AbortHandleMap>>,
        key: String,
        handle: Arc<tokio::task::AbortHandle>,
    ) -> Self {
        register_abort_handle(&handles, key.clone(), handle.clone());
        Self {
            handles,
            key,
            handle,
            completed: false,
        }
    }

    fn complete(&mut self) {
        unregister_abort_handle(&self.handles, &self.key, &self.handle);
        self.completed = true;
    }
}

impl Drop for JobRegistration {
    fn drop(&mut self) {
        unregister_abort_handle(&self.handles, &self.key, &self.handle);
        if !self.completed {
            self.handle.abort();
        }
    }
}

#[cfg(test)]
#[path = "database_transfers_tests.rs"]
mod tests;
