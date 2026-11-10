//! Saved read-only connections to a plugin that classifies its own language.
//!
//! The plugin is a document store: its queries are not SQL, so the SQL
//! preflight can neither vouch for a read nor be trusted to refuse a write.
//! Every test reads what the plugin was asked, because "blocked" has to mean
//! that nothing reached its executor.

use super::*;
use crate::plugins::driver::{test_driver_with_manifest, test_manifest, RpcDriver};
use crate::runtime::{events::NoopRuntimeEvents, paths::FixedRuntimePaths};
use serde_json::json;
use std::sync::{Arc, Mutex};

/// The id the editor test registers its plugin under, in the process-global
/// driver registry.
const DOCUMENT_STORE: &str = "test-read-only-document-store";

const READ: &str = "db.users.find({})";
const WRITE: &str = "db.users.insertOne({})";
const DDL: &str = "db.users.drop()";
const UNKNOWN: &str = "db.users.aggregate([{ $out: 'copy' }])";
// A SQL read to the host's SQL classifier, and nothing to this plugin.
const LOOKS_LIKE_SQL: &str = "SELECT * FROM users";
const CLASSIFIER_FAILS: &str = "db.classifier.crash()";
const PROTECTION_FAILS: &str = "db.users.find({ protection: 'down' })";

/// Every call the plugin received, as `(method, query)`.
type Calls = Arc<Mutex<Vec<(String, String)>>>;

fn methods(calls: &Calls) -> Vec<String> {
    calls
        .lock()
        .unwrap()
        .iter()
        .map(|(method, _)| method.clone())
        .collect()
}

/// How the plugin is declared. `query_classification` is on in all of them.
#[derive(Clone, Copy)]
enum Declares {
    /// The database refuses writes in `execute_read_only_query`.
    ReadOnlyQueries,
    /// The driver cannot write at all, so it has no protected RPC.
    ReadOnlyDriver,
    /// A classifier and nothing that stops a write.
    NoGuarantee,
}

/// A document store that classifies its own language.
fn document_store(declares: Declares) -> (RpcDriver, Calls) {
    let calls = Calls::default();
    let log = calls.clone();
    let mut manifest = test_manifest();
    manifest.id = DOCUMENT_STORE.to_string();
    manifest.capabilities.query_classification = true;
    manifest.capabilities.read_only_queries = matches!(declares, Declares::ReadOnlyQueries);
    manifest.capabilities.readonly = matches!(declares, Declares::ReadOnlyDriver);
    let driver = test_driver_with_manifest(manifest, move |rpc| {
        let query = rpc.params["query"].as_str().unwrap_or_default().to_string();
        log.lock()
            .unwrap()
            .push((rpc.method.clone(), query.clone()));
        match rpc.method.as_str() {
            "classify_query" => match query.as_str() {
                READ | PROTECTION_FAILS => Ok(json!({ "kind": "select" })),
                WRITE => Ok(json!({ "kind": "write" })),
                DDL => Ok(json!({ "kind": "ddl" })),
                CLASSIFIER_FAILS => Err("the classifier crashed".into()),
                _ => Ok(json!({ "kind": "unknown" })),
            },
            "execute_read_only_query" if query == PROTECTION_FAILS => {
                Err("read-only protection is unavailable".into())
            }
            // Both executors answer, so a call that should not have happened
            // shows in the log and not as a failure the test could mistake for
            // a refusal.
            "execute_read_only_query" | "execute_query" => {
                Ok(json!({ "columns": ["name"], "rows": [["alice"]], "affected_rows": 0 }))
            }
            other => Err(format!("unexpected method {other}")),
        }
    });
    (driver, calls)
}

fn connection(read_only: bool) -> ConnectionParams {
    ConnectionParams {
        read_only,
        ..Default::default()
    }
}

async fn run(driver: &RpcDriver, read_only: bool, query: &str) -> Result<QueryResult, String> {
    execute_query(driver, &connection(read_only), query, Some(10), 1, None).await
}

#[tokio::test]
async fn a_classified_read_runs_through_the_protected_rpc() {
    let (driver, calls) = document_store(Declares::ReadOnlyQueries);

    let result = run(&driver, true, READ).await.unwrap();

    assert_eq!(result.rows[0][0], json!("alice"));
    assert_eq!(
        methods(&calls),
        ["classify_query", "execute_read_only_query"],
        "the verdict comes first and the read runs only through the protected call"
    );
}

#[tokio::test]
async fn writes_unknown_text_and_failed_classification_never_reach_an_executor() {
    for query in [WRITE, DDL, UNKNOWN, LOOKS_LIKE_SQL, CLASSIFIER_FAILS, ""] {
        let (driver, calls) = document_store(Declares::ReadOnlyQueries);

        let error = run(&driver, true, query).await.unwrap_err();

        assert_eq!(error, WRITE_BLOCKED, "{query:?}");
        assert_eq!(
            methods(&calls),
            ["classify_query"],
            "{query:?} must be refused on the verdict alone"
        );
    }
}

#[tokio::test]
async fn a_failed_protected_call_is_never_retried_through_execute_query() {
    let (driver, calls) = document_store(Declares::ReadOnlyQueries);

    let error = run(&driver, true, PROTECTION_FAILS).await.unwrap_err();

    assert!(error.contains("protection is unavailable"), "{error}");
    assert_eq!(
        methods(&calls),
        ["classify_query", "execute_read_only_query"],
        "a read whose protection failed must not run unprotected"
    );
}

#[tokio::test]
async fn a_driver_without_an_execution_guarantee_cannot_enter_read_only_mode() {
    // Even a read: a classifier alone does not stop a write at execution.
    let (driver, calls) = document_store(Declares::NoGuarantee);

    let error = run(&driver, true, READ).await.unwrap_err();

    assert!(
        error.contains("does not support protected read-only queries"),
        "{error}"
    );
    assert!(
        methods(&calls).is_empty(),
        "the plugin must not be called at all"
    );
}

#[tokio::test]
async fn an_intrinsically_read_only_driver_keeps_its_ordinary_execution() {
    let (driver, calls) = document_store(Declares::ReadOnlyDriver);

    run(&driver, true, READ).await.unwrap();
    assert_eq!(
        methods(&calls),
        ["classify_query", "execute_query"],
        "a driver that cannot write needs no protected RPC"
    );

    // Its classifier is still heard: a write verdict is refused on the spot.
    let error = run(&driver, true, WRITE).await.unwrap_err();
    assert_eq!(error, WRITE_BLOCKED);
    assert_eq!(
        methods(&calls),
        ["classify_query", "execute_query", "classify_query"]
    );
}

#[tokio::test]
async fn a_writable_connection_is_neither_classified_nor_restricted() {
    let (driver, calls) = document_store(Declares::ReadOnlyQueries);

    validate_query(&driver, &connection(false), WRITE)
        .await
        .unwrap();

    assert!(methods(&calls).is_empty());
}

#[tokio::test]
async fn a_sql_plugin_keeps_the_sql_preflight_and_the_protected_rpc() {
    let calls = Calls::default();
    let log = calls.clone();
    let mut manifest = test_manifest();
    manifest.capabilities.read_only_queries = true;
    manifest.capabilities.sql_dialect = Some(crate::drivers::driver_trait::SqlDialect::Sqlite);
    let driver = test_driver_with_manifest(manifest, move |rpc| {
        log.lock()
            .unwrap()
            .push((rpc.method.clone(), String::new()));
        Ok(json!({ "columns": ["n"], "rows": [[1]], "affected_rows": 0 }))
    });

    run(&driver, true, "SELECT 1").await.unwrap();
    assert_eq!(methods(&calls), ["execute_read_only_query"]);

    let error = run(&driver, true, "DELETE FROM items").await.unwrap_err();
    assert_eq!(error, WRITE_BLOCKED);
    assert_eq!(
        methods(&calls),
        ["execute_read_only_query"],
        "no classify_query for a plugin that did not declare it, and no write"
    );
}

/// Secrets nobody stored: the saved connection has none.
struct NoSecrets;
impl crate::runtime::secrets::RuntimeSecrets for NoSecrets {
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

/// The entry points the editor, the web server and every other client use:
/// the plugin is found through a saved connection, and a valid read on it must
/// not be refused as if it were SQL.
#[tokio::test]
async fn a_saved_read_only_connection_hears_the_plugin_in_the_editor_paths() {
    use crate::application::queries::{self as queries, QueryRequestScope, QueryResponsePolicy};

    // The registry is process-global, and a concurrent reconcile test sweeps
    // plugins out of it: hold the lock the registry's own tests hold.
    let _registry = crate::drivers::registry::REGISTRY_TEST_LOCK.lock().await;
    let (driver, calls) = document_store(Declares::ReadOnlyQueries);
    crate::drivers::registry::register_driver(driver).await;

    let temp = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().into(),
            temp.path().into(),
        )),
        Arc::new(NoopRuntimeEvents),
        Arc::new(NoSecrets),
    );
    let saved: crate::models::SavedConnection = serde_json::from_value(json!({
        "id": "docs",
        "name": "Docs",
        "params": ConnectionParams {
            driver: DOCUMENT_STORE.to_string(),
            read_only: true,
            ..Default::default()
        },
    }))
    .unwrap();
    crate::persistence::save_connections_file(
        &runtime.paths.connections_file(),
        &crate::models::ConnectionsFile {
            connections: vec![saved],
            ..Default::default()
        },
    )
    .unwrap();
    let cancellation = crate::commands::QueryCancellationState::default();
    let query = |text: &str| {
        queries::execute_query(
            &runtime,
            &cancellation,
            QueryRequestScope::DESKTOP,
            QueryResponsePolicy::Unbounded,
            "docs".into(),
            text.into(),
            None,
            None,
            None,
            None,
            None,
        )
    };
    let batch = |texts: &[&str]| {
        queries::execute_query_batch(
            &runtime,
            &cancellation,
            QueryRequestScope::DESKTOP,
            QueryResponsePolicy::Unbounded,
            "docs".into(),
            texts.iter().map(|text| text.to_string()).collect(),
            None,
            None,
            None,
            None,
            None,
            None,
        )
    };

    let read = query(READ).await.unwrap();
    assert_eq!(read.rows[0][0], json!("alice"));
    assert_eq!(
        methods(&calls),
        [
            "classify_query",
            "classify_query",
            "execute_read_only_query"
        ],
        "the preflight, then the protected execution, which checks again"
    );
    calls.lock().unwrap().clear();

    for text in [WRITE, DDL, UNKNOWN, LOOKS_LIKE_SQL, CLASSIFIER_FAILS] {
        let error = query(text).await.unwrap_err();
        assert!(error.contains("read-only"), "{text}: {error}");
        assert_eq!(
            methods(&calls),
            ["classify_query"],
            "{text}: refused by the preflight, before anything ran"
        );
        calls.lock().unwrap().clear();
    }

    let both = batch(&[READ, READ]).await.unwrap();
    assert_eq!(both.len(), 2);
    assert!(both.iter().all(|statement| statement.error.is_none()));
    assert!(
        methods(&calls)
            .iter()
            .all(|method| method != "execute_query"),
        "a protected batch never runs a statement unprotected"
    );
    calls.lock().unwrap().clear();

    // One refused statement refuses the batch before its first is sent.
    let error = batch(&[READ, WRITE]).await.unwrap_err();
    assert!(error.contains("read-only"), "{error}");
    assert_eq!(methods(&calls), ["classify_query", "classify_query"]);

    crate::drivers::registry::unregister_driver(DOCUMENT_STORE).await;
}

#[test]
fn the_policy_follows_the_verdict_and_the_guarantee() {
    let protected = DriverCapabilities {
        read_only_queries: true,
        ..Default::default()
    };
    for kind in ["select", "write", "ddl", "unknown", "", "SELECT", "read"] {
        // A writable connection accepts whatever it is told.
        assert!(
            validate_kind(&connection(false), &protected, kind).is_ok(),
            "{kind:?}"
        );
        // A read-only one accepts the exact word `select` and nothing else.
        assert_eq!(
            validate_kind(&connection(true), &protected, kind).is_ok(),
            kind == "select",
            "{kind:?}"
        );
        // And never without a guarantee, whatever the verdict.
        assert!(
            validate_kind(&connection(true), &DriverCapabilities::default(), kind).is_err(),
            "{kind:?}"
        );
    }
}
