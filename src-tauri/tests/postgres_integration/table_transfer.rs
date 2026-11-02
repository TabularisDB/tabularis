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
        "CREATE INDEX orders_note ON {source}.orders (note)"
    ))
    .await;
    run(&format!(
        "CREATE UNIQUE INDEX orders_customer ON {source}.orders (customer, id) WHERE paid"
    ))
    .await;
    run(&format!(
        "INSERT INTO {source}.orders VALUES \
         (1, 1, E'it''s; a \\\\ back\\nslash', 12.50, true, '2026-01-02 03:04:05+00', \
          '{{\"k\": [1, \"x\"]}}', '\\xdeadbeef', ARRAY['a', 'b;c'], '2026-02-03'), \
         (2, 2, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL), \
         (3, 1, '', 0, NULL, '2026-06-01 10:00:00+05:30', '\"text\"', \
          decode(repeat('ab', 20000), 'hex'), '{{}}', NULL), \
         (4, 2, 'caf\u{e9} \u{1f600} \u{4e2d}\u{6587}', NULL, NULL, NULL, NULL, NULL, \
          ARRAY['\u{1f600}', NULL], NULL)"
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
    let indexes = |schema: &str| {
        format!(
            "SELECT indexname, replace(indexdef, '{schema}.', '') FROM pg_indexes \
             WHERE schemaname = '{schema}' AND tablename = 'orders' ORDER BY indexname"
        )
    };
    let source_indexes = run(&indexes(&source)).await;
    let target_indexes = run(&indexes(&target)).await;
    run(&format!("DROP SCHEMA {source} CASCADE")).await;
    run(&format!("DROP SCHEMA {target} CASCADE")).await;

    assert_eq!(exported.expect("export").rows, 4);
    assert_eq!(imported.expect("import").rows, 4);
    assert_eq!(target_rows.unwrap(), source_rows);
    assert_eq!(source_indexes.len(), 3, "the primary key and two indexes");
    assert_eq!(target_indexes, source_indexes);
}

/// Exports `{source}.{table}` and imports it into `target`.
async fn round_trip(table: &str, source: &str, target: &str) -> Result<u64, String> {
    round_trip_file(table, source, target)
        .await
        .map(|(rows, _)| rows)
}

/// The first value of each exported row, in file order.
fn exported_keys(file: &str) -> Vec<String> {
    file.lines()
        .filter_map(|line| line.strip_prefix('('))
        .map(|line| {
            line.split(',')
                .next()
                .unwrap()
                .trim_matches('\'')
                .to_string()
        })
        .collect()
}

/// [`round_trip`], also returning the exported file.
async fn round_trip_file(table: &str, source: &str, target: &str) -> Result<(u64, String), String> {
    let temp = tempfile::tempdir().unwrap();
    let runtime = runtime(temp.path());
    let path = temp.path().join(format!("{table}.sql"));
    export_table(
        &runtime,
        &ExportCancellationState::default(),
        None,
        "pg".to_string(),
        TableExportOptions {
            table: table.to_string(),
            content: TableSqlContent::StructureAndData,
            schema: Some(source.to_string()),
            database: None,
        },
        TableExportDestination::ServerPath(path.clone()),
    )
    .await?;
    let file = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    import_table(
        &runtime,
        &DumpCancellationState::default(),
        None,
        "pg".to_string(),
        TableImportSource::ServerPath(path),
        TableImportOptions {
            if_exists: IfTableExists::Fail,
            schema: Some(target.to_string()),
            database: None,
        },
    )
    .await
    .map(|imported| (imported.rows, file))
}

/// Integer limits, `numeric` with more digits than a double holds, and the
/// float edge values (infinities, NaN, negative zero, the smallest and
/// largest doubles) come back bit for bit.
#[tokio::test]
#[ignore]
async fn test_numeric_extremes_round_trip() {
    require_pg!();
    tabularis_lib::drivers::registry::register_driver(postgres::PostgresDriver::new()).await;
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let source = format!("table_transfer_num_src_{suffix}");
    let target = format!("table_transfer_num_dst_{suffix}");
    run(&format!("CREATE SCHEMA {source}")).await;
    run(&format!("CREATE SCHEMA {target}")).await;
    run(&format!(
        "CREATE TABLE {source}.numbers (id integer PRIMARY KEY, small smallint, \
         big bigint, exact numeric, scaled numeric(60,30), double float8, single float4)"
    ))
    .await;
    run(&format!(
        "INSERT INTO {source}.numbers VALUES \
         (1, 32767, 9223372036854775807, \
          '123456789012345678901234567890.123456789012345678901234567890', \
          '-123456789012345678901234567890.123456789012345678901234567890', \
          'Infinity', 'Infinity'), \
         (2, -32768, -9223372036854775808, 'NaN', 0, '-Infinity', '-Infinity'), \
         (3, 0, 9007199254740993, '-0.000000000000000000000000000001', NULL, 'NaN', 'NaN'), \
         (4, NULL, -9007199254740993, 1e-130, 1, '-0', '-0'), \
         (5, 1, NULL, NULL, NULL, 1.7976931348623157e308, 3.4028235e38), \
         (6, 2, 0, 0.1, 0.1, 5e-324, 1.4e-45), \
         (7, 3, 1, 0, NULL, 0.30000000000000004, 0.1)"
    ))
    .await;

    // The export dialog's estimate: none before the first ANALYZE.
    let unanalyzed = postgres::get_approximate_row_count(&pg_params(), "numbers", &source).await;
    run(&format!("ANALYZE {source}.numbers")).await;
    let analyzed = postgres::get_approximate_row_count(&pg_params(), "numbers", &source).await;
    let imported = round_trip("numbers", &source, &target).await;
    // Rows come out in key order, not in the order of the key's text.
    run(&format!(
        "CREATE TABLE {source}.keyed (id integer PRIMARY KEY, v text)"
    ))
    .await;
    run(&format!(
        "INSERT INTO {source}.keyed SELECT g, g::text FROM generate_series(12, 1, -1) g"
    ))
    .await;
    let keyed = round_trip_file("keyed", &source, &target).await;
    let compare = |schema: &str| {
        format!(
            "SELECT id, small, big::text, exact::text, scaled::text, double::text, \
             encode(float8send(double), 'hex'), single::text, \
             encode(float4send(single), 'hex') FROM {schema}.numbers ORDER BY id"
        )
    };
    let source_rows = run(&compare(&source)).await;
    let target_rows = match imported {
        Ok(_) => Some(run(&compare(&target)).await),
        Err(_) => None,
    };
    run(&format!("DROP SCHEMA {source} CASCADE")).await;
    run(&format!("DROP SCHEMA {target} CASCADE")).await;

    assert_eq!(unanalyzed, Ok(None));
    assert_eq!(analyzed, Ok(Some(7)));
    assert_eq!(imported.expect("round trip"), 7);
    assert_eq!(target_rows.unwrap(), source_rows);
    let (rows, file) = keyed.expect("keyed round trip");
    assert_eq!(rows, 12);
    assert_eq!(
        exported_keys(&file),
        (1..=12).map(|id| id.to_string()).collect::<Vec<_>>()
    );
}
