use crate::ai_activity::{self, AiActivityEvent};
use crate::ai_approval::{self, PendingApproval, PollOutcome};
use crate::commands;
use crate::config::{
    self, AppConfig, DEFAULT_AI_AUDIT_ENABLED, DEFAULT_AI_AUDIT_MAX_ENTRIES,
    DEFAULT_AI_SESSION_GAP_MINUTES, DEFAULT_MCP_APPROVAL_MODE,
    DEFAULT_MCP_APPROVAL_TIMEOUT_SECONDS, DEFAULT_MCP_PREFLIGHT_EXPLAIN,
};
use crate::credential_cache;
use crate::drivers::{mysql, postgres, sqlite};
use crate::heartbeat;
use crate::models::{ConnectionParams, SshConnection};
use crate::paths;
use crate::persistence;
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

pub mod install;
pub mod preflight;
pub mod protocol;
use protocol::*;

const APPROVAL_POLL_INTERVAL_MS: u64 = 500;

/// Async-friendly mirror of the data we want to record on every tool call.
struct CallAudit {
    tool: String,
    connection_id: Option<String>,
    connection_name: Option<String>,
    query: Option<String>,
    query_kind: Option<String>,
    rows: Option<usize>,
    status: String,
    error: Option<String>,
    approval_id: Option<String>,
}

impl CallAudit {
    fn for_tool(tool: &str) -> Self {
        Self {
            tool: tool.to_string(),
            connection_id: None,
            connection_name: None,
            query: None,
            query_kind: None,
            rows: None,
            status: "success".to_string(),
            error: None,
            approval_id: None,
        }
    }
}

/// MCP-mode equivalent of `expand_ssh_connection_params` — no AppHandle needed.
/// Loads SSH credentials from the config file and keychain directly.
async fn expand_ssh_params_for_mcp(
    params: &ConnectionParams,
) -> Result<ConnectionParams, JsonRpcError> {
    let mut expanded = params.clone();

    if !params.ssh_enabled.unwrap_or(false) {
        return Ok(expanded);
    }

    let ssh_id = match &params.ssh_connection_id {
        Some(id) => id.clone(),
        None => return Ok(expanded), // legacy inline SSH fields already present
    };

    let ssh_path = paths::get_app_config_dir().join("ssh_connections.json");
    if !ssh_path.exists() {
        return Err(JsonRpcError {
            code: -32000,
            message: format!("SSH connection {} not found", ssh_id),
            data: None,
        });
    }

    let content = tokio::task::spawn_blocking({
        let p = ssh_path.clone();
        move || std::fs::read_to_string(p).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| JsonRpcError {
        code: -32000,
        message: e.to_string(),
        data: None,
    })?
    .map_err(|e| JsonRpcError {
        code: -32000,
        message: e,
        data: None,
    })?;

    let mut ssh: SshConnection = serde_json::from_str::<Vec<SshConnection>>(&content)
        .unwrap_or_default()
        .into_iter()
        .find(|s| s.id == ssh_id)
        .ok_or_else(|| JsonRpcError {
            code: -32000,
            message: format!("SSH connection {} not found", ssh_id),
            data: None,
        })?;

    if ssh.auth_type.is_none() {
        ssh.auth_type = Some(
            if ssh
                .key_file
                .as_ref()
                .map_or(false, |k| !k.trim().is_empty())
            {
                "ssh_key".to_string()
            } else {
                "password".to_string()
            },
        );
    }

    if ssh.save_in_keychain.unwrap_or(false) {
        let cache = std::sync::Arc::new(credential_cache::CredentialCache::default());
        let id = ssh.id.clone();
        let (pwd_r, pass_r) = tokio::task::spawn_blocking(move || {
            let pwd = credential_cache::get_ssh_password_cached(&cache, &id);
            let pass = credential_cache::get_ssh_key_passphrase_cached(&cache, &id);
            (pwd, pass)
        })
        .await
        .map_err(|e| JsonRpcError {
            code: -32000,
            message: e.to_string(),
            data: None,
        })?;

        if let Ok(v) = pwd_r {
            if !v.trim().is_empty() {
                ssh.password = Some(v);
            }
        }
        if let Ok(v) = pass_r {
            if !v.trim().is_empty() {
                ssh.key_passphrase = Some(v);
            }
        }
    }

    expanded.ssh_host = Some(ssh.host);
    expanded.ssh_port = Some(ssh.port);
    expanded.ssh_user = Some(ssh.user);
    expanded.ssh_password = ssh.password;
    expanded.ssh_key_file = ssh.key_file;
    expanded.ssh_key_passphrase = ssh.key_passphrase;

    Ok(expanded)
}

fn find_connection(conn_id: &str) -> Result<crate::models::SavedConnection, JsonRpcError> {
    let config_path = paths::get_app_config_dir().join("connections.json");
    let connections = persistence::load_connections(&config_path).map_err(|e| JsonRpcError {
        code: -32000,
        message: e,
        data: None,
    })?;

    connections
        .into_iter()
        .find(|c| c.id == conn_id || c.name.eq_ignore_ascii_case(conn_id))
        .ok_or_else(|| JsonRpcError {
            code: -32000,
            message: format!("Connection not found: {}", conn_id),
            data: None,
        })
}

/// Full connection resolution for MCP: DB password + SSH expansion + tunnel setup.
async fn resolve_db_params(
    conn_id: &str,
) -> Result<(crate::models::SavedConnection, ConnectionParams), JsonRpcError> {
    let mut conn = find_connection(conn_id)?;

    // Load DB password from keychain if it isn't stored inline
    if conn.params.save_in_keychain.unwrap_or(false) {
        let cache = std::sync::Arc::new(credential_cache::CredentialCache::default());
        let id = conn.id.clone();
        let pwd = tokio::task::spawn_blocking(move || {
            credential_cache::get_db_password_cached(&cache, &id)
        })
        .await
        .map_err(|e| JsonRpcError {
            code: -32000,
            message: e.to_string(),
            data: None,
        })?;

        if let Ok(p) = pwd {
            if !p.trim().is_empty() {
                conn.params.password = Some(p);
            }
        }
    }

    let expanded = expand_ssh_params_for_mcp(&conn.params).await?;
    let db_params = commands::resolve_connection_params(&expanded).map_err(|e| JsonRpcError {
        code: -32000,
        message: e,
        data: None,
    })?;
    Ok((conn, db_params))
}

pub async fn run_mcp_server() {
    eprintln!("[MCP] Starting Tabularis MCP Server...");

    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let mut iterator = stdin.lock().lines();

    while let Some(line_result) = iterator.next() {
        match line_result {
            Ok(line) => {
                if line.trim().is_empty() {
                    continue;
                }

                // Log input to stderr for debugging
                eprintln!("[MCP] Received: {}", line);

                match serde_json::from_str::<JsonRpcRequest>(&line) {
                    Ok(request) => {
                        let response = handle_request(request).await;
                        if let Some(resp) = response {
                            let json = serde_json::to_string(&resp).unwrap();
                            // Log output to stderr
                            eprintln!("[MCP] Sending: {}", json);
                            stdout.write_all(json.as_bytes()).unwrap();
                            stdout.write_all(b"\n").unwrap();
                            stdout.flush().unwrap();
                        }
                    }
                    Err(e) => {
                        eprintln!("[MCP] Error parsing JSON: {}", e);
                    }
                }
            }
            Err(e) => {
                eprintln!("[MCP] Error reading stdin: {}", e);
                break;
            }
        }
    }
}

async fn handle_request(req: JsonRpcRequest) -> Option<JsonRpcResponse> {
    // Notifications (no id)
    if req.id.is_none() {
        if req.method == "notifications/initialized" {
            eprintln!("[MCP] Client initialized.");
        }
        return None;
    }

    let id = req.id.clone();
    let result = match req.method.as_str() {
        "initialize" => handle_initialize(req.params),
        "resources/list" => handle_list_resources().await,
        "resources/read" => handle_read_resource(req.params).await,
        "tools/list" => handle_list_tools(),
        "tools/call" => handle_call_tool(req.params).await,
        _ => Err(JsonRpcError {
            code: -32601,
            message: "Method not found".to_string(),
            data: None,
        }),
    };

    let (res, err) = match result {
        Ok(val) => (Some(val), None),
        Err(e) => (None, Some(e)),
    };

    Some(JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        id,
        result: res,
        error: err,
    })
}

fn handle_initialize(params: Option<Value>) -> Result<Value, JsonRpcError> {
    // Capture client name for the audit log session metadata. Best-effort:
    // if parsing fails we still complete the handshake.
    if let Some(p) = &params {
        if let Some(name) = p
            .get("clientInfo")
            .and_then(|c| c.get("name"))
            .and_then(|v| v.as_str())
        {
            ai_activity::set_client_hint(Some(name.to_string()));
        }
    }

    let result = InitializeResult {
        protocol_version: "2024-11-05".to_string(),
        capabilities: ServerCapabilities {
            resources: Some(json!({ "listChanged": false })),
            tools: Some(json!({ "listChanged": false })),
            prompts: None,
        },
        server_info: ServerInfo {
            name: "tabularis-mcp".to_string(),
            version: "0.1.0".to_string(),
        },
    };
    Ok(serde_json::to_value(result).unwrap())
}

async fn handle_list_resources() -> Result<Value, JsonRpcError> {
    let config_path = paths::get_app_config_dir().join("connections.json");
    let connections = persistence::load_connections(&config_path).map_err(|e| JsonRpcError {
        code: -32000,
        message: format!("Failed to load connections: {}", e),
        data: None,
    })?;

    let mut resources = Vec::new();

    // Add connection list resource
    resources.push(Resource {
        uri: "tabularis://connections".to_string(),
        name: "Connections List".to_string(),
        description: Some("List of all configured database connections".to_string()),
        mime_type: Some("application/json".to_string()),
    });

    // Add schema resources for each connection
    for conn in connections {
        resources.push(Resource {
            uri: format!("tabularis://{}/schema", conn.id),
            name: format!("Schema: {}", conn.name),
            description: Some(format!("Database schema for {}", conn.name)),
            mime_type: Some("application/json".to_string()),
        });
    }

    Ok(json!({
        "resources": resources
    }))
}

async fn handle_read_resource(params: Option<Value>) -> Result<Value, JsonRpcError> {
    let params = params.ok_or(JsonRpcError {
        code: -32602,
        message: "Missing params".to_string(),
        data: None,
    })?;

    let uri = params["uri"].as_str().ok_or(JsonRpcError {
        code: -32602,
        message: "Missing uri".to_string(),
        data: None,
    })?;

    if uri == "tabularis://connections" {
        let config_path = paths::get_app_config_dir().join("connections.json");
        let connections =
            persistence::load_connections(&config_path).map_err(|e| JsonRpcError {
                code: -32000,
                message: e,
                data: None,
            })?;

        let safe_list: Vec<_> = connections
            .iter()
            .map(|c| {
                json!({
                    "id": c.id,
                    "name": c.name,
                    "driver": c.params.driver,
                    "host": c.params.host,
                    "database": c.params.database
                })
            })
            .collect();

        return Ok(json!({
            "contents": [{
                "uri": uri,
                "mime_type": "application/json",
                "text": serde_json::to_string_pretty(&safe_list).unwrap()
            }]
        }));
    }

    if uri.starts_with("tabularis://") && uri.ends_with("/schema") {
        let parts: Vec<&str> = uri.split('/').collect();
        // uri format: tabularis://{id}/schema -> ["tabularis:", "", "{id}", "schema"]
        if parts.len() < 4 {
            return Err(JsonRpcError {
                code: -32602,
                message: "Invalid URI format".to_string(),
                data: None,
            });
        }
        let conn_id = parts[2];

        let config_path = paths::get_app_config_dir().join("connections.json");
        let connections =
            persistence::load_connections(&config_path).map_err(|e| JsonRpcError {
                code: -32000,
                message: e,
                data: None,
            })?;

        // Try to find by ID or exact name (case-insensitive) first, then partial name match
        let conn = connections
            .iter()
            .find(|c| c.id == conn_id || c.name.eq_ignore_ascii_case(conn_id))
            .or_else(|| {
                connections
                    .iter()
                    .find(|c| c.name.to_lowercase().contains(&conn_id.to_lowercase()))
            })
            .ok_or(JsonRpcError {
                code: -32000,
                message: format!("Connection not found: {}", conn_id),
                data: None,
            })?;

        let params =
            commands::resolve_connection_params(&conn.params).map_err(|e| JsonRpcError {
                code: -32000,
                message: e,
                data: None,
            })?;

        let tables = match conn.params.driver.as_str() {
            "mysql" => mysql::get_tables(&params, None).await,
            "postgres" => postgres::get_tables(&params, "public").await,
            "sqlite" => sqlite::get_tables(&params).await,
            _ => Err("Unsupported driver".into()),
        }
        .map_err(|e| JsonRpcError {
            code: -32000,
            message: e,
            data: None,
        })?;

        // Format as simplified DDL or JSON
        let schema_json = serde_json::to_string_pretty(&tables).unwrap();

        return Ok(json!({
            "contents": [{
                "uri": uri,
                "mime_type": "application/json",
                "text": schema_json
            }]
        }));
    }

    Err(JsonRpcError {
        code: -32602,
        message: "Resource not found".to_string(),
        data: None,
    })
}

fn handle_list_tools() -> Result<Value, JsonRpcError> {
    let tools = vec![
        Tool {
            name: "list_connections".to_string(),
            description: Some("List all saved database connections".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        },
        Tool {
            name: "list_tables".to_string(),
            description: Some("List all tables in a database connection".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "connection_id": { "type": "string", "description": "The ID or name of the connection" },
                    "schema": { "type": "string", "description": "Schema name (optional, defaults to 'public' for PostgreSQL)" }
                },
                "required": ["connection_id"]
            }),
        },
        Tool {
            name: "describe_table".to_string(),
            description: Some(
                "Get the full schema of a table: columns, indexes, and foreign keys".to_string(),
            ),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "connection_id": { "type": "string", "description": "The ID or name of the connection" },
                    "table_name": { "type": "string", "description": "The name of the table to describe" },
                    "schema": { "type": "string", "description": "Schema name (optional, defaults to 'public' for PostgreSQL)" }
                },
                "required": ["connection_id", "table_name"]
            }),
        },
        Tool {
            name: "run_query".to_string(),
            description: Some("Execute a SQL query on a specific connection. If the query already contains a LIMIT clause, it will be respected.".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "connection_id": { "type": "string", "description": "The ID or name of the connection" },
                    "query": { "type": "string", "description": "The SQL query to execute" },
                    "limit": { "type": "integer", "description": "Maximum number of rows to return (default: 100). If the query already contains a LIMIT clause smaller than this value, the query's LIMIT takes precedence." }
                },
                "required": ["connection_id", "query"]
            }),
        },
    ];

    Ok(json!({
        "tools": tools
    }))
}

async fn handle_call_tool(params: Option<Value>) -> Result<Value, JsonRpcError> {
    let start = std::time::Instant::now();
    let app_config = config::load_config_from_disk();
    let audit_enabled = app_config
        .ai_audit_enabled
        .unwrap_or(DEFAULT_AI_AUDIT_ENABLED);
    let max_entries = app_config
        .ai_audit_max_entries
        .unwrap_or(DEFAULT_AI_AUDIT_MAX_ENTRIES) as usize;
    let gap_minutes = app_config
        .ai_session_gap_minutes
        .unwrap_or(DEFAULT_AI_SESSION_GAP_MINUTES);

    let session_id = ai_activity::compute_or_rotate_session_id(gap_minutes);
    let client_hint = ai_activity::get_client_hint();

    let params_value = match params {
        Some(p) => p,
        None => {
            let err = JsonRpcError {
                code: -32602,
                message: "Missing params".to_string(),
                data: None,
            };
            if audit_enabled {
                let mut audit = CallAudit::for_tool("unknown");
                audit.status = "error".to_string();
                audit.error = Some(err.message.clone());
                emit_audit(&session_id, &client_hint, &audit, start, max_entries);
            }
            return Err(err);
        }
    };
    let name = params_value["name"].as_str().unwrap_or("").to_string();
    let args = params_value
        .get("arguments")
        .and_then(|v| v.as_object())
        .cloned();

    let mut audit = CallAudit::for_tool(&name);
    let result = dispatch_tool(&name, args.as_ref(), &app_config, &session_id, &mut audit).await;

    match &result {
        Ok(_) => {
            if audit.status == "success" {
                audit.status = "success".to_string();
            }
        }
        Err(e) => {
            // Inner code may have already set a more specific status (e.g.
            // blocked_readonly, denied, timeout). Only fall back to "error"
            // when nothing was set.
            if audit.status == "success" {
                audit.status = "error".to_string();
            }
            if audit.error.is_none() {
                audit.error = Some(e.message.clone());
            }
        }
    }

    if audit_enabled {
        emit_audit(&session_id, &client_hint, &audit, start, max_entries);
    }

    result
}

fn emit_audit(
    session_id: &str,
    client_hint: &Option<String>,
    audit: &CallAudit,
    start: std::time::Instant,
    max_entries: usize,
) {
    let event = AiActivityEvent {
        id: ai_activity::new_uuid(),
        session_id: session_id.to_string(),
        timestamp: ai_activity::now_iso8601(),
        tool: audit.tool.clone(),
        connection_id: audit.connection_id.clone(),
        connection_name: audit.connection_name.clone(),
        query: audit.query.clone(),
        query_kind: audit.query_kind.clone(),
        duration_ms: start.elapsed().as_millis() as u64,
        status: audit.status.clone(),
        rows: audit.rows,
        error: audit.error.clone(),
        client_hint: client_hint.clone(),
        approval_id: audit.approval_id.clone(),
    };
    if let Err(e) = ai_activity::append_and_rotate(&event, max_entries) {
        eprintln!("[MCP] Failed to write audit log: {}", e);
    }
}

async fn dispatch_tool(
    name: &str,
    args: Option<&serde_json::Map<String, Value>>,
    config: &AppConfig,
    session_id: &str,
    audit: &mut CallAudit,
) -> Result<Value, JsonRpcError> {
    match name {
        "list_connections" => tool_list_connections(audit).await,
        "list_tables" => {
            let args = require_args(args)?;
            tool_list_tables(args, audit).await
        }
        "describe_table" => {
            let args = require_args(args)?;
            tool_describe_table(args, audit).await
        }
        "run_query" => {
            let args = require_args(args)?;
            tool_run_query(args, config, session_id, audit).await
        }
        _ => Err(JsonRpcError {
            code: -32601,
            message: "Tool not found".to_string(),
            data: None,
        }),
    }
}

fn require_args(
    args: Option<&serde_json::Map<String, Value>>,
) -> Result<&serde_json::Map<String, Value>, JsonRpcError> {
    args.ok_or(JsonRpcError {
        code: -32602,
        message: "Missing arguments".to_string(),
        data: None,
    })
}

async fn tool_list_connections(_audit: &mut CallAudit) -> Result<Value, JsonRpcError> {
    let config_path = paths::get_app_config_dir().join("connections.json");
    let connections = persistence::load_connections(&config_path).map_err(|e| JsonRpcError {
        code: -32000,
        message: e,
        data: None,
    })?;

    let list: Vec<_> = connections
        .iter()
        .map(|c| {
            json!({
                "id": c.id,
                "name": c.name,
                "driver": c.params.driver,
                "host": c.params.host,
                "database": c.params.database.to_string()
            })
        })
        .collect();

    Ok(json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&list).unwrap()
        }]
    }))
}

async fn tool_list_tables(
    args: &serde_json::Map<String, Value>,
    audit: &mut CallAudit,
) -> Result<Value, JsonRpcError> {
    let conn_id = args
        .get("connection_id")
        .and_then(|v| v.as_str())
        .ok_or(JsonRpcError {
            code: -32602,
            message: "Missing connection_id".to_string(),
            data: None,
        })?;
    let schema = args.get("schema").and_then(|v| v.as_str());

    audit.connection_id = Some(conn_id.to_string());

    let (conn, db_params) = resolve_db_params(conn_id).await?;
    audit.connection_name = Some(conn.name.clone());

    let tables = match conn.params.driver.as_str() {
        "mysql" => mysql::get_tables(&db_params, schema).await,
        "postgres" => {
            let s = schema.unwrap_or("public");
            postgres::get_tables(&db_params, s).await
        }
        "sqlite" => sqlite::get_tables(&db_params).await,
        _ => Err("Unsupported driver".into()),
    }
    .map_err(|e| JsonRpcError {
        code: -32000,
        message: e,
        data: None,
    })?;

    let names: Vec<&str> = tables.iter().map(|t| t.name.as_str()).collect();
    audit.rows = Some(names.len());
    Ok(json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&names).unwrap()
        }]
    }))
}

async fn tool_describe_table(
    args: &serde_json::Map<String, Value>,
    audit: &mut CallAudit,
) -> Result<Value, JsonRpcError> {
    let conn_id = args
        .get("connection_id")
        .and_then(|v| v.as_str())
        .ok_or(JsonRpcError {
            code: -32602,
            message: "Missing connection_id".to_string(),
            data: None,
        })?;
    let table_name = args
        .get("table_name")
        .and_then(|v| v.as_str())
        .ok_or(JsonRpcError {
            code: -32602,
            message: "Missing table_name".to_string(),
            data: None,
        })?;
    let schema = args.get("schema").and_then(|v| v.as_str());

    audit.connection_id = Some(conn_id.to_string());

    let (conn, db_params) = resolve_db_params(conn_id).await?;
    audit.connection_name = Some(conn.name.clone());

    let (columns, foreign_keys, indexes) = match conn.params.driver.as_str() {
        "mysql" => {
            let cols = mysql::get_columns(&db_params, table_name, schema).await;
            let fks = mysql::get_foreign_keys(&db_params, table_name, schema).await;
            let idxs = mysql::get_indexes(&db_params, table_name, schema).await;
            (cols, fks, idxs)
        }
        "postgres" => {
            let s = schema.unwrap_or("public");
            let cols = postgres::get_columns(&db_params, table_name, s).await;
            let fks = postgres::get_foreign_keys(&db_params, table_name, s).await;
            let idxs = postgres::get_indexes(&db_params, table_name, s).await;
            (cols, fks, idxs)
        }
        "sqlite" => {
            let cols = sqlite::get_columns(&db_params, table_name).await;
            let fks = sqlite::get_foreign_keys(&db_params, table_name).await;
            let idxs = sqlite::get_indexes(&db_params, table_name).await;
            (cols, fks, idxs)
        }
        _ => {
            return Err(JsonRpcError {
                code: -32000,
                message: "Unsupported driver".to_string(),
                data: None,
            })
        }
    };

    let result = json!({
        "table": table_name,
        "columns": columns.map_err(|e| JsonRpcError { code: -32000, message: e, data: None })?,
        "foreign_keys": foreign_keys.map_err(|e| JsonRpcError { code: -32000, message: e, data: None })?,
        "indexes": indexes.map_err(|e| JsonRpcError { code: -32000, message: e, data: None })?
    });

    Ok(json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&result).unwrap()
        }]
    }))
}

async fn tool_run_query(
    args: &serde_json::Map<String, Value>,
    config: &AppConfig,
    session_id: &str,
    audit: &mut CallAudit,
) -> Result<Value, JsonRpcError> {
    let conn_id = args
        .get("connection_id")
        .and_then(|v| v.as_str())
        .ok_or(JsonRpcError {
            code: -32602,
            message: "Missing connection_id".to_string(),
            data: None,
        })?;
    let query = args
        .get("query")
        .and_then(|v| v.as_str())
        .ok_or(JsonRpcError {
            code: -32602,
            message: "Missing query".to_string(),
            data: None,
        })?;

    let max_rows = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(100) as u32;

    audit.connection_id = Some(conn_id.to_string());
    audit.query = Some(query.to_string());
    let kind = ai_activity::classify_query_kind(query);
    audit.query_kind = Some(kind.to_string());

    let (conn, db_params) = resolve_db_params(conn_id).await?;
    audit.connection_name = Some(conn.name.clone());

    // Read-only enforcement (fail-closed: unknown counts as write).
    if config::is_connection_readonly(config, &conn.id) && kind != "select" {
        audit.status = "blocked_readonly".to_string();
        let msg = "Query blocked by Tabularis read-only mode. Enable writes for this connection in Settings → MCP → Read-only mode.".to_string();
        audit.error = Some(msg.clone());
        return Err(JsonRpcError {
            code: -32000,
            message: msg,
            data: None,
        });
    }

    // Approval gate
    let approval_mode = config
        .mcp_approval_mode
        .clone()
        .unwrap_or_else(|| DEFAULT_MCP_APPROVAL_MODE.to_string());
    let needs_approval = match approval_mode.as_str() {
        "off" => false,
        "all" => true,
        // writes_only — anything that isn't a clean select.
        _ => kind != "select",
    };

    let mut effective_query: String = query.to_string();

    if needs_approval {
        // Fail fast if the GUI is not running — otherwise we'd queue a
        // pending approval that nobody can approve and wait the full
        // `mcp_approval_timeout_seconds` (default 120s) for nothing.
        if !heartbeat::is_alive() {
            audit.status = "host_unavailable".to_string();
            let msg = "Tabularis app is not running — open it to approve writes".to_string();
            audit.error = Some(msg.clone());
            return Err(JsonRpcError {
                code: -32000,
                message: msg,
                data: None,
            });
        }

        let timeout_secs = config
            .mcp_approval_timeout_seconds
            .unwrap_or(DEFAULT_MCP_APPROVAL_TIMEOUT_SECONDS) as u64;
        let want_explain = config
            .mcp_preflight_explain
            .unwrap_or(DEFAULT_MCP_PREFLIGHT_EXPLAIN);

        // Pre-flight EXPLAIN — best effort, never blocks.
        let (explain_plan, explain_error) = if want_explain {
            let outcome =
                preflight::preflight_explain(&conn.params.driver, &db_params, query, None).await;
            (outcome.plan, outcome.error)
        } else {
            (None, None)
        };

        let approval_id = ai_approval::new_approval_id();
        audit.approval_id = Some(approval_id.clone());

        let pending = PendingApproval {
            id: approval_id.clone(),
            created_at: ai_activity::now_iso8601(),
            session_id: session_id.to_string(),
            connection_id: conn.id.clone(),
            connection_name: conn.name.clone(),
            query: query.to_string(),
            query_kind: kind.to_string(),
            client_hint: ai_activity::get_client_hint(),
            explain_plan,
            explain_error,
        };

        if let Err(e) = ai_approval::write_pending(&pending) {
            audit.status = "error".to_string();
            let msg = format!("Failed to enqueue approval request: {}", e);
            audit.error = Some(msg.clone());
            return Err(JsonRpcError {
                code: -32000,
                message: msg,
                data: None,
            });
        }

        match ai_approval::poll_decision_with_liveness(
            &approval_id,
            timeout_secs,
            APPROVAL_POLL_INTERVAL_MS,
            heartbeat::is_alive,
        )
        .await
        {
            Ok(PollOutcome::Decided(decision)) => {
                if decision.decision == "approve" {
                    if let Some(edited) = decision
                        .edited_query
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                    {
                        effective_query = edited.to_string();
                    }
                } else {
                    let reason = decision
                        .reason
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(|r| format!(": {}", r))
                        .unwrap_or_default();
                    audit.status = "denied".to_string();
                    let msg = format!("Query denied by user{}", reason);
                    audit.error = Some(msg.clone());
                    return Err(JsonRpcError {
                        code: -32000,
                        message: msg,
                        data: None,
                    });
                }
            }
            Ok(PollOutcome::TimedOut) => {
                audit.status = "timeout".to_string();
                let msg = format!(
                    "Approval timed out after {}s — open Tabularis to approve writes",
                    timeout_secs
                );
                audit.error = Some(msg.clone());
                return Err(JsonRpcError {
                    code: -32000,
                    message: msg,
                    data: None,
                });
            }
            Ok(PollOutcome::HostUnavailable) => {
                audit.status = "host_unavailable".to_string();
                let msg =
                    "Tabularis app closed during approval — open it to approve writes".to_string();
                audit.error = Some(msg.clone());
                return Err(JsonRpcError {
                    code: -32000,
                    message: msg,
                    data: None,
                });
            }
            Err(e) => {
                audit.status = "error".to_string();
                audit.error = Some(e.clone());
                return Err(JsonRpcError {
                    code: -32000,
                    message: e,
                    data: None,
                });
            }
        }
    }

    let result = match conn.params.driver.as_str() {
        "mysql" => {
            mysql::execute_query(&db_params, &effective_query, Some(max_rows), 1, None).await
        }
        "postgres" => {
            postgres::execute_query(&db_params, &effective_query, Some(max_rows), 1, None).await
        }
        "sqlite" => sqlite::execute_query(&db_params, &effective_query, Some(max_rows), 1).await,
        _ => Err("Unsupported driver".into()),
    }
    .map_err(|e| JsonRpcError {
        code: -32000,
        message: e,
        data: None,
    })?;

    audit.rows = Some(result.rows.len());

    Ok(json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&result).unwrap()
        }]
    }))
}

