//! "Export table to SQL" and "Import table from SQL" (#709): one table,
//! structure and optionally rows, written to a `.sql` file in the source
//! driver's dialect, and read back into a connection using the same driver.
//!
//! The file format and its pure helpers live in [`crate::table_sql`].
//! Built-in drivers stream rows natively; plugin drivers are paged through
//! `execute_query`, and may render their own `INSERT` statements through the
//! optional `render_insert_statements` RPC method. Everything else (quoting,
//! literals, schema scoping) follows the driver's declared capabilities.

use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Cursor, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::io::AsyncReadExt;
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use super::connection_files::GeneratedFile;
use super::database_transfers::{
    self, json_column_names, plugin_dump_has_more, plugin_row_cells, stream_sql_rows,
    DumpCancellationState, ImportProgress, JobKind, JobRegistration,
};
use super::file_transfers::{FileTransferStore, MAX_FILE_TRANSFER_BYTES};
use super::generic_exports::{export_key, ExportRegistration};
use crate::drivers::driver_trait::{DatabaseDriver, DriverCapabilities};
use crate::drivers::sql_syntax::SqlSyntax;
use crate::dump_utils::DumpDialect;
use crate::export::{ExportCancellationState, ProgressEmitter, DEFAULT_PROGRESS_INTERVAL};
use crate::models::{ColumnDefinition, ConnectionParams, DatabaseSelection, TableColumn};
use crate::runtime::RuntimeContext;
use crate::table_sql::{
    end_marker, render_insert, section_marker, terminate_statements, unqualify_ddl, SqlScanRules,
    StructureSource, TableSqlContent, TableSqlHeader, TableSqlItem, TableSqlReader, FORMAT_VERSION,
    INSERT_BATCH_ROWS, SECTION_DATA, SECTION_STRUCTURE,
};

#[cfg(test)]
#[path = "table_transfers_tests.rs"]
mod tests;

/// Upload purpose of a table export picked for import in the browser.
pub const TABLE_IMPORT_PURPOSE: &str = "table-import";
const SQL_MIME_TYPE: &str = "application/sql";
/// How much of a file the import preview reads: the header and the
/// structure section, never the data.
const PREVIEW_READ_BYTES: u64 = 256 * 1024;
/// Longest structure section shown in the import preview.
const PREVIEW_STRUCTURE_CHARS: usize = 64 * 1024;
const PLUGIN_PAGE_SIZE: u32 = 1000;
const IMPORT_PROGRESS_INTERVAL: usize = 500;

pub const TABLE_EXPORT_CANCELLED: &str = "Export cancelled";

/// What to do when the table in the file already exists in the target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IfTableExists {
    Fail,
    DropAndRecreate,
    Append,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableExportOptions {
    pub table: String,
    pub content: TableSqlContent,
    pub schema: Option<String>,
    pub database: Option<String>,
}

pub enum TableExportDestination {
    ServerPath(PathBuf),
    SessionDownload(Uuid),
}

pub enum TableImportSource {
    ServerPath(PathBuf),
    SessionUpload { owner: Uuid, token: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableExportResult {
    pub rows: u64,
    pub bytes: u64,
    pub structure_source: StructureSource,
    /// The browser download, when the export ran for a web session.
    pub file: Option<GeneratedFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableImportPreview {
    pub header: TableSqlHeader,
    /// The file's structure section, as written.
    pub structure: String,
    pub structure_truncated: bool,
    /// Why this connection can't import the file, if it can't.
    pub problem: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableImportResult {
    pub table: String,
    pub statements: u64,
    pub rows: u64,
}

/// What an import does before and instead of the structure section.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ImportPlan {
    pub drop_first: bool,
    pub run_structure: bool,
}

/// Decides what the import does from the file, the chosen mode and whether
/// the table exists. Appending to a missing table creates it as usual.
pub(crate) fn plan_import(
    header: &TableSqlHeader,
    mode: IfTableExists,
    exists: bool,
    can_manage_tables: bool,
) -> Result<ImportPlan, String> {
    if mode == IfTableExists::Append && !header.content.has_data() {
        return Err("This file holds the structure only, so it has no rows to append.".to_string());
    }
    let plan = match (exists, mode) {
        (true, IfTableExists::Fail) => {
            return Err(format!(
                "Table \"{}\" already exists. Choose \"Drop and recreate\" or \"Append rows\" to import into it.",
                header.table
            ))
        }
        (true, IfTableExists::DropAndRecreate) => ImportPlan {
            drop_first: true,
            run_structure: true,
        },
        (true, IfTableExists::Append) => ImportPlan {
            drop_first: false,
            run_structure: false,
        },
        (false, _) => ImportPlan {
            drop_first: false,
            run_structure: true,
        },
    };
    if (plan.run_structure || plan.drop_first) && !can_manage_tables {
        return Err("This connection's driver cannot create or drop tables.".to_string());
    }
    Ok(plan)
}

/// Checks a file against the connection it would be imported into, before
/// anything touches the database.
pub(crate) fn check_import_target(
    header: &TableSqlHeader,
    driver_id: &str,
    capabilities: &DriverCapabilities,
) -> Result<(), String> {
    if header.driver != driver_id {
        return Err(format!(
            "This file was exported from a \"{}\" connection and can only be imported into a connection using the same driver (this one uses \"{driver_id}\").",
            header.driver
        ));
    }
    if capabilities.readonly {
        return Err("This connection is read-only.".to_string());
    }
    if capabilities.table_import == Some(false) {
        return Err(
            "This connection's driver does not support importing tables from SQL.".to_string(),
        );
    }
    Ok(())
}

/// `SELECT` of the insertable columns, ordered by the primary key when there
/// is one so plugin paging is deterministic. Generated columns are left out:
/// engines refuse values for them.
pub(crate) fn export_select(
    dialect: &DumpDialect,
    schema: Option<&str>,
    table: &str,
    columns: &[TableColumn],
) -> String {
    let selected = columns
        .iter()
        .filter(|column| !column.is_generated)
        .map(|column| dialect.quote_identifier(&column.name))
        .collect::<Vec<_>>();
    let list = if selected.is_empty() {
        "*".to_string()
    } else {
        selected.join(", ")
    };
    let keys = columns
        .iter()
        .filter(|column| column.is_pk)
        .map(|column| dialect.quote_identifier(&column.name))
        .collect::<Vec<_>>();
    let order = if keys.is_empty() {
        String::new()
    } else {
        format!(" ORDER BY {}", keys.join(", "))
    };
    format!(
        "SELECT {list} FROM {}{order}",
        dialect.table_ref(schema, table)
    )
}

/// `shop.public.orders`: where an export came from, for the header.
pub(crate) fn source_label(database: &str, schema: Option<&str>, table: &str) -> String {
    // A file-based database is named by its file, without folders or extension.
    let database = if database.contains(['/', '\\']) {
        let file = database.rsplit(['/', '\\']).next().unwrap_or(database);
        file.rsplit_once('.')
            .map(|(stem, _)| stem)
            .filter(|stem| !stem.is_empty())
            .unwrap_or(file)
    } else {
        database
    };
    [Some(database), schema, Some(table)]
        .into_iter()
        .flatten()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(".")
}

/// The import preview from the first bytes of a file: its header and its
/// structure section, never the data.
pub(crate) fn read_preview(prefix: &[u8]) -> Result<(TableSqlHeader, String, bool), String> {
    let mut reader = Cursor::new(prefix);
    let header = TableSqlHeader::parse(&mut reader)?;
    let rest = &prefix[reader.position() as usize..];
    let text = String::from_utf8_lossy(rest);
    let mut structure = String::new();
    let mut in_structure = false;
    let mut complete = false;
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim();
        if trimmed == section_marker(SECTION_STRUCTURE) {
            in_structure = true;
            continue;
        }
        if trimmed.starts_with("-- @") && in_structure {
            complete = true;
            break;
        }
        if in_structure {
            structure.push_str(line);
        }
    }
    let mut truncated = !complete && (prefix.len() as u64) >= PREVIEW_READ_BYTES;
    if structure.chars().count() > PREVIEW_STRUCTURE_CHARS {
        structure = structure.chars().take(PREVIEW_STRUCTURE_CHARS).collect();
        truncated = true;
    }
    Ok((header, structure.trim().to_string(), truncated))
}

// --- Export ------------------------------------------------------------

pub async fn export_table(
    runtime: &RuntimeContext,
    state: &ExportCancellationState,
    session_id: Option<Uuid>,
    connection_id: String,
    options: TableExportOptions,
    destination: TableExportDestination,
) -> Result<TableExportResult, String> {
    let (driver, mut params) =
        super::connections::resolve_saved_connection_params(runtime, session_id, &connection_id)?;
    scope_database(&mut params, options.database.as_deref());
    let (path, download_owner) = match destination {
        TableExportDestination::ServerPath(path) => (path, None),
        TableExportDestination::SessionDownload(owner) => {
            let directory = runtime.paths.data_dir().join("table-export-jobs");
            create_private_directory(&directory)?;
            (
                directory.join(format!(".pending-{}.sql", Uuid::new_v4())),
                Some(owner),
            )
        }
    };
    let pending_download = download_owner.map(|_| RemoveOnDrop::new(path.clone()));
    let browser_limit = download_owner.map(|_| MAX_FILE_TRANSFER_BYTES);

    let runtime_for_task = runtime.clone();
    let connection_for_task = connection_id.clone();
    let task_path = path.clone();
    let task_options = options.clone();
    let task = tokio::spawn(async move {
        write_table_export(
            &runtime_for_task,
            session_id,
            &connection_for_task,
            &task_path,
            &params,
            &driver,
            &task_options,
            browser_limit,
        )
        .await
    });
    let mut registration = ExportRegistration::new(
        state.handles.clone(),
        export_key(session_id, &connection_id),
        Arc::new(task.abort_handle()),
    );
    let result = task.await;
    registration.complete();
    let summary = match result {
        Ok(result) => result?,
        Err(error) if error.is_cancelled() => return Err(TABLE_EXPORT_CANCELLED.to_string()),
        Err(error) => return Err(format!("Export task failed: {error}")),
    };

    let file = match download_owner {
        None => None,
        Some(owner) => {
            let contents = tokio::fs::File::open(&path)
                .await
                .map_err(|error| error.to_string())?;
            let metadata = FileTransferStore::new(runtime.paths.data_dir())
                .store_download(
                    owner,
                    "table-export",
                    &download_file_name(&options.table),
                    Some(SQL_MIME_TYPE),
                    ReaderStream::new(contents),
                )
                .await?;
            drop(pending_download);
            Some(GeneratedFile::Download {
                file_name: metadata.file_name,
                mime_type: metadata.mime_type,
                token: metadata.token,
                size: metadata.size,
            })
        }
    };
    Ok(TableExportResult {
        rows: summary.rows,
        bytes: summary.bytes,
        structure_source: summary.structure_source,
        file,
    })
}

struct ExportSummary {
    rows: u64,
    bytes: u64,
    structure_source: StructureSource,
}

/// Writes the export next to `destination` and renames it into place on
/// success, so a failed or cancelled export never leaves a partial file at
/// the chosen path. The rows go to a scratch file first, because the header
/// that precedes them carries the row count.
#[allow(clippy::too_many_arguments)]
async fn write_table_export(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    destination: &Path,
    params: &ConnectionParams,
    driver: &str,
    options: &TableExportOptions,
    size_limit: Option<u64>,
) -> Result<ExportSummary, String> {
    let drv = crate::drivers::registry::get_connection_driver(params).await?;
    let manifest = drv.manifest();
    if manifest.capabilities.table_export == Some(false) {
        return Err(
            "This connection's driver does not support exporting tables to SQL.".to_string(),
        );
    }
    let dialect = DumpDialect::from_capabilities(driver, &manifest.capabilities);
    let rules = SqlScanRules::new(&SqlSyntax::resolve(&manifest.capabilities), &dialect);
    let resolved_schema = dialect.resolve_schema(options.schema.as_deref());
    let schema = dialect.scoped_schema(resolved_schema.as_deref());
    let table = options.table.as_str();
    let columns = drv.get_columns(params, table, schema).await?;
    let (structure, structure_source) =
        table_structure(&drv, params, &dialect, &rules, table, schema, &columns).await?;

    let body_path = sibling_path(destination, "rows");
    let _body_guard = RemoveOnDrop::new(body_path.clone());
    let mut body = BufWriter::new(create_private_file(&body_path)?);
    let io = |error: std::io::Error| error.to_string();
    writeln!(body, "{}", section_marker(SECTION_STRUCTURE)).map_err(io)?;
    writeln!(body, "{structure}\n").map_err(io)?;
    let mut rows = 0;
    if options.content.has_data() {
        writeln!(body, "{}", section_marker(SECTION_DATA)).map_err(io)?;
        let query = export_select(&dialect, schema, table, &columns);
        let progress_runtime = runtime.clone();
        let progress_connection = connection_id.to_string();
        let mut progress = ProgressEmitter::new(DEFAULT_PROGRESS_INTERVAL, move |rows_processed| {
            let payload = serde_json::json!({
                "connection_id": progress_connection,
                "rows_processed": rows_processed,
            });
            let _ = match session_id {
                Some(owner) => progress_runtime
                    .events
                    .emit_to(owner, "export_progress", payload),
                None => progress_runtime.events.emit("export_progress", payload),
            };
        });
        let mut writer = RowWriter {
            out: &mut body,
            dialect: &dialect,
            table,
            batch: Vec::new(),
            columns: Vec::new(),
        };
        if is_builtin_driver(driver) {
            stream_sql_rows(
                &drv,
                params,
                driver,
                &query,
                table,
                schema,
                |names, cells| {
                    if writer.columns.is_empty() {
                        writer.columns = names.to_vec();
                    }
                    writer.push(
                        cells
                            .into_iter()
                            .map(|cell| cell.render(&dialect))
                            .collect(),
                    )?;
                    progress.tick();
                    Ok(())
                },
            )
            .await?;
            writer.flush()?;
        } else {
            write_plugin_rows(
                &drv,
                params,
                &query,
                table,
                schema,
                &columns,
                &mut writer,
                &mut progress,
            )
            .await?;
        }
        progress.finish();
        rows = progress.count();
        writeln!(body).map_err(io)?;
    }
    writeln!(body, "{}", end_marker()).map_err(io)?;
    body.flush().map_err(io)?;
    drop(body);

    let header = TableSqlHeader {
        format_version: FORMAT_VERSION,
        tabularis_version: env!("CARGO_PKG_VERSION").to_string(),
        driver: driver.to_string(),
        driver_version: (!manifest.is_builtin).then(|| manifest.version.clone()),
        source: source_label(params.database.primary(), resolved_schema.as_deref(), table),
        table: table.to_string(),
        content: options.content,
        structure_source,
        rows,
        exported: chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    };
    let part_path = sibling_path(destination, "part");
    let mut part_guard = RemoveOnDrop::new(part_path.clone());
    let mut out = BufWriter::new(create_private_file(&part_path)?);
    out.write_all(header.render().as_bytes()).map_err(io)?;
    std::io::copy(&mut File::open(&body_path).map_err(io)?, &mut out).map_err(io)?;
    out.flush().map_err(io)?;
    drop(out);
    let bytes = fs::metadata(&part_path).map_err(io)?.len();
    if let Some(limit) = size_limit.filter(|limit| bytes > *limit) {
        return Err(format!(
            "Export exceeds the {limit} byte browser download limit"
        ));
    }
    fs::rename(&part_path, destination)
        .map_err(|error| format!("Failed to write {}: {error}", destination.display()))?;
    part_guard.disarm();
    Ok(ExportSummary {
        rows,
        bytes,
        structure_source,
    })
}

/// The table's `CREATE TABLE` (and index statements) from the driver, made
/// unqualified; else one built from its columns, marked `generated`.
async fn table_structure(
    drv: &Arc<dyn DatabaseDriver>,
    params: &ConnectionParams,
    dialect: &DumpDialect,
    rules: &SqlScanRules,
    table: &str,
    schema: Option<&str>,
    columns: &[TableColumn],
) -> Result<(String, StructureSource), String> {
    if let Ok(ddl) = drv.get_table_ddl(params, table, schema).await {
        if !ddl.trim().is_empty() {
            let ddl = unqualify_ddl(&ddl, dialect, rules, schema, table);
            return Ok((terminate_statements(&ddl), StructureSource::Driver));
        }
    }
    let definitions = columns
        .iter()
        .filter(|column| !column.is_generated)
        .map(|column| ColumnDefinition {
            name: column.name.clone(),
            data_type: column
                .full_type
                .clone()
                .unwrap_or_else(|| column.data_type.clone()),
            is_nullable: column.is_nullable,
            is_pk: column.is_pk,
            is_auto_increment: column.is_auto_increment,
            default_value: column.default_value.clone(),
            comment: None,
        })
        .collect::<Vec<_>>();
    let statements = drv
        .get_create_table_sql(table, definitions, None)
        .await
        .map_err(|error| {
            format!("Could not read or build the structure of table \"{table}\": {error}")
        })?;
    let structure = statements
        .iter()
        .map(|statement| terminate_statements(statement))
        .collect::<Vec<_>>()
        .join("\n");
    Ok((structure, StructureSource::Generated))
}

/// Batches rendered rows into `INSERT` statements of [`INSERT_BATCH_ROWS`].
struct RowWriter<'a, W: Write> {
    out: &'a mut W,
    dialect: &'a DumpDialect,
    table: &'a str,
    columns: Vec<String>,
    batch: Vec<Vec<String>>,
}

impl<W: Write> RowWriter<'_, W> {
    fn push(&mut self, row: Vec<String>) -> Result<(), String> {
        self.batch.push(row);
        if self.batch.len() >= INSERT_BATCH_ROWS {
            self.flush()?;
        }
        Ok(())
    }

    fn flush(&mut self) -> Result<(), String> {
        if self.batch.is_empty() {
            return Ok(());
        }
        let statement = render_insert(self.dialect, self.table, &self.columns, &self.batch);
        self.batch.clear();
        self.write_statement(&statement)
    }

    fn write_statement(&mut self, statement: &str) -> Result<(), String> {
        writeln!(self.out, "{}", terminate_statements(statement)).map_err(|error| error.to_string())
    }
}

/// Pages a plugin's rows through `execute_query` and lets the plugin render
/// each batch when it implements `render_insert_statements`; otherwise the
/// host renders it from the manifest capabilities.
#[allow(clippy::too_many_arguments)]
async fn write_plugin_rows<W: Write, F: FnMut(u64)>(
    drv: &Arc<dyn DatabaseDriver>,
    params: &ConnectionParams,
    query: &str,
    table: &str,
    schema: Option<&str>,
    columns: &[TableColumn],
    writer: &mut RowWriter<'_, W>,
    progress: &mut ProgressEmitter<F>,
) -> Result<(), String> {
    let json_columns = json_column_names(columns);
    let mut plugin_renders = true;
    let mut batch: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut page = 1u32;
    loop {
        let result = drv
            .execute_query(params, query, Some(PLUGIN_PAGE_SIZE), page, schema)
            .await?;
        let fetched = result.rows.len() as u32;
        if writer.columns.is_empty() {
            writer.columns = result.columns.clone();
        }
        for row in result.rows {
            batch.push(row);
            progress.tick();
            if batch.len() >= INSERT_BATCH_ROWS {
                flush_plugin_batch(
                    drv,
                    table,
                    schema,
                    &json_columns,
                    writer,
                    &mut batch,
                    &mut plugin_renders,
                )
                .await?;
            }
        }
        if fetched == 0 || !plugin_dump_has_more(result.pagination, fetched, PLUGIN_PAGE_SIZE) {
            break;
        }
        page += 1;
    }
    flush_plugin_batch(
        drv,
        table,
        schema,
        &json_columns,
        writer,
        &mut batch,
        &mut plugin_renders,
    )
    .await
}

async fn flush_plugin_batch<W: Write>(
    drv: &Arc<dyn DatabaseDriver>,
    table: &str,
    schema: Option<&str>,
    json_columns: &std::collections::HashSet<String>,
    writer: &mut RowWriter<'_, W>,
    batch: &mut Vec<Vec<serde_json::Value>>,
    plugin_renders: &mut bool,
) -> Result<(), String> {
    if batch.is_empty() {
        return Ok(());
    }
    if *plugin_renders {
        match drv
            .render_insert_statements(table, schema, &writer.columns, batch)
            .await?
        {
            Some(statements) => {
                for statement in statements {
                    writer.write_statement(&statement)?;
                }
                batch.clear();
                return Ok(());
            }
            None => *plugin_renders = false,
        }
    }
    let columns = writer.columns.clone();
    for row in batch.drain(..) {
        let rendered = plugin_row_cells(row, &columns, json_columns)
            .into_iter()
            .map(|cell| cell.render(writer.dialect))
            .collect();
        writer.push(rendered)?;
    }
    writer.flush()
}

// --- Import preview ----------------------------------------------------------

pub async fn preview_table_import(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: String,
    source: TableImportSource,
) -> Result<TableImportPreview, String> {
    let (driver, params) =
        super::connections::resolve_saved_connection_params(runtime, session_id, &connection_id)?;
    let mut prefix = Vec::new();
    match source {
        TableImportSource::ServerPath(path) => {
            tokio::fs::File::open(&path)
                .await
                .map_err(|error| format!("Failed to open {}: {error}", path.display()))?
                .take(PREVIEW_READ_BYTES)
                .read_to_end(&mut prefix)
                .await
                .map_err(|error| error.to_string())?;
        }
        TableImportSource::SessionUpload { owner, token } => {
            FileTransferStore::new(runtime.paths.data_dir())
                .open_upload(owner, &token, TABLE_IMPORT_PURPOSE)
                .await?
                .take(PREVIEW_READ_BYTES)
                .read_to_end(&mut prefix)
                .await
                .map_err(|error| error.to_string())?;
        }
    }
    let (header, structure, structure_truncated) = read_preview(&prefix)?;
    let drv = crate::drivers::registry::get_connection_driver(&params).await?;
    let problem = check_import_target(&header, &driver, &drv.manifest().capabilities).err();
    Ok(TableImportPreview {
        header,
        structure,
        structure_truncated,
        problem,
    })
}

// --- Import ------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableImportOptions {
    pub if_exists: IfTableExists,
    pub schema: Option<String>,
    pub database: Option<String>,
}

pub async fn import_table(
    runtime: &RuntimeContext,
    state: &DumpCancellationState,
    session_id: Option<Uuid>,
    connection_id: String,
    source: TableImportSource,
    options: TableImportOptions,
) -> Result<TableImportResult, String> {
    let (driver, mut params) =
        super::connections::resolve_saved_connection_params(runtime, session_id, &connection_id)?;
    scope_database(&mut params, options.database.as_deref());
    let (path, claimed) = match source {
        TableImportSource::ServerPath(path) => (path, None),
        TableImportSource::SessionUpload { owner, token } => {
            let claimed = FileTransferStore::new(runtime.paths.data_dir()).claim_upload(
                owner,
                &token,
                TABLE_IMPORT_PURPOSE,
            )?;
            (claimed.path().to_path_buf(), Some(claimed))
        }
    };
    let runtime_for_task = runtime.clone();
    let connection_for_task = connection_id.clone();
    let task = tokio::spawn(async move {
        let _claimed = claimed;
        run_table_import(
            &runtime_for_task,
            session_id,
            &connection_for_task,
            &path,
            &params,
            &driver,
            &options,
        )
        .await
    });
    let mut registration = JobRegistration::new(
        state.handles.clone(),
        database_transfers::job_key(session_id, JobKind::TableImport, &connection_id),
        Arc::new(task.abort_handle()),
    );
    let result = task.await;
    registration.complete();
    database_transfers::join_job(result, "Import")
}

pub fn cancel_table_import(
    state: &DumpCancellationState,
    session_id: Option<Uuid>,
    connection_id: &str,
) -> Result<(), String> {
    database_transfers::cancel_job(state, session_id, JobKind::TableImport, connection_id)
}

async fn run_table_import(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    path: &Path,
    params: &ConnectionParams,
    driver: &str,
    options: &TableImportOptions,
) -> Result<TableImportResult, String> {
    let file =
        File::open(path).map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    let mut reader = BufReader::with_capacity(128 * 1024, file);
    let header = TableSqlHeader::parse(&mut reader)?;
    let drv = crate::drivers::registry::get_connection_driver(params).await?;
    let capabilities = &drv.manifest().capabilities;
    check_import_target(&header, driver, capabilities)?;
    let dialect = DumpDialect::from_capabilities(driver, capabilities);
    let resolved_schema = dialect.resolve_schema(options.schema.as_deref());
    let schema = dialect.scoped_schema(resolved_schema.as_deref());
    let table = header.table.as_str();
    let exists = drv
        .get_tables(params, schema)
        .await?
        .iter()
        .any(|existing| existing.name == table);
    let plan = plan_import(
        &header,
        options.if_exists,
        exists,
        capabilities.manage_tables,
    )?;

    let progress = ImportReporter {
        runtime,
        session_id,
        connection_id,
    };
    progress.emit(0, "Starting import...".to_string(), false);
    if plan.drop_first {
        let drop_sql = drop_table_sql(&drv, params, &dialect, capabilities, table, schema).await;
        drv.execute_query(params, &drop_sql, None, 1, schema)
            .await
            .map_err(|error| format!("Could not drop the existing table \"{table}\": {error}"))?;
    }

    let rules = SqlScanRules::new(&SqlSyntax::resolve(capabilities), &dialect);
    let mut statements = TableSqlReader::new(reader, rules);
    let mut section = String::new();
    let mut created = false;
    let mut executed: u64 = 0;
    let mut rows: u64 = 0;
    loop {
        let item = match statements.next_item() {
            Ok(Some(item)) => item,
            Ok(None) => break,
            Err(error) => {
                let removed = created
                    && remove_created_table(&drv, params, &dialect, capabilities, table, schema)
                        .await;
                return Err(import_failure(&section, None, &error, rows, removed));
            }
        };
        match item {
            TableSqlItem::Section(name) => {
                section = name;
                progress.emit(executed, format!("Importing {section}"), false);
            }
            TableSqlItem::Statement { sql, line } => {
                if section == SECTION_STRUCTURE && !plan.run_structure {
                    continue;
                }
                match drv.execute_query(params, &sql, None, 1, schema).await {
                    Ok(result) => {
                        executed += 1;
                        if section == SECTION_DATA {
                            rows += result.affected_rows;
                        } else if section == SECTION_STRUCTURE {
                            created = true;
                        }
                        if executed as usize % IMPORT_PROGRESS_INTERVAL == 0 {
                            progress.emit(
                                executed,
                                format!("Importing {section}: {rows} rows"),
                                false,
                            );
                        }
                    }
                    Err(error) => {
                        let removed = created
                            && remove_created_table(
                                &drv,
                                params,
                                &dialect,
                                capabilities,
                                table,
                                schema,
                            )
                            .await;
                        return Err(import_failure(&section, Some(line), &error, rows, removed));
                    }
                }
            }
        }
    }
    progress.emit(executed, "Import completed".to_string(), true);
    Ok(TableImportResult {
        table: header.table,
        statements: executed,
        rows,
    })
}

/// The error an import reports: the section, the line in the file, the
/// driver's message, the rows inserted so far and whether the table this
/// import created was removed again.
pub(crate) fn import_failure(
    section: &str,
    line: Option<usize>,
    error: &str,
    rows: u64,
    removed: bool,
) -> String {
    let section = if section.is_empty() {
        "header"
    } else {
        section
    };
    let location = match line {
        Some(line) => format!(" at line {line}"),
        None => String::new(),
    };
    let outcome = if removed {
        "The table created by this import was removed.".to_string()
    } else {
        format!("{rows} rows were inserted before the error.")
    };
    format!("Import failed in the {section} section{location}: {error}\n{outcome}")
}

async fn drop_table_sql(
    drv: &Arc<dyn DatabaseDriver>,
    params: &ConnectionParams,
    dialect: &DumpDialect,
    capabilities: &DriverCapabilities,
    table: &str,
    schema: Option<&str>,
) -> String {
    if capabilities.drop_table_sql {
        if let Ok(Some(sql)) = drv.get_drop_table_sql(params, table, schema).await {
            return sql;
        }
    }
    format!("DROP TABLE {}", dialect.table_ref(schema, table))
}

/// Drops the table this import created, after a failure. Best effort: the
/// result says whether it worked.
async fn remove_created_table(
    drv: &Arc<dyn DatabaseDriver>,
    params: &ConnectionParams,
    dialect: &DumpDialect,
    capabilities: &DriverCapabilities,
    table: &str,
    schema: Option<&str>,
) -> bool {
    let sql = drop_table_sql(drv, params, dialect, capabilities, table, schema).await;
    drv.execute_query(params, &sql, None, 1, schema)
        .await
        .is_ok()
}

struct ImportReporter<'a> {
    runtime: &'a RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &'a str,
}

impl ImportReporter<'_> {
    fn emit(&self, executed: u64, operation: String, complete: bool) {
        let executed = executed as usize;
        database_transfers::emit_progress(
            self.runtime,
            self.session_id,
            "import_progress",
            &ImportProgress {
                connection_id: self.connection_id.to_string(),
                statements_executed: executed,
                total_statements: if complete { executed } else { 0 },
                percentage: if complete { 100.0 } else { 0.0 },
                current_operation: operation,
            },
        );
    }
}

// --- Helpers -----------------------------------------------------------------

fn is_builtin_driver(driver: &str) -> bool {
    matches!(driver, "mysql" | "postgres" | "sqlite")
}

fn scope_database(params: &mut ConnectionParams, database: Option<&str>) {
    if let Some(database) = database.filter(|database| !database.is_empty()) {
        params.database = DatabaseSelection::Single(database.to_string());
    }
}

/// `<table>_<yyyyMMdd-HHmmss>.sql`
pub(crate) fn download_file_name(table: &str) -> String {
    format!(
        "{}_{}.sql",
        super::file_transfers::safe_file_name(table).replace([' ', '.'], "_"),
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    )
}

/// A hidden scratch file in the destination's folder, so the final rename
/// stays on one file system.
fn sibling_path(destination: &Path, tag: &str) -> PathBuf {
    let name = destination
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "table.sql".to_string());
    destination.with_file_name(format!(".{name}.{}.{tag}", Uuid::new_v4()))
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

fn create_private_file(path: &Path) -> Result<File, String> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .map_err(|error| format!("Failed to create {}: {error}", path.display()))
}

/// Removes a scratch file when dropped, including when the task is aborted.
struct RemoveOnDrop {
    path: Option<PathBuf>,
}

impl RemoveOnDrop {
    fn new(path: PathBuf) -> Self {
        Self { path: Some(path) }
    }

    fn disarm(&mut self) {
        self.path = None;
    }
}

impl Drop for RemoveOnDrop {
    fn drop(&mut self) {
        if let Some(path) = self.path.take() {
            let _ = fs::remove_file(path);
        }
    }
}
