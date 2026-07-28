//! Microsoft SQL Server driver (built-in).
//!
//! Editing is enabled for single/composite primary keys and IDENTITY tables.
//! The driver supports schema introspection, table/view DDL, foreign keys,
//! triggers, and stored-routine management.

pub mod ddl;
pub mod explain;
pub mod extract;
pub mod helpers;
pub mod introspection;
pub mod pool;
pub mod routines;
pub mod triggers;
pub mod types;
pub mod version;

use std::collections::HashMap;

use async_trait::async_trait;
use futures::TryStreamExt;

use crate::drivers::driver_trait::{
    BatchProgressFn, DatabaseDriver, DriverCapabilities, PluginManifest,
};
use crate::drivers::sqlserver::helpers::{
    bracket_quote, build_delete_composite_sql, build_update_composite_sql, qualify,
};
use crate::models::{
    BatchStatementResult, ColumnDefinition, ConnectionParams, DataTypeInfo, ExplainQueryOutput,
    ForeignKey, Index, Pagination, QueryResult, RoutineCallArg, RoutineInfo, RoutineParameter,
    TableColumn, TableInfo, TableSchema, TriggerInfo, ViewInfo,
};
use crate::pool_manager::get_sqlserver_pool;
use tiberius::ToSql;

/// Built-in SQL Server driver. Backed by `tiberius` + `deadpool`.
pub struct SqlServerDriver {
    manifest: PluginManifest,
}

impl SqlServerDriver {
    pub fn new() -> Self {
        Self {
            manifest: PluginManifest {
                id: "sqlserver".to_string(),
                name: "SQL Server".to_string(),
                version: "0.2.0".to_string(),
                description: "Microsoft SQL Server".to_string(),
                default_port: Some(1433),
                capabilities: DriverCapabilities {
                    schemas: true,
                    views: true,
                    materialized_views: false,
                    routines: true,
                    file_based: false,
                    folder_based: false,
                    single_database: false,
                    connection_string: true,
                    connection_string_example: "sqlserver://sa:password@localhost:1433/master"
                        .into(),
                    identifier_quote: "\"".into(),
                    alter_primary_key: false,
                    auto_increment_keyword: "IDENTITY(1,1)".into(),
                    serial_type: String::new(),
                    inline_pk: false,
                    alter_column: true,
                    create_foreign_keys: true,
                    no_connection_required: false,
                    manage_tables: true,
                    readonly: false,
                    triggers: true,
                    routine_management: true,
                    supports_ssl: true,
                    explain: true,
                    sql_dialect: crate::drivers::driver_trait::SqlDialect::Mssql,
                },
                is_builtin: true,
                engine: None,
                paradigms: Vec::new(),
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

/// Acquire a Tiberius client from the pool.
async fn acquire(
    params: &ConnectionParams,
) -> Result<deadpool::managed::Object<pool::BridgeManager>, String> {
    let pool = get_sqlserver_pool(params).await?;
    pool.get().await.map_err(|e| e.to_string())
}

fn empty_query_result(columns: Vec<String>) -> QueryResult {
    QueryResult {
        columns,
        rows: Vec::new(),
        affected_rows: 0,
        truncated: false,
        pagination: None,
        additional_results: None,
    }
}

async fn collect_query_results(
    mut stream: tiberius::QueryStream<'_>,
) -> Result<Vec<QueryResult>, String> {
    let mut results = Vec::new();
    let mut current: Option<QueryResult> = None;

    while let Some(item) = stream.try_next().await.map_err(|error| error.to_string())? {
        match item {
            tiberius::QueryItem::Metadata(metadata) => {
                if let Some(previous) = current.take() {
                    results.push(previous);
                }
                current = Some(empty_query_result(
                    metadata
                        .columns()
                        .iter()
                        .map(|column| column.name().to_string())
                        .collect(),
                ));
            }
            tiberius::QueryItem::Row(row) => {
                let result = current.get_or_insert_with(|| {
                    empty_query_result(
                        row.columns()
                            .iter()
                            .map(|column| column.name().to_string())
                            .collect(),
                    )
                });
                result.rows.push(
                    (0..row.columns().len())
                        .map(|index| extract::extract_value(&row, index))
                        .collect(),
                );
            }
        }
    }
    if let Some(result) = current {
        results.push(result);
    }
    Ok(results)
}

async fn execute_result_bearing_dml(
    conn: &mut pool::BridgeConnection,
    query: &str,
) -> Result<QueryResult, String> {
    const AFFECTED_COLUMN: &str = "__tabularis_affected_rows";
    let wrapped = format!("{query}\n; SELECT CAST(@@ROWCOUNT AS BIGINT) AS [{AFFECTED_COLUMN}]");
    let stream = conn
        .simple_query(wrapped)
        .await
        .map_err(|error| error.to_string())?;
    let mut results = collect_query_results(stream).await?;
    let affected = results
        .last()
        .filter(|result| result.columns == [AFFECTED_COLUMN])
        .and_then(|result| result.rows.first())
        .and_then(|row| row.first())
        .and_then(serde_json::Value::as_i64)
        .and_then(|value| u64::try_from(value).ok())
        .ok_or_else(|| {
            "SQL Server did not return affected rows for result-bearing DML".to_string()
        })?;
    results.pop();

    let mut first = if results.is_empty() {
        empty_query_result(Vec::new())
    } else {
        results.remove(0)
    };
    first.affected_rows = affected;
    if !results.is_empty() {
        first.additional_results = Some(results);
    }
    Ok(first)
}

async fn execute_on_connection(
    conn: &mut pool::BridgeConnection,
    query: &str,
    limit: Option<u32>,
    page: u32,
) -> Result<QueryResult, String> {
    let returns_result_set = helpers::query_returns_result_set(query);
    if returns_result_set && helpers::query_reports_affected_rows(query) {
        return execute_result_bearing_dml(conn, query).await;
    }
    if !returns_result_set {
        if helpers::query_reports_affected_rows(query) {
            let affected_rows = conn
                .execute(query, &[])
                .await
                .map_err(|error| error.to_string())?
                .total();
            return Ok(QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                affected_rows,
                truncated: false,
                pagination: None,
                additional_results: None,
            });
        }

        conn.simple_query(query)
            .await
            .map_err(|error| error.to_string())?
            .into_results()
            .await
            .map_err(|error| error.to_string())?;
        return Ok(empty_query_result(Vec::new()));
    }

    let pagination_limit = limit.filter(|_| helpers::query_can_be_paginated(query));
    let mut pagination = pagination_limit.map(|page_size| Pagination {
        page,
        page_size,
        total_rows: None,
        has_more: false,
    });
    let final_query = match pagination_limit {
        Some(page_size) => helpers::build_paginated_query(query, page_size, page),
        None => query.to_string(),
    };
    let stream = conn
        .simple_query(final_query)
        .await
        .map_err(|error| error.to_string())?;
    let mut results = collect_query_results(stream).await?;
    let mut first = if results.is_empty() {
        empty_query_result(Vec::new())
    } else {
        results.remove(0)
    };

    if let Some(ref mut pagination) = pagination {
        pagination.has_more = first.rows.len() > pagination.page_size as usize;
        if pagination.has_more {
            first.rows.truncate(pagination.page_size as usize);
            first.truncated = true;
        }
    }
    first.pagination = pagination;
    if !results.is_empty() {
        first.additional_results = Some(results);
    }
    Ok(first)
}

#[async_trait]
impl DatabaseDriver for SqlServerDriver {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn get_data_types(&self) -> Vec<DataTypeInfo> {
        types::get_data_types()
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

    /// URL-style connection string used by the shared frontend parser.
    fn build_connection_url(&self, params: &ConnectionParams) -> Result<String, String> {
        let host = params.host.as_deref().unwrap_or("localhost");
        let port = params.port.unwrap_or(1433);
        let db = params.database.primary();
        let user = params.username.as_deref().unwrap_or("sa");
        let pass = params.password.as_deref().unwrap_or("");
        Ok(format!(
            "sqlserver://{}:{}@{}:{}/{}",
            urlencoding::encode(user),
            urlencoding::encode(pass),
            host,
            port,
            urlencoding::encode(db),
        ))
    }

    async fn test_connection(&self, params: &ConnectionParams) -> Result<(), String> {
        let mut conn = acquire(params).await?;
        conn.simple_query("SELECT 1")
            .await
            .map_err(|e| e.to_string())?
            .into_first_result()
            .await
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    async fn get_databases(&self, params: &ConnectionParams) -> Result<Vec<String>, String> {
        let mut conn = acquire(params).await?;
        // Skip system DBs (database_id <= 4: master, tempdb, model, msdb)
        let rows = conn
            .simple_query("SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name")
            .await
            .map_err(|e| e.to_string())?
            .into_first_result()
            .await
            .map_err(|error| error.to_string())?;

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
            .into_first_result().await.map_err(|error| error.to_string())?;

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
        params: &ConnectionParams,
        view_name: &str,
        definition: &str,
        schema: Option<&str>,
    ) -> Result<(), String> {
        let sql = format!(
            "CREATE VIEW {} AS {}",
            qualify(schema, view_name),
            definition
        );
        let mut conn = acquire(params).await?;
        conn.simple_query(sql)
            .await
            .map_err(|error| format!("Failed to create view: {error}"))?
            .into_first_result()
            .await
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    async fn alter_view(
        &self,
        params: &ConnectionParams,
        view_name: &str,
        definition: &str,
        schema: Option<&str>,
    ) -> Result<(), String> {
        let sql = format!(
            "ALTER VIEW {} AS {}",
            qualify(schema, view_name),
            definition
        );
        let mut conn = acquire(params).await?;
        conn.simple_query(sql)
            .await
            .map_err(|error| format!("Failed to alter view: {error}"))?
            .into_first_result()
            .await
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    async fn drop_view(
        &self,
        params: &ConnectionParams,
        view_name: &str,
        schema: Option<&str>,
    ) -> Result<(), String> {
        let sql = format!("DROP VIEW IF EXISTS {}", qualify(schema, view_name));
        let mut conn = acquire(params).await?;
        conn.simple_query(sql)
            .await
            .map_err(|error| format!("Failed to drop view: {error}"))?
            .into_first_result()
            .await
            .map_err(|error| error.to_string())?;
        Ok(())
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
        introspection::get_routine_parameters(&mut conn, routine_name, schema.unwrap_or("dbo"))
            .await
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

    async fn build_routine_call_sql(
        &self,
        params: &ConnectionParams,
        routine_name: &str,
        routine_type: &str,
        args: &[RoutineCallArg],
        schema: Option<&str>,
    ) -> Result<String, String> {
        let parameters = if args.iter().any(|arg| {
            arg.mode.eq_ignore_ascii_case("OUT") || arg.mode.eq_ignore_ascii_case("INOUT")
        }) {
            self.get_routine_parameters(params, routine_name, schema)
                .await?
        } else {
            Vec::new()
        };
        let is_table_valued = if routine_type.eq_ignore_ascii_case("FUNCTION") {
            let mut conn = acquire(params).await?;
            introspection::is_table_valued_function(&mut conn, routine_name, schema).await?
        } else {
            false
        };
        routines::routine_call_sql(
            routine_name,
            routine_type,
            args,
            &parameters,
            is_table_valued,
            schema,
        )
    }

    async fn routine_create_template(
        &self,
        routine_type: &str,
        schema: Option<&str>,
    ) -> Result<String, String> {
        Ok(routines::routine_create_template(routine_type, schema))
    }

    async fn get_routine_edit_script(
        &self,
        params: &ConnectionParams,
        routine_name: &str,
        routine_type: &str,
        schema: Option<&str>,
    ) -> Result<String, String> {
        let definition = self
            .get_routine_definition(params, routine_name, routine_type, schema)
            .await?;
        routines::routine_edit_script(&definition)
    }

    async fn drop_routine(
        &self,
        params: &ConnectionParams,
        routine_name: &str,
        routine_type: &str,
        schema: Option<&str>,
    ) -> Result<(), String> {
        let sql = routines::drop_routine_sql(routine_name, routine_type, schema);
        self.execute_query(params, &sql, None, 1, schema)
            .await
            .map(|_| ())
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
        let mut conn = acquire(params).await?;
        execute_on_connection(&mut conn, query, limit, page).await
    }

    async fn execute_batch(
        &self,
        params: &ConnectionParams,
        queries: &[String],
        limit: Option<u32>,
        page: u32,
        _schema: Option<&str>,
        on_progress: Option<&BatchProgressFn>,
    ) -> Result<Vec<BatchStatementResult>, String> {
        let mut conn = acquire(params).await?;
        let mut results = Vec::with_capacity(queries.len());
        for (index, query) in queries.iter().enumerate() {
            let start = std::time::Instant::now();
            let outcome = execute_on_connection(&mut conn, query, limit, page).await;
            let result = BatchStatementResult::from_outcome(start, outcome);
            if let Some(callback) = on_progress {
                callback(index, &result);
            }
            results.push(result);
        }
        Ok(results)
    }

    async fn explain_query(
        &self,
        params: &ConnectionParams,
        query: &str,
        analyze: bool,
        _schema: Option<&str>,
    ) -> Result<ExplainQueryOutput, String> {
        let mut conn = acquire(params).await?;
        explain::explain_query(&mut conn, query, analyze).await
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
            return Err("SQL Server: INSERT requires at least one column/value pair".to_string());
        }

        // Acquire the connection up-front; both the identity probe and the
        // actual INSERT reuse it so the IDENTITY_INSERT batch and any error
        // recovery happen on the same session.
        let mut conn = acquire(params).await?;

        let identity_col = introspection::detect_identity_column(&mut conn, table, schema).await?;

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

        // Map each JSON value to a typed Tiberius parameter. Owned boxes live
        // for the duration of the call so the borrowed `&dyn ToSql` slice is
        // valid.
        let owned_params: Vec<Box<dyn tiberius::ToSql>> = columns
            .iter()
            .map(|column| helpers::value_to_sql_param(&data[column]))
            .collect::<Result<_, _>>()?;
        let params_slice: Vec<&dyn tiberius::ToSql> =
            owned_params.iter().map(|b| b.as_ref()).collect();

        let exec = conn
            .execute(&sql, &params_slice)
            .await
            .map_err(|e| e.to_string())?;
        Ok(exec.total())
    }

    async fn update_record(
        &self,
        params: &ConnectionParams,
        table: &str,
        pk_map: &HashMap<String, serde_json::Value>,
        col_name: &str,
        new_val: serde_json::Value,
        schema: Option<&str>,
        _max_blob_size: u64,
    ) -> Result<u64, String> {
        let mut primary_keys: Vec<_> = pk_map.iter().collect();
        primary_keys.sort_by(|(left, _), (right, _)| left.cmp(right));
        let pk_columns: Vec<String> = primary_keys
            .iter()
            .map(|(column, _)| (*column).clone())
            .collect();
        let sql =
            build_update_composite_sql(schema, table, col_name, &pk_columns).ok_or_else(|| {
                "SQL Server: UPDATE requires at least one primary-key column".to_string()
            })?;

        let mut owned_params = Vec::with_capacity(primary_keys.len() + 1);
        owned_params.push(helpers::value_to_sql_param(&new_val)?);
        for (_, value) in primary_keys {
            owned_params.push(helpers::value_to_sql_param(value)?);
        }
        let bound: Vec<&dyn ToSql> = owned_params.iter().map(|value| value.as_ref()).collect();

        let mut conn = acquire(params).await?;
        let result = conn
            .execute(sql, &bound)
            .await
            .map_err(|error| error.to_string())?;
        Ok(result.total())
    }

    async fn delete_record(
        &self,
        params: &ConnectionParams,
        table: &str,
        pk_map: &HashMap<String, serde_json::Value>,
        schema: Option<&str>,
    ) -> Result<u64, String> {
        let mut primary_keys: Vec<_> = pk_map.iter().collect();
        primary_keys.sort_by(|(left, _), (right, _)| left.cmp(right));
        let pk_columns: Vec<String> = primary_keys
            .iter()
            .map(|(column, _)| (*column).clone())
            .collect();
        let sql = build_delete_composite_sql(schema, table, &pk_columns).ok_or_else(|| {
            "SQL Server: DELETE requires at least one primary-key column".to_string()
        })?;

        let owned_params: Vec<Box<dyn ToSql>> = primary_keys
            .into_iter()
            .map(|(_, value)| helpers::value_to_sql_param(value))
            .collect::<Result<_, _>>()?;
        let bound: Vec<&dyn ToSql> = owned_params.iter().map(|value| value.as_ref()).collect();

        let mut conn = acquire(params).await?;
        let result = conn
            .execute(sql, &bound)
            .await
            .map_err(|error| error.to_string())?;
        Ok(result.total())
    }

    // --- DDL generation -----------------------------------------------------

    async fn get_create_table_sql(
        &self,
        table_name: &str,
        columns: Vec<ColumnDefinition>,
        schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let mut col_defs = Vec::new();
        let mut pk_cols = Vec::new();

        for column in &columns {
            col_defs.push(helpers::render_column_definition(column, false));
            if column.is_pk {
                pk_cols.push(bracket_quote(&column.name));
            }
        }

        if !pk_cols.is_empty() {
            col_defs.push(format!("PRIMARY KEY ({})", pk_cols.join(", ")));
        }

        let table_ref = qualify(schema, table_name);
        Ok(vec![format!(
            "CREATE TABLE {} (\n  {}\n)",
            table_ref,
            col_defs.join(",\n  ")
        )])
    }

    async fn get_add_column_sql(
        &self,
        table: &str,
        column: ColumnDefinition,
        schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        Ok(vec![format!(
            "ALTER TABLE {} ADD {}",
            qualify(schema, table),
            helpers::render_column_definition(&column, true),
        )])
    }

    async fn get_alter_column_sql(
        &self,
        table: &str,
        old_column: ColumnDefinition,
        new_column: ColumnDefinition,
        schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        ddl::alter_column_sql(table, &old_column, &new_column, schema)
    }

    async fn get_create_index_sql(
        &self,
        table: &str,
        index_name: &str,
        columns: Vec<String>,
        is_unique: bool,
        schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        if columns.is_empty() {
            return Err("SQL Server: CREATE INDEX requires at least one column".into());
        }
        let columns = columns
            .iter()
            .map(|column| bracket_quote(column))
            .collect::<Vec<_>>()
            .join(", ");
        let unique = if is_unique { "UNIQUE " } else { "" };
        Ok(vec![format!(
            "CREATE {unique}INDEX {} ON {} ({columns})",
            bracket_quote(index_name),
            qualify(schema, table),
        )])
    }

    async fn get_create_foreign_key_sql(
        &self,
        table: &str,
        fk_name: &str,
        column: &str,
        ref_table: &str,
        ref_column: &str,
        on_delete: Option<&str>,
        on_update: Option<&str>,
        schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        ddl::create_foreign_key_sql(
            table, fk_name, column, ref_table, ref_column, on_delete, on_update, schema,
        )
    }

    async fn drop_index(
        &self,
        params: &ConnectionParams,
        table: &str,
        index_name: &str,
        schema: Option<&str>,
    ) -> Result<(), String> {
        let sql = format!(
            "DROP INDEX {} ON {}",
            bracket_quote(index_name),
            qualify(schema, table),
        );
        let mut conn = acquire(params).await?;
        conn.execute(sql, &[])
            .await
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    async fn drop_foreign_key(
        &self,
        params: &ConnectionParams,
        table: &str,
        fk_name: &str,
        schema: Option<&str>,
    ) -> Result<(), String> {
        let sql = format!(
            "ALTER TABLE {} DROP CONSTRAINT {}",
            qualify(schema, table),
            bracket_quote(fk_name),
        );
        let mut conn = acquire(params).await?;
        conn.execute(sql, &[])
            .await
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    // --- Triggers -----------------------------------------------------------

    async fn get_triggers(
        &self,
        params: &ConnectionParams,
        schema: Option<&str>,
    ) -> Result<Vec<TriggerInfo>, String> {
        let mut conn = acquire(params).await?;
        triggers::get_triggers(&mut conn, schema).await
    }

    async fn get_trigger_definition(
        &self,
        params: &ConnectionParams,
        trigger_name: &str,
        _table_name: &str,
        schema: Option<&str>,
    ) -> Result<String, String> {
        let mut conn = acquire(params).await?;
        introspection::get_module_definition(&mut conn, trigger_name, schema).await
    }

    async fn create_trigger(
        &self,
        params: &ConnectionParams,
        trigger_sql: &str,
        schema: Option<&str>,
    ) -> Result<(), String> {
        self.execute_query(params, trigger_sql, None, 1, schema)
            .await
            .map(|_| ())
    }

    async fn drop_trigger(
        &self,
        params: &ConnectionParams,
        trigger_name: &str,
        _table_name: &str,
        schema: Option<&str>,
    ) -> Result<(), String> {
        let sql = triggers::drop_trigger_sql(trigger_name, schema);
        self.execute_query(params, &sql, None, 1, schema)
            .await
            .map(|_| ())
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
mod tests;
