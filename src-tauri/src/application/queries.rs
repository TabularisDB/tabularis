use crate::drivers::driver_trait::{BatchProgressFn, DatabaseDriver};
use crate::models::{BatchStatementResult, ExplainQueryOutput, QueryResult};
use crate::runtime::{state::ApplicationState, RuntimeContext};
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use tokio::task::AbortHandle;
use uuid::Uuid;

pub const WEB_MAX_ROWS_PER_PAGE: u32 = 10_000;
pub const WEB_MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum QueryResponsePolicy {
    Unbounded,
    WebBounded,
}

#[derive(Debug)]
pub enum QueryCommand {
    Execute {
        connection_id: String,
        query: String,
        limit: Option<u32>,
        page: Option<u32>,
        schema: Option<String>,
    },
    ExecuteBatch {
        connection_id: String,
        queries: Vec<String>,
        limit: Option<u32>,
        page: Option<u32>,
        schema: Option<String>,
        batch_id: Option<String>,
    },
    Count {
        connection_id: String,
        query: String,
        schema: Option<String>,
    },
    Explain {
        connection_id: String,
        query: String,
        analyze: bool,
        schema: Option<String>,
    },
    GetServerNow {
        connection_id: String,
    },
}

#[derive(Clone, Copy)]
pub struct QueryRequestScope<'a> {
    pub session_id: Option<Uuid>,
    pub request_id: Option<&'a str>,
}

struct QueryTaskRegistration {
    handles: Arc<std::sync::Mutex<crate::commands::AbortHandleMap>>,
    slot: String,
    handle: Arc<AbortHandle>,
}

impl QueryTaskRegistration {
    fn new(
        cancellation: &crate::commands::QueryCancellationState,
        slot: String,
        handle: Arc<AbortHandle>,
    ) -> Self {
        crate::commands::register_abort_handle(&cancellation.handles, slot.clone(), handle.clone());
        Self {
            handles: cancellation.handles.clone(),
            slot,
            handle,
        }
    }
}

impl Drop for QueryTaskRegistration {
    fn drop(&mut self) {
        self.handle.abort();
        crate::commands::unregister_abort_handle(&self.handles, &self.slot, &self.handle);
    }
}

impl QueryRequestScope<'_> {
    pub const DESKTOP: Self = Self {
        session_id: None,
        request_id: None,
    };
}

pub async fn execute(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    session_id: Option<Uuid>,
    request_id: &str,
    command: QueryCommand,
) -> Result<Value, String> {
    let scope = QueryRequestScope {
        session_id,
        request_id: Some(request_id),
    };
    let connection_id = command.connection_id().to_string();
    emit_query_status(runtime, scope, &connection_id, "started");

    let result = match command {
        QueryCommand::Execute {
            connection_id,
            query,
            limit,
            page,
            schema,
        } => execute_query(
            runtime,
            &state.query_cancellation,
            scope,
            QueryResponsePolicy::WebBounded,
            connection_id,
            query,
            limit,
            page,
            schema,
        )
        .await
        .and_then(json),
        QueryCommand::ExecuteBatch {
            connection_id,
            queries,
            limit,
            page,
            schema,
            batch_id,
        } => execute_query_batch(
            runtime,
            &state.query_cancellation,
            scope,
            QueryResponsePolicy::WebBounded,
            connection_id,
            queries,
            limit,
            page,
            schema,
            batch_id,
        )
        .await
        .and_then(json),
        QueryCommand::Count {
            connection_id,
            query,
            schema,
        } => count_query(runtime, scope.session_id, connection_id, query, schema)
            .await
            .and_then(json),
        QueryCommand::Explain {
            connection_id,
            query,
            analyze,
            schema,
        } => explain_query_plan(
            runtime,
            &state.query_cancellation,
            scope,
            connection_id,
            query,
            analyze,
            schema,
        )
        .await
        .and_then(json),
        QueryCommand::GetServerNow { connection_id } => {
            get_server_now(runtime, scope.session_id, connection_id)
                .await
                .and_then(json)
        }
    };

    emit_query_status(
        runtime,
        scope,
        &connection_id,
        if result.is_ok() {
            "completed"
        } else {
            "failed"
        },
    );
    result
}

impl QueryCommand {
    fn connection_id(&self) -> &str {
        match self {
            Self::Execute { connection_id, .. }
            | Self::ExecuteBatch { connection_id, .. }
            | Self::Count { connection_id, .. }
            | Self::Explain { connection_id, .. }
            | Self::GetServerNow { connection_id } => connection_id,
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn execute_query(
    runtime: &RuntimeContext,
    cancellation: &crate::commands::QueryCancellationState,
    scope: QueryRequestScope<'_>,
    policy: QueryResponsePolicy,
    connection_id: String,
    query: String,
    limit: Option<u32>,
    page: Option<u32>,
    schema: Option<String>,
) -> Result<QueryResult, String> {
    log::info!(
        "Executing query on connection: {} | Query: {}",
        connection_id,
        query
    );
    let sanitized_query = sanitize_user_query(&query);
    let dropped = crate::sql_database_statements::dropped_database(&sanitized_query);
    let (driver, params) = driver_and_params(runtime, scope.session_id, &connection_id).await?;
    let effective_limit = response_limit(policy, limit);
    let task = tokio::spawn(async move {
        driver
            .execute_query(
                &params,
                &sanitized_query,
                effective_limit,
                page.unwrap_or(1),
                schema.as_deref(),
            )
            .await
    });
    let _registration = QueryTaskRegistration::new(
        cancellation,
        cancellation_slot(scope, &connection_id),
        Arc::new(task.abort_handle()),
    );
    let result = task.await;

    match result {
        Ok(Ok(query_result)) => {
            enforce_response_size(policy, &query_result)?;
            log::info!(
                "Query executed successfully, returned {} rows",
                query_result.rows.len()
            );
            if let Some(database) = dropped {
                emit_database_dropped(runtime, scope.session_id, &connection_id, &database);
            }
            Ok(query_result)
        }
        Ok(Err(error)) => {
            log::error!("Query execution failed: {error}");
            Err(error)
        }
        Err(error) if error.is_cancelled() => {
            emit_query_cancelled(runtime, scope, &connection_id);
            log::warn!("Query was cancelled");
            Err("Query cancelled".to_string())
        }
        Err(error) => Err(format!("Query task failed: {error}")),
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn execute_query_batch(
    runtime: &RuntimeContext,
    cancellation: &crate::commands::QueryCancellationState,
    scope: QueryRequestScope<'_>,
    policy: QueryResponsePolicy,
    connection_id: String,
    queries: Vec<String>,
    limit: Option<u32>,
    page: Option<u32>,
    schema: Option<String>,
    batch_id: Option<String>,
) -> Result<Vec<BatchStatementResult>, String> {
    log::info!(
        "Executing query batch on connection: {} | {} statement(s)",
        connection_id,
        queries.len()
    );
    let sanitized_queries: Vec<String> = queries
        .iter()
        .map(|query| sanitize_user_query(query))
        .collect();
    let dropped_per_statement: Vec<Option<String>> = sanitized_queries
        .iter()
        .map(|query| crate::sql_database_statements::dropped_database(query))
        .collect();
    let (driver, params) = driver_and_params(runtime, scope.session_id, &connection_id).await?;
    let progress: Option<Arc<BatchProgressFn>> = batch_id.map(|batch_id| {
        let events = runtime.events.clone();
        let session_id = scope.session_id;
        Arc::new(move |index, statement: &BatchStatementResult| {
            if enforce_response_size(policy, statement).is_err() {
                return;
            }
            let payload = serde_json::json!({
                "batch_id": batch_id,
                "index": index,
                "statement": statement,
            });
            let _ = emit_event(&*events, session_id, "batch-statement-complete", payload);
        }) as Arc<BatchProgressFn>
    });
    let effective_limit = response_limit(policy, limit);
    let task = tokio::spawn(async move {
        driver
            .execute_batch(
                &params,
                &sanitized_queries,
                effective_limit,
                page.unwrap_or(1),
                schema.as_deref(),
                progress.as_deref(),
            )
            .await
    });
    let _registration = QueryTaskRegistration::new(
        cancellation,
        cancellation_slot(scope, &connection_id),
        Arc::new(task.abort_handle()),
    );
    let result = task.await;

    match result {
        Ok(Ok(batch_results)) => {
            enforce_response_size(policy, &batch_results)?;
            for (dropped, statement) in dropped_per_statement.iter().zip(&batch_results) {
                if let Some(database) = dropped {
                    if statement.result.is_some() {
                        emit_database_dropped(runtime, scope.session_id, &connection_id, database);
                    }
                }
            }
            Ok(batch_results)
        }
        Ok(Err(error)) => Err(error),
        Err(error) if error.is_cancelled() => {
            emit_query_cancelled(runtime, scope, &connection_id);
            Err("Query cancelled".to_string())
        }
        Err(error) => Err(format!("Query task failed: {error}")),
    }
}

pub async fn explain_query_plan(
    runtime: &RuntimeContext,
    cancellation: &crate::commands::QueryCancellationState,
    scope: QueryRequestScope<'_>,
    connection_id: String,
    query: String,
    analyze: bool,
    schema: Option<String>,
) -> Result<ExplainQueryOutput, String> {
    let sanitized_query = sanitize_user_query(&query);
    if !crate::drivers::common::is_explainable_query(&sanitized_query) {
        return Err(
            "EXPLAIN is only supported for DML statements (SELECT, INSERT, UPDATE, DELETE, REPLACE). DDL statements like CREATE, DROP, or ALTER cannot be explained."
                .to_string(),
        );
    }
    let (driver, params) = driver_and_params(runtime, scope.session_id, &connection_id).await?;
    let task = tokio::spawn(async move {
        driver
            .explain_query(&params, &sanitized_query, analyze, schema.as_deref())
            .await
    });
    let _registration = QueryTaskRegistration::new(
        cancellation,
        cancellation_slot(scope, &connection_id),
        Arc::new(task.abort_handle()),
    );
    let result = task.await;

    match result {
        Ok(result) => result,
        Err(error) if error.is_cancelled() => {
            emit_query_cancelled(runtime, scope, &connection_id);
            Err("Explain query cancelled".to_string())
        }
        Err(error) => Err(format!("Explain query task failed: {error}")),
    }
}

pub async fn count_query(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: String,
    query: String,
    schema: Option<String>,
) -> Result<u64, String> {
    let (driver, params) = driver_and_params(runtime, session_id, &connection_id).await?;
    let sanitized = query.trim().trim_end_matches(';');
    let count_query = format!("SELECT COUNT(*) FROM ({sanitized}) as count_wrapper");
    let result = driver
        .execute_query(&params, &count_query, None, 1, schema.as_deref())
        .await?;
    Ok(result
        .rows
        .first()
        .and_then(|row| row.first())
        .and_then(Value::as_i64)
        .map(|count| count as u64)
        .unwrap_or(0))
}

pub async fn get_server_now(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: String,
) -> Result<String, String> {
    let (driver, params) = driver_and_params(runtime, session_id, &connection_id).await?;
    let query = if params.driver == "sqlite" {
        "SELECT datetime('now', 'localtime')"
    } else {
        "SELECT NOW()"
    };
    let result = driver
        .execute_query(&params, query, Some(1), 1, None)
        .await?;
    result
        .rows
        .first()
        .and_then(|row| row.first())
        .map(|value| match value {
            Value::String(value) => value.clone(),
            other => other.to_string(),
        })
        .ok_or_else(|| "No timestamp returned from server".to_string())
}

pub fn cancel_query(
    cancellation: &crate::commands::QueryCancellationState,
    session_id: Option<Uuid>,
    connection_id: &str,
    query_request_id: Option<&str>,
) -> Result<(), String> {
    cancel_registered_queries(cancellation, session_id, connection_id, query_request_id)
}

pub(crate) fn cancel_registered_queries(
    cancellation: &crate::commands::QueryCancellationState,
    session_id: Option<Uuid>,
    connection_id: &str,
    query_request_id: Option<&str>,
) -> Result<(), String> {
    let slots =
        cancellation_slots_for_cancel(cancellation, session_id, connection_id, query_request_id);
    if slots.is_empty() {
        return Err("No running query found".to_string());
    }

    let mut handles = Vec::<Arc<AbortHandle>>::new();
    {
        let mut registered = cancellation
            .handles
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        for slot in slots {
            handles.extend(registered.remove(&slot).unwrap_or_default());
        }
    }
    if handles.is_empty() {
        return Err("No running query found".to_string());
    }
    for handle in handles {
        handle.abort();
    }
    Ok(())
}

fn response_limit(policy: QueryResponsePolicy, requested: Option<u32>) -> Option<u32> {
    match policy {
        QueryResponsePolicy::Unbounded => requested,
        QueryResponsePolicy::WebBounded => Some(
            requested
                .unwrap_or(WEB_MAX_ROWS_PER_PAGE)
                .min(WEB_MAX_ROWS_PER_PAGE),
        ),
    }
}

fn enforce_response_size<T: Serialize>(
    policy: QueryResponsePolicy,
    response: &T,
) -> Result<(), String> {
    if policy == QueryResponsePolicy::Unbounded {
        return Ok(());
    }
    let bytes = serde_json::to_vec(response).map_err(|error| error.to_string())?;
    if bytes.len() > WEB_MAX_RESPONSE_BYTES {
        return Err(format!(
            "Query response exceeds the web limit of {WEB_MAX_RESPONSE_BYTES} bytes; use pagination with at most {WEB_MAX_ROWS_PER_PAGE} rows per page"
        ));
    }
    Ok(())
}

async fn driver_and_params(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
) -> Result<(Arc<dyn DatabaseDriver>, crate::models::ConnectionParams), String> {
    let runtime = runtime.clone();
    let connection_id = connection_id.to_string();
    let (driver_id, params) = tokio::task::spawn_blocking(move || {
        crate::application::connections::resolve_saved_connection_params(
            &runtime,
            session_id,
            &connection_id,
        )
    })
    .await
    .map_err(|error| error.to_string())??;
    let driver = crate::drivers::registry::get_driver(&driver_id)
        .await
        .ok_or_else(|| format!("Driver not found: {driver_id}"))?;
    Ok((driver, params))
}

fn cancellation_slot(scope: QueryRequestScope<'_>, connection_id: &str) -> String {
    match (scope.session_id, scope.request_id) {
        (Some(session_id), Some(request_id)) => format!(
            "web-query:{session_id}:{}:{connection_id}:{request_id}",
            connection_id.len()
        ),
        _ => connection_id.to_string(),
    }
}

fn cancellation_slots_for_cancel(
    state: &crate::commands::QueryCancellationState,
    session_id: Option<Uuid>,
    connection_id: &str,
    query_request_id: Option<&str>,
) -> Vec<String> {
    let Some(session_id) = session_id else {
        return vec![connection_id.to_string()];
    };
    let prefix = format!(
        "web-query:{session_id}:{}:{connection_id}:",
        connection_id.len()
    );
    if let Some(request_id) = query_request_id {
        return vec![format!("{prefix}{request_id}")];
    }
    state
        .handles
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .keys()
        .filter(|slot| slot.starts_with(&prefix))
        .cloned()
        .collect()
}

fn sanitize_user_query(query: &str) -> String {
    query
        .trim()
        .trim_end_matches(';')
        .replace('\u{2018}', "'")
        .replace('\u{2019}', "'")
        .replace(['\u{201C}', '\u{201D}'], "\"")
}

fn emit_database_dropped(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    database: &str,
) {
    let payload = serde_json::json!({
        "connectionId": connection_id,
        "database": database,
    });
    let _ = emit_event(&*runtime.events, session_id, "database-dropped", payload);
}

fn emit_query_status(
    runtime: &RuntimeContext,
    scope: QueryRequestScope<'_>,
    connection_id: &str,
    status: &str,
) {
    let (Some(session_id), Some(request_id)) = (scope.session_id, scope.request_id) else {
        return;
    };
    let _ = runtime.events.emit_to(
        session_id,
        "query-status",
        serde_json::json!({
            "requestId": request_id,
            "connectionId": connection_id,
            "status": status,
        }),
    );
}

fn emit_query_cancelled(
    runtime: &RuntimeContext,
    scope: QueryRequestScope<'_>,
    connection_id: &str,
) {
    let (Some(session_id), Some(request_id)) = (scope.session_id, scope.request_id) else {
        return;
    };
    let _ = runtime.events.emit_to(
        session_id,
        "query-cancelled",
        serde_json::json!({
            "requestId": request_id,
            "connectionId": connection_id,
        }),
    );
}

fn emit_event(
    events: &dyn crate::runtime::events::RuntimeEvents,
    session_id: Option<Uuid>,
    event: &str,
    payload: Value,
) -> Result<(), String> {
    if let Some(session_id) = session_id {
        events.emit_to(session_id, event, payload)
    } else {
        events.emit(event, payload)
    }
}

fn json<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "queries_tests.rs"]
mod tests;
