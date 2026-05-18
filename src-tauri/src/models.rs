use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DatabaseSelection {
    Single(String),
    Multiple(Vec<String>),
}

impl DatabaseSelection {
    pub fn primary(&self) -> &str {
        match self {
            DatabaseSelection::Single(s) => s.as_str(),
            DatabaseSelection::Multiple(v) => v.first().map(|s| s.as_str()).unwrap_or(""),
        }
    }

    pub fn as_vec(&self) -> Vec<String> {
        match self {
            DatabaseSelection::Single(s) => {
                if s.is_empty() {
                    vec![]
                } else {
                    vec![s.clone()]
                }
            }
            DatabaseSelection::Multiple(v) => v.clone(),
        }
    }

    pub fn is_multi(&self) -> bool {
        matches!(self, DatabaseSelection::Multiple(v) if v.len() > 1)
    }
}

/// If `previous` was single-db (zero/one effective database) and `new` is multi-db
/// (two or more), return the previous single database name so callers can backfill
/// existing per-connection records (favorites, query history) that had no explicit
/// database set. Returns `None` when this is not a single→multi transition or when
/// the previous selection had no usable name.
pub fn single_db_before_multi_transition(
    previous: &DatabaseSelection,
    new: &DatabaseSelection,
) -> Option<String> {
    if previous.is_multi() || !new.is_multi() {
        return None;
    }
    previous
        .as_vec()
        .into_iter()
        .find(|s| !s.trim().is_empty())
}

impl std::fmt::Display for DatabaseSelection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.primary())
    }
}

impl Default for DatabaseSelection {
    fn default() -> Self {
        DatabaseSelection::Single(String::new())
    }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SshConnection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_type: Option<String>, // "password" or "ssh_key"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_passphrase: Option<String>,
    pub save_in_keychain: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SshConnectionInput {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth_type: String, // "password" or "ssh_key"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_passphrase: Option<String>,
    pub save_in_keychain: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SshTestParams {
    pub host: String,
    pub port: u16,
    pub user: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_passphrase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct ConnectionParams {
    pub driver: String,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub database: DatabaseSelection,
    pub ssl_mode: Option<String>,
    pub ssl_ca: Option<String>,
    pub ssl_cert: Option<String>,
    pub ssl_key: Option<String>,
    // SSH Tunnel
    pub ssh_enabled: Option<bool>,
    pub ssh_connection_id: Option<String>,
    // Legacy SSH fields (for backward compatibility during migration)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh_host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh_port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh_user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh_password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh_key_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh_key_passphrase: Option<String>,
    pub save_in_keychain: Option<bool>,
    // Connection ID for stable pooling (not persisted, set at runtime)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    // SQL Server-specific TLS/auth fields (Phase 2, issue #144)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trust_server_certificate: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encrypt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_mode: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SavedConnection {
    pub id: String,
    pub name: String,
    pub params: ConnectionParams,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<i32>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ConnectionGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub sort_order: i32,
}

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct ConnectionsFile {
    #[serde(default)]
    pub groups: Vec<ConnectionGroup>,
    #[serde(default)]
    pub connections: Vec<SavedConnection>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TestConnectionRequest {
    pub params: ConnectionParams,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TableColumn {
    pub name: String,
    pub data_type: String,
    pub is_pk: bool,
    pub is_nullable: bool,
    pub is_auto_increment: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub character_maximum_length: Option<u64>,
    /// 1-based position of this column within its table's primary key.
    /// `None` for non-PK columns and for drivers that don't yet emit ordinal
    /// info. Frontends should sort PK columns by `pk_ordinal` when assembling
    /// composite-key requests (issue #148).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pk_ordinal: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ForeignKey {
    pub name: String,
    pub column_name: String,
    pub ref_table: String,
    pub ref_column: String,
    pub on_delete: Option<String>,
    pub on_update: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Index {
    pub name: String,
    pub column_name: String,
    pub is_unique: bool,
    pub is_primary: bool,
    pub seq_in_index: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Pagination {
    pub page: u32,
    pub page_size: u32,
    pub total_rows: Option<u64>,
    pub has_more: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub affected_rows: u64,
    #[serde(default)]
    pub truncated: bool,
    pub pagination: Option<Pagination>,
}

/// A single node in a query execution plan tree.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExplainNode {
    pub id: String,
    pub node_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub startup_cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_rows: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_rows: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_time_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_loops: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub buffers_hit: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub buffers_read: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index_condition: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub join_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash_condition: Option<String>,
    #[serde(default)]
    pub extra: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub children: Vec<ExplainNode>,
}

/// The complete result of an EXPLAIN query, including the plan tree and metadata.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExplainPlan {
    pub root: ExplainNode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub planning_time_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_time_ms: Option<f64>,
    pub original_query: String,
    pub driver: String,
    pub has_analyze_data: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_output: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TableSchema {
    pub name: String,
    pub columns: Vec<TableColumn>,
    pub foreign_keys: Vec<ForeignKey>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RoutineInfo {
    pub name: String,
    pub routine_type: String, // "PROCEDURE" | "FUNCTION"
    pub definition: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RoutineParameter {
    pub name: String,
    pub data_type: String,
    pub mode: String, // "IN", "OUT", "INOUT"
    pub ordinal_position: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ViewInfo {
    pub name: String,
    pub definition: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ColumnDefinition {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub is_pk: bool,
    pub is_auto_increment: bool,
    pub default_value: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DataTypeInfo {
    pub name: String,
    pub category: String,
    pub requires_length: bool,
    pub requires_precision: bool,
    pub default_length: Option<String>,
    #[serde(default)]
    pub supports_auto_increment: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires_extension: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DataTypeRegistry {
    pub driver: String,
    pub types: Vec<DataTypeInfo>,
}
