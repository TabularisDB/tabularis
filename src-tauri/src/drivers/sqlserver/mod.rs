//! Microsoft SQL Server driver (built-in).
//!
//! Phase 1 scope: read-only preview. `DriverCapabilities.readonly = true`
//! keeps the UI from calling CRUD routes; the trait still requires the methods
//! to exist, so the unimplemented ones return a descriptive error until later
//! days fill them in.

pub mod extract;
pub mod helpers;
pub mod introspection;
pub mod pool;
pub mod version;

use std::collections::HashMap;

use async_trait::async_trait;

use crate::drivers::driver_trait::{
    DatabaseDriver, DriverCapabilities, PluginManifest,
};
use crate::drivers::sqlserver::helpers::{
    build_delete_composite_sql, build_update_composite_sql,
};
use crate::models::{
    ConnectionParams, DataTypeInfo, ForeignKey, Index, Pagination, QueryResult, RoutineInfo,
    RoutineParameter, TableColumn, TableInfo, TableSchema, ViewInfo,
};
use crate::pool_manager::get_sqlserver_pool;
use mssql_tiberius_bridge::ToSql;

/// Built-in SQL Server driver. Backed by `mssql-tiberius-bridge` + `deadpool`.
pub struct SqlServerDriver {
    manifest: PluginManifest,
}

impl SqlServerDriver {
    pub fn new() -> Self {
        Self {
            manifest: PluginManifest {
                id: "sqlserver".to_string(),
                name: "SQL Server".to_string(),
                version: "0.1.0".to_string(),
                description: "Microsoft SQL Server (read-only preview)".to_string(),
                default_port: Some(1433),
                capabilities: DriverCapabilities {
                    schemas: true,
                    views: true,
                    routines: true,
                    file_based: false,
                    folder_based: false,
                    connection_string: true,
                    connection_string_example:
                        "server=localhost,1433;database=master;user id=sa;password=...;encrypt=true"
                            .into(),
                    identifier_quote: "\"".into(),
                    alter_primary_key: true,
                    auto_increment_keyword: "IDENTITY(1,1)".into(),
                    serial_type: String::new(),
                    inline_pk: false,
                    alter_column: false,
                    create_foreign_keys: false,
                    no_connection_required: false,
                    manage_tables: false,
                    readonly: true,
                },
                is_builtin: true,
                default_username: "sa".to_string(),
                color: "#cc2927".to_string(),
                icon: "database".to_string(),
                settings: vec![],
                ui_extensions: None,
            },
        }
    }
}

impl Default for SqlServerDriver {
    fn default() -> Self {
        Self::new()
    }
}

/// Acquire a bridge client from the pool.
async fn acquire(
    params: &ConnectionParams,
) -> Result<deadpool::managed::Object<pool::BridgeManager>, String> {
    let pool = get_sqlserver_pool(params).await?;
    pool.get().await.map_err(|e| e.to_string())
}

#[async_trait]
impl DatabaseDriver for SqlServerDriver {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn get_data_types(&self) -> Vec<DataTypeInfo> {
        // Populated in Phase 1 Day 5+; empty vec keeps clipboard-import UI
        // inert for now (the readonly flag already hides editing surfaces).
        Vec::new()
    }

    fn map_inferred_type(&self, kind: &str) -> String {
        match kind {
            "TEXT" => "NVARCHAR(MAX)".into(),
            "INTEGER" => "INT".into(),
            "REAL" => "FLOAT".into(),
            "BOOLEAN" => "BIT".into(),
            "DATE" => "DATE".into(),
            "DATETIME" => "DATETIME2".into(),
            "JSON" => "NVARCHAR(MAX)".into(),
            other => other.into(),
        }
    }

    /// ADO.NET-style connection string. Not used internally (we use the pool),
    /// kept for UI preview + copy-to-clipboard.
    fn build_connection_url(&self, params: &ConnectionParams) -> Result<String, String> {
        let host = params.host.as_deref().unwrap_or("localhost");
        let port = params.port.unwrap_or(1433);
        let db = params.database.primary();
        let user = params.username.as_deref().unwrap_or("");
        let pass = params.password.as_deref().unwrap_or("");
        Ok(format!(
            "Server={host},{port};Database={db};User Id={user};Password={pass};TrustServerCertificate=true;Encrypt=true"
        ))
    }

    async fn test_connection(&self, params: &ConnectionParams) -> Result<(), String> {
        let mut conn = acquire(params).await?;
        conn.simple_query("SELECT 1")
            .await
            .map_err(|e| e.to_string())?
            .into_first_result();
        Ok(())
    }

    async fn get_databases(&self, params: &ConnectionParams) -> Result<Vec<String>, String> {
        let mut conn = acquire(params).await?;
        // Skip system DBs (database_id <= 4: master, tempdb, model, msdb)
        let rows = conn
            .simple_query(
                "SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name",
            )
            .await
            .map_err(|e| e.to_string())?
            .into_first_result();

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            if let Some(name) = row.get::<&str, _>(0) {
                out.push(name.to_string());
            }
        }
        Ok(out)
    }

    async fn get_schemas(&self, params: &ConnectionParams) -> Result<Vec<String>, String> {
        let mut conn = acquire(params).await?;
        // User schemas: schema_id < 16384 excludes built-in (sys, INFORMATION_SCHEMA, guest, ...).
        // We also exclude the noise schemas explicitly; `dbo` is the default owner and must stay.
        let rows = conn
            .simple_query(
                "SELECT name FROM sys.schemas \
                 WHERE schema_id < 16384 \
                   AND name NOT IN ('sys','INFORMATION_SCHEMA','guest','db_owner','db_accessadmin','db_securityadmin','db_ddladmin','db_backupoperator','db_datareader','db_datawriter','db_denydatareader','db_denydatawriter') \
                 ORDER BY name",
            )
            .await
            .map_err(|e| e.to_string())?
            .into_first_result();

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            if let Some(name) = row.get::<&str, _>(0) {
                out.push(name.to_string());
            }
        }
        Ok(out)
    }

    // --- Schema inspection (Day 4) -----------------------------------------

    async fn get_tables(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<Vec<TableInfo>, String> {
        let mut conn = acquire(params).await?;
        introspection::get_tables(&mut conn, schema.unwrap_or("dbo")).await
    }

    async fn get_columns(
        &self,
        params: &ConnectionParams,
        table: &str,
        schema: Option<&str>,
    ) -> Result<Vec<TableColumn>, String> {
        let mut conn = acquire(params).await?;
        introspection::get_columns(&mut conn, table, schema).await
    }

    async fn get_foreign_keys(
        &self,
        params: &ConnectionParams,
        table: &str,
        schema: Option<&str>,
    ) -> Result<Vec<ForeignKey>, String> {
        let mut conn = acquire(params).await?;
        introspection::get_foreign_keys(&mut conn, table, schema).await
    }

    async fn get_indexes(
        &self,
        params: &ConnectionParams,
        table: &str,
        schema: Option<&str>,
    ) -> Result<Vec<Index>, String> {
        let mut conn = acquire(params).await?;
        introspection::get_indexes(&mut conn, table, schema).await
    }

    // --- Views --------------------------------------------------------------

    async fn get_views(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<Vec<ViewInfo>, String> {
        let mut conn = acquire(params).await?;
        introspection::get_views(&mut conn, schema.unwrap_or("dbo")).await
    }

    async fn get_view_definition(
        &self,
        params: &ConnectionParams,
        view_name: &str,
        schema: Option<&str>,
    ) -> Result<String, String> {
        let mut conn = acquire(params).await?;
        introspection::get_module_definition(&mut conn, view_name, schema).await
    }

    async fn get_view_columns(
        &self,
        params: &ConnectionParams,
        view_name: &str,
        schema: Option<&str>,
    ) -> Result<Vec<TableColumn>, String> {
        // `sys.columns` + `sys.types` work identically for views, so we reuse
        // the table introspection. The PK sub-query returns 0 for views
        // (no primary key on views), which is the correct behaviour.
        let mut conn = acquire(params).await?;
        introspection::get_columns(&mut conn, view_name, schema).await
    }

    async fn create_view(
        &self,
        _params: &ConnectionParams,
        _view_name: &str,
        _definition: &str,
        _schema: Option<&str>,
    ) -> Result<(), String> {
        Err("SQL Server: view creation disabled in Phase 1 read-only preview".into())
    }

    async fn alter_view(
        &self,
        _params: &ConnectionParams,
        _view_name: &str,
        _definition: &str,
        _schema: Option<&str>,
    ) -> Result<(), String> {
        Err("SQL Server: view alter disabled in Phase 1 read-only preview".into())
    }

    async fn drop_view(
        &self,
        _params: &ConnectionParams,
        _view_name: &str,
        _schema: Option<&str>,
    ) -> Result<(), String> {
        Err("SQL Server: view drop disabled in Phase 1 read-only preview".into())
    }

    // --- Routines -----------------------------------------------------------

    async fn get_routines(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<Vec<RoutineInfo>, String> {
        let mut conn = acquire(params).await?;
        introspection::get_routines(&mut conn, schema.unwrap_or("dbo")).await
    }

    async fn get_routine_parameters(
        &self,
        params: &ConnectionParams,
        routine_name: &str,
        schema: Option<&str>,
    ) -> Result<Vec<RoutineParameter>, String> {
        let mut conn = acquire(params).await?;
        introspection::get_routine_parameters(&mut conn, routine_name, schema.unwrap_or("dbo")).await
    }

    async fn get_routine_definition(
        &self,
        params: &ConnectionParams,
        routine_name: &str,
        _routine_type: &str,
        schema: Option<&str>,
    ) -> Result<String, String> {
        let mut conn = acquire(params).await?;
        introspection::get_module_definition(&mut conn, routine_name, schema).await
    }

    // --- Query execution ---------------------------------------------------

    async fn execute_query(
        &self,
        params: &ConnectionParams,
        query: &str,
        limit: Option<u32>,
        page: u32,
        _schema: Option<&str>,
    ) -> Result<QueryResult, String> {
        use crate::drivers::common::{
            build_paginated_query_dialect, is_select_query, PaginationDialect,
        };

        let is_select = is_select_query(query);
        let mut pagination_info: Option<Pagination> = None;
        let final_query: String;

        if is_select && limit.is_some() {
            let l = limit.unwrap();
            final_query =
                build_paginated_query_dialect(query, l, page, PaginationDialect::OffsetFetch);
            pagination_info = Some(Pagination {
                page,
                page_size: l,
                total_rows: None,
                has_more: false, // filled after we know the row count
            });
        } else {
            final_query = query.to_string();
        }

        let mut conn = acquire(params).await?;
        let stream = conn
            .simple_query(final_query)
            .await
            .map_err(|e| e.to_string())?;
        let rows = stream
            .into_first_result();

        let columns: Vec<String> = rows
            .first()
            .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
            .unwrap_or_default();

        let mut json_rows: Vec<Vec<serde_json::Value>> = rows
            .iter()
            .map(|r| {
                (0..r.columns().len())
                    .map(|i| extract::extract_value(r, i))
                    .collect()
            })
            .collect();

        let mut truncated = false;
        if let Some(ref mut p) = pagination_info {
            let has_more = json_rows.len() > p.page_size as usize;
            if has_more {
                json_rows.truncate(p.page_size as usize);
            }
            p.has_more = has_more;
            truncated = has_more;
        }

        Ok(QueryResult {
            columns,
            rows: json_rows,
            affected_rows: 0,
            truncated,
            pagination: pagination_info,
        })
    }

    // --- CRUD ----------------------------------------------------------------

    async fn insert_record(
        &self,
        params: &ConnectionParams,
        table: &str,
        data: HashMap<String, serde_json::Value>,
        schema: Option<&str>,
        _max_blob_size: u64,
    ) -> Result<u64, String> {
        if data.is_empty() {
            return Err(
                "SQL Server: INSERT requires at least one column/value pair"
                    .to_string(),
            );
        }

        // Acquire the connection up-front; both the identity probe and the
        // actual INSERT reuse it so the IDENTITY_INSERT batch and any error
        // recovery happen on the same session.
        let mut conn = acquire(params).await?;

        let identity_col =
            introspection::detect_identity_column(&mut conn, table, schema).await?;

        // Deterministic column order keeps the SQL stable for tests and for
        // SQL Server's plan cache (sp_executesql keys on the full text).
        let mut columns: Vec<String> = data.keys().cloned().collect();
        columns.sort();

        let needs_identity_insert = identity_col
            .as_ref()
            .map(|id| columns.iter().any(|c| c.eq_ignore_ascii_case(id)))
            .unwrap_or(false);

        let qualified = helpers::qualify(schema, table);
        let sql = helpers::build_insert_sql(
            &qualified,
            &columns,
            if needs_identity_insert {
                Some(qualified.as_str())
            } else {
                None
            },
        );

        // Map each `serde_json::Value` to a typed bridge parameter so that
        // primitives bind as `bit`/`bigint`/`float`/`nvarchar` instead of
        // the JSON-stringified `NVARCHAR(4000)` the bridge's blanket
        // `ToSql for Value` would produce. Owned boxes live for the
        // duration of the call so the borrowed `&dyn ToSql` slice is valid.
        let owned_params: Vec<Box<dyn mssql_tiberius_bridge::ToSql>> = columns
            .iter()
            .map(|c| helpers::value_to_sql_param(&data[c]))
            .collect();
        let params_slice: Vec<&dyn mssql_tiberius_bridge::ToSql> =
            owned_params.iter().map(|b| b.as_ref()).collect();

        let exec = conn
            .execute(&sql, &params_slice)
            .await
            .map_err(|e| e.to_string())?;
        // Bridge preview.3 returns 0 for DML row counts (mssql-tds doesn't
        // expose DONE token row counts yet — bridge issue #1). Callers must
        // verify success via a follow-up SELECT rather than this count.
        Ok(exec.total())
    }

    async fn update_record(
        &self,
        _params: &ConnectionParams,
        _table: &str,
        _pk_col: &str,
        _pk_val: serde_json::Value,
        _col_name: &str,
        _new_val: serde_json::Value,
        _schema: Option<&str>,
        _max_blob_size: u64,
    ) -> Result<u64, String> {
        Err("SQL Server: UPDATE disabled in Phase 1 read-only preview".into())
    }

    async fn delete_record(
        &self,
        _params: &ConnectionParams,
        _table: &str,
        _pk_col: &str,
        _pk_val: serde_json::Value,
        _schema: Option<&str>,
    ) -> Result<u64, String> {
        Err("SQL Server: DELETE disabled in Phase 1 read-only preview".into())
    }

    // --- CRUD: composite primary keys (issue #145) -------------------------
    //
    // Phase 1's single-key `delete_record` / `update_record` remain stubbed
    // out behind `readonly = true`. The composite variants below are the new
    // entry points the Tauri commands route to when `pk_cols` / `pk_vals` are
    // supplied (any arity, including length 1). They do all the work
    // themselves rather than delegating to the legacy single-key methods, so
    // they're independent of the Phase 1 stubs.
    //
    // Row counts: `mssql-tiberius-bridge` currently returns 0 affected rows
    // for plain DML (upstream issue #1). We surface that as-is — callers
    // treat a successful `Ok(_)` as confirmation the statement executed; the
    // returned count is informational only on SQL Server until the bridge
    // exposes DONE-token row counts.

    async fn delete_record_composite(
        &self,
        params: &ConnectionParams,
        table: &str,
        pk_cols: &[String],
        pk_vals: Vec<serde_json::Value>,
        schema: Option<&str>,
    ) -> Result<u64, String> {
        if pk_cols.is_empty() {
            return Err("delete_record_composite: pk_cols is empty".into());
        }
        if pk_cols.len() != pk_vals.len() {
            return Err(format!(
                "delete_record_composite: pk_cols ({}) and pk_vals ({}) length mismatch",
                pk_cols.len(),
                pk_vals.len()
            ));
        }
        let sql = build_delete_composite_sql(schema, table, pk_cols)
            .ok_or_else(|| "delete_record_composite: failed to build SQL".to_string())?;

        let bound: Vec<&dyn ToSql> = pk_vals.iter().map(|v| v as &dyn ToSql).collect();

        let mut conn = acquire(params).await?;
        let result = conn
            .execute(sql, &bound)
            .await
            .map_err(|e| e.to_string())?;
        Ok(result.total())
    }

    async fn update_record_composite(
        &self,
        params: &ConnectionParams,
        table: &str,
        pk_cols: &[String],
        pk_vals: Vec<serde_json::Value>,
        col_name: &str,
        new_val: serde_json::Value,
        schema: Option<&str>,
        _max_blob_size: u64,
    ) -> Result<u64, String> {
        if pk_cols.is_empty() {
            return Err("update_record_composite: pk_cols is empty".into());
        }
        if pk_cols.len() != pk_vals.len() {
            return Err(format!(
                "update_record_composite: pk_cols ({}) and pk_vals ({}) length mismatch",
                pk_cols.len(),
                pk_vals.len()
            ));
        }
        let sql = build_update_composite_sql(schema, table, col_name, pk_cols)
            .ok_or_else(|| "update_record_composite: failed to build SQL".to_string())?;

        // Parameter order matches `build_update_composite_sql`: the new value
        // is `@P1`, the PK values bind to `@P2`..`@P{n+1}`.
        let bound: Vec<&dyn ToSql> = std::iter::once(&new_val as &dyn ToSql)
            .chain(pk_vals.iter().map(|v| v as &dyn ToSql))
            .collect();

        let mut conn = acquire(params).await?;
        let result = conn
            .execute(sql, &bound)
            .await
            .map_err(|e| e.to_string())?;
        Ok(result.total())
    }

    // --- ER diagram batch ---------------------------------------------------

    async fn get_schema_snapshot(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<Vec<TableSchema>, String> {
        let mut conn = acquire(params).await?;
        introspection::get_schema_snapshot(&mut conn, schema.unwrap_or("dbo")).await
    }

    async fn get_all_columns_batch(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<HashMap<String, Vec<TableColumn>>, String> {
        let mut conn = acquire(params).await?;
        introspection::get_all_columns_batch(&mut conn, schema.unwrap_or("dbo")).await
    }

    async fn get_all_foreign_keys_batch(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<HashMap<String, Vec<ForeignKey>>, String> {
        let mut conn = acquire(params).await?;
        introspection::get_all_foreign_keys_batch(&mut conn, schema.unwrap_or("dbo")).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::DatabaseSelection;

    fn make_params(host: Option<&str>, port: Option<u16>, db: &str) -> ConnectionParams {
        ConnectionParams {
            driver: "sqlserver".into(),
            host: host.map(String::from),
            port,
            username: Some("sa".into()),
            password: Some("Strong!Pass123".into()),
            database: DatabaseSelection::Single(db.into()),
            ssl_mode: None,
            ssl_ca: None,
            ssl_cert: None,
            ssl_key: None,
            ssh_enabled: None,
            ssh_connection_id: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_password: None,
            ssh_key_file: None,
            ssh_key_passphrase: None,
            save_in_keychain: None,
            connection_id: None,
            ..Default::default()
        }
    }

    #[test]
    fn manifest_has_phase1_capabilities() {
        let drv = SqlServerDriver::new();
        let m = drv.manifest();
        assert_eq!(m.id, "sqlserver");
        assert_eq!(m.default_port, Some(1433));
        assert!(m.is_builtin);
        assert!(m.capabilities.readonly, "Phase 1 must ship readonly");
        assert!(
            !m.capabilities.manage_tables,
            "Phase 1 must hide CREATE TABLE UI"
        );
        assert!(m.capabilities.schemas);
        assert!(m.capabilities.views);
        assert!(m.capabilities.routines);
        assert_eq!(m.capabilities.auto_increment_keyword, "IDENTITY(1,1)");
        assert_eq!(m.capabilities.identifier_quote, "\"");
    }

    #[test]
    fn build_connection_url_emits_ado_net_format() {
        let drv = SqlServerDriver::new();
        let params = make_params(Some("db.internal"), Some(1445), "app");
        let url = drv.build_connection_url(&params).expect("builds");
        assert!(url.starts_with("Server=db.internal,1445;"), "got {}", url);
        assert!(url.contains("Database=app;"));
        assert!(url.contains("User Id=sa;"));
        assert!(url.contains("Password=Strong!Pass123;"));
        assert!(url.contains("TrustServerCertificate=true"));
    }

    #[test]
    fn build_connection_url_uses_defaults_when_missing() {
        let drv = SqlServerDriver::new();
        let mut params = make_params(None, None, "master");
        params.username = None;
        params.password = None;
        let url = drv.build_connection_url(&params).expect("builds");
        assert!(url.starts_with("Server=localhost,1433;"), "got {}", url);
        assert!(url.contains("Database=master;"));
        assert!(url.contains("User Id=;"));
        assert!(url.contains("Password=;"));
    }

    #[test]
    fn map_inferred_type_covers_known_kinds() {
        let drv = SqlServerDriver::new();
        assert_eq!(drv.map_inferred_type("TEXT"), "NVARCHAR(MAX)");
        assert_eq!(drv.map_inferred_type("INTEGER"), "INT");
        assert_eq!(drv.map_inferred_type("REAL"), "FLOAT");
        assert_eq!(drv.map_inferred_type("BOOLEAN"), "BIT");
        assert_eq!(drv.map_inferred_type("DATE"), "DATE");
        assert_eq!(drv.map_inferred_type("DATETIME"), "DATETIME2");
        assert_eq!(drv.map_inferred_type("JSON"), "NVARCHAR(MAX)");
    }

    #[test]
    fn map_inferred_type_passes_unknown_through() {
        let drv = SqlServerDriver::new();
        assert_eq!(drv.map_inferred_type("UUID"), "UUID");
        assert_eq!(drv.map_inferred_type("anything-custom"), "anything-custom");
    }

    #[test]
    fn get_data_types_empty_in_phase1() {
        // Phase 1 is read-only; clipboard-import types are populated in Phase 2.
        let drv = SqlServerDriver::new();
        assert!(drv.get_data_types().is_empty());
    }

    #[tokio::test]
    async fn write_operations_error_out_in_phase1() {
        let drv = SqlServerDriver::new();
        let params = make_params(Some("localhost"), Some(1433), "master");

        // `insert_record` is now wired up (issue #147) so it no longer
        // returns the Phase 1 "read-only" string. It exercises a real
        // connection path which fails fast in unit tests; we assert only
        // that the empty-data validation still rejects callers before any
        // I/O happens.
        let insert_err = drv
            .insert_record(&params, "t", HashMap::new(), None, 0)
            .await
            .expect_err("empty insert must be rejected");
        assert!(insert_err.contains("at least one column"));

        let delete_err = drv
            .delete_record(&params, "t", "id", serde_json::json!(1), None)
            .await
            .expect_err("delete must be blocked");
        assert!(delete_err.contains("read-only"));

        let create_view_err = drv
            .create_view(&params, "v", "SELECT 1", None)
            .await
            .expect_err("create_view must be blocked");
        assert!(create_view_err.contains("read-only"));
    }

    // --- Composite-PK input validation (issue #145) ------------------------
    //
    // These exercise the override's preconditions without talking to a live
    // server. The actual round-trip behaviour (SQL execution + tiberius
    // parameter binding) is covered by the unit tests for the SQL builders
    // and value-to-param helper in `helpers.rs`.

    #[tokio::test]
    async fn delete_composite_rejects_empty_pk_cols() {
        let drv = SqlServerDriver::new();
        let params = make_params(Some("localhost"), Some(1433), "master");
        let err = drv
            .delete_record_composite(&params, "Users", &[], Vec::new(), None)
            .await
            .expect_err("empty pk_cols must error before touching the network");
        assert!(err.to_lowercase().contains("empty"), "got {err}");
    }

    #[tokio::test]
    async fn delete_composite_rejects_length_mismatch() {
        let drv = SqlServerDriver::new();
        let params = make_params(Some("localhost"), Some(1433), "master");
        let err = drv
            .delete_record_composite(
                &params,
                "Users",
                &["a".to_string(), "b".to_string()],
                vec![serde_json::json!(1)],
                None,
            )
            .await
            .expect_err("length mismatch must error before touching the network");
        assert!(err.contains("length mismatch"), "got {err}");
    }

    #[tokio::test]
    async fn update_composite_rejects_empty_pk_cols() {
        let drv = SqlServerDriver::new();
        let params = make_params(Some("localhost"), Some(1433), "master");
        let err = drv
            .update_record_composite(
                &params,
                "Users",
                &[],
                Vec::new(),
                "email",
                serde_json::json!("x@y"),
                None,
                1024 * 1024,
            )
            .await
            .expect_err("empty pk_cols must error before touching the network");
        assert!(err.to_lowercase().contains("empty"), "got {err}");
    }

    #[tokio::test]
    async fn update_composite_rejects_length_mismatch() {
        let drv = SqlServerDriver::new();
        let params = make_params(Some("localhost"), Some(1433), "master");
        let err = drv
            .update_record_composite(
                &params,
                "Users",
                &["a".to_string(), "b".to_string()],
                vec![serde_json::json!(1)],
                "email",
                serde_json::json!("x@y"),
                None,
                1024 * 1024,
            )
            .await
            .expect_err("length mismatch must error before touching the network");
        assert!(err.contains("length mismatch"), "got {err}");
    }
}

