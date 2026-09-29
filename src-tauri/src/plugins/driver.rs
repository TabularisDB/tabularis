use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, OnceCell};

use crate::drivers::driver_trait::{BatchProgressFn, DatabaseDriver, PluginManifest};
use crate::models::{
    AiSchemaContext, BatchStatementResult, ColumnDefinition, ConnectionParams, DataTypeInfo,
    DatabaseSelection, DbPrivilegeCatalog, DbUserInfo, ExplainQueryOutput, ForeignKey, Index,
    QueryResult, RawExplainOutput, RoutineInfo, RoutineParameter, TableColumn, TableInfo,
    TableSchema, TriggerInfo, ViewInfo,
};
use crate::plugins::connection_metadata::{ConnectionMetadataCache, ConnectionMetadataOverrides};
use crate::plugins::rpc::{JsonRpcRequest, JsonRpcResponse, PluginCallError};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Maximum time to wait for a plugin to answer a single JSON-RPC call before
/// giving up. Generous enough for slow query execution, bounded so a wedged
/// plugin cannot block the (single-threaded) MCP request loop forever.
const PLUGIN_CALL_TIMEOUT: Duration = Duration::from_secs(120);

/// The first operation waits for initialization of its own plugin only.
const PLUGIN_INIT_TIMEOUT: Duration = Duration::from_secs(15);

/// Flag to create the process without a console window on Windows.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Heuristic for the JSON-RPC "method not found" error (code -32601). Only
/// the error *message* survives the response plumbing, so optional-method
/// fallbacks match on the standard wording (and the code, for SDKs that
/// embed it in the message).
fn is_method_not_found(err: &str) -> bool {
    err.to_lowercase().contains("method not found") || err.contains("-32601")
}

/// Message sent to the management task that owns the plugin child process.
enum PluginCommand {
    /// Dispatch a JSON-RPC request and route the response back via the sender.
    Call(
        JsonRpcRequest,
        oneshot::Sender<Result<Value, PluginCallError>>,
    ),
    /// Drop the pending entry for `id` because the caller stopped waiting
    /// (timed out). Prevents an unbounded leak of orphaned response senders.
    Cancel(u64),
}

pub struct PluginProcess {
    sender: mpsc::Sender<PluginCommand>,
    next_id: AtomicU64,
    shutdown_tx: tokio::sync::Mutex<Option<oneshot::Sender<()>>>,
    pub pid: Option<u32>,
    initialization_settings: Option<HashMap<String, Value>>,
    initialized: OnceCell<()>,
}

impl PluginProcess {
    async fn new(executable_path: PathBuf, interpreter: Option<String>) -> Result<Self, String> {
        let (tx, rx) = mpsc::channel::<PluginCommand>(100);
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

        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let child = cmd
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            // Kill the child if its owning task is dropped without a clean
            // shutdown — e.g. when the `--mcp` subprocess exits on stdin EOF
            // and the Tokio runtime is torn down. Without this, the management
            // task is cancelled before its `select!` can call `child.kill()`,
            // leaving orphaned plugin processes running.
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| {
                format!(
                    "Failed to start plugin process {:?}: {}",
                    executable_path, e
                )
            })?;

        let pid = child.id();

        // Hand the running child off to the management task.
        tokio::spawn(async move {
            let mut child = child;
            let mut rx = rx;
            let mut shutdown_rx = shutdown_rx;

            let mut stdin = child.stdin.take().expect("Failed to open stdin");
            let stdout = child.stdout.take().expect("Failed to open stdout");
            let mut reader = BufReader::new(stdout);

            let mut pending_requests: HashMap<
                u64,
                oneshot::Sender<Result<Value, PluginCallError>>,
            > = HashMap::new();
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
                            Some(PluginCommand::Call(req, resp_tx)) => {
                                let id = req.id;
                                pending_requests.insert(id, resp_tx);

                                let mut req_str = serde_json::to_string(&req).unwrap();
                                req_str.push('\n');

                                if let Err(e) = stdin.write_all(req_str.as_bytes()).await {
                                    log::error!("Failed to write to plugin stdin: {}", e);
                                    if let Some(tx) = pending_requests.remove(&id) {
                                        let _ = tx.send(Err(format!("Plugin communication error: {}", e).into()));
                                    }
                                }
                            }
                            Some(PluginCommand::Cancel(id)) => {
                                // Caller timed out; drop the orphaned sender so
                                // pending_requests does not grow without bound.
                                pending_requests.remove(&id);
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
                                            let _ = tx.send(Err(PluginCallError::Remote(error)));
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
            initialization_settings: None,
            initialized: OnceCell::new(),
        })
    }

    async fn shutdown(&self) {
        let mut guard = self.shutdown_tx.lock().await;
        if let Some(tx) = guard.take() {
            let _ = tx.send(());
        }
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        self.call_with_timeout(method, params, PLUGIN_CALL_TIMEOUT)
            .await
    }

    /// Sends a JSON-RPC request to the plugin and waits at most `timeout` for a
    /// response. A hung or unresponsive plugin therefore fails this single call
    /// instead of blocking the caller — and, in the single-threaded MCP request
    /// loop, every subsequent request — forever.
    async fn call_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        self.call_detailed(method, params, timeout)
            .await
            .map_err(|e| e.to_string())
    }

    async fn call_detailed(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, PluginCallError> {
        if let Some(settings) = &self.initialization_settings {
            self.initialized
                .get_or_init(|| async {
                    // Older plugins may not implement initialize. Preserve that
                    // compatibility, but serialize concurrent first calls behind it.
                    if let Err(error) = self
                        .send_request(
                            "initialize",
                            json!({ "settings": settings }),
                            PLUGIN_INIT_TIMEOUT,
                        )
                        .await
                    {
                        log::warn!(
                            "Plugin initialization failed (pid {:?}): {}",
                            self.pid,
                            error
                        );
                    }
                })
                .await;
        }
        self.send_request(method, params, timeout).await
    }

    async fn send_request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, PluginCallError> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            method: method.to_string(),
            params,
            id,
        };

        let (tx, rx) = oneshot::channel();
        self.sender
            .send(PluginCommand::Call(req, tx))
            .await
            .map_err(|_| "Plugin process channel closed".to_string())?;

        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("Plugin process did not respond".to_string().into()),
            Err(_) => {
                // Tell the management task to drop the now-orphaned pending
                // entry so it does not leak one slot per timeout.
                let _ = self.sender.send(PluginCommand::Cancel(id)).await;
                Err(format!(
                    "Plugin call '{}' timed out after {}s",
                    method,
                    timeout.as_secs()
                )
                .into())
            }
        }
    }
}

pub struct RpcDriver {
    manifest: PluginManifest,
    process: Arc<PluginProcess>,
    data_types: Vec<DataTypeInfo>,
    connection_metadata: bool,
    metadata_cache: Arc<ConnectionMetadataCache>,
    connection_params: Option<ConnectionParams>,
}

impl RpcDriver {
    pub async fn new(
        manifest: PluginManifest,
        executable_path: PathBuf,
        interpreter: Option<String>,
        data_types: Vec<DataTypeInfo>,
        settings: HashMap<String, serde_json::Value>,
    ) -> Result<Self, String> {
        let mut process = PluginProcess::new(executable_path, interpreter).await?;
        // Register manifests immediately. Initialize only when this plugin is
        // actually used, so idle plugins cannot delay the GUI or MCP startup.
        process.initialization_settings = Some(settings);
        let process = Arc::new(process);
        Ok(Self {
            manifest,
            process,
            data_types,
            connection_metadata: false,
            metadata_cache: Arc::new(ConnectionMetadataCache::default()),
            connection_params: None,
        })
    }

    /// SQL-building methods historically had no connection parameters. Add
    /// them only for opted-in snapshots; legacy plugin request shapes stay intact.
    async fn call_with_connection(
        &self,
        method: &str,
        mut arguments: Value,
    ) -> Result<Value, String> {
        if let Some(params) = &self.connection_params {
            if let Some(object) = arguments.as_object_mut() {
                object.entry("params").or_insert_with(|| json!(params));
            }
        }
        self.process.call(method, arguments).await
    }

    pub fn with_connection_metadata(mut self, enabled: bool) -> Self {
        self.connection_metadata = enabled;
        self
    }

    /// Coerce `database` to a single, non-empty primary database name before
    /// it's sent to the plugin subprocess.
    ///
    /// Multi-database opt-in connections persist `database` as
    /// `DatabaseSelection::Multiple(...)`, or as an empty `Single("")` for
    /// "all databases" mode — both serialize to a JSON array/empty string.
    /// Plugins only understand a single `database: Option<String>` field for
    /// the pool they use to answer RPCs: an un-coerced array silently
    /// deserializes to `None`, and an empty string is rejected outright by
    /// e.g. deadpool-postgres (`ConfigError::DbnameMissing`/`DbnameEmpty`),
    /// so either shape fails pool creation before ever reaching the server.
    ///
    /// Applied at every `"params"` JSON-RPC payload site in this impl, not
    /// just `ping`/`test_connection` — a per-table/schema command that
    /// *should* resolve a concrete database override before reaching the
    /// driver (see `commands.rs`) can still omit it (a frontend refresh
    /// helper calling the wrong/generic function, a command with no
    /// per-call override at all, a future RPC nobody remembers to wire up).
    /// Coercing here means such a gap degrades to targeting the primary/
    /// first-selected database instead of crashing the whole connection —
    /// it is a safety net, not a substitute for passing the right override.
    /// For an already-resolved `Single(db)` (the normal case for both
    /// single-database connections and per-command multi-db overrides),
    /// `primary()` returns `db` unchanged, so this is a no-op.
    ///
    /// When there's no selection at all (empty "all databases" / an empty
    /// `Multiple`), fall back to the engine's maintenance database — the
    /// same convention the built-in Postgres driver already uses for
    /// `get_databases` (`drivers/postgres/mod.rs`) — but only for engines
    /// known to have one; other engines are left as-is so their own plugin
    /// can apply whatever default makes sense for them.
    fn with_primary_database(&self, params: &ConnectionParams) -> ConnectionParams {
        let mut params = params.clone();
        let primary = params.database.primary();
        let dbname = if primary.is_empty() {
            match self.manifest.engine.as_deref() {
                Some("postgres" | "postgresql") => "postgres",
                _ => primary,
            }
        } else {
            primary
        };
        params.database = DatabaseSelection::Single(dbname.to_string());
        params
    }
}

#[async_trait]
impl DatabaseDriver for RpcDriver {
    fn has_connection_metadata(&self) -> bool {
        self.connection_metadata
    }

    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    async fn for_connection(
        &self,
        params: &ConnectionParams,
    ) -> Result<Option<Arc<dyn DatabaseDriver>>, String> {
        if !self.connection_metadata {
            return Ok(None);
        }
        let cell = self.metadata_cache.entry(params).await?;
        let metadata = cell.get_or_try_init(|| async {
            let overrides = match self.process.call_detailed(
                "get_connection_metadata", json!({ "params": self.with_primary_database(params) }), PLUGIN_CALL_TIMEOUT,
            ).await {
                Ok(value) => serde_json::from_value::<ConnectionMetadataOverrides>(value)
                    .map_err(|e| format!("Invalid connection metadata: {}", e))?,
                Err(PluginCallError::Remote(error)) if error.code == -32601 => {
                    log::warn!("Plugin '{}' declares connection metadata but does not implement the RPC; using its manifest", self.manifest.id);
                    ConnectionMetadataOverrides::default()
                }
                Err(error) => return Err(format!("Connection metadata discovery failed: {}", error)),
            };
            overrides.resolve(&self.manifest, &self.data_types)
        }).await?;
        let mut manifest = self.manifest.clone();
        manifest.capabilities = metadata.capabilities.clone();
        manifest.type_mappings = metadata.type_mappings.clone();
        Ok(Some(Arc::new(Self {
            manifest,
            process: self.process.clone(),
            data_types: metadata.data_types.clone(),
            // The returned snapshot is already resolved for this operation.
            connection_metadata: false,
            metadata_cache: self.metadata_cache.clone(),
            connection_params: Some(params.clone()),
        })))
    }

    async fn invalidate_connection_metadata(&self, connection_id: Option<&str>) {
        self.metadata_cache.invalidate(connection_id).await;
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

    fn map_inferred_type(&self, kind: &str) -> String {
        // Manifest keys are documented as uppercase; the lookup is case-insensitive.
        self.manifest
            .type_mappings
            .get(&kind.to_uppercase())
            .cloned()
            .unwrap_or_else(|| kind.to_string())
    }

    fn build_connection_url(&self, _params: &ConnectionParams) -> Result<String, String> {
        // Plugin drivers manage their own connections — no URL needed.
        Ok(format!("{}://...", self.manifest.id))
    }

    async fn ping(&self, params: &ConnectionParams) -> Result<(), String> {
        let params = self.with_primary_database(params);
        match self
            .process
            .call("ping", json!({ "params": &params }))
            .await
        {
            Ok(_) => Ok(()),
            Err(e) if e.contains("Method not found") || e.contains("not implemented") => {
                // Fallback for plugins that haven't implemented ping yet
                self.test_connection(&params).await
            }
            Err(e) => Err(e),
        }
    }

    async fn test_connection(&self, params: &ConnectionParams) -> Result<(), String> {
        // Delegate to the plugin process via RPC instead of using sqlx
        let params = self.with_primary_database(params);
        let res = self
            .process
            .call("test_connection", json!({ "params": &params }))
            .await?;
        // If the plugin returns a success response (even null/true), connection is ok
        let _ = res;
        Ok(())
    }

    async fn get_databases(&self, params: &ConnectionParams) -> Result<Vec<String>, String> {
        let res = self
            .process
            .call(
                "get_databases",
                json!({ "params": self.with_primary_database(params) }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_schemas(&self, params: &ConnectionParams) -> Result<Vec<String>, String> {
        let res = self
            .process
            .call(
                "get_schemas",
                json!({ "params": self.with_primary_database(params) }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_tables(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<Vec<TableInfo>, String> {
        let res = self
            .process
            .call(
                "get_tables",
                json!({ "params": self.with_primary_database(params), "schema": schema }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_columns(
        &self,
        params: &ConnectionParams,
        table: &str,
        schema: Option<&str>,
    ) -> Result<Vec<TableColumn>, String> {
        let res = self
            .process
            .call(
                "get_columns",
                json!({ "params": self.with_primary_database(params), "table": table, "schema": schema }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_foreign_keys(
        &self,
        params: &ConnectionParams,
        table: &str,
        schema: Option<&str>,
    ) -> Result<Vec<ForeignKey>, String> {
        let res = self
            .process
            .call(
                "get_foreign_keys",
                json!({ "params": self.with_primary_database(params), "table": table, "schema": schema }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_indexes(
        &self,
        params: &ConnectionParams,
        table: &str,
        schema: Option<&str>,
    ) -> Result<Vec<Index>, String> {
        let res = self
            .process
            .call(
                "get_indexes",
                json!({ "params": self.with_primary_database(params), "table": table, "schema": schema }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_views(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<Vec<ViewInfo>, String> {
        let res = self
            .process
            .call(
                "get_views",
                json!({ "params": self.with_primary_database(params), "schema": schema }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_view_definition(
        &self,
        params: &ConnectionParams,
        view_name: &str,
        schema: Option<&str>,
    ) -> Result<String, String> {
        let res = self
            .process
            .call(
                "get_view_definition",
                json!({ "params": self.with_primary_database(params), "view_name": view_name, "schema": schema }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_view_columns(
        &self,
        params: &ConnectionParams,
        view_name: &str,
        schema: Option<&str>,
    ) -> Result<Vec<TableColumn>, String> {
        let res = self
            .process
            .call(
                "get_view_columns",
                json!({ "params": self.with_primary_database(params), "view_name": view_name, "schema": schema }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn create_view(
        &self,
        params: &ConnectionParams,
        view_name: &str,
        definition: &str,
        schema: Option<&str>,
    ) -> Result<(), String> {
        let res = self.process.call("create_view", json!({ "params": self.with_primary_database(params), "view_name": view_name, "definition": definition, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn alter_view(
        &self,
        params: &ConnectionParams,
        view_name: &str,
        definition: &str,
        schema: Option<&str>,
    ) -> Result<(), String> {
        let res = self.process.call("alter_view", json!({ "params": self.with_primary_database(params), "view_name": view_name, "definition": definition, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn drop_view(
        &self,
        params: &ConnectionParams,
        view_name: &str,
        schema: Option<&str>,
    ) -> Result<(), String> {
        let res = self
            .process
            .call(
                "drop_view",
                json!({ "params": self.with_primary_database(params), "view_name": view_name, "schema": schema }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    // --- Materialized views -------------------------------------------------

    async fn get_materialized_views(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<Vec<ViewInfo>, String> {
        let res = self
            .process
            .call(
                "get_materialized_views",
                json!({ "params": self.with_primary_database(params), "schema": schema }),
            )
            .await;
        match res {
            Ok(v) => serde_json::from_value(v).map_err(|e| e.to_string()),
            Err(e) if is_method_not_found(&e) => Ok(Vec::new()),
            Err(e) => Err(e),
        }
    }

    async fn get_materialized_view_columns(
        &self,
        params: &ConnectionParams,
        view_name: &str,
        schema: Option<&str>,
    ) -> Result<Vec<TableColumn>, String> {
        let res = self
            .process
            .call(
                "get_materialized_view_columns",
                json!({ "params": self.with_primary_database(params), "view_name": view_name, "schema": schema }),
            )
            .await;
        match res {
            Ok(v) => serde_json::from_value(v).map_err(|e| e.to_string()),
            Err(e) if is_method_not_found(&e) => Ok(Vec::new()),
            Err(e) => Err(e),
        }
    }

    async fn get_materialized_view_definition(
        &self,
        params: &ConnectionParams,
        view_name: &str,
        schema: Option<&str>,
    ) -> Result<String, String> {
        let res = self
            .process
            .call(
                "get_materialized_view_definition",
                json!({ "params": self.with_primary_database(params), "view_name": view_name, "schema": schema }),
            )
            .await;
        match res {
            Ok(v) => serde_json::from_value(v).map_err(|e| e.to_string()),
            Err(e) if is_method_not_found(&e) => {
                Err("Materialized views are not supported by this driver".to_string())
            }
            Err(e) => Err(e),
        }
    }

    async fn refresh_materialized_view(
        &self,
        params: &ConnectionParams,
        view_name: &str,
        schema: Option<&str>,
    ) -> Result<(), String> {
        let res = self
            .process
            .call(
                "refresh_materialized_view",
                json!({ "params": self.with_primary_database(params), "view_name": view_name, "schema": schema }),
            )
            .await;
        match res {
            Ok(_) => Ok(()),
            Err(e) if is_method_not_found(&e) => {
                Err("Materialized views are not supported by this driver".to_string())
            }
            Err(e) => Err(e),
        }
    }

    async fn get_routines(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<Vec<RoutineInfo>, String> {
        let res = self
            .process
            .call(
                "get_routines",
                json!({ "params": self.with_primary_database(params), "schema": schema }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_routine_parameters(
        &self,
        params: &ConnectionParams,
        routine_name: &str,
        schema: Option<&str>,
    ) -> Result<Vec<RoutineParameter>, String> {
        let res = self
            .process
            .call(
                "get_routine_parameters",
                json!({ "params": self.with_primary_database(params), "routine_name": routine_name, "schema": schema }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_routine_definition(
        &self,
        params: &ConnectionParams,
        routine_name: &str,
        routine_type: &str,
        schema: Option<&str>,
    ) -> Result<String, String> {
        let res = self.process.call("get_routine_definition", json!({ "params": self.with_primary_database(params), "routine_name": routine_name, "routine_type": routine_type, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    // --- Routine management ---------------------------------------------
    //
    // These RPC methods are OPTIONAL for plugins that declare the
    // `routine_management` capability: when the plugin does not implement
    // one, the host falls back to the same dialect-neutral SQL the trait
    // defaults produce, so a plugin only overrides what its dialect needs.

    async fn build_routine_call_sql(
        &self,
        params: &ConnectionParams,
        routine_name: &str,
        routine_type: &str,
        args: &[crate::models::RoutineCallArg],
        schema: Option<&str>,
    ) -> Result<String, String> {
        let res = self
            .process
            .call(
                "build_routine_call_sql",
                json!({ "params": self.with_primary_database(params), "routine_name": routine_name, "routine_type": routine_type, "args": args, "schema": schema }),
            )
            .await;
        match res {
            Ok(v) => serde_json::from_value(v).map_err(|e| e.to_string()),
            Err(e) if is_method_not_found(&e) => {
                Ok(crate::drivers::common::generic_routine_call_sql(
                    routine_name,
                    routine_type,
                    args,
                    schema,
                    &self.manifest.capabilities.identifier_quote,
                ))
            }
            Err(e) => Err(e),
        }
    }

    async fn routine_create_template(
        &self,
        routine_type: &str,
        schema: Option<&str>,
    ) -> Result<String, String> {
        let res = self
            .call_with_connection(
                "routine_create_template",
                json!({ "routine_type": routine_type, "schema": schema }),
            )
            .await;
        match res {
            Ok(v) => serde_json::from_value(v).map_err(|e| e.to_string()),
            Err(e) if is_method_not_found(&e) => {
                let keyword = if routine_type.eq_ignore_ascii_case("FUNCTION") {
                    "FUNCTION"
                } else {
                    "PROCEDURE"
                };
                Ok(format!(
                    "CREATE {keyword} my_routine()\nBEGIN\n    -- routine body\nEND"
                ))
            }
            Err(e) => Err(e),
        }
    }

    async fn get_routine_edit_script(
        &self,
        params: &ConnectionParams,
        routine_name: &str,
        routine_type: &str,
        schema: Option<&str>,
    ) -> Result<String, String> {
        let res = self
            .process
            .call(
                "get_routine_edit_script",
                json!({ "params": self.with_primary_database(params), "routine_name": routine_name, "routine_type": routine_type, "schema": schema }),
            )
            .await;
        match res {
            Ok(v) => serde_json::from_value(v).map_err(|e| e.to_string()),
            Err(e) if is_method_not_found(&e) => {
                self.get_routine_definition(params, routine_name, routine_type, schema)
                    .await
            }
            Err(e) => Err(e),
        }
    }

    async fn drop_routine(
        &self,
        params: &ConnectionParams,
        routine_name: &str,
        routine_type: &str,
        schema: Option<&str>,
    ) -> Result<(), String> {
        let res = self
            .process
            .call(
                "drop_routine",
                json!({ "params": self.with_primary_database(params), "routine_name": routine_name, "routine_type": routine_type, "schema": schema }),
            )
            .await;
        match res {
            Ok(v) => serde_json::from_value(v).map_err(|e| e.to_string()),
            Err(e) if is_method_not_found(&e) => {
                let sql = crate::drivers::common::generic_drop_routine_sql(
                    routine_name,
                    routine_type,
                    schema,
                    &self.manifest.capabilities.identifier_quote,
                );
                self.execute_query(params, &sql, None, 1, schema)
                    .await
                    .map(|_| ())
            }
            Err(e) => Err(e),
        }
    }

    async fn execute_query(
        &self,
        params: &ConnectionParams,
        query: &str,
        limit: Option<u32>,
        page: u32,
        schema: Option<&str>,
    ) -> Result<QueryResult, String> {
        let res = self.process.call("execute_query", json!({ "params": self.with_primary_database(params), "query": query, "limit": limit, "page": page, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn execute_batch(
        &self,
        params: &ConnectionParams,
        queries: &[String],
        limit: Option<u32>,
        page: u32,
        schema: Option<&str>,
        on_progress: Option<&BatchProgressFn>,
    ) -> Result<Vec<BatchStatementResult>, String> {
        let res = self
            .process
            .call(
                "execute_query_batch",
                json!({
                    "params": self.with_primary_database(params),
                    "queries": queries,
                    "limit": limit,
                    "page": page,
                    "schema": schema
                }),
            )
            .await;

        match res {
            Ok(value) => {
                let results: Vec<BatchStatementResult> =
                    serde_json::from_value(value).map_err(|e| e.to_string())?;
                if let Some(cb) = on_progress {
                    for (idx, result) in results.iter().enumerate() {
                        cb(idx, result);
                    }
                }
                Ok(results)
            }
            Err(e) if is_method_not_found(&e) => {
                let mut results = Vec::with_capacity(queries.len());
                for (idx, q) in queries.iter().enumerate() {
                    let start = std::time::Instant::now();
                    let outcome = self.execute_query(params, q, limit, page, schema).await;
                    let result = BatchStatementResult::from_outcome(start, outcome);
                    if let Some(cb) = on_progress {
                        cb(idx, &result);
                    }
                    results.push(result);
                }
                Ok(results)
            }
            Err(e) => Err(e),
        }
    }

    async fn explain_query(
        &self,
        params: &ConnectionParams,
        query: &str,
        analyze: bool,
        schema: Option<&str>,
    ) -> Result<ExplainQueryOutput, String> {
        let res = self
            .process
            .call(
                "explain_query",
                json!({ "params": self.with_primary_database(params), "query": query, "analyze": analyze, "schema": schema }),
            )
            .await?;
        // Permanently support both historical parsed plans and raw payloads
        // for runtime-registered parsers. Only the complete raw wire shape is
        // recognized; every other plugin result passes through unchanged.
        if let Some((engine, format, payload, original_query)) =
            res.as_object().and_then(|object| {
                Some((
                    object.get("engine")?.as_str()?,
                    object.get("format")?.as_str()?,
                    object.get("payload")?.as_str()?,
                    object.get("original_query"),
                ))
            })
        {
            let original_query = match original_query {
                None | Some(Value::Null) => query.to_string(),
                Some(Value::String(original_query)) => original_query.clone(),
                Some(_) => {
                    return Err(
                        "Plugin raw EXPLAIN field 'original_query' must be a string or null"
                            .to_string(),
                    );
                }
            };

            return Ok(ExplainQueryOutput::Raw {
                raw: RawExplainOutput {
                    engine: engine.to_string(),
                    format: format.to_string(),
                    payload: payload.to_string(),
                    original_query,
                },
            });
        }

        Ok(ExplainQueryOutput::Plan { plan: res })
    }

    async fn insert_record(
        &self,
        params: &ConnectionParams,
        table: &str,
        data: HashMap<String, serde_json::Value>,
        schema: Option<&str>,
        max_blob_size: u64,
    ) -> Result<u64, String> {
        let res = self.process.call("insert_record", json!({ "params": self.with_primary_database(params), "table": table, "data": data, "schema": schema, "max_blob_size": max_blob_size })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn update_record(
        &self,
        params: &ConnectionParams,
        table: &str,
        pk_map: &std::collections::HashMap<String, serde_json::Value>,
        col_name: &str,
        new_val: serde_json::Value,
        schema: Option<&str>,
        max_blob_size: u64,
    ) -> Result<u64, String> {
        let res = self.process.call("update_record", json!({ "params": self.with_primary_database(params), "table": table, "pk_map": pk_map, "col_name": col_name, "new_val": new_val, "schema": schema, "max_blob_size": max_blob_size })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn delete_record(
        &self,
        params: &ConnectionParams,
        table: &str,
        pk_map: &std::collections::HashMap<String, serde_json::Value>,
        schema: Option<&str>,
    ) -> Result<u64, String> {
        let res = self
            .process
            .call(
                "delete_record",
                json!({ "params": self.with_primary_database(params), "table": table, "pk_map": pk_map, "schema": schema }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    // --- BLOB helpers ---------------------------------------------------------

    async fn save_blob_to_file(
        &self,
        params: &ConnectionParams,
        table: &str,
        col_name: &str,
        pk_map: &std::collections::HashMap<String, serde_json::Value>,
        schema: Option<&str>,
        file_path: &str,
    ) -> Result<(), String> {
        let res = self
            .process
            .call(
                "save_blob_to_file",
                json!({
                    "params": self.with_primary_database(params),
                    "table": table,
                    "col_name": col_name,
                    "pk_map": pk_map,
                    "schema": schema,
                    "file_path": file_path
                }),
            )
            .await;
        match res {
            Ok(_) => Ok(()),
            Err(e) if is_method_not_found(&e) => {
                Err("BLOB file export not supported by this driver".into())
            }
            Err(e) => Err(e),
        }
    }

    async fn fetch_blob_as_data_url(
        &self,
        params: &ConnectionParams,
        table: &str,
        col_name: &str,
        pk_map: &std::collections::HashMap<String, serde_json::Value>,
        schema: Option<&str>,
    ) -> Result<String, String> {
        let res = self
            .process
            .call(
                "fetch_blob_as_data_url",
                json!({
                    "params": self.with_primary_database(params),
                    "table": table,
                    "col_name": col_name,
                    "pk_map": pk_map,
                    "schema": schema
                }),
            )
            .await;
        match res {
            Ok(v) => serde_json::from_value(v).map_err(|e| e.to_string()),
            Err(e) if is_method_not_found(&e) => {
                Err("BLOB preview not supported by this driver".into())
            }
            Err(e) => Err(e),
        }
    }

    async fn get_table_query_template(
        &self,
        params: &ConnectionParams,
        request: &crate::models::TableQueryTemplateRequest,
    ) -> Result<Option<String>, String> {
        if !self.manifest.capabilities.table_query_templates {
            return Ok(None);
        }
        match self
            .process
            .call_detailed(
                "get_table_query_template",
                json!({ "params": params, "request": request }),
                PLUGIN_CALL_TIMEOUT,
            )
            .await
        {
            Ok(value) => serde_json::from_value::<String>(value)
                .map(Some)
                .map_err(|error| format!("Invalid table query template: {error}")),
            Err(PluginCallError::Remote(error)) if error.code == -32601 => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    async fn get_create_table_sql(
        &self,
        table_name: &str,
        columns: Vec<ColumnDefinition>,
        schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let res = self
            .call_with_connection(
                "get_create_table_sql",
                json!({ "table_name": table_name, "columns": columns, "schema": schema }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_add_column_sql(
        &self,
        table: &str,
        column: ColumnDefinition,
        schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let res = self
            .call_with_connection(
                "get_add_column_sql",
                json!({ "table": table, "column": column, "schema": schema }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_alter_column_sql(
        &self,
        table: &str,
        old_column: ColumnDefinition,
        new_column: ColumnDefinition,
        schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let res = self.call_with_connection("get_alter_column_sql", json!({ "table": table, "old_column": old_column, "new_column": new_column, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_create_index_sql(
        &self,
        table: &str,
        index_name: &str,
        columns: Vec<String>,
        is_unique: bool,
        schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let res = self.call_with_connection("get_create_index_sql", json!({ "table": table, "index_name": index_name, "columns": columns, "is_unique": is_unique, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_create_foreign_key_sql(
        &self,
        params: &ConnectionParams,
        table: &str,
        fk_name: &str,
        column: &str,
        ref_table: &str,
        ref_column: &str,
        on_delete: Option<&str>,
        on_update: Option<&str>,
        schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let params = self.connection_params.as_ref().unwrap_or(params);
        let res = self.process.call("get_create_foreign_key_sql", json!({ "params": self.with_primary_database(params), "table": table, "fk_name": fk_name, "column": column, "ref_table": ref_table, "ref_column": ref_column, "on_delete": on_delete, "on_update": on_update, "schema": schema })).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    /// Not yet part of the plugin RPC protocol — a plugin that hasn't added a
    /// `get_table_ddl` handler surfaces this as a clear "method not
    /// implemented" error from `self.process.call`, rather than the
    /// "Unsupported driver" blanket rejection `dump_database` used to give
    /// every plugin-based driver regardless of whether it could actually
    /// help. See tabularis-postgresql-plugin for the tracked follow-up.
    async fn get_table_ddl(
        &self,
        params: &ConnectionParams,
        table: &str,
        schema: Option<&str>,
    ) -> Result<String, String> {
        let params = self.connection_params.as_ref().unwrap_or(params);
        let res = self
            .process
            .call(
                "get_table_ddl",
                json!({ "params": self.with_primary_database(params), "table": table, "schema": schema }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn drop_index(
        &self,
        params: &ConnectionParams,
        table: &str,
        index_name: &str,
        schema: Option<&str>,
    ) -> Result<(), String> {
        self.process.call("drop_index", json!({ "params": self.with_primary_database(params), "table": table, "index_name": index_name, "schema": schema })).await?;
        Ok(())
    }

    async fn drop_foreign_key(
        &self,
        params: &ConnectionParams,
        table: &str,
        fk_name: &str,
        schema: Option<&str>,
    ) -> Result<(), String> {
        self.process
            .call(
                "drop_foreign_key",
                json!({ "params": self.with_primary_database(params), "table": table, "fk_name": fk_name, "schema": schema }),
            )
            .await?;
        Ok(())
    }

    async fn get_triggers(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<Vec<TriggerInfo>, String> {
        let res = self
            .process
            .call(
                "get_triggers",
                json!({ "params": self.with_primary_database(params), "schema": schema }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    // --- User management (plugins opt in via `capabilities.userManagement`) --

    async fn get_db_privilege_catalog(&self) -> Result<DbPrivilegeCatalog, String> {
        let res = self
            .call_with_connection("get_db_privilege_catalog", json!({}))
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_db_users(&self, params: &ConnectionParams) -> Result<Vec<DbUserInfo>, String> {
        let res = self
            .process
            .call(
                "get_db_users",
                json!({ "params": self.with_primary_database(params) }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_db_user_grants(
        &self,
        params: &ConnectionParams,
        user: &str,
        host: &str,
    ) -> Result<Vec<String>, String> {
        let res = self
            .process
            .call(
                "get_db_user_grants",
                json!({ "params": self.with_primary_database(params), "user": user, "host": host }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn create_db_user(
        &self,
        params: &ConnectionParams,
        user: &str,
        host: &str,
        password: &str,
    ) -> Result<(), String> {
        self.process
            .call(
                "create_db_user",
                json!({ "params": self.with_primary_database(params), "user": user, "host": host, "password": password }),
            )
            .await?;
        Ok(())
    }

    async fn drop_db_user(
        &self,
        params: &ConnectionParams,
        user: &str,
        host: &str,
    ) -> Result<(), String> {
        self.process
            .call(
                "drop_db_user",
                json!({ "params": self.with_primary_database(params), "user": user, "host": host }),
            )
            .await?;
        Ok(())
    }

    async fn set_db_user_password(
        &self,
        params: &ConnectionParams,
        user: &str,
        host: &str,
        password: &str,
    ) -> Result<(), String> {
        self.process
            .call(
                "set_db_user_password",
                json!({ "params": self.with_primary_database(params), "user": user, "host": host, "password": password }),
            )
            .await?;
        Ok(())
    }

    async fn get_db_user_privileges(
        &self,
        params: &ConnectionParams,
        user: &str,
        host: &str,
    ) -> Result<Vec<crate::models::DbUserGrantSet>, String> {
        let res = self
            .process
            .call(
                "get_db_user_privileges",
                json!({ "params": self.with_primary_database(params), "user": user, "host": host }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn apply_db_user_privileges(
        &self,
        params: &ConnectionParams,
        user: &str,
        host: &str,
        database: Option<&str>,
        table: Option<&str>,
        privileges: &[String],
        grant: bool,
    ) -> Result<(), String> {
        self.process
            .call(
                "apply_db_user_privileges",
                json!({
                    "params": self.with_primary_database(params),
                    "user": user,
                    "host": host,
                    "database": database,
                    "table": table,
                    "privileges": privileges,
                    "grant": grant
                }),
            )
            .await?;
        Ok(())
    }

    async fn get_trigger_definition(
        &self,
        params: &ConnectionParams,
        trigger_name: &str,
        table_name: &str,
        schema: Option<&str>,
    ) -> Result<String, String> {
        let res = self
            .process
            .call(
                "get_trigger_definition",
                json!({
                    "params": self.with_primary_database(params),
                    "trigger_name": trigger_name,
                    "table_name": table_name,
                    "schema": schema
                }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn create_trigger(
        &self,
        params: &ConnectionParams,
        trigger_sql: &str,
        schema: Option<&str>,
    ) -> Result<(), String> {
        self.process
            .call(
                "create_trigger",
                json!({ "params": self.with_primary_database(params), "trigger_sql": trigger_sql, "schema": schema }),
            )
            .await?;
        Ok(())
    }

    async fn drop_trigger(
        &self,
        params: &ConnectionParams,
        trigger_name: &str,
        table_name: &str,
        schema: Option<&str>,
    ) -> Result<(), String> {
        self.process
            .call(
                "drop_trigger",
                json!({
                    "params": self.with_primary_database(params),
                    "trigger_name": trigger_name,
                    "table_name": table_name,
                    "schema": schema
                }),
            )
            .await?;
        Ok(())
    }

    async fn get_schema_snapshot(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<Vec<TableSchema>, String> {
        let res = self
            .process
            .call(
                "get_schema_snapshot",
                json!({ "params": self.with_primary_database(params), "schema": schema }),
            )
            .await;
        match res {
            Ok(v) => serde_json::from_value(v).map_err(|e| e.to_string()),
            Err(e) if is_method_not_found(&e) => {
                // The plugin doesn't implement this batch RPC (the
                // PostgreSQL plugin doesn't as of this writing — followed
                // up separately). Unlike get_materialized_views' empty-Vec
                // fallback above, an empty schema here would be actively
                // misleading (it reads as "this schema has no tables", not
                // "this driver has no fast batch endpoint"), so compose the
                // same shape from get_tables/get_columns/get_foreign_keys
                // instead, which the plugin does implement.
                let tables = self.get_tables(params, schema).await?;
                let mut snapshot = Vec::with_capacity(tables.len());
                for table in tables {
                    let columns = self.get_columns(params, &table.name, schema).await?;
                    let foreign_keys = self.get_foreign_keys(params, &table.name, schema).await?;
                    snapshot.push(TableSchema {
                        name: table.name,
                        columns,
                        foreign_keys,
                    });
                }
                Ok(snapshot)
            }
            Err(e) => Err(e),
        }
    }

    async fn get_ai_schema_context(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
        max_tables: usize,
    ) -> Result<AiSchemaContext, String> {
        match self
            .process
            .call(
                "get_ai_schema_context",
                json!({
                    "params": self.with_primary_database(params),
                    "schema": schema,
                    "max_tables": max_tables,
                }),
            )
            .await
        {
            Ok(value) => serde_json::from_value(value).map_err(|e| e.to_string()),
            Err(error) if is_method_not_found(&error) => {
                crate::ai_schema_context::load_from_driver(self, params, schema, max_tables).await
            }
            Err(error) => Err(error),
        }
    }

    async fn get_all_columns_batch(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<HashMap<String, Vec<TableColumn>>, String> {
        let res = self
            .process
            .call(
                "get_all_columns_batch",
                json!({ "params": self.with_primary_database(params), "schema": schema }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    async fn get_all_foreign_keys_batch(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<HashMap<String, Vec<ForeignKey>>, String> {
        let res = self
            .process
            .call(
                "get_all_foreign_keys_batch",
                json!({ "params": self.with_primary_database(params), "schema": schema }),
            )
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }
}

/// Builds a fake, in-memory `RpcDriver` backed by `handle_request` instead of
/// a real subprocess. `pub(crate)` (rather than private to this module's own
/// `tests`) so other modules' tests — e.g. `mcp::tests` — can register a
/// driver whose behavior they control without spawning a real plugin
/// process.
#[cfg(test)]
pub(crate) fn test_manifest() -> PluginManifest {
    PluginManifest {
        id: "test-plugin".to_string(),
        name: "Test Plugin".to_string(),
        version: "1.0.0".to_string(),
        description: "Test plugin".to_string(),
        default_port: None,
        capabilities: crate::drivers::driver_trait::DriverCapabilities {
            triggers: true,
            ..Default::default()
        },
        is_builtin: false,
        engine: None,
        paradigms: Vec::new(),
        default_username: String::new(),
        color: String::new(),
        icon: String::new(),
        settings: Vec::new(),
        ui_extensions: None,
        explain_parsers: None,
        type_mappings: HashMap::new(),
        deprecated: None,
    }
}

/// Builds a fake, in-memory `RpcDriver` backed by `handle_request` instead of
/// a real subprocess, with `connection_metadata` disabled. `pub(crate)` so
/// other modules' tests (e.g. `mcp::tests`) can build one too; enable
/// connection metadata with `.with_connection_metadata(true)`.
#[cfg(test)]
pub(crate) fn test_driver<F>(mut handle_request: F) -> RpcDriver
where
    F: FnMut(JsonRpcRequest) -> Value + Send + 'static,
{
    test_driver_result(move |request| Ok(handle_request(request)))
}

#[cfg(test)]
pub(crate) fn test_driver_result<F>(mut handle_request: F) -> RpcDriver
where
    F: FnMut(JsonRpcRequest) -> Result<Value, String> + Send + 'static,
{
    let (tx, mut rx) = mpsc::channel::<PluginCommand>(8);
    tokio::spawn(async move {
        while let Some(command) = rx.recv().await {
            if let PluginCommand::Call(request, response_tx) = command {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    handle_request(request)
                }))
                .map_err(|_| "request assertion failed".to_string())
                .and_then(|outcome| outcome);
                let _ = response_tx.send(result.map_err(PluginCallError::Transport));
            }
        }
    });

    let (shutdown_tx, _shutdown_rx) = oneshot::channel();
    RpcDriver {
        manifest: test_manifest(),
        process: Arc::new(PluginProcess {
            sender: tx,
            next_id: AtomicU64::new(1),
            shutdown_tx: tokio::sync::Mutex::new(Some(shutdown_tx)),
            pid: None,
            initialization_settings: None,
            initialized: OnceCell::new(),
        }),
        data_types: Vec::new(),
        connection_metadata: false,
        metadata_cache: Arc::new(ConnectionMetadataCache::default()),
        connection_params: None,
    }
}

/// Overrides the manifest id of a driver built by [`test_driver`] /
/// [`test_driver_result`] (both default to `"test-plugin"`), so a test that
/// registers into the shared, process-global [`crate::drivers::registry`]
/// can use an id no other test claims.
#[cfg(test)]
pub(crate) fn with_test_driver_id(mut driver: RpcDriver, id: &str) -> RpcDriver {
    driver.manifest.id = id.to_string();
    driver
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::DatabaseSelection;

    fn test_connection_params() -> ConnectionParams {
        ConnectionParams {
            driver: "test-plugin".to_string(),
            host: Some("localhost".to_string()),
            port: Some(1234),
            username: Some("user".to_string()),
            password: Some("secret".to_string()),
            connection_uri: None,
            connection_uri_in_keychain: None,
            database: DatabaseSelection::Single("db".to_string()),
            ssl_mode: None,
            ssl_ca: None,
            ssl_cert: None,
            ssl_key: None,
            enable_cleartext_plugin: None,
            pipes_as_concat: None,
            ssh_enabled: None,
            ssh_connection_id: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_password: None,
            ssh_key_file: None,
            ssh_key_passphrase: None,
            ssh_allow_passphrase_prompt: None,
            save_in_keychain: None,
            k8s_enabled: None,
            k8s_connection_id: None,
            k8s_context: None,
            k8s_namespace: None,
            k8s_resource_type: None,
            k8s_resource_name: None,
            k8s_port: None,
            k8s_kubectl_path: None,
            k8s_kubeconfig_path: None,
            ssm_enabled: None,
            ssm_target: None,
            ssm_profile: None,
            ssm_region: None,
            startup_script: None,
            use_iam_auth: None,
            extra: HashMap::new(),
            connection_id: Some("conn-1".to_string()),
            proxy: None,
        }
    }

    #[tokio::test]
    async fn rpc_driver_returns_structurally_detected_raw_explain_output() {
        let request_query = "SELECT * FROM users";

        for (plugin_original_query, expected_original_query) in [
            (None, request_query),
            (Some(Value::Null), request_query),
            (Some(json!("SELECT id FROM users")), "SELECT id FROM users"),
        ] {
            let driver = test_driver(move |request| {
                assert_eq!(request.method, "explain_query");
                assert_eq!(request.params["query"], request_query);
                assert_eq!(request.params["analyze"], true);
                assert_eq!(request.params["schema"], "public");

                let mut result = json!({
                    "engine": "third-party-db",
                    "format": "third-party-plan-text",
                    "payload": "raw plan payload",
                    "ignored": "additional fields are allowed"
                });
                if let Some(original_query) = plugin_original_query.clone() {
                    result["original_query"] = original_query;
                }
                result
            });

            let output = driver
                .explain_query(
                    &test_connection_params(),
                    request_query,
                    true,
                    Some("public"),
                )
                .await
                .expect("raw explain output");

            let ExplainQueryOutput::Raw { raw } = output else {
                panic!("complete raw output must use the raw variant");
            };
            assert_eq!(raw.engine, "third-party-db");
            assert_eq!(raw.format, "third-party-plan-text");
            assert_eq!(raw.payload, "raw plan payload");
            assert_eq!(raw.original_query, expected_original_query);
        }
    }

    #[tokio::test]
    async fn rpc_driver_rejects_invalid_raw_explain_original_query() {
        let driver = test_driver(|_| {
            json!({
                "engine": "third-party-db",
                "format": "third-party-plan-text",
                "payload": "raw plan payload",
                "original_query": 42
            })
        });

        let error = driver
            .explain_query(
                &test_connection_params(),
                "SELECT * FROM users",
                false,
                None,
            )
            .await
            .expect_err("invalid original_query must fail");

        assert_eq!(
            error,
            "Plugin raw EXPLAIN field 'original_query' must be a string or null"
        );
    }

    #[tokio::test]
    async fn rpc_driver_preserves_realistic_parsed_explain_plan() {
        let parsed_plan = json!({
            "engine": "third-party-db",
            "root": {
                "id": "node-0",
                "node_type": "Index Scan",
                "relation": "users",
                "startup_cost": 0.15,
                "total_cost": 8.17,
                "plan_rows": 1,
                "actual_rows": null,
                "actual_time_ms": null,
                "actual_loops": null,
                "buffers_hit": null,
                "buffers_read": null,
                "filter": "email = 'alice@example.com'",
                "index_condition": null,
                "join_type": null,
                "hash_condition": null,
                "extra": {},
                "children": []
            },
            "planning_time_ms": 0.12,
            "execution_time_ms": null,
            "original_query": "SELECT * FROM users WHERE email = 'alice@example.com'",
            "driver": "third-party-db",
            "has_analyze_data": false,
            "raw_output": null
        });
        let expected_plan = parsed_plan.clone();
        let driver = test_driver(move |_| parsed_plan.clone());

        let output = driver
            .explain_query(
                &test_connection_params(),
                "SELECT * FROM users WHERE email = 'alice@example.com'",
                false,
                None,
            )
            .await
            .expect("parsed explain plan");

        let ExplainQueryOutput::Plan { plan } = output else {
            panic!("historical parsed plans must keep using the plan variant");
        };
        assert_eq!(plan, expected_plan);
    }

    #[tokio::test]
    async fn rpc_driver_falls_back_to_plan_for_malformed_raw_explain_objects() {
        let malformed_results = [
            json!({
                "engine": "third-party-db",
                "format": "third-party-plan-text"
            }),
            json!({
                "engine": "third-party-db",
                "format": 42,
                "payload": "raw plan payload"
            }),
            json!({
                "format": "third-party-plan-text",
                "payload": "raw plan payload"
            }),
        ];

        for malformed in malformed_results {
            let expected_plan = malformed.clone();
            let driver = test_driver(move |_| malformed.clone());

            let output = driver
                .explain_query(
                    &test_connection_params(),
                    "SELECT * FROM users",
                    false,
                    None,
                )
                .await
                .expect("malformed raw object must remain a plan");

            let ExplainQueryOutput::Plan { plan } = output else {
                panic!("incomplete raw output must use the plan variant");
            };
            assert_eq!(plan, expected_plan);
        }
    }

    #[tokio::test]
    async fn rpc_driver_uses_custom_ai_schema_context_when_available() {
        let driver = test_driver(|request| {
            assert_eq!(request.method, "get_ai_schema_context");
            assert_eq!(request.params["schema"], "public");
            assert_eq!(request.params["max_tables"], 20);
            json!({
                "tables": [{
                    "name": "users",
                    "columns": [],
                    "foreign_keys": []
                }],
                "total_table_count": 1
            })
        });

        let context = driver
            .get_ai_schema_context(&test_connection_params(), Some("public"), 20)
            .await
            .expect("get_ai_schema_context");

        assert_eq!(context.tables.len(), 1);
        assert_eq!(context.tables[0].name, "users");
        assert_eq!(context.total_table_count, 1);
    }

    #[tokio::test]
    async fn rpc_driver_forwards_params_to_get_create_foreign_key_sql() {
        let uri = "libsql://db.example.invalid?authToken=tok";
        let expected = uri.to_string();
        let driver = test_driver(move |request| {
            assert_eq!(request.method, "get_create_foreign_key_sql");
            assert_eq!(request.params["params"]["connection_uri"], expected);
            assert_eq!(request.params["table"], "orders");
            json!(["ALTER TABLE ..."])
        });
        let mut params = test_connection_params();
        params.connection_uri = Some(uri.to_string());

        let sql = driver
            .get_create_foreign_key_sql(
                &params,
                "orders",
                "fk_user",
                "user_id",
                "users",
                "id",
                Some("CASCADE"),
                Some("CASCADE"),
                None,
            )
            .await
            .expect("fk sql");
        assert_eq!(sql, vec!["ALTER TABLE ...".to_string()]);
    }

    #[tokio::test]
    async fn rpc_driver_builds_ai_schema_context_from_standard_metadata_as_fallback() {
        let driver = test_driver_result(|request| match request.method.as_str() {
            "get_ai_schema_context" => Err("Method not found (-32601)".to_string()),
            "get_tables" => Ok(json!([{ "name": "users" }])),
            "get_columns" => Ok(json!([{
                "name": "id",
                "data_type": "bigint",
                "is_pk": true,
                "is_nullable": false,
                "is_auto_increment": true
            }])),
            "get_foreign_keys" => Ok(json!([])),
            method => Err(format!("Unexpected method: {method}")),
        });

        let context = driver
            .get_ai_schema_context(&test_connection_params(), Some("public"), 20)
            .await
            .expect("fallback schema context");

        assert_eq!(context.tables.len(), 1);
        assert_eq!(context.tables[0].name, "users");
        assert_eq!(context.tables[0].columns[0].name, "id");
        assert_eq!(context.total_table_count, 1);
    }

    #[tokio::test]
    async fn rpc_driver_forwards_the_connection_uri_to_test_connection() {
        let uri = "mongodb+srv://cluster.example.invalid/app?retryWrites=true&w=majority";
        let expected = uri.to_string();
        let driver = test_driver(move |request| {
            assert_eq!(request.method, "test_connection");
            assert_eq!(request.params["params"]["connection_uri"], expected);
            Value::Null
        });
        let mut params = test_connection_params();
        params.connection_uri = Some(uri.to_string());

        driver
            .test_connection(&params)
            .await
            .expect("test connection");
    }

    #[tokio::test]
    async fn rpc_driver_forwards_the_connection_uri_to_subsequent_operations() {
        let uri = "mongodb+srv://cluster.example.invalid/app?retryWrites=true&w=majority";
        let expected = uri.to_string();
        let driver = test_driver(move |request| {
            assert_eq!(request.method, "get_databases");
            assert_eq!(request.params["params"]["connection_uri"], expected);
            json!(["app"])
        });
        let mut params = test_connection_params();
        params.connection_uri = Some(uri.to_string());

        let databases = driver.get_databases(&params).await.expect("get databases");

        assert_eq!(databases, vec!["app"]);
    }

    #[tokio::test]
    async fn rpc_driver_omits_the_connection_uri_when_unset() {
        let driver = test_driver(|request| {
            assert_eq!(request.method, "get_databases");
            assert!(request.params["params"].get("connection_uri").is_none());
            json!(["db"])
        });

        driver
            .get_databases(&test_connection_params())
            .await
            .expect("get databases");
    }

    #[tokio::test]
    async fn rpc_driver_forwards_execute_query_batch() {
        let driver = test_driver(|request| {
            assert_eq!(request.method, "execute_query_batch");
            assert_eq!(request.params["params"]["driver"], "test-plugin");
            assert_eq!(
                request.params["queries"],
                json!(["CREATE TEMP TABLE t(id INT)", "SELECT * FROM t"])
            );
            assert_eq!(request.params["limit"], 50);
            assert_eq!(request.params["page"], 2);
            assert_eq!(request.params["schema"], "public");
            json!([
                {
                    "result": {
                        "columns": [],
                        "rows": [],
                        "affected_rows": 0,
                        "pagination": null
                    },
                    "error": null,
                    "execution_time_ms": 1.5
                },
                {
                    "result": null,
                    "error": "boom",
                    "execution_time_ms": 2.5
                }
            ])
        });

        let queries = vec![
            "CREATE TEMP TABLE t(id INT)".to_string(),
            "SELECT * FROM t".to_string(),
        ];
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let progress_seen = Arc::clone(&seen);
        let progress: Arc<BatchProgressFn> = Arc::new(move |idx, result| {
            progress_seen
                .lock()
                .expect("progress lock")
                .push((idx, result.result.is_some()));
        });

        let results = driver
            .execute_batch(
                &test_connection_params(),
                &queries,
                Some(50),
                2,
                Some("public"),
                Some(progress.as_ref()),
            )
            .await
            .expect("execute_query_batch");

        assert_eq!(results.len(), 2);
        assert!(results[0].result.is_some());
        assert_eq!(results[1].error.as_deref(), Some("boom"));
        assert_eq!(
            *seen.lock().expect("progress lock"),
            vec![(0, true), (1, false)]
        );
    }

    #[tokio::test]
    async fn rpc_driver_execute_batch_falls_back_when_method_missing() {
        let call_count = Arc::new(AtomicU64::new(0));
        let call_count_for_driver = Arc::clone(&call_count);
        let driver = test_driver_result(move |request| {
            let idx = call_count_for_driver.fetch_add(1, Ordering::SeqCst);
            match idx {
                0 => {
                    assert_eq!(request.method, "execute_query_batch");
                    Err("method not found: -32601".to_string())
                }
                1 => {
                    assert_eq!(request.method, "execute_query");
                    assert_eq!(request.params["query"], "SELECT 1");
                    Ok(json!({
                        "columns": ["one"],
                        "rows": [[1]],
                        "affected_rows": 0,
                        "pagination": null
                    }))
                }
                2 => {
                    assert_eq!(request.method, "execute_query");
                    assert_eq!(request.params["query"], "BROKEN");
                    Err("statement failed".to_string())
                }
                _ => panic!("unexpected request {}", idx),
            }
        });

        let queries = vec!["SELECT 1".to_string(), "BROKEN".to_string()];
        let results = driver
            .execute_batch(&test_connection_params(), &queries, None, 1, None, None)
            .await
            .expect("fallback execute_batch");

        assert_eq!(call_count.load(Ordering::SeqCst), 3);
        assert!(results[0].result.is_some());
        assert_eq!(results[1].error.as_deref(), Some("statement failed"));
    }

    #[tokio::test]
    async fn rpc_driver_forwards_get_triggers() {
        let driver = test_driver(|request| {
            assert_eq!(request.method, "get_triggers");
            assert_eq!(request.params["schema"], "public");
            assert_eq!(request.params["params"]["driver"], "test-plugin");
            json!([
                {
                    "name": "users_audit_trg",
                    "table_name": "users",
                    "event": "INSERT OR UPDATE",
                    "timing": "AFTER",
                    "definition": "CREATE TRIGGER users_audit_trg ..."
                }
            ])
        });

        let triggers = driver
            .get_triggers(&test_connection_params(), Some("public"))
            .await
            .expect("get_triggers");

        assert_eq!(triggers.len(), 1);
        assert_eq!(triggers[0].name, "users_audit_trg");
        assert_eq!(triggers[0].table_name, "users");
        assert_eq!(triggers[0].event, "INSERT OR UPDATE");
        assert_eq!(triggers[0].timing, "AFTER");
        assert_eq!(
            triggers[0].definition.as_deref(),
            Some("CREATE TRIGGER users_audit_trg ...")
        );
    }

    #[tokio::test]
    async fn rpc_driver_forwards_get_trigger_definition() {
        let driver = test_driver(|request| {
            assert_eq!(request.method, "get_trigger_definition");
            assert_eq!(request.params["trigger_name"], "users_audit_trg");
            assert_eq!(request.params["table_name"], "users");
            assert_eq!(request.params["schema"], "public");
            assert_eq!(request.params["params"]["driver"], "test-plugin");
            json!("CREATE TRIGGER users_audit_trg ...")
        });

        let definition = driver
            .get_trigger_definition(
                &test_connection_params(),
                "users_audit_trg",
                "users",
                Some("public"),
            )
            .await
            .expect("get_trigger_definition");

        assert_eq!(definition, "CREATE TRIGGER users_audit_trg ...");
    }

    #[tokio::test]
    async fn rpc_driver_forwards_create_trigger() {
        let driver = test_driver(|request| {
            assert_eq!(request.method, "create_trigger");
            assert_eq!(
                request.params["trigger_sql"],
                "CREATE TRIGGER users_audit_trg ..."
            );
            assert_eq!(request.params["schema"], "public");
            assert_eq!(request.params["params"]["driver"], "test-plugin");
            Value::Null
        });

        driver
            .create_trigger(
                &test_connection_params(),
                "CREATE TRIGGER users_audit_trg ...",
                Some("public"),
            )
            .await
            .expect("create_trigger");
    }

    #[tokio::test]
    async fn rpc_driver_forwards_drop_trigger() {
        let driver = test_driver(|request| {
            assert_eq!(request.method, "drop_trigger");
            assert_eq!(request.params["trigger_name"], "users_audit_trg");
            assert_eq!(request.params["table_name"], "users");
            assert_eq!(request.params["schema"], "public");
            assert_eq!(request.params["params"]["driver"], "test-plugin");
            Value::Null
        });

        driver
            .drop_trigger(
                &test_connection_params(),
                "users_audit_trg",
                "users",
                Some("public"),
            )
            .await
            .expect("drop_trigger");
    }

    #[tokio::test]
    async fn rpc_driver_forwards_save_blob_to_file() {
        let driver = test_driver(|request| {
            assert_eq!(request.method, "save_blob_to_file");
            assert_eq!(request.params["table"], "documents");
            assert_eq!(request.params["col_name"], "content");
            assert_eq!(request.params["pk_map"]["id"], 42);
            assert_eq!(request.params["schema"], "public");
            assert_eq!(request.params["file_path"], "/tmp/out.pdf");
            assert_eq!(request.params["params"]["driver"], "test-plugin");
            Value::Null
        });

        let mut pk_map = HashMap::new();
        pk_map.insert("id".to_string(), json!(42));

        driver
            .save_blob_to_file(
                &test_connection_params(),
                "documents",
                "content",
                &pk_map,
                Some("public"),
                "/tmp/out.pdf",
            )
            .await
            .expect("save_blob_to_file");
    }

    #[tokio::test]
    async fn rpc_driver_save_blob_falls_back_when_method_missing() {
        let driver = test_driver_result(|request| {
            assert_eq!(request.method, "save_blob_to_file");
            Err("Method not found (-32601)".to_string())
        });

        let pk_map = HashMap::new();
        let result = driver
            .save_blob_to_file(&test_connection_params(), "t", "c", &pk_map, None, "/tmp/x")
            .await;

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("BLOB file export not supported"));
    }

    #[tokio::test]
    async fn rpc_driver_forwards_fetch_blob_as_data_url() {
        let driver = test_driver(|request| {
            assert_eq!(request.method, "fetch_blob_as_data_url");
            assert_eq!(request.params["table"], "images");
            assert_eq!(request.params["col_name"], "data");
            assert_eq!(request.params["pk_map"]["id"], 7);
            assert_eq!(request.params["schema"], "public");
            assert_eq!(request.params["params"]["driver"], "test-plugin");
            // The documented BLOB wire format (see drivers/common/blob.rs)
            json!("BLOB:12:image/png:iVBORw0KGgo=")
        });

        let mut pk_map = HashMap::new();
        pk_map.insert("id".to_string(), json!(7));

        let url = driver
            .fetch_blob_as_data_url(
                &test_connection_params(),
                "images",
                "data",
                &pk_map,
                Some("public"),
            )
            .await
            .expect("fetch_blob_as_data_url");

        assert_eq!(url, "BLOB:12:image/png:iVBORw0KGgo=");
    }

    #[tokio::test]
    async fn rpc_driver_fetch_blob_falls_back_when_method_missing() {
        let driver = test_driver_result(|request| {
            assert_eq!(request.method, "fetch_blob_as_data_url");
            Err("Method not found (-32601)".to_string())
        });

        let pk_map = HashMap::new();
        let result = driver
            .fetch_blob_as_data_url(&test_connection_params(), "t", "c", &pk_map, None)
            .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("BLOB preview not supported"));
    }

    #[tokio::test]
    async fn rpc_driver_forwards_get_materialized_views() {
        let driver = test_driver(|request| {
            assert_eq!(request.method, "get_materialized_views");
            assert_eq!(request.params["schema"], "public");
            assert_eq!(request.params["params"]["driver"], "test-plugin");
            json!([{ "name": "mv_sales", "schema": "public" }])
        });

        let views = driver
            .get_materialized_views(&test_connection_params(), Some("public"))
            .await
            .expect("get_materialized_views");

        assert_eq!(views.len(), 1);
        assert_eq!(views[0].name, "mv_sales");
    }

    #[tokio::test]
    async fn rpc_driver_materialized_views_falls_back_when_method_missing() {
        let driver = test_driver_result(|request| {
            assert_eq!(request.method, "get_materialized_views");
            Err("Method not found (-32601)".to_string())
        });

        let views = driver
            .get_materialized_views(&test_connection_params(), None)
            .await
            .expect("fallback returns empty vec");

        assert!(views.is_empty());
    }

    /// Regression: the ER diagram against a plugin lacking `get_schema_snapshot`
    /// (the PostgreSQL plugin, as of this writing) rendered a silently blank
    /// canvas — the batch RPC failed with "method not found" and there was
    /// no fallback, unlike get_materialized_views above. Unlike that one, an
    /// empty-Vec fallback here would be actively misleading ("no tables"
    /// instead of "no fast batch endpoint"), so this composes the same shape
    /// from get_tables/get_columns/get_foreign_keys instead.
    #[tokio::test]
    async fn rpc_driver_get_schema_snapshot_falls_back_to_composed_metadata_when_method_missing() {
        let driver = test_driver_result(|request| match request.method.as_str() {
            "get_schema_snapshot" => Err("Method not found (-32601)".to_string()),
            "get_tables" => Ok(json!([{ "name": "products" }])),
            "get_columns" => Ok(json!([
                { "name": "id", "data_type": "integer", "is_pk": true, "is_nullable": false, "is_auto_increment": true },
            ])),
            "get_foreign_keys" => Ok(json!([
                { "name": "fk_products_category", "column_name": "category_id", "ref_table": "categories", "ref_column": "id" },
            ])),
            other => panic!("unexpected method: {other}"),
        });

        let snapshot = driver
            .get_schema_snapshot(&test_connection_params(), Some("public"))
            .await
            .expect("fallback composes a snapshot from get_tables/get_columns/get_foreign_keys");

        assert_eq!(snapshot.len(), 1);
        assert_eq!(snapshot[0].name, "products");
        assert_eq!(snapshot[0].columns.len(), 1);
        assert_eq!(snapshot[0].columns[0].name, "id");
        assert_eq!(snapshot[0].foreign_keys.len(), 1);
        assert_eq!(snapshot[0].foreign_keys[0].ref_table, "categories");
    }

    #[tokio::test]
    async fn rpc_driver_forwards_get_materialized_view_columns() {
        let driver = test_driver(|request| {
            assert_eq!(request.method, "get_materialized_view_columns");
            assert_eq!(request.params["view_name"], "mv_sales");
            assert_eq!(request.params["schema"], "public");
            json!([{ "name": "total", "data_type": "numeric", "is_pk": false, "is_nullable": true, "is_auto_increment": false }])
        });

        let cols = driver
            .get_materialized_view_columns(&test_connection_params(), "mv_sales", Some("public"))
            .await
            .expect("get_materialized_view_columns");

        assert_eq!(cols.len(), 1);
        assert_eq!(cols[0].name, "total");
    }

    #[tokio::test]
    async fn rpc_driver_materialized_view_columns_falls_back_when_method_missing() {
        let driver = test_driver_result(|request| {
            assert_eq!(request.method, "get_materialized_view_columns");
            Err("Method not found (-32601)".to_string())
        });

        let cols = driver
            .get_materialized_view_columns(&test_connection_params(), "mv_x", None)
            .await
            .expect("fallback returns empty vec");

        assert!(cols.is_empty());
    }

    #[tokio::test]
    async fn rpc_driver_forwards_get_materialized_view_definition() {
        let driver = test_driver(|request| {
            assert_eq!(request.method, "get_materialized_view_definition");
            assert_eq!(request.params["view_name"], "mv_sales");
            json!("SELECT sum(amount) FROM sales")
        });

        let def = driver
            .get_materialized_view_definition(&test_connection_params(), "mv_sales", Some("public"))
            .await
            .expect("get_materialized_view_definition");

        assert_eq!(def, "SELECT sum(amount) FROM sales");
    }

    #[tokio::test]
    async fn rpc_driver_materialized_view_definition_falls_back_when_method_missing() {
        let driver = test_driver_result(|request| {
            assert_eq!(request.method, "get_materialized_view_definition");
            Err("Method not found (-32601)".to_string())
        });

        let result = driver
            .get_materialized_view_definition(&test_connection_params(), "mv_x", None)
            .await;

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Materialized views are not supported"));
    }

    #[tokio::test]
    async fn rpc_driver_forwards_refresh_materialized_view() {
        let driver = test_driver(|request| {
            assert_eq!(request.method, "refresh_materialized_view");
            assert_eq!(request.params["view_name"], "mv_sales");
            assert_eq!(request.params["schema"], "public");
            assert_eq!(request.params["params"]["driver"], "test-plugin");
            Value::Null
        });

        driver
            .refresh_materialized_view(&test_connection_params(), "mv_sales", Some("public"))
            .await
            .expect("refresh_materialized_view");
    }

    #[tokio::test]
    async fn rpc_driver_refresh_materialized_view_falls_back_when_method_missing() {
        let driver = test_driver_result(|request| {
            assert_eq!(request.method, "refresh_materialized_view");
            Err("Method not found (-32601)".to_string())
        });

        let result = driver
            .refresh_materialized_view(&test_connection_params(), "mv_x", None)
            .await;

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Materialized views are not supported"));
    }

    #[tokio::test]
    async fn rpc_driver_map_inferred_type_uses_manifest_mappings() {
        let (tx, _rx) = mpsc::channel::<PluginCommand>(1);
        let (shutdown_tx, _shutdown_rx) = oneshot::channel();

        let mut manifest = test_manifest();
        manifest
            .type_mappings
            .insert("DATETIME".to_string(), "TIMESTAMP".to_string());
        manifest
            .type_mappings
            .insert("JSON".to_string(), "JSONB".to_string());

        let driver = RpcDriver {
            manifest,
            process: Arc::new(PluginProcess {
                sender: tx,
                next_id: AtomicU64::new(1),
                shutdown_tx: tokio::sync::Mutex::new(Some(shutdown_tx)),
                pid: None,
                initialization_settings: None,
                initialized: OnceCell::new(),
            }),
            data_types: Vec::new(),
            connection_metadata: false,
            metadata_cache: Arc::new(ConnectionMetadataCache::default()),
            connection_params: None,
        };

        // Mapped types
        assert_eq!(driver.map_inferred_type("DATETIME"), "TIMESTAMP");
        assert_eq!(driver.map_inferred_type("JSON"), "JSONB");
        // Lookup is case-insensitive (input is uppercased before matching)
        assert_eq!(driver.map_inferred_type("datetime"), "TIMESTAMP");
        // Unmapped types pass through unchanged
        assert_eq!(driver.map_inferred_type("INTEGER"), "INTEGER");
        assert_eq!(driver.map_inferred_type("TEXT"), "TEXT");
    }

    #[tokio::test]
    async fn rpc_driver_map_inferred_type_passthrough_without_mappings() {
        let (tx, _rx) = mpsc::channel::<PluginCommand>(1);
        let (shutdown_tx, _shutdown_rx) = oneshot::channel();

        let driver = RpcDriver {
            manifest: test_manifest(), // empty type_mappings
            process: Arc::new(PluginProcess {
                sender: tx,
                next_id: AtomicU64::new(1),
                shutdown_tx: tokio::sync::Mutex::new(Some(shutdown_tx)),
                pid: None,
                initialization_settings: None,
                initialized: OnceCell::new(),
            }),
            data_types: Vec::new(),
            connection_metadata: false,
            metadata_cache: Arc::new(ConnectionMetadataCache::default()),
            connection_params: None,
        };

        assert_eq!(driver.map_inferred_type("DATETIME"), "DATETIME");
        assert_eq!(driver.map_inferred_type("JSON"), "JSON");
    }

    #[tokio::test]
    async fn with_primary_database_coerces_multiple_to_first_selected() {
        let driver = test_driver(|_| json!(true));
        let mut params = test_connection_params();
        params.database = DatabaseSelection::Multiple(vec![
            "tabularis_pr822_demo".to_string(),
            "tabularis_test_secondary".to_string(),
        ]);

        let coerced = driver.with_primary_database(&params);

        assert_eq!(coerced.database.primary(), "tabularis_pr822_demo");
        assert!(matches!(coerced.database, DatabaseSelection::Single(_)));
    }

    #[tokio::test]
    async fn with_primary_database_leaves_single_database_unchanged() {
        let driver = test_driver(|_| json!(true));
        let params = test_connection_params(); // database: Single("db")

        let coerced = driver.with_primary_database(&params);

        assert_eq!(coerced.database.primary(), "db");
    }

    /// Non-Postgres engines have no known maintenance database, so an empty
    /// selection is left as-is — the plugin owns whatever default makes
    /// sense for it.
    #[tokio::test]
    async fn with_primary_database_leaves_empty_selection_alone_for_unknown_engines() {
        let driver = test_driver(|_| json!(true)); // test_manifest() -> engine: None
        let mut params = test_connection_params();
        params.database = DatabaseSelection::Single(String::new());

        let coerced = driver.with_primary_database(&params);

        assert_eq!(coerced.database.primary(), "");
    }

    /// Regression test: "All databases" mode (the *default* radio selection
    /// in the Databases tab) persists `database` as `Single("")`. Postgres
    /// pool creation (deadpool-postgres) rejects both a missing AND an
    /// empty dbname, so this must fall back to the "postgres" maintenance
    /// database — the same convention the built-in Postgres driver already
    /// uses for `get_databases` (`drivers/postgres/mod.rs`).
    #[tokio::test]
    async fn with_primary_database_falls_back_to_postgres_maintenance_db_for_postgresql_engine() {
        let mut driver = test_driver(|_| json!(true));
        driver.manifest.engine = Some("postgresql".to_string());
        let mut params = test_connection_params();
        params.database = DatabaseSelection::Single(String::new());

        let coerced = driver.with_primary_database(&params);

        assert_eq!(coerced.database.primary(), "postgres");
    }

    /// Same fallback for an empty `Multiple` selection (belt-and-suspenders;
    /// today's UI never persists an empty array, but `primary()` treats it
    /// identically to `Single("")`).
    #[tokio::test]
    async fn with_primary_database_falls_back_to_postgres_maintenance_db_for_empty_multiple() {
        let mut driver = test_driver(|_| json!(true));
        driver.manifest.engine = Some("postgres".to_string());
        let mut params = test_connection_params();
        params.database = DatabaseSelection::Multiple(vec![]);

        let coerced = driver.with_primary_database(&params);

        assert_eq!(coerced.database.primary(), "postgres");
    }

    /// Regression test for the bug found while manually testing PR #822: a
    /// PostgreSQL-plugin connection saved with "Choose databases" (multi-db
    /// opt-in) persists `database` as `DatabaseSelection::Multiple(...)`,
    /// which serializes to a bare JSON array. The plugin's
    /// `database: Option<String>` field can't represent an array, so an
    /// un-coerced `test_connection`/`ping` call silently resolved to `None`
    /// on the plugin side and pool creation failed with a missing-dbname
    /// error — even though the connection itself was perfectly valid.
    #[tokio::test]
    async fn rpc_driver_test_connection_sends_primary_database_for_multi_db_opt_in() {
        let driver = test_driver(|request| {
            assert_eq!(request.method, "test_connection");
            // The plugin must see a plain string, never a JSON array.
            assert_eq!(request.params["params"]["database"], "tabularis_pr822_demo");
            json!(true)
        });

        let mut params = test_connection_params();
        params.database = DatabaseSelection::Multiple(vec![
            "tabularis_pr822_demo".to_string(),
            "tabularis_test_secondary".to_string(),
        ]);

        driver
            .test_connection(&params)
            .await
            .expect("test_connection must succeed once database is coerced to a string");
    }

    #[tokio::test]
    async fn rpc_driver_ping_sends_primary_database_for_multi_db_opt_in() {
        let driver = test_driver(|request| {
            assert_eq!(request.method, "ping");
            assert_eq!(request.params["params"]["database"], "tabularis_pr822_demo");
            json!(true)
        });

        let mut params = test_connection_params();
        params.database = DatabaseSelection::Multiple(vec![
            "tabularis_pr822_demo".to_string(),
            "tabularis_test_secondary".to_string(),
        ]);

        driver
            .ping(&params)
            .await
            .expect("ping must succeed once database is coerced to a string");
    }

    /// Regression test for the more severe sibling of the same bug: "All
    /// databases" is the *default* radio selection in the Databases tab and
    /// persists `database` as `Single("")`. Without the maintenance-db
    /// fallback, every plugin-backed Postgres connection saved with the
    /// default database mode would fail to connect at all.
    #[tokio::test]
    async fn rpc_driver_test_connection_falls_back_to_postgres_for_all_databases_mode() {
        let mut driver = test_driver(|request| {
            assert_eq!(request.method, "test_connection");
            assert_eq!(request.params["params"]["database"], "postgres");
            json!(true)
        });
        driver.manifest.engine = Some("postgresql".to_string());

        let mut params = test_connection_params();
        params.database = DatabaseSelection::Single(String::new());

        driver
            .test_connection(&params)
            .await
            .expect("test_connection must fall back to the postgres maintenance db");
    }

    /// Regression test for #822's second recurrence of the same bug: dropping
    /// a table in the nested multi-db tree triggered a schema refresh that
    /// omitted the per-call `database` override, sending the connection's raw
    /// `Multiple(...)` straight to the plugin and crashing the whole
    /// connection's sidebar with "Pool creation failed". `get_schemas` (and
    /// every other RPC in this impl — see `with_primary_database`'s doc
    /// comment) must coerce it the same way `ping`/`test_connection` already
    /// did, so a gap like that degrades to the primary database instead of
    /// crashing.
    #[tokio::test]
    async fn rpc_driver_get_schemas_coerces_multi_db_opt_in_when_no_override_is_applied() {
        let driver = test_driver(|request| {
            assert_eq!(request.method, "get_schemas");
            assert_eq!(request.params["params"]["database"], "tabularis_pr822_demo");
            json!(["public"])
        });

        let mut params = test_connection_params();
        params.database = DatabaseSelection::Multiple(vec![
            "tabularis_pr822_demo".to_string(),
            "tabularis_test_secondary".to_string(),
        ]);

        driver
            .get_schemas(&params)
            .await
            .expect("get_schemas must succeed once database is coerced to a string");
    }

    /// Same coverage as above but for the "all databases" default mode
    /// (`Single("")`), and for `get_tables` — the other half of the
    /// drop-table repro's actual call chain (`refreshTables` calls
    /// `get_tables`, not `get_schemas`, without a database override).
    #[tokio::test]
    async fn rpc_driver_get_tables_falls_back_to_postgres_for_all_databases_mode() {
        let mut driver = test_driver(|request| {
            assert_eq!(request.method, "get_tables");
            assert_eq!(request.params["params"]["database"], "postgres");
            json!([])
        });
        driver.manifest.engine = Some("postgresql".to_string());

        let mut params = test_connection_params();
        params.database = DatabaseSelection::Single(String::new());

        driver
            .get_tables(&params, None)
            .await
            .expect("get_tables must fall back to the postgres maintenance db");
    }
}

#[cfg(test)]
#[path = "table_query_template_tests.rs"]
mod table_query_template_tests;

#[cfg(test)]
#[path = "startup_tests.rs"]
mod startup_tests;
