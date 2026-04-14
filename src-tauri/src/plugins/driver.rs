use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot};

use crate::drivers::driver_trait::{DatabaseDriver, PluginManifest};
use crate::models::{
    ColumnDefinition, ConnectionParams, DataTypeInfo, ExplainPlan, ForeignKey, Index, QueryResult,
    RoutineInfo, RoutineParameter, TableColumn, TableInfo, TableSchema, ViewInfo,
};
use crate::plugins::rpc::{JsonRpcRequest, JsonRpcResponse};

pub struct PluginProcess {
    sender: mpsc::Sender<(JsonRpcRequest, oneshot::Sender<Result<Value, String>>)>,
    next_id: AtomicU64,
    shutdown_tx: tokio::sync::Mutex<Option<oneshot::Sender<()>>>,
    pub pid: Option<u32>,
}

impl PluginProcess {
    async fn new(executable_path: PathBuf, interpreter: Option<String>) -> Result<Self, String> {
        let (tx, rx) = mpsc::channel::<(JsonRpcRequest, oneshot::Sender<Result<Value, String>>)>(100);
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        // Spawn the child process directly in the async context so that any
        // spawn failure is immediately propagated as an error (no silent panic).
        let mut cmd = if let Some(ref interp) = interpreter {
            let mut c = Command::new(interp);
            c.arg(&executable_path);
            c
        } else {
            Command::new(&executable_path)
        };
        let child = cmd
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Failed to start plugin process {:?}: {}", executable_path, e))?;

        let pid = child.id();

        // Hand the running child off to the management task.
        tokio::spawn(async move {
            let mut child = child;
            let mut rx = rx;
            let mut shutdown_rx = shutdown_rx;

            let mut stdin = child.stdin.take().expect("Failed to open stdin");
            let stdout = child.stdout.take().expect("Failed to open stdout");
            let mut reader = BufReader::new(stdout);

            let mut pending_requests: HashMap<u64, oneshot::Sender<Result<Value, String>>> = HashMap::new();
            let mut line_buf = String::new();

            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => {
                        log::info!("Plugin process shutdown requested, terminating child");
                        let _ = child.kill().await;
                        break;
                    }
                    msg = rx.recv() => {
                        match msg {
                            Some((req, resp_tx)) => {
                                let id = req.id;
                                pending_requests.insert(id, resp_tx);

                                let mut req_str = serde_json::to_string(&req).unwrap();
                                req_str.push('\n');

                                if let Err(e) = stdin.write_all(req_str.as_bytes()).await {
                                    log::error!("Failed to write to plugin stdin: {}", e);
                                    if let Some(tx) = pending_requests.remove(&id) {
                                        let _ = tx.send(Err(format!("Plugin communication error: {}", e)));
                                    }
                                }
                            }
                            None => {
                                // Channel closed without explicit shutdown — kill the process anyway.
                                log::warn!("Plugin process channel closed without shutdown signal, terminating child");
                                let _ = child.kill().await;
                                break;
                            }
                        }
                    }
                    line_result = reader.read_line(&mut line_buf) => {
                        match line_result {
                            Ok(0) => {
                                log::error!("Plugin process exited unexpectedly");
                                break;
                            }
                            Ok(_) => {
                                match serde_json::from_str::<JsonRpcResponse>(&line_buf) {
                                    Ok(JsonRpcResponse::Success { result, id, .. }) => {
                                        if let Some(tx) = pending_requests.remove(&id) {
                                            let _ = tx.send(Ok(result));
                                        }
                                    }
                                    Ok(JsonRpcResponse::Error { error, id, .. }) => {
                                        if let Some(tx) = pending_requests.remove(&id) {
                                            let _ = tx.send(Err(error.message));
                                        }
                                    }
                                    Err(e) => {
                                        log::error!("Failed to parse plugin response: {}", e);
                                    }
                                }
                                line_buf.clear();
                            }
                            Err(e) => {
                                log::error!("Failed to read from plugin stdout: {}", e);
                                break;
                            }
                        }
                    }
                }
            }
        });

        Ok(Self {
            sender: tx,
            next_id: AtomicU64::new(1),
            shutdown_tx: tokio::sync::Mutex::new(Some(shutdown_tx)),
            pid,
        })
    }

    async fn shutdown(&self) {
        let mut guard = self.shutdown_tx.lock().await;
        if let Some(tx) = guard.take() {
            let _ = tx.send(());
        }
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            method: method.to_string(),
            params,
            id,
        };

        let (tx, rx) = oneshot::channel();
        self.sender.send((req, tx)).await.map_err(|_| "Plugin process channel closed".to_string())?;

        rx.await.map_err(|_| "Plugin process did not respond".to_string())?
    }
}

pub struct RpcDriver {
    manifest: PluginManifest,
    process: Arc<PluginProcess>,
    data_types: Vec<DataTypeInfo>,
}

impl RpcDriver {
    pub async fn new(manifest: PluginManifest, executable_path: PathBuf, interpreter: Option<String>, data_types: Vec<DataTypeInfo>, settings: HashMap<String, serde_json::Value>) -> Result<Self, String> {
        let process = Arc::new(PluginProcess::new(executable_path, interpreter).await?);
        // Send initialize RPC with settings; silently ignore any error or non-response.
        let _ = process.call("initialize", json!({ "settings": settings })).await;
        Ok(Self {
            manifest,
            process,
            data_types,
        })
    }
}

#[async_trait]
impl DatabaseDriver for RpcDriver {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    async fn shutdown(&self) {
        self.process.shutdown().await;
    }

    fn pid(&self) -> Option<u32> {
        self.process.pid
    }

    fn get_data_types(&self) -> Vec<DataTypeInfo> {
        self.data_types.clone()
    }

    fn build_connection_url(&self, _params: &ConnectionParams) -> Result<String, String> {
        // Plugin drivers manage their own connections — no URL needed.
        Ok(format!("{}://...", self.manifest.id))
    }

    async fn ping(&self, params: &ConnectionParams) -> Result<(), String> {
        match self.process.call("ping", json!({ "params": params })).await {
            Ok(_) => Ok(()),
            Err(e) if e.contains("Method not found") || e.contains("not implemented") => {
                // Fallback for plugins that haven't implemented ping yet
                self.test_connection(params).await
            }
            Err(e) => Err(e),
        }
    }

    async fn test_connection(&self, params: &ConnectionParams) -> Result<(), String> {
        // Delegate to the plugin process via RPC instead of using sqlx
        let res = self.process.call("test_connection", json!({ "params": params })).await?;
        // If the plugin returns a success response (even null/true), connection is ok
        let _ = res;
        Ok(())
    }

    async fn get_databases(&self, params: &ConnectionParams) -> Result<Vec<String>, String> {
        let res = self.process.call("get_databases", json!({ "params": params })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_schemas(&self, params: &ConnectionParams) -> Result<Vec<String>, String> {
        let res = self.process.call("get_schemas", json!({ "params": params })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_tables(&self, params: &ConnectionParams, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let res = self.process.call("get_tables", json!({ "params": params, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_columns(&self, params: &ConnectionParams, table: &str, schema: Option<&str>) -> Result<Vec<TableColumn>, String> {
        let res = self.process.call("get_columns", json!({ "params": params, "table": table, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_foreign_keys(&self, params: &ConnectionParams, table: &str, schema: Option<&str>) -> Result<Vec<ForeignKey>, String> {
        let res = self.process.call("get_foreign_keys", json!({ "params": params, "table": table, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_indexes(&self, params: &ConnectionParams, table: &str, schema: Option<&str>) -> Result<Vec<Index>, String> {
        let res = self.process.call("get_indexes", json!({ "params": params, "table": table, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_views(&self, params: &ConnectionParams, schema: Option<&str>) -> Result<Vec<ViewInfo>, String> {
        let res = self.process.call("get_views", json!({ "params": params, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_view_definition(&self, params: &ConnectionParams, view_name: &str, schema: Option<&str>) -> Result<String, String> {
        let res = self.process.call("get_view_definition", json!({ "params": params, "view_name": view_name, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_view_columns(&self, params: &ConnectionParams, view_name: &str, schema: Option<&str>) -> Result<Vec<TableColumn>, String> {
        let res = self.process.call("get_view_columns", json!({ "params": params, "view_name": view_name, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn create_view(&self, params: &ConnectionParams, view_name: &str, definition: &str, schema: Option<&str>) -> Result<(), String> {
        let res = self.process.call("create_view", json!({ "params": params, "view_name": view_name, "definition": definition, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn alter_view(&self, params: &ConnectionParams, view_name: &str, definition: &str, schema: Option<&str>) -> Result<(), String> {
        let res = self.process.call("alter_view", json!({ "params": params, "view_name": view_name, "definition": definition, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn drop_view(&self, params: &ConnectionParams, view_name: &str, schema: Option<&str>) -> Result<(), String> {
        let res = self.process.call("drop_view", json!({ "params": params, "view_name": view_name, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_routines(&self, params: &ConnectionParams, schema: Option<&str>) -> Result<Vec<RoutineInfo>, String> {
        let res = self.process.call("get_routines", json!({ "params": params, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_routine_parameters(&self, params: &ConnectionParams, routine_name: &str, schema: Option<&str>) -> Result<Vec<RoutineParameter>, String> {
        let res = self.process.call("get_routine_parameters", json!({ "params": params, "routine_name": routine_name, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_routine_definition(&self, params: &ConnectionParams, routine_name: &str, routine_type: &str, schema: Option<&str>) -> Result<String, String> {
        let res = self.process.call("get_routine_definition", json!({ "params": params, "routine_name": routine_name, "routine_type": routine_type, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn execute_query(&self, params: &ConnectionParams, query: &str, limit: Option<u32>, page: u32, schema: Option<&str>) -> Result<QueryResult, String> {
        let res = self.process.call("execute_query", json!({ "params": params, "query": query, "limit": limit, "page": page, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn explain_query(&self, params: &ConnectionParams, query: &str, analyze: bool, schema: Option<&str>) -> Result<ExplainPlan, String> {
        let res = self.process.call("explain_query", json!({ "params": params, "query": query, "analyze": analyze, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn insert_record(&self, params: &ConnectionParams, table: &str, data: HashMap<String, serde_json::Value>, schema: Option<&str>, max_blob_size: u64) -> Result<u64, String> {
        let res = self.process.call("insert_record", json!({ "params": params, "table": table, "data": data, "schema": schema, "max_blob_size": max_blob_size })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn update_record(&self, params: &ConnectionParams, table: &str, pk_col: &str, pk_val: serde_json::Value, col_name: &str, new_val: serde_json::Value, schema: Option<&str>, max_blob_size: u64) -> Result<u64, String> {
        let res = self.process.call("update_record", json!({ "params": params, "table": table, "pk_col": pk_col, "pk_val": pk_val, "col_name": col_name, "new_val": new_val, "schema": schema, "max_blob_size": max_blob_size })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn delete_record(&self, params: &ConnectionParams, table: &str, pk_col: &str, pk_val: serde_json::Value, schema: Option<&str>) -> Result<u64, String> {
        let res = self.process.call("delete_record", json!({ "params": params, "table": table, "pk_col": pk_col, "pk_val": pk_val, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_create_table_sql(&self, table_name: &str, columns: Vec<ColumnDefinition>, schema: Option<&str>) -> Result<Vec<String>, String> {
        let res = self.process.call("get_create_table_sql", json!({ "table_name": table_name, "columns": columns, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_add_column_sql(&self, table: &str, column: ColumnDefinition, schema: Option<&str>) -> Result<Vec<String>, String> {
        let res = self.process.call("get_add_column_sql", json!({ "table": table, "column": column, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_alter_column_sql(&self, table: &str, old_column: ColumnDefinition, new_column: ColumnDefinition, schema: Option<&str>) -> Result<Vec<String>, String> {
        let res = self.process.call("get_alter_column_sql", json!({ "table": table, "old_column": old_column, "new_column": new_column, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_create_index_sql(&self, table: &str, index_name: &str, columns: Vec<String>, is_unique: bool, schema: Option<&str>) -> Result<Vec<String>, String> {
        let res = self.process.call("get_create_index_sql", json!({ "table": table, "index_name": index_name, "columns": columns, "is_unique": is_unique, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_create_foreign_key_sql(&self, table: &str, fk_name: &str, column: &str, ref_table: &str, ref_column: &str, on_delete: Option<&str>, on_update: Option<&str>, schema: Option<&str>) -> Result<Vec<String>, String> {
        let res = self.process.call("get_create_foreign_key_sql", json!({ "table": table, "fk_name": fk_name, "column": column, "ref_table": ref_table, "ref_column": ref_column, "on_delete": on_delete, "on_update": on_update, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn drop_index(&self, params: &ConnectionParams, table: &str, index_name: &str, schema: Option<&str>) -> Result<(), String> {
        self.process.call("drop_index", json!({ "params": params, "table": table, "index_name": index_name, "schema": schema })).await?;
        Ok(())
    }

    async fn drop_foreign_key(&self, params: &ConnectionParams, table: &str, fk_name: &str, schema: Option<&str>) -> Result<(), String> {
        self.process.call("drop_foreign_key", json!({ "params": params, "table": table, "fk_name": fk_name, "schema": schema })).await?;
        Ok(())
    }

    async fn get_schema_snapshot(&self, params: &ConnectionParams, schema: Option<&str>) -> Result<Vec<TableSchema>, String> {
        let res = self.process.call("get_schema_snapshot", json!({ "params": params, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_all_columns_batch(&self, params: &ConnectionParams, schema: Option<&str>) -> Result<HashMap<String, Vec<TableColumn>>, String> {
        let res = self.process.call("get_all_columns_batch", json!({ "params": params, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_all_foreign_keys_batch(&self, params: &ConnectionParams, schema: Option<&str>) -> Result<HashMap<String, Vec<ForeignKey>>, String> {
        let res = self.process.call("get_all_foreign_keys_batch", json!({ "params": params, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }
}
