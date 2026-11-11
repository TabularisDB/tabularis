use super::*;
use crate::drivers::driver_trait::SqlDialect;
use crate::runtime::{events::NoopRuntimeEvents, paths::FixedRuntimePaths};
use serde_json::json;
use std::sync::Arc;

fn capabilities() -> DriverCapabilities {
    DriverCapabilities {
        read_only_queries: true,
        sql_dialect: Some(SqlDialect::Sqlite),
        ..Default::default()
    }
}

#[test]
fn old_connections_remain_writable_and_the_policy_round_trips() {
    let legacy: ConnectionParams =
        serde_json::from_value(json!({"driver":"sqlite", "database":"test"})).unwrap();
    assert!(!legacy.read_only);
    assert!(serde_json::to_value(&legacy)
        .unwrap()
        .get("read_only")
        .is_none());
    let params = ConnectionParams {
        read_only: true,
        ..legacy
    };
    let restored: ConnectionParams =
        serde_json::from_value(serde_json::to_value(params).unwrap()).unwrap();
    assert!(restored.read_only);
}

#[test]
fn plugin_opt_in_is_required_and_sql_preflight_fails_closed() {
    let params = ConnectionParams {
        read_only: true,
        ..Default::default()
    };
    assert!(validate_support(&params, &DriverCapabilities::default()).is_err());
    assert!(validate_support(
        &params,
        &DriverCapabilities {
            readonly: true,
            ..Default::default()
        }
    )
    .is_ok());
    for sql in [
        "SELECT 1",
        "WITH x AS (SELECT 1) SELECT * FROM x",
        "PRAGMA table_info(items)",
    ] {
        assert!(
            validate_query(&params, &capabilities(), sql).is_ok(),
            "{sql}"
        );
    }
    for sql in [
        "DELETE FROM items",
        "SELECT 1; INSERT INTO items VALUES (2)",
        "PRAGMA query_only = OFF",
        "PRAGMA user_version(42)",
        "BEGIN",
        "COMMIT",
        "SET TRANSACTION READ WRITE",
        "EXPLAIN ANALYZE DELETE FROM items",
        "WITH x AS (DELETE FROM items RETURNING *) SELECT * FROM x",
    ] {
        assert!(
            validate_query(&params, &capabilities(), sql).is_err(),
            "{sql}"
        );
    }
}

#[test]
fn startup_scripts_are_skipped_only_for_protected_connections() {
    let original = ConnectionParams {
        startup_script: Some("DELETE FROM items".into()),
        ..Default::default()
    };
    let mut ordinary = original.clone();
    prepare_params(&mut ordinary);
    assert_eq!(ordinary.startup_script, original.startup_script);
    ordinary.read_only = true;
    prepare_params(&mut ordinary);
    assert!(ordinary.startup_script.is_none());
    assert!(original.startup_script.is_some());
}

struct NoopSecrets;
impl crate::runtime::secrets::RuntimeSecrets for NoopSecrets {
    fn get(&self, _: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
    fn set(&self, _: &str, _: &str) -> Result<(), String> {
        Ok(())
    }
    fn delete(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
}

async fn fixture() -> (tempfile::TempDir, RuntimeContext, ConnectionParams) {
    let temp = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().into(),
            temp.path().into(),
        )),
        Arc::new(NoopRuntimeEvents),
        Arc::new(NoopSecrets),
    );
    let params = ConnectionParams {
        driver: "sqlite".into(),
        database: crate::models::DatabaseSelection::Single(
            temp.path()
                .join("test.sqlite")
                .to_string_lossy()
                .into_owned(),
        ),
        ..Default::default()
    };
    std::fs::File::create(params.database.primary()).unwrap();
    let driver = crate::drivers::sqlite::SqliteDriver::new();
    driver
        .execute_query(&params, "CREATE TABLE items (id INTEGER)", None, 1, None)
        .await
        .unwrap();
    crate::drivers::registry::register_driver(driver).await;
    let mut saved: crate::models::SavedConnection = serde_json::from_value(json!({
        "id":"protected", "name":"Protected", "params":params,
    }))
    .unwrap();
    saved.params.read_only = true;
    saved.params.startup_script = Some("INSERT INTO items VALUES (99)".into());
    crate::persistence::save_connections_file(
        &runtime.paths.connections_file(),
        &crate::models::ConnectionsFile {
            connections: vec![saved],
            ..Default::default()
        },
    )
    .unwrap();
    (temp, runtime, params)
}

#[tokio::test]
async fn shared_execution_blocks_writes_and_keeps_normal_connections_writable() {
    use crate::application::queries::{
        execute_query, execute_query_batch, QueryRequestScope, QueryResponsePolicy,
    };
    let (_temp, runtime, params) = fixture().await;
    let cancellation = crate::commands::QueryCancellationState::default();
    let read = execute_query(
        &runtime,
        &cancellation,
        QueryRequestScope::DESKTOP,
        QueryResponsePolicy::Unbounded,
        "protected".into(),
        "SELECT COUNT(*) FROM items".into(),
        None,
        None,
        None,
        None,
        None,
    )
    .await
    .unwrap();
    assert_eq!(read.rows[0][0], json!(0));
    for sql in [
        "INSERT INTO items VALUES (1)",
        "PRAGMA query_only = OFF; INSERT INTO items VALUES (2)",
    ] {
        assert!(execute_query(
            &runtime,
            &cancellation,
            QueryRequestScope::DESKTOP,
            QueryResponsePolicy::Unbounded,
            "protected".into(),
            sql.into(),
            None,
            None,
            None,
            None,
            None
        )
        .await
        .unwrap_err()
        .contains("read-only"));
    }
    let batch = execute_query_batch(
        &runtime,
        &cancellation,
        QueryRequestScope::DESKTOP,
        QueryResponsePolicy::Unbounded,
        "protected".into(),
        vec!["SELECT 1".into(), "SELECT 2".into()],
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .await
    .unwrap();
    assert_eq!(batch.len(), 2);
    assert!(batch.iter().all(|result| result.error.is_none()));
    assert!(execute_query_batch(
        &runtime,
        &cancellation,
        QueryRequestScope::DESKTOP,
        QueryResponsePolicy::Unbounded,
        "protected".into(),
        vec!["SELECT 1".into(), "DELETE FROM items".into()],
        None,
        None,
        None,
        None,
        None,
        None
    )
    .await
    .is_err());
    assert!(crate::application::records::delete_record(
        &runtime,
        None,
        "protected",
        "items".into(),
        Default::default(),
        None,
        None
    )
    .await
    .unwrap_err()
    .contains("read-only"));
    assert!(crate::application::database_objects::drop_view(
        &runtime,
        None,
        "protected",
        "v".into(),
        None,
        None
    )
    .await
    .unwrap_err()
    .contains("read-only"));
    // Imports must be rejected before even opening their source file.
    let imports = crate::application::database_transfers::DumpCancellationState::default();
    assert!(crate::application::database_transfers::import_database(
        &runtime,
        &imports,
        None,
        "protected".into(),
        crate::application::database_transfers::ImportSource::ServerPath("missing.sql".into()),
        None,
        None,
    )
    .await
    .unwrap_err()
    .contains("read-only"));
    assert!(crate::application::table_transfers::import_table(
        &runtime,
        &imports,
        None,
        "protected".into(),
        crate::application::table_transfers::TableImportSource::ServerPath("missing.sql".into()),
        crate::application::table_transfers::TableImportOptions {
            if_exists: crate::application::table_transfers::IfTableExists::Fail,
            schema: None,
            database: None,
        },
    )
    .await
    .unwrap_err()
    .contains("read-only"));
    // The same pool must remain usable for a separately configured writable connection.
    let driver = crate::drivers::sqlite::SqliteDriver::new();
    driver
        .execute_query(&params, "INSERT INTO items VALUES (3)", None, 1, None)
        .await
        .unwrap();
    let result = driver
        .execute_query(&params, "SELECT COUNT(*) FROM items", None, 1, None)
        .await
        .unwrap();
    assert_eq!(result.rows[0][0], json!(1));
}

#[tokio::test]
async fn read_only_table_export_keeps_rows_and_binary_values() {
    use crate::application::table_transfers::{
        export_table, TableExportDestination, TableExportOptions,
    };
    let (temp, runtime, params) = fixture().await;
    let driver = crate::drivers::sqlite::SqliteDriver::new();
    driver
        .execute_query(
            &params,
            "CREATE TABLE binary_items (id INTEGER, payload BLOB)",
            None,
            1,
            None,
        )
        .await
        .unwrap();
    driver
        .execute_query(
            &params,
            "INSERT INTO binary_items VALUES (7, X'00FF')",
            None,
            1,
            None,
        )
        .await
        .unwrap();
    let path = temp.path().join("export.sql");
    let exported = export_table(
        &runtime,
        &crate::export::ExportCancellationState::default(),
        None,
        "protected".into(),
        TableExportOptions {
            table: "binary_items".into(),
            content: crate::table_sql::TableSqlContent::StructureAndData,
            schema: None,
            database: None,
        },
        TableExportDestination::ServerPath(path.clone()),
    )
    .await
    .unwrap();
    assert_eq!(exported.rows, 1);
    let sql = std::fs::read_to_string(path).unwrap();
    assert!(sql.contains("INSERT INTO"));
    assert!(sql.to_lowercase().contains("00ff"));
}

#[tokio::test]
async fn read_only_native_dumps_match_writable_dumps_across_page_boundaries() {
    let (_temp, _runtime, params) = fixture().await;
    let driver: Arc<dyn DatabaseDriver> = Arc::new(crate::drivers::sqlite::SqliteDriver::new());
    driver.execute_query(&params, "CREATE TABLE dump_values (id INTEGER, label TEXT, document JSON, payload BLOB, optional TEXT)", None, 1, None).await.unwrap();
    driver.execute_query(&params, "WITH RECURSIVE n(id) AS (SELECT 1 UNION ALL SELECT id+1 FROM n WHERE id < 2105) INSERT INTO dump_values SELECT id, 'quote '' and unicode café', '{\"flag\":true}', X'00FF', NULL FROM n", None, 1, None).await.unwrap();
    let mut outputs = Vec::new();
    for read_only in [false, true] {
        let params = ConnectionParams {
            read_only,
            ..params.clone()
        };
        let mut output = Vec::new();
        crate::application::database_transfers::stream_sql_rows(
            &driver,
            &params,
            "sqlite",
            "SELECT * FROM dump_values ORDER BY id",
            "dump_values",
            None,
            |names, cells| {
                let cells = cells
                    .into_iter()
                    .map(|cell| {
                        json!({
                            "value":cell.value, "is_json":cell.is_json,
                        })
                    })
                    .collect::<Vec<_>>();
                output.push(json!({"columns":names,"cells":cells}));
                Ok(())
            },
        )
        .await
        .unwrap();
        assert_eq!(output.len(), 2105);
        // Retain the exact SQL cell semantics, including the JSON/text distinction.
        outputs.push(output);
    }
    for (index, (writable, protected)) in outputs[0].iter().zip(&outputs[1]).enumerate() {
        assert_eq!(
            writable, protected,
            "export row {index} differs between policies"
        );
    }
}

#[tokio::test]
async fn on_a_read_only_connection_stream_query_delivers_the_read_only_result_as_one_batch_and_a_write_statement_is_rejected_with_the_same_error_as_execute_query(
) {
    use crate::application::queries::{
        execute_query, stream_query, QueryRequestScope, QueryResponsePolicy,
    };
    use crate::drivers::driver_trait::QueryChunk;
    let (_temp, runtime, _params) = fixture().await;
    let cancellation = crate::commands::QueryCancellationState::default();
    let stream = |sql: &str| {
        let chunks = Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = chunks.clone();
        let result = stream_query(
            &runtime,
            &cancellation,
            QueryRequestScope::DESKTOP,
            "protected".into(),
            sql.into(),
            None,
            None,
            None,
            move |chunk| sink.lock().unwrap().push(chunk),
        );
        async move { (result.await, chunks.lock().unwrap().clone()) }
    };

    let read = "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 1200) SELECT x FROM n";
    let (result, chunks) = stream(read).await;
    result.unwrap();
    let [QueryChunk::Columns(columns), QueryChunk::Rows(rows)] = chunks.as_slice() else {
        panic!("unexpected chunks: {chunks:?}");
    };
    assert_eq!(columns, &["x"]);
    assert_eq!(rows.len(), 1200);

    let write = "INSERT INTO items VALUES (1)";
    let streamed = stream(write).await.0.unwrap_err();
    let executed = execute_query(
        &runtime,
        &cancellation,
        QueryRequestScope::DESKTOP,
        QueryResponsePolicy::Unbounded,
        "protected".into(),
        write.into(),
        None,
        None,
        None,
        None,
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(streamed, executed);
    assert_eq!(streamed, WRITE_BLOCKED);
}
