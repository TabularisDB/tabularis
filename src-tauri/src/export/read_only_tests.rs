use super::*;
use crate::drivers::driver_trait::SqlDialect;
use crate::plugins::driver::{test_driver_with_manifest, test_manifest};
use crate::plugins::rpc::JsonRpcRequest;
use serde_json::json;

async fn plugin_params<F>(support: bool, handle: F) -> ConnectionParams
where
    F: FnMut(JsonRpcRequest) -> Result<Value, String> + Send + 'static,
{
    let mut manifest = test_manifest();
    manifest.id = format!("readonly-export-{}", uuid::Uuid::new_v4());
    manifest.capabilities.read_only_queries = support;
    manifest.capabilities.sql_dialect = Some(SqlDialect::Sqlite);
    let params = ConnectionParams {
        driver: manifest.id.clone(),
        read_only: true,
        ..Default::default()
    };
    crate::drivers::registry::register_driver(test_driver_with_manifest(manifest, handle)).await;
    params
}

#[tokio::test]
async fn read_only_plugin_exports_use_protected_rpc_for_every_page_and_format() {
    let _registry = crate::drivers::registry::REGISTRY_TEST_LOCK.lock().await;
    let calls = Arc::new(Mutex::new(Vec::new()));
    let recorded = calls.clone();
    let params = plugin_params(true, move |rpc| {
        let page = rpc.params["page"].as_u64().unwrap();
        recorded.lock().unwrap().push((rpc.method.clone(), page));
        assert_eq!(rpc.method, "execute_read_only_query");
        assert_eq!(rpc.params["params"]["read_only"], true);
        assert!(rpc.params.get("query_session_id").is_none());
        assert!(rpc.params.get("session_id").is_none());
        assert_eq!(rpc.params["limit"], 1000);
        Ok(json!({"columns":["id"], "rows":if page == 1 {json!([[1],[2]])} else {json!([[3]])},
            "affected_rows":0, "pagination":{"page":page,"page_size":1000,"total_rows":3,"has_more":page == 1}}))
    }).await;
    for format in [
        ExportFormat::Csv,
        ExportFormat::Json,
        ExportFormat::Markdown,
    ] {
        for session in [None, Some("previously-writable-session")] {
            calls.lock().unwrap().clear();
            let mut output = Vec::new();
            run_export(
                &params.driver,
                &params,
                "SELECT id FROM items",
                &mut output,
                format,
                b',',
                session,
                |_| {},
            )
            .await
            .unwrap();
            assert_eq!(
                *calls.lock().unwrap(),
                vec![
                    ("execute_read_only_query".to_string(), 1),
                    ("execute_read_only_query".to_string(), 2)
                ]
            );
            let text = String::from_utf8(output).unwrap();
            assert!(text.contains('3'));
            if format == ExportFormat::Json {
                assert_eq!(
                    serde_json::from_str::<Value>(&text).unwrap(),
                    json!([{"id":1},{"id":2},{"id":3}])
                );
            }
        }
    }
    crate::drivers::registry::unregister_driver(&params.driver).await;
}

#[tokio::test]
async fn read_only_plugin_exports_block_writes_and_unsupported_drivers_before_rpc() {
    let _registry = crate::drivers::registry::REGISTRY_TEST_LOCK.lock().await;
    for support in [true, false] {
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let recorded = calls.clone();
        let params = plugin_params(support, move |_| {
            recorded.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Err("unexpected RPC".into())
        })
        .await;
        let queries = if support {
            vec![
                "DELETE FROM items",
                "SELECT 1; INSERT INTO items VALUES (2)",
            ]
        } else {
            vec!["SELECT 1"]
        };
        for query in queries {
            assert!(run_export(
                &params.driver,
                &params,
                query,
                Vec::new(),
                ExportFormat::Json,
                b',',
                Some("previously-writable-session"),
                |_| {}
            )
            .await
            .is_err());
            assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
        }
        crate::drivers::registry::unregister_driver(&params.driver).await;
    }
}

#[tokio::test]
async fn read_only_plugin_exports_never_retry_without_protection() {
    let _registry = crate::drivers::registry::REGISTRY_TEST_LOCK.lock().await;
    for error in [
        "method not found",
        "database refused a write in SELECT mutate_data()",
    ] {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let recorded = calls.clone();
        let params = plugin_params(true, move |rpc| {
            recorded.lock().unwrap().push(rpc.method);
            Err(error.into())
        })
        .await;
        assert!(run_export(
            &params.driver,
            &params,
            "SELECT mutate_data()",
            Vec::new(),
            ExportFormat::Json,
            b',',
            None,
            |_| {}
        )
        .await
        .is_err());
        assert_eq!(*calls.lock().unwrap(), vec!["execute_read_only_query"]);
        crate::drivers::registry::unregister_driver(&params.driver).await;
    }
}

#[tokio::test]
async fn writable_plugin_exports_preserve_normal_and_session_execution() {
    let _registry = crate::drivers::registry::REGISTRY_TEST_LOCK.lock().await;
    let calls = Arc::new(Mutex::new(Vec::new()));
    let recorded = calls.clone();
    let mut params = plugin_params(false, move |rpc| {
        recorded.lock().unwrap().push(rpc.method.clone());
        let result = json!({"columns":["id"],"rows":[[1]],"affected_rows":0});
        if rpc.method == "execute_query_batch" {
            assert_eq!(rpc.params["session_id"], "writable-session");
            return Ok(json!((0..4)
                .map(|_| json!({"result":result,"error":null}))
                .collect::<Vec<_>>()));
        }
        assert_eq!(rpc.method, "execute_query");
        Ok(result)
    })
    .await;
    params.read_only = false;
    for session in [None, Some("writable-session")] {
        run_export(
            &params.driver,
            &params,
            "SELECT 1",
            Vec::new(),
            ExportFormat::Json,
            b',',
            session,
            |_| {},
        )
        .await
        .unwrap();
    }
    assert_eq!(
        *calls.lock().unwrap(),
        vec!["execute_query", "execute_query_batch"]
    );
    crate::drivers::registry::unregister_driver(&params.driver).await;
}

#[tokio::test]
async fn read_only_native_exports_reject_writes_and_policy_reset_statements() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let params = ConnectionParams {
        driver: "sqlite".into(),
        database: crate::models::DatabaseSelection::Single(
            file.path().to_string_lossy().into_owned(),
        ),
        ..Default::default()
    };
    crate::drivers::registry::register_driver(sqlite::SqliteDriver::new()).await;
    sqlite::execute_query(&params, "CREATE TABLE items (id INTEGER)", None, 1)
        .await
        .unwrap();
    let protected = ConnectionParams {
        read_only: true,
        ..params.clone()
    };
    for query in [
        "PRAGMA query_only = OFF",
        "DELETE FROM items RETURNING id",
        "PRAGMA query_only = OFF; INSERT INTO items VALUES (9)",
    ] {
        assert!(run_export(
            "sqlite",
            &protected,
            query,
            Vec::new(),
            ExportFormat::Json,
            b',',
            Some("previously-writable-session"),
            |_| {}
        )
        .await
        .is_err());
    }
    let mut output = Vec::new();
    run_export(
        "sqlite",
        &protected,
        "SELECT COUNT(*) AS count FROM items",
        &mut output,
        ExportFormat::Json,
        b',',
        Some("previously-writable-session"),
        |_| {},
    )
    .await
    .unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&output).unwrap(),
        json!([{"count":0}])
    );
}

/// A writable plugin connection whose `execute_query` returns full pages with
/// no pagination metadata, like PostgreSQL does for `UPDATE ... RETURNING`,
/// until `last_page`, which is short. Records `(page, limit)` per call.
async fn paging_plugin_params(last_page: u64) -> (ConnectionParams, Arc<Mutex<Vec<(u64, Value)>>>) {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let recorded = calls.clone();
    let mut params = plugin_params(false, move |rpc| {
        assert_eq!(rpc.method, "execute_query");
        let page = rpc.params["page"].as_u64().unwrap();
        recorded
            .lock()
            .unwrap()
            .push((page, rpc.params["limit"].clone()));
        let size = if page >= last_page { 3 } else { 1000 };
        let rows: Vec<Value> = (0..size).map(|id| json!([id])).collect();
        Ok(json!({"columns":["id"],"rows":rows,"affected_rows":0}))
    })
    .await;
    params.read_only = false;
    (params, calls)
}

#[tokio::test]
async fn a_writable_plugin_export_runs_a_modifying_statement_exactly_once() {
    let _registry = crate::drivers::registry::REGISTRY_TEST_LOCK.lock().await;
    let (params, calls) = paging_plugin_params(3).await;

    for statement in [
        "UPDATE counters SET value = value + 1 RETURNING id",
        "INSERT INTO log(id) VALUES (1) RETURNING id",
        "DELETE FROM log RETURNING id",
        "WITH changed AS (UPDATE counters SET value = value + 1 RETURNING id) SELECT id FROM changed",
    ] {
        calls.lock().unwrap().clear();
        run_export(
            &params.driver,
            &params,
            statement,
            Vec::new(),
            ExportFormat::Json,
            b',',
            None,
            |_| {},
        )
        .await
        .unwrap();

        let calls = calls.lock().unwrap();
        assert_eq!(
            calls.len(),
            1,
            "{statement} was executed {} times",
            calls.len()
        );
    }
    crate::drivers::registry::unregister_driver(&params.driver).await;
}

#[tokio::test]
async fn a_writable_plugin_export_still_pages_a_plain_select() {
    let _registry = crate::drivers::registry::REGISTRY_TEST_LOCK.lock().await;
    let (params, calls) = paging_plugin_params(3).await;

    run_export(
        &params.driver,
        &params,
        "SELECT id FROM items",
        Vec::new(),
        ExportFormat::Json,
        b',',
        None,
        |_| {},
    )
    .await
    .unwrap();

    let pages: Vec<u64> = calls.lock().unwrap().iter().map(|c| c.0).collect();
    assert_eq!(pages, [1, 2, 3]);
    crate::drivers::registry::unregister_driver(&params.driver).await;
}

/// A writable plugin connection that answers `execute_query_batch` for an open
/// session, recording every statement of every batch in order. `fail_on` makes
/// the statement containing that text return an error.
async fn session_batch_plugin_params(
    fail_on: Option<&'static str>,
) -> (ConnectionParams, Arc<Mutex<Vec<String>>>) {
    let statements = Arc::new(Mutex::new(Vec::new()));
    let recorded = statements.clone();
    let mut params = plugin_params(false, move |rpc| {
        assert_eq!(rpc.method, "execute_query_batch");
        let queries: Vec<String> = rpc.params["queries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|q| q.as_str().unwrap().to_string())
            .collect();
        recorded.lock().unwrap().extend(queries.iter().cloned());
        let ok = json!({"columns":["id"],"rows":[[1]],"affected_rows":0});
        Ok(json!(queries
            .iter()
            .map(|q| match fail_on {
                Some(text) if q.contains(text) => json!({"result":null,"error":"boom"}),
                _ => json!({"result":ok,"error":null}),
            })
            .collect::<Vec<_>>()))
    })
    .await;
    params.read_only = false;
    (params, statements)
}

#[tokio::test]
async fn a_session_export_of_a_write_keeps_it_in_the_open_transaction() {
    let _registry = crate::drivers::registry::REGISTRY_TEST_LOCK.lock().await;
    let (params, statements) = session_batch_plugin_params(None).await;

    run_export(
        &params.driver,
        &params,
        "UPDATE counters SET value = value + 1 RETURNING id",
        Vec::new(),
        ExportFormat::Json,
        b',',
        Some("writable-session"),
        |_| {},
    )
    .await
    .unwrap();

    let sent = statements.lock().unwrap().clone();
    assert_eq!(
        sent,
        [
            "SAVEPOINT tabularis_write",
            "UPDATE counters SET value = value + 1 RETURNING id",
            "RELEASE SAVEPOINT tabularis_write",
        ],
        "a successful write must be released, never rolled back"
    );
    crate::drivers::registry::unregister_driver(&params.driver).await;
}

#[tokio::test]
async fn a_failed_session_export_write_rolls_back_to_its_savepoint_only() {
    let _registry = crate::drivers::registry::REGISTRY_TEST_LOCK.lock().await;
    let (params, statements) = session_batch_plugin_params(Some("UPDATE")).await;

    let error = run_export(
        &params.driver,
        &params,
        "UPDATE counters SET value = value + 1 RETURNING id",
        Vec::new(),
        ExportFormat::Json,
        b',',
        Some("writable-session"),
        |_| {},
    )
    .await
    .unwrap_err();

    assert!(error.contains("boom"), "{error}");
    let sent = statements.lock().unwrap().clone();
    assert!(sent
        .iter()
        .any(|s| s == "ROLLBACK TO SAVEPOINT tabularis_write"));
    assert!(sent
        .iter()
        .any(|s| s == "RELEASE SAVEPOINT tabularis_write"));
    crate::drivers::registry::unregister_driver(&params.driver).await;
}

#[tokio::test]
async fn a_session_export_of_a_plain_select_still_rolls_back_its_read() {
    let _registry = crate::drivers::registry::REGISTRY_TEST_LOCK.lock().await;
    let (params, statements) = session_batch_plugin_params(None).await;

    run_export(
        &params.driver,
        &params,
        "SELECT id FROM items",
        Vec::new(),
        ExportFormat::Json,
        b',',
        Some("writable-session"),
        |_| {},
    )
    .await
    .unwrap();

    let sent = statements.lock().unwrap().clone();
    assert_eq!(sent[0], "SAVEPOINT tabularis_read");
    assert!(sent
        .iter()
        .any(|s| s == "ROLLBACK TO SAVEPOINT tabularis_read"));
    crate::drivers::registry::unregister_driver(&params.driver).await;
}
