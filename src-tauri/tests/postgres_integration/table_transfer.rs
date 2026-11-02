//! "Export table to SQL" and "Import table from SQL" (#709) against a real
//! PostgreSQL server: a table exported from one schema and imported into
//! another comes back with the same values, for types whose driver-extracted
//! form would not survive (arrays, `bytea` past the preview size,
//! `timestamptz` offsets, `numeric` precision, JSON).

use std::path::Path;
use std::sync::Arc;

use crate::helpers::pg_params;
use serde_json::Value;
use tabularis_lib::application::database_transfers::DumpCancellationState;
use tabularis_lib::application::table_transfers::{
    export_table, import_table, IfTableExists, TableExportDestination, TableExportOptions,
    TableImportOptions, TableImportSource,
};
use tabularis_lib::drivers::postgres;
use tabularis_lib::export::ExportCancellationState;
use tabularis_lib::models::{ConnectionsFile, SavedConnection};
use tabularis_lib::runtime::events::NoopRuntimeEvents;
use tabularis_lib::runtime::paths::FixedRuntimePaths;
use tabularis_lib::runtime::RuntimeContext;
use tabularis_lib::table_sql::TableSqlContent;

struct NoSecrets;

impl tabularis_lib::runtime::secrets::RuntimeSecrets for NoSecrets {
    fn get(&self, _account: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    fn set(&self, _account: &str, _value: &str) -> Result<(), String> {
        Ok(())
    }

    fn delete(&self, _account: &str) -> Result<(), String> {
        Ok(())
    }
}

/// A runtime whose only saved connection, `pg`, is the test server.
fn runtime(dir: &Path) -> RuntimeContext {
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(dir.to_path_buf(), dir.to_path_buf())),
        Arc::new(NoopRuntimeEvents),
        Arc::new(NoSecrets),
    );
    let connection = SavedConnection {
        id: "pg".to_string(),
        name: "pg".to_string(),
        params: pg_params(),
        plugin_secret_keys: Vec::new(),
        group_id: None,
        sort_order: None,
        detect_json_in_text_columns: None,
        appearance: None,
        tag_ids: None,
        environment: None,
    };
    tabularis_lib::persistence::save_connections_file(
        &runtime.paths.connections_file(),
        &ConnectionsFile {
            connections: vec![connection],
            ..Default::default()
        },
    )
    .expect("save the test connection");
    runtime
}

async fn run(sql: &str) -> Vec<Vec<Value>> {
    postgres::execute_query(&pg_params(), sql, None, 1, None)
        .await
        .unwrap_or_else(|error| panic!("fixture SQL failed: {error}; SQL: {sql}"))
        .rows
}

const COLUMNS: &str = "id, customer, note, price::text, paid, at::text, meta::text, \
    encode(raw, 'hex'), tags::text, d::text";

#[tokio::test]
#[ignore]
async fn test_table_round_trips_into_another_schema() {
    require_pg!();
    tabularis_lib::drivers::registry::register_driver(postgres::PostgresDriver::new()).await;
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let source = format!("table_transfer_src_{suffix}");
    let target = format!("table_transfer_dst_{suffix}");
    run(&format!("CREATE SCHEMA {source}")).await;
    run(&format!("CREATE SCHEMA {target}")).await;
    for schema in [&source, &target] {
        run(&format!(
            "CREATE TABLE {schema}.customers (id integer PRIMARY KEY, name text)"
        ))
        .await;
        run(&format!(
            "INSERT INTO {schema}.customers VALUES (1, 'a'), (2, 'b')"
        ))
        .await;
    }
    run(&format!(
        "CREATE TABLE {source}.orders (id integer PRIMARY KEY, \
         customer integer REFERENCES {source}.customers (id), note text, \
         price numeric(10,2), paid boolean, at timestamptz, meta jsonb, raw bytea, \
         tags text[], d date)"
    ))
    .await;
    run(&format!(
        "INSERT INTO {source}.orders VALUES \
         (1, 1, E'it''s; a \\\\ back\\nslash', 12.50, true, '2026-01-02 03:04:05+00', \
          '{{\"k\": [1, \"x\"]}}', '\\xdeadbeef', ARRAY['a', 'b;c'], '2026-02-03'), \
         (2, 2, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL), \
         (3, 1, '', 0, NULL, '2026-06-01 10:00:00+05:30', '\"text\"', \
          decode(repeat('ab', 20000), 'hex'), '{{}}', NULL)"
    ))
    .await;

    let temp = tempfile::tempdir().unwrap();
    let runtime = runtime(temp.path());
    let path = temp.path().join("orders.sql");
    let exported = export_table(
        &runtime,
        &ExportCancellationState::default(),
        None,
        "pg".to_string(),
        TableExportOptions {
            table: "orders".to_string(),
            content: TableSqlContent::StructureAndData,
            schema: Some(source.clone()),
            database: None,
        },
        TableExportDestination::ServerPath(path.clone()),
    )
    .await;
    let imported = import_table(
        &runtime,
        &DumpCancellationState::default(),
        None,
        "pg".to_string(),
        TableImportSource::ServerPath(path),
        TableImportOptions {
            if_exists: IfTableExists::Fail,
            schema: Some(target.clone()),
            database: None,
        },
    )
    .await;
    let source_rows = run(&format!(
        "SELECT {COLUMNS} FROM {source}.orders ORDER BY id"
    ))
    .await;
    let target_rows = imported
        .as_ref()
        .ok()
        .map(|_| format!("SELECT {COLUMNS} FROM {target}.orders ORDER BY id"));
    let target_rows = match target_rows {
        Some(sql) => Some(run(&sql).await),
        None => None,
    };
    run(&format!("DROP SCHEMA {source} CASCADE")).await;
    run(&format!("DROP SCHEMA {target} CASCADE")).await;

    assert_eq!(exported.expect("export").rows, 3);
    assert_eq!(imported.expect("import").rows, 3);
    assert_eq!(target_rows.unwrap(), source_rows);
}
