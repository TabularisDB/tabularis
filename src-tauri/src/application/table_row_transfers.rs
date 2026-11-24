//! Direct table-to-table row transfer between two saved connections.
//!
//! SQLite-only row-by-row transfer. Plugin drivers use the
//! `DatabaseDriver` trait's whole-database/whole-file transfer protocol.

mod sqlite;

use super::database_transfers::{emit_progress, DumpCancellationState};
use crate::drivers::driver_trait::DatabaseDriver;
use crate::models::{ConnectionParams, DatabaseSelection};
use crate::pool_manager::get_sqlite_pool;
use crate::runtime::RuntimeContext;
use crate::table_transfer::{
    apply_conversion, build_table_plan, capabilities, dialect_for_driver, ensure_supported_pair,
    ColumnBinding, ConflictMode, PlanInputs, PlanIssue, PlannedTable, TablePlan, TableSelection,
    TableTransferCapabilities, TableTransferRequest, TransferDialect, TransferValue,
    DEFAULT_BATCH_ROWS, MAX_BATCH_ROWS,
};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use uuid::Uuid;

pub const TABLE_TRANSFER_PROGRESS_EVENT: &str = "table_transfer_progress";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferStatus {
    Completed,
    Failed,
    Cancelled,
    NotStarted,
    Running,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableTransferPlan {
    pub tables: Vec<TablePlan>,
    pub issues: Vec<PlanIssue>,
    pub blocking: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableTransferTableResult {
    pub source_table: String,
    pub target_table: String,
    pub status: TransferStatus,
    pub rows_read: u64,
    pub rows_written: u64,
    pub rows_skipped: u64,
    /// Rows of the batch that was rolled back when the table failed.
    pub rows_failed: u64,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableTransferResult {
    pub transfer_id: String,
    pub status: TransferStatus,
    pub tables: Vec<TableTransferTableResult>,
}

#[derive(Clone, Debug, Serialize)]
pub struct TableTransferProgress {
    pub transfer_id: String,
    pub table_index: usize,
    pub total_tables: usize,
    pub source_table: String,
    pub target_table: String,
    pub status: TransferStatus,
    pub rows_read: u64,
    pub rows_written: u64,
    pub rows_skipped: u64,
    pub estimated_rows: Option<i64>,
}

#[derive(Clone)]
struct Endpoint {
    driver: String,
    dialect: TransferDialect,
    params: ConnectionParams,
    schema: String,
    drv: Arc<dyn DatabaseDriver>,
}

struct Resolved {
    source: Endpoint,
    target: Endpoint,
    tables: Vec<PlannedTable>,
    issues: Vec<PlanIssue>,
}

impl Resolved {
    fn blocking(&self) -> bool {
        !self.issues.is_empty() || self.tables.iter().any(|t| t.plan.blocking)
    }
}

pub fn get_capabilities() -> TableTransferCapabilities {
    capabilities()
}

fn non_empty(value: Option<&String>) -> Option<&str> {
    value.map(String::as_str).filter(|v| !v.is_empty())
}

async fn resolve_endpoint(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    database: Option<&String>,
    schema: Option<&String>,
) -> Result<Endpoint, String> {
    let (driver, mut params) =
        super::connections::resolve_saved_connection_params(runtime, session_id, connection_id)?;
    let dialect = dialect_for_driver(&driver)
        .ok_or_else(|| format!("Table transfer does not support the {driver} driver"))?;
    if let Some(database) = non_empty(database) {
        params.database = DatabaseSelection::Single(database.to_string());
    }
    let drv = crate::drivers::registry::get_connection_driver(&params).await?;
    let schema = match dialect {
        TransferDialect::Sqlite => String::new(),
    };
    Ok(Endpoint {
        driver,
        dialect,
        params,
        schema,
        drv,
    })
}

impl Endpoint {
    fn schema_arg(&self) -> Option<&str> {
        None
    }
}

fn reaches_same_database(a: &ConnectionParams, b: &ConnectionParams) -> bool {
    if a.driver != b.driver {
        return false;
    }
    match dialect_for_driver(&a.driver) {
        Some(TransferDialect::Sqlite) => same_file(a.database.primary(), b.database.primary()),
        None => false,
    }
}

fn same_file(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

#[derive(Debug, PartialEq, Eq)]
enum SameTable {
    Yes,
    No,
}

/// Decides whether the transfer would write a table into itself, whichever
/// saved connections the two endpoints came from.
async fn same_table(source: &Endpoint, target: &Endpoint, selection: &TableSelection) -> SameTable {
    if source.schema != target.schema
        || !selection
            .source_table
            .eq_ignore_ascii_case(&selection.target_table)
        || source.params.driver != target.params.driver
    {
        return SameTable::No;
    }
    if reaches_same_database(&source.params, &target.params) {
        return SameTable::Yes;
    }
    SameTable::No
}

async fn plan_tables(
    source: &Endpoint,
    target: &Endpoint,
    selections: &[TableSelection],
) -> Result<(Vec<PlannedTable>, Vec<PlanIssue>), String> {
    let mut issues = Vec::new();
    if target.drv.manifest().capabilities.readonly || target.params.read_only {
        issues.push(PlanIssue::new("targetReadOnly", None));
    }
    // SQLite folds ASCII case in table names, so `dst` and `DST` are one table.
    let mut seen = std::collections::HashSet::new();
    let mut tables = Vec::with_capacity(selections.len());
    for selection in selections {
        if !seen.insert(selection.target_table.to_ascii_lowercase()) {
            issues.push(PlanIssue::new(
                "duplicateTargetTable",
                Some(&selection.target_table),
            ));
        }
        let source_columns = source
            .drv
            .get_columns(&source.params, &selection.source_table, source.schema_arg())
            .await?;
        let target_columns = target
            .drv
            .get_columns(&target.params, &selection.target_table, target.schema_arg())
            .await?;
        let verdict = same_table(source, target, selection).await;
        let estimated_rows: Option<i64> = None;
        let target_strict = if target.dialect == TransferDialect::Sqlite
            && target_columns
                .iter()
                .any(|c| c.data_type.trim().eq_ignore_ascii_case("ANY"))
        {
            let pool = get_sqlite_pool(&target.params).await?;
            sqlite::is_strict_table(&pool, &selection.target_table).await
        } else {
            false
        };
        let mut planned = build_table_plan(&PlanInputs {
            selection,
            source_columns: &source_columns,
            target_columns: &target_columns,
            target_dialect: target.dialect,
            target_strict,
            estimated_rows,
            same_table: verdict == SameTable::Yes,
        });
        tables.push(planned);
    }
    Ok((tables, issues))
}

async fn resolve(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    request: &TableTransferRequest,
) -> Result<Resolved, String> {
    if request.tables.is_empty() {
        return Err("Select at least one table to transfer".to_string());
    }
    let source = resolve_endpoint(
        runtime,
        session_id,
        &request.source_connection_id,
        request.source_database.as_ref(),
        request.source_schema.as_ref(),
    )
    .await?;
    let target = resolve_endpoint(
        runtime,
        session_id,
        &request.target_connection_id,
        request.target_database.as_ref(),
        request.target_schema.as_ref(),
    )
    .await?;
    ensure_supported_pair(&source.driver, &target.driver)?;

    let (tables, issues) = plan_tables(&source, &target, &request.tables).await?;
    Ok(Resolved {
        source,
        target,
        tables,
        issues,
    })
}

pub async fn plan(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    request: TableTransferRequest,
) -> Result<TableTransferPlan, String> {
    let resolved = resolve(runtime, session_id, &request).await?;
    let blocking = resolved.blocking();
    Ok(TableTransferPlan {
        tables: resolved.tables.into_iter().map(|t| t.plan).collect(),
        issues: resolved.issues,
        blocking,
    })
}

fn transfer_key(session_id: Option<Uuid>, transfer_id: &str) -> String {
    match session_id {
        Some(session_id) => format!("web:{session_id}:table-transfer:{transfer_id}"),
        None => format!("desktop:table-transfer:{transfer_id}"),
    }
}

pub fn cancel_session_transfers(state: &DumpCancellationState, session_id: Uuid) {
    let prefix = format!("web:{session_id}:");
    let flags = state
        .table_transfers
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    for (key, flag) in flags.iter() {
        if key.starts_with(&prefix) {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

pub fn cancel(
    state: &DumpCancellationState,
    session_id: Option<Uuid>,
    transfer_id: &str,
) -> Result<(), String> {
    let flags = state
        .table_transfers
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    match flags.get(&transfer_key(session_id, transfer_id)) {
        Some(flag) => {
            flag.store(true, Ordering::SeqCst);
            Ok(())
        }
        None => Err("No active table transfer found".to_string()),
    }
}

/// Registers the cancel flag for a transfer and cancels it if the caller goes
/// away (for example a closed browser session) before the job finishes.
struct Registration {
    state: Arc<std::sync::Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>>,
    key: String,
    flag: Arc<AtomicBool>,
}

impl Drop for Registration {
    fn drop(&mut self) {
        self.flag.store(true, Ordering::SeqCst);
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.key);
    }
}

struct Job {
    runtime: RuntimeContext,
    session_id: Option<Uuid>,
    transfer_id: String,
    cancel: Arc<AtomicBool>,
    source: Endpoint,
    target: Endpoint,
    conflict: ConflictMode,
    batch_rows: usize,
    total_tables: usize,
}

pub async fn run(
    runtime: &RuntimeContext,
    state: &DumpCancellationState,
    session_id: Option<Uuid>,
    request: TableTransferRequest,
) -> Result<TableTransferResult, String> {
    let transfer_id = non_empty(request.transfer_id.as_ref())
        .ok_or_else(|| "A transfer id is required".to_string())?
        .to_string();
    // Register before planning: resolving opens pools and reads metadata, and a
    // cancel (or a closed browser session) arriving meanwhile must still count.
    let flag = Arc::new(AtomicBool::new(false));
    let key = transfer_key(session_id, &transfer_id);
    {
        let mut flags = state
            .table_transfers
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if flags.contains_key(&key) {
            return Err("A table transfer with this id is already running".to_string());
        }
        flags.insert(key.clone(), flag.clone());
    }
    let _registration = Registration {
        state: state.table_transfers.clone(),
        key,
        flag: flag.clone(),
    };
    // The plan is rebuilt here: a client-supplied plan is never trusted.
    let resolved = resolve(runtime, session_id, &request).await?;
    if resolved.blocking() {
        return Err(
            "The transfer plan has blocking issues. Review the plan before starting".to_string(),
        );
    }
    let job = Job {
        runtime: runtime.clone(),
        session_id,
        transfer_id,
        cancel: flag,
        source: resolved.source,
        target: resolved.target,
        conflict: request.conflict,
        batch_rows: request
            .batch_rows
            .unwrap_or(DEFAULT_BATCH_ROWS)
            .clamp(1, MAX_BATCH_ROWS),
        total_tables: resolved.tables.len(),
    };
    let tables = resolved.tables;
    tokio::spawn(async move { run_job(job, tables).await })
        .await
        .map_err(|error| format!("Table transfer task failed: {error}"))
}

async fn run_job(job: Job, tables: Vec<PlannedTable>) -> TableTransferResult {
    let mut results = Vec::with_capacity(tables.len());
    let mut stopped: Option<TransferStatus> = None;
    for (index, planned) in tables.iter().enumerate() {
        let mut result = TableTransferTableResult {
            source_table: planned.plan.source_table.clone(),
            target_table: planned.plan.target_table.clone(),
            status: TransferStatus::NotStarted,
            rows_read: 0,
            rows_written: 0,
            rows_skipped: 0,
            rows_failed: 0,
            error: None,
        };
        if stopped.is_none() && job.cancel.load(Ordering::SeqCst) {
            stopped = Some(TransferStatus::Cancelled);
        }
        if stopped.is_none() {
            result.status = TransferStatus::Running;
            emit(&job, index, planned, &result);
            match copy_table(&job, index, planned, &mut result).await {
                Ok(status) => result.status = status,
                Err(error) => {
                    result.status = TransferStatus::Failed;
                    result.error = Some(error);
                }
            }
            emit(&job, index, planned, &result);
            if result.status != TransferStatus::Completed {
                stopped = Some(result.status);
            }
        }
        results.push(result);
    }
    TableTransferResult {
        transfer_id: job.transfer_id,
        status: stopped.unwrap_or(TransferStatus::Completed),
        tables: results,
    }
}

fn emit(job: &Job, index: usize, planned: &PlannedTable, result: &TableTransferTableResult) {
    emit_progress(
        &job.runtime,
        job.session_id,
        TABLE_TRANSFER_PROGRESS_EVENT,
        &TableTransferProgress {
            transfer_id: job.transfer_id.clone(),
            table_index: index,
            total_tables: job.total_tables,
            source_table: result.source_table.clone(),
            target_table: result.target_table.clone(),
            status: result.status,
            rows_read: result.rows_read,
            rows_written: result.rows_written,
            rows_skipped: result.rows_skipped,
            estimated_rows: planned.plan.estimated_rows,
        },
    );
}

enum Sink {
    Sqlite(sqlx::Pool<sqlx::Sqlite>),
}

impl Sink {
    async fn write(
        &mut self,
        target: &Endpoint,
        table: &str,
        bindings: &[ColumnBinding],
        rows: &[Vec<TransferValue>],
        conflict: ConflictMode,
    ) -> Result<(u64, u64), String> {
        match self {
            Self::Sqlite(pool) => sqlite::write_batch(pool, table, bindings, rows, conflict).await,
        }
    }
}

async fn open_sink(target: &Endpoint) -> Result<Sink, String> {
    Ok(match target.dialect {
        TransferDialect::Sqlite => Sink::Sqlite(get_sqlite_pool(&target.params).await?),
    })
}

/// Copies one table in bounded batches. Each batch commits on its own, so a
/// failure or cancellation leaves every earlier batch in the target.
async fn copy_table(
    job: &Job,
    index: usize,
    planned: &PlannedTable,
    result: &mut TableTransferTableResult,
) -> Result<TransferStatus, String> {
    use futures::TryStreamExt;

    let bindings = &planned.bindings;
    let pool = get_sqlite_pool(&job.source.params).await?;
    let mut sink = open_sink(&job.target).await?;

    // One read transaction pins a snapshot for the whole copy, and one
    // advancing SELECT walks the table once. LIMIT/OFFSET paging would
    // re-scan and discard every earlier row on each batch (quadratic).
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let columns: Vec<String> = bindings
        .iter()
        .map(|b| format!("\"{}\"", b.source_column.replace('"', "\"\"")))
        .collect();
    let select = format!(
        "SELECT {} FROM \"{}\"",
        columns.join(", "),
        planned.plan.source_table.replace('"', "\"\"")
    );
    let mut stream = sqlx::query(&select).fetch(&mut *tx);

    let mut ordinal = 0u64;
    loop {
        if job.cancel.load(Ordering::SeqCst) {
            return Ok(TransferStatus::Cancelled);
        }
        let mut rows = Vec::with_capacity(job.batch_rows);
        while rows.len() < job.batch_rows {
            match stream.try_next().await.map_err(|e| e.to_string())? {
                Some(row) => rows.push(row),
                None => break,
            }
        }
        if rows.is_empty() {
            return Ok(TransferStatus::Completed);
        }
        let mut batch = Vec::with_capacity(rows.len());
        for row in &rows {
            ordinal += 1;
            let mut converted = Vec::with_capacity(bindings.len());
            for (position, binding) in bindings.iter().enumerate() {
                let value = sqlite_read_cell(row, position, binding.source_kind)?;
                let value = apply_conversion(&binding.conversion, value).map_err(|error| {
                    result.rows_failed = rows.len() as u64;
                    format!(
                        "Source row {ordinal}, column \"{}\" was rejected ({}). Nothing from this batch was written",
                        binding.source_column,
                        error.code()
                    )
                })?;
                converted.push(value);
            }
            batch.push(converted);
        }
        result.rows_read += batch.len() as u64;
        if job.cancel.load(Ordering::SeqCst) {
            return Ok(TransferStatus::Cancelled);
        }
        match sink
            .write(
                &job.target,
                &planned.plan.target_table,
                bindings,
                &batch,
                job.conflict,
            )
            .await
        {
            Ok((written, skipped)) => {
                result.rows_written += written;
                result.rows_skipped += skipped;
                emit(job, index, planned, result);
            }
            Err(error) => {
                result.rows_failed = batch.len() as u64;
                return Err(error);
            }
        }
    }
}

/// Reads a cell from a SQLite source row by position.
fn sqlite_read_cell(
    row: &sqlx::sqlite::SqliteRow,
    index: usize,
    kind: crate::table_transfer::SourceKind,
) -> Result<TransferValue, String> {
    use crate::table_transfer::SourceKind;
    use sqlx::Row;

    let wrong = || "A source column returned an unexpected type".to_string();
    match kind {
        SourceKind::Bool => {
            // SQLite stores booleans as integers (0, 1, 2, …). Preserve the
            // raw integer instead of coercing to bool — coercing via `v != 0`
            // would turn 2 into 1, a lossy change in a transfer marked "Exact."
            let v: Option<i64> = row.try_get(index).map_err(|_| wrong())?;
            Ok(v.map_or(TransferValue::Null, TransferValue::Int))
        }
        SourceKind::Int => {
            let v: Option<i64> = row.try_get(index).map_err(|_| wrong())?;
            Ok(v.map_or(TransferValue::Null, TransferValue::Int))
        }
        SourceKind::Float => {
            let v: Option<f64> = row.try_get(index).map_err(|_| wrong())?;
            Ok(v.map_or(TransferValue::Null, TransferValue::Float))
        }
        SourceKind::Text => {
            let v: Option<String> = row.try_get(index).map_err(|_| wrong())?;
            Ok(v.map_or(TransferValue::Null, TransferValue::Text))
        }
        SourceKind::Bytes => {
            let v: Option<Vec<u8>> = row.try_get(index).map_err(|_| wrong())?;
            Ok(v.map_or(TransferValue::Null, TransferValue::Bytes))
        }
        _ => {
            let v: Option<String> = row.try_get(index).map_err(|_| wrong())?;
            Ok(v.map_or(TransferValue::Null, TransferValue::Text))
        }
    }
}

#[cfg(test)]
#[path = "table_row_transfers_tests.rs"]
mod tests;
