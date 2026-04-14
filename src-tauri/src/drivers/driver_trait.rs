use std::collections::HashMap;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sqlx::any::AnyConnectOptions;
use sqlx::{AnyConnection, Connection};
use std::str::FromStr;

use crate::models::{
    ColumnDefinition, ConnectionParams, DataTypeInfo, ExplainPlan, ForeignKey, Index, QueryResult,
    RoutineInfo, RoutineParameter, TableColumn, TableInfo, TableSchema, ViewInfo,
};

/// Capabilities advertised by a driver.
/// The frontend uses these flags to decide which UI sections to show.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DriverCapabilities {
    /// Supports multiple named schemas (e.g. PostgreSQL).
    pub schemas: bool,
    /// Supports views.
    pub views: bool,
    /// Supports stored procedures and functions.
    pub routines: bool,
    /// File-based database (e.g. SQLite); no host/port required.
    pub file_based: bool,
    /// Folder-based database (e.g. CSV directory); connection points to a directory instead of a file.
    #[serde(default)]
    pub folder_based: bool,
    /// Enables connection string import input in the connection modal.
    /// Defaults to `true` for backward compatibility.
    #[serde(default = "default_true", alias = "connectionString")]
    pub connection_string: bool,
    /// Optional placeholder example shown for connection string input.
    #[serde(default, alias = "connectionStringExample")]
    pub connection_string_example: String,
    /// Character used to quote identifiers (e.g. `"` for PostgreSQL, `` ` `` for MySQL).
    #[serde(default = "default_double_quote")]
    pub identifier_quote: String,
    /// Supports adding or modifying primary keys on existing tables via ALTER TABLE.
    #[serde(default = "default_true")]
    pub alter_primary_key: bool,
    // SQL generation capabilities
    /// Keyword appended after column type for auto-increment (e.g. "AUTO_INCREMENT" for MySQL).
    /// Empty string means the driver does not use a keyword-based auto-increment.
    #[serde(default)]
    pub auto_increment_keyword: String,
    /// Replacement type for auto-increment columns (e.g. "SERIAL" for PostgreSQL).
    /// Empty string means the driver does not use a type replacement.
    #[serde(default)]
    pub serial_type: String,
    /// Whether primary key is defined inline in the column definition (e.g. SQLite AUTOINCREMENT).
    #[serde(default)]
    pub inline_pk: bool,
    // DDL capabilities
    /// Supports ALTER TABLE MODIFY/ALTER COLUMN on existing tables.
    #[serde(default)]
    pub alter_column: bool,
    /// Supports creating foreign key constraints (properly enforced).
    #[serde(default)]
    pub create_foreign_keys: bool,
    /// API-based plugin that requires no host, port, or credentials.
    /// When `true`, the connection form is hidden and database validation is skipped.
    #[serde(default)]
    pub no_connection_required: bool,
    /// Whether the driver supports table and column management
    /// (CREATE TABLE, ALTER TABLE ADD/MODIFY/DROP COLUMN, DROP TABLE).
    /// Does NOT control index or foreign key operations (see `create_foreign_keys`).
    /// Defaults to `true`.
    #[serde(default = "default_true")]
    pub manage_tables: bool,
    /// When `true`, the driver is read-only: all data modification operations
    /// (INSERT, UPDATE, DELETE) are disabled in the UI.
    /// Table/column management is also hidden regardless of `manage_tables`.
    /// Defaults to `false`.
    #[serde(default)]
    pub readonly: bool,
}

fn default_double_quote() -> String {
    "\"".to_string()
}

fn default_true() -> bool {
    true
}

/// A UI extension slot entry declared in a plugin's manifest.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UIExtensionEntry {
    /// Target slot name (e.g. `"row-edit-modal.field.after"`).
    pub slot: String,
    /// Module path relative to the plugin directory (e.g. `"dist/index.js"`).
    pub module: String,
    /// Ordering weight (lower = earlier).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
}

/// A single user-configurable setting declared in a plugin's manifest.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct PluginSettingDefinition {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub setting_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub options: Vec<String>,
}

/// Metadata describing a registered driver plugin.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginManifest {
    /// Unique identifier used in `ConnectionParams.driver` (e.g. `"mysql"`).
    pub id: String,
    /// Human-readable name shown in the UI (e.g. `"MySQL"`).
    pub name: String,
    /// Semver string of this driver implementation (e.g. `"1.0.0"`).
    pub version: String,
    /// Short description shown in the UI.
    pub description: String,
    /// Default TCP port, `None` for file-based drivers.
    pub default_port: Option<u16>,
    pub capabilities: DriverCapabilities,
    /// `true` for built-in drivers (postgres, mysql, sqlite); always `false`
    /// for external plugin drivers. The frontend uses this to distinguish
    /// built-in entries without relying on a hardcoded ID list.
    #[serde(default)]
    pub is_builtin: bool,
    /// Default username pre-filled in the connection modal (e.g. `"postgres"`,
    /// `"root"`). Empty string for drivers that have no default.
    #[serde(default)]
    pub default_username: String,
    /// CSS hex color for UI accents (e.g. `"#f97316"`). Empty string falls back to a neutral color.
    #[serde(default)]
    pub color: String,
    /// Lucide-compatible icon name (e.g. `"network"`, `"database"`). Empty string falls back to a generic icon.
    #[serde(default)]
    pub icon: String,
    /// Plugin-declared settings definitions. Empty for built-in drivers.
    #[serde(default)]
    pub settings: Vec<PluginSettingDefinition>,
    /// UI extension slot declarations. Absent for built-in drivers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_extensions: Option<Vec<UIExtensionEntry>>,
}

/// The complete interface every database driver plugin must implement.
///
/// The `schema` parameter is `Option<&str>` throughout. Drivers that do not
/// use schemas (MySQL, SQLite) simply ignore it. Drivers that do (PostgreSQL)
/// fall back to `"public"` when it is `None`.
#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    // --- Metadata -----------------------------------------------------------

    fn manifest(&self) -> &PluginManifest;

    /// Returns the list of data types supported by this driver.
    fn get_data_types(&self) -> Vec<DataTypeInfo>;

    /// Builds the connection URL string for this driver.
    fn build_connection_url(&self, params: &ConnectionParams) -> Result<String, String>;

    /// Shuts down any background resources held by this driver (e.g. a plugin subprocess).
    /// Built-in sqlx-based drivers hold no background process; the default is a no-op.
    async fn shutdown(&self) {}

    /// Returns the OS process ID of the subprocess backing this driver, if any.
    /// Built-in drivers always return `None`.
    fn pid(&self) -> Option<u32> {
        None
    }

    /// Lightweight health check on an existing connection/pool.
    /// Built-in drivers override this with a pool-based check; plugin drivers
    /// delegate via JSON-RPC. The default falls back to `test_connection`.
    async fn ping(&self, params: &ConnectionParams) -> Result<(), String> {
        self.test_connection(params).await
    }

    /// Tests connectivity. Default implementation uses `build_connection_url` + sqlx.
    /// Plugin drivers that manage their own connections should override this.
    async fn test_connection(&self, params: &ConnectionParams) -> Result<(), String> {
        let url = self.build_connection_url(params)?;
        let options = AnyConnectOptions::from_str(&url).map_err(|e| e.to_string())?;
        let mut conn: AnyConnection = AnyConnection::connect_with(&options)
            .await
            .map_err(|e: sqlx::Error| e.to_string())?;
        conn.ping().await.map_err(|e: sqlx::Error| e.to_string())?;
        Ok(())
    }

    // --- Database / schema discovery ----------------------------------------

    async fn get_databases(&self, params: &ConnectionParams) -> Result<Vec<String>, String>;
    async fn get_schemas(&self, params: &ConnectionParams) -> Result<Vec<String>, String>;

    // --- Schema inspection ---------------------------------------------------

    async fn get_tables(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<Vec<TableInfo>, String>;

    async fn get_columns(
        &self,
        params: &ConnectionParams,
        table: &str,
        schema: Option<&str>,
    ) -> Result<Vec<TableColumn>, String>;

    async fn get_foreign_keys(
        &self,
        params: &ConnectionParams,
        table: &str,
        schema: Option<&str>,
    ) -> Result<Vec<ForeignKey>, String>;

    async fn get_indexes(
        &self,
        params: &ConnectionParams,
        table: &str,
        schema: Option<&str>,
    ) -> Result<Vec<Index>, String>;

    // --- Views --------------------------------------------------------------

    async fn get_views(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<Vec<ViewInfo>, String>;

    async fn get_view_definition(
        &self,
        params: &ConnectionParams,
        view_name: &str,
        schema: Option<&str>,
    ) -> Result<String, String>;

    async fn get_view_columns(
        &self,
        params: &ConnectionParams,
        view_name: &str,
        schema: Option<&str>,
    ) -> Result<Vec<TableColumn>, String>;

    async fn create_view(
        &self,
        params: &ConnectionParams,
        view_name: &str,
        definition: &str,
        schema: Option<&str>,
    ) -> Result<(), String>;

    async fn alter_view(
        &self,
        params: &ConnectionParams,
        view_name: &str,
        definition: &str,
        schema: Option<&str>,
    ) -> Result<(), String>;

    async fn drop_view(
        &self,
        params: &ConnectionParams,
        view_name: &str,
        schema: Option<&str>,
    ) -> Result<(), String>;

    // --- Routines -----------------------------------------------------------

    async fn get_routines(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<Vec<RoutineInfo>, String>;

    async fn get_routine_parameters(
        &self,
        params: &ConnectionParams,
        routine_name: &str,
        schema: Option<&str>,
    ) -> Result<Vec<RoutineParameter>, String>;

    async fn get_routine_definition(
        &self,
        params: &ConnectionParams,
        routine_name: &str,
        routine_type: &str,
        schema: Option<&str>,
    ) -> Result<String, String>;

    // --- Query execution ----------------------------------------------------

    async fn execute_query(
        &self,
        params: &ConnectionParams,
        query: &str,
        limit: Option<u32>,
        page: u32,
        schema: Option<&str>,
    ) -> Result<QueryResult, String>;

    /// Runs EXPLAIN (or EXPLAIN ANALYZE) on the given query and returns a
    /// parsed execution plan tree. Drivers that do not support EXPLAIN can
    /// rely on the default implementation which returns an error.
    async fn explain_query(
        &self,
        _params: &ConnectionParams,
        _query: &str,
        _analyze: bool,
        _schema: Option<&str>,
    ) -> Result<ExplainPlan, String> {
        Err("EXPLAIN not supported by this driver".into())
    }

    // --- CRUD ---------------------------------------------------------------

    async fn insert_record(
        &self,
        params: &ConnectionParams,
        table: &str,
        data: HashMap<String, serde_json::Value>,
        schema: Option<&str>,
        max_blob_size: u64,
    ) -> Result<u64, String>;

    async fn update_record(
        &self,
        params: &ConnectionParams,
        table: &str,
        pk_col: &str,
        pk_val: serde_json::Value,
        col_name: &str,
        new_val: serde_json::Value,
        schema: Option<&str>,
        max_blob_size: u64,
    ) -> Result<u64, String>;

    async fn delete_record(
        &self,
        params: &ConnectionParams,
        table: &str,
        pk_col: &str,
        pk_val: serde_json::Value,
        schema: Option<&str>,
    ) -> Result<u64, String>;

    // --- BLOB helpers (optional, built-in drivers only) ---------------------

    async fn save_blob_to_file(
        &self,
        _params: &ConnectionParams,
        _table: &str,
        _col_name: &str,
        _pk_col: &str,
        _pk_val: serde_json::Value,
        _schema: Option<&str>,
        _file_path: &str,
    ) -> Result<(), String> {
        Err("BLOB file export not supported by this driver".into())
    }

    async fn fetch_blob_as_data_url(
        &self,
        _params: &ConnectionParams,
        _table: &str,
        _col_name: &str,
        _pk_col: &str,
        _pk_val: serde_json::Value,
        _schema: Option<&str>,
    ) -> Result<String, String> {
        Err("BLOB preview not supported by this driver".into())
    }

    // --- DDL generation (SQL preview) ----------------------------------------

    async fn get_create_table_sql(
        &self,
        _table_name: &str,
        _columns: Vec<ColumnDefinition>,
        _schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        Err("DDL generation not supported".into())
    }

    async fn get_add_column_sql(
        &self,
        _table: &str,
        _column: ColumnDefinition,
        _schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        Err("DDL generation not supported".into())
    }

    async fn get_alter_column_sql(
        &self,
        _table: &str,
        _old_column: ColumnDefinition,
        _new_column: ColumnDefinition,
        _schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        Err("DDL generation not supported".into())
    }

    async fn get_create_index_sql(
        &self,
        _table: &str,
        _index_name: &str,
        _columns: Vec<String>,
        _is_unique: bool,
        _schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        Err("DDL generation not supported".into())
    }

    async fn get_create_foreign_key_sql(
        &self,
        _table: &str,
        _fk_name: &str,
        _column: &str,
        _ref_table: &str,
        _ref_column: &str,
        _on_delete: Option<&str>,
        _on_update: Option<&str>,
        _schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        Err("DDL generation not supported".into())
    }

    async fn drop_index(
        &self,
        _params: &ConnectionParams,
        _table: &str,
        _index_name: &str,
        _schema: Option<&str>,
    ) -> Result<(), String> {
        Err("Not supported".into())
    }

    async fn drop_foreign_key(
        &self,
        _params: &ConnectionParams,
        _table: &str,
        _fk_name: &str,
        _schema: Option<&str>,
    ) -> Result<(), String> {
        Err("Not supported".into())
    }

    // --- ER diagram (batch) -------------------------------------------------

    async fn get_schema_snapshot(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<Vec<TableSchema>, String>;

    async fn get_all_columns_batch(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<HashMap<String, Vec<TableColumn>>, String>;

    async fn get_all_foreign_keys_batch(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<HashMap<String, Vec<ForeignKey>>, String>;
}
