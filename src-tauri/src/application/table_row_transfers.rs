//! Direct table-to-table row transfer between two saved connections.
//!
//! First milestone: PostgreSQL source into a PostgreSQL or SQLite target,
//! append-only, into tables that already exist. Plugin drivers are not
//! supported; `get_table_transfer_capabilities` publishes the pairs that are.

mod postgres;
mod sqlite;

use super::database_transfers::{emit_progress, DumpCancellationState};
use crate::drivers::driver_trait::DatabaseDriver;
use crate::models::{ConnectionParams, DatabaseSelection};
use crate::pool_manager::{get_postgres_pool, get_sqlite_pool};
use crate::runtime::RuntimeContext;
use crate::table_transfer::{
    apply_conversion, build_table_plan, capabilities, dialect_for_driver, ensure_supported_pair,
    ColumnBinding, ConflictMode, PlanInputs, PlanIssue, PlannedTable, TableTransferCapabilities,
    TableSelection, TableTransferRequest, TablePlan, TransferDialect, TransferValue, DEFAULT_BATCH_ROWS,
    MAX_BATCH_ROWS,
};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use uuid::Uuid;

pub const TABLE_TRANSFER_PROGRESS_EVENT: &str = "table_transfer_progress";
const CURSOR_NAME: &str = "tabularis_transfer";
const SOURCE_SESSION_SETUP: &str = "SET LOCAL TimeZone TO 'UTC'; \
     SET LOCAL DateStyle TO 'ISO, MDY'; \
     SET LOCAL extra_float_digits TO 3";

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
        TransferDialect::Postgres => non_empty(schema).unwrap_or("public").to_string(),
        TransferDialect::Sqlite => String::new(),
    };
    Ok(Endpoint { driver, dialect, params, schema, drv })
}

impl Endpoint {
    fn schema_arg(&self) -> Option<&str> {
        (self.dialect == TransferDialect::Postgres).then_some(self.schema.as_str())
    }
}

fn is_loopback(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
}

fn same_host(a: Option<&str>, b: Option<&str>) -> bool {
    let a = a.unwrap_or("localhost").trim().to_ascii_lowercase();
    let b = b.unwrap_or("localhost").trim().to_ascii_lowercase();
    a == b || (is_loopback(&a) && is_loopback(&b))
}

fn same_ssh_route(a: &ConnectionParams, b: &ConnectionParams) -> bool {
    let (a_on, b_on) = (a.ssh_enabled == Some(true), b.ssh_enabled == Some(true));
    if !a_on && !b_on {
        return true;
    }
    if a_on != b_on {
        return false;
    }
    match (&a.ssh_connection_id, &b.ssh_connection_id) {
        (Some(x), Some(y)) => x == y,
        (None, None) => {
            a.ssh_host == b.ssh_host && a.ssh_port == b.ssh_port && a.ssh_user == b.ssh_user
        }
        _ => false,
    }
}

/// True when two resolved connections reach the same database. Saved
/// connections are aliases: a different connection id says nothing about
/// whether the data lives in the same place. A tunnel that cannot be proven
/// identical counts as a different route, so only a provable match blocks.
fn reaches_same_database(a: &ConnectionParams, b: &ConnectionParams) -> bool {
    if a.driver != b.driver {
        return false;
    }
    match dialect_for_driver(&a.driver) {
        Some(TransferDialect::Sqlite) => same_file(a.database.primary(), b.database.primary()),
        Some(TransferDialect::Postgres) => {
            a.database.primary() == b.database.primary()
                && same_host(a.host.as_deref(), b.host.as_deref())
                && a.port.unwrap_or(5432) == b.port.unwrap_or(5432)
                && same_ssh_route(a, b)
        }
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

/// True when the transfer would write a table into itself, whichever saved
/// connections the two endpoints came from.
fn is_same_table(
    source: (&ConnectionParams, &str),
    target: (&ConnectionParams, &str),
    selection: &TableSelection,
) -> bool {
    reaches_same_database(source.0, target.0)
        && source.1 == target.1
        && selection.source_table == selection.target_table
}

async fn plan_tables(
    source: &Endpoint,
    target: &Endpoint,
    selections: &[TableSelection],
) -> Result<(Vec<PlannedTable>, Vec<PlanIssue>), String> {
    let mut issues = Vec::new();
    if target.drv.manifest().capabilities.readonly {
        issues.push(PlanIssue::new("targetReadOnly", None));
    }
    let mut seen = std::collections::HashSet::new();
    let mut tables = Vec::with_capacity(selections.len());
    for selection in selections {
        if !seen.insert(selection.target_table.as_str()) {
            issues.push(PlanIssue::new("duplicateTargetTable", Some(&selection.target_table)));
        }
        let source_columns = source
            .drv
            .get_columns(&source.params, &selection.source_table, source.schema_arg())
            .await?;
        let target_columns = target
            .drv
            .get_columns(&target.params, &selection.target_table, target.schema_arg())
            .await?;
        let same_table = is_same_table(
            (&source.params, &source.schema),
            (&target.params, &target.schema),
            selection,
        );
        let estimated_rows = if source_columns.is_empty() {
            None
        } else {
            let pool = get_postgres_pool(&source.params).await?;
            postgres::estimate_rows(&pool, &source.schema, &selection.source_table).await
        };
        let target_strict = if target.dialect == TransferDialect::Sqlite
            && target_columns.iter().any(|c| c.data_type.trim().eq_ignore_ascii_case("ANY"))
        {
            let pool = get_sqlite_pool(&target.params).await?;
            sqlite::is_strict_table(&pool, &selection.target_table).await
        } else {
            false
        };
        tables.push(build_table_plan(&PlanInputs {
            selection,
            source_columns: &source_columns,
            target_columns: &target_columns,
            target_dialect: target.dialect,
            target_strict,
            estimated_rows,
            same_table,
        }));
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
    Ok(Resolved { source, target, tables, issues })
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
    let flags = state.table_transfers.lock().unwrap_or_else(|e| e.into_inner());
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
    let flags = state.table_transfers.lock().unwrap_or_else(|e| e.into_inner());
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
        self.state.lock().unwrap_or_else(|e| e.into_inner()).remove(&self.key);
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
        let mut flags = state.table_transfers.lock().unwrap_or_else(|e| e.into_inner());
        if flags.contains_key(&key) {
            return Err("A table transfer with this id is already running".to_string());
        }
        flags.insert(key.clone(), flag.clone());
    }
    let _registration = Registration { state: state.table_transfers.clone(), key, flag: flag.clone() };
    // The plan is rebuilt here: a client-supplied plan is never trusted.
    let resolved = resolve(runtime, session_id, &request).await?;
    if resolved.blocking() {
        return Err("The transfer plan has blocking issues. Review the plan before starting".to_string());
    }
    let job = Job {
        runtime: runtime.clone(),
        session_id,
        transfer_id,
        cancel: flag,
        source: resolved.source,
        target: resolved.target,
        conflict: request.conflict,
        batch_rows: request.batch_rows.unwrap_or(DEFAULT_BATCH_ROWS).clamp(1, MAX_BATCH_ROWS),
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
    Postgres(deadpool_postgres::Object),
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
            Self::Postgres(client) => {
                postgres::write_batch(client, &target.schema, table, bindings, rows, conflict).await
            }
            Self::Sqlite(pool) => sqlite::write_batch(pool, table, bindings, rows, conflict).await,
        }
    }
}

async fn open_sink(target: &Endpoint) -> Result<Sink, String> {
    Ok(match target.dialect {
        TransferDialect::Postgres => Sink::Postgres(
            get_postgres_pool(&target.params)
                .await?
                .get()
                .await
                .map_err(|_| "Could not get a target connection".to_string())?,
        ),
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
    let bindings = &planned.bindings;
    let pool = get_postgres_pool(&job.source.params).await?;
    let mut source = pool
        .get()
        .await
        .map_err(|_| "Could not get a source connection".to_string())?;
    let mut sink = open_sink(&job.target).await?;
    let describe = |e: tokio_postgres::Error| postgres::describe_error(&e);

    // A read-only repeatable-read transaction gives one consistent snapshot
    // and guarantees the source is never modified.
    let tx = source
        .build_transaction()
        .isolation_level(tokio_postgres::IsolationLevel::RepeatableRead)
        .read_only(true)
        .start()
        .await
        .map_err(describe)?;
    tx.batch_execute(SOURCE_SESSION_SETUP).await.map_err(describe)?;
    let select = postgres::select_sql(&job.source.schema, &planned.plan.source_table, bindings);
    tx.batch_execute(&format!("DECLARE {CURSOR_NAME} NO SCROLL CURSOR FOR {select}"))
        .await
        .map_err(describe)?;
    let fetch = format!("FETCH FORWARD {} FROM {CURSOR_NAME}", job.batch_rows);

    let mut ordinal = 0u64;
    loop {
        if job.cancel.load(Ordering::SeqCst) {
            return Ok(TransferStatus::Cancelled);
        }
        let fetched = tx.query(fetch.as_str(), &[]).await.map_err(describe)?;
        if fetched.is_empty() {
            return Ok(TransferStatus::Completed);
        }
        let mut batch = Vec::with_capacity(fetched.len());
        for row in &fetched {
            ordinal += 1;
            let mut converted = Vec::with_capacity(bindings.len());
            for (position, binding) in bindings.iter().enumerate() {
                let value = postgres::read_cell(row, position, binding.source_kind)?;
                let value = apply_conversion(&binding.conversion, value).map_err(|error| {
                    result.rows_failed = fetched.len() as u64;
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
            .write(&job.target, &planned.plan.target_table, bindings, &batch, job.conflict)
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

#[cfg(test)]
#[path = "table_row_transfers_tests.rs"]
mod tests;
