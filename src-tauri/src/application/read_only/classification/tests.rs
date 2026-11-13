use super::*;
use crate::plugins::driver::{test_driver_with_manifest, test_manifest, RpcDriver};
use crate::plugins::rpc::JsonRpcRequest;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

/// What stops a write once a query has been called a read.
#[derive(Clone, Copy, Debug)]
enum Guarantee {
    /// Nothing: `execute_read_only_query` is `execute_query`.
    None,
    /// The database refuses writes (`read_only_queries`).
    ReadOnlyQueries,
    /// The driver cannot write at all (`readonly`).
    ReadOnlyDriver,
}

/// A plugin driver with the given capabilities, answering with `reply`.
///
/// A panic inside `reply` (a failed assertion) reaches the host as a failed
/// call, which classifies as `"unknown"`. A test that expects `"unknown"`
/// therefore must not assert inside its handler.
fn plugin(
    query_classification: bool,
    guarantee: Guarantee,
    reply: impl FnMut(JsonRpcRequest) -> Result<Value, String> + Send + 'static,
) -> RpcDriver {
    let mut manifest = test_manifest();
    manifest.capabilities.query_classification = query_classification;
    manifest.capabilities.read_only_queries = matches!(guarantee, Guarantee::ReadOnlyQueries);
    manifest.capabilities.readonly = matches!(guarantee, Guarantee::ReadOnlyDriver);
    test_driver_with_manifest(manifest, reply)
}

/// A classifying plugin that gives `verdict` for every query.
fn says(verdict: &'static str, guarantee: Guarantee) -> RpcDriver {
    plugin(true, guarantee, move |_| Ok(json!({ "kind": verdict })))
}

async fn kind(driver: &RpcDriver, query: &str) -> &'static str {
    classify_query(driver, &ConnectionParams::default(), query).await
}

#[tokio::test]
async fn a_driver_that_did_not_opt_in_is_read_as_sql_without_a_call() {
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = calls.clone();
    let driver = plugin(false, Guarantee::None, move |_| {
        counter.fetch_add(1, Ordering::SeqCst);
        Ok(json!({ "kind": "select" }))
    });

    assert_eq!(kind(&driver, "SELECT 1").await, "select");
    assert_eq!(kind(&driver, "DELETE FROM t").await, "write");
    assert_eq!(kind(&driver, "DROP TABLE t").await, "ddl");
    // Not SQL, and no classifier of its own to vouch for it.
    assert_eq!(kind(&driver, "db.users.find({})").await, "unknown");
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_classifying_driver_decides_and_is_not_read_as_sql() {
    // The plugin disagrees with the SQL classifier in both directions.
    let driver = plugin(true, Guarantee::ReadOnlyQueries, |rpc| {
        let verdict = match rpc.params["query"].as_str() {
            Some("SELECT 1") => "write",
            Some("db.users.find({})") => "select",
            Some("db.users.drop()") => "ddl",
            _ => "unknown",
        };
        Ok(json!({ "kind": verdict }))
    });

    assert_eq!(kind(&driver, "SELECT 1").await, "write");
    assert_eq!(kind(&driver, "db.users.find({})").await, "select");
    assert_eq!(kind(&driver, "db.users.drop()").await, "ddl");
    assert_eq!(kind(&driver, "db.runCommand({})").await, "unknown");
}

#[tokio::test]
async fn a_select_verdict_needs_an_execution_guarantee() {
    for (verdict, guarantee, expected) in [
        ("select", Guarantee::ReadOnlyQueries, "select"),
        ("select", Guarantee::ReadOnlyDriver, "select"),
        ("select", Guarantee::None, "unknown"),
        // Nothing else is ever rewritten, with or without a guarantee.
        ("write", Guarantee::ReadOnlyQueries, "write"),
        ("write", Guarantee::ReadOnlyDriver, "write"),
        ("write", Guarantee::None, "write"),
        ("ddl", Guarantee::ReadOnlyQueries, "ddl"),
        ("ddl", Guarantee::ReadOnlyDriver, "ddl"),
        ("ddl", Guarantee::None, "ddl"),
        ("unknown", Guarantee::ReadOnlyQueries, "unknown"),
        ("unknown", Guarantee::ReadOnlyDriver, "unknown"),
        ("unknown", Guarantee::None, "unknown"),
    ] {
        assert_eq!(
            kind(&says(verdict, guarantee), "q").await,
            expected,
            "verdict {verdict}, guarantee {guarantee:?}"
        );
    }
}

#[tokio::test]
async fn a_failed_classification_is_unknown_and_never_a_sql_fallback() {
    // `SELECT 1` is a read to the SQL classifier. This driver declared its own
    // language, so when it cannot answer the host does not guess.
    let driver = plugin(true, Guarantee::ReadOnlyQueries, |_| {
        Err("Method not found: classify_query".into())
    });

    assert_eq!(kind(&driver, "SELECT 1").await, "unknown");
    assert_eq!(kind(&driver, "db.users.find({})").await, "unknown");
}

#[tokio::test]
async fn an_unreadable_answer_is_unknown() {
    for reply in [
        Value::Null,
        json!("select"),
        json!(["select"]),
        json!({}),
        json!({ "kind": null }),
        json!({ "kind": 1 }),
        json!({ "kind": "SELECT" }),
        json!({ "kind": "read" }),
    ] {
        let answer = reply.clone();
        let driver = plugin(
            true,
            Guarantee::ReadOnlyQueries,
            move |_| Ok(answer.clone()),
        );
        assert_eq!(kind(&driver, "SELECT 1").await, "unknown", "{reply}");
    }
}

#[tokio::test]
async fn every_query_is_classified_on_its_own_including_an_edited_one() {
    // Verdicts are not cached: a query edited during approval is classified
    // again, by the driver, from the edited text.
    let seen = Arc::new(Mutex::new(Vec::<String>::new()));
    let log = seen.clone();
    let driver = plugin(true, Guarantee::ReadOnlyQueries, move |rpc| {
        let query = rpc.params["query"].as_str().unwrap_or_default().to_string();
        let verdict = if query.contains("drop") {
            "ddl"
        } else {
            "select"
        };
        log.lock().unwrap().push(query);
        Ok(json!({ "kind": verdict }))
    });

    assert_eq!(kind(&driver, "db.users.find({})").await, "select");
    // The approver edits the read into a write.
    assert_eq!(kind(&driver, "db.users.drop()").await, "ddl");
    assert_eq!(
        *seen.lock().unwrap(),
        vec![
            "db.users.find({})".to_string(),
            "db.users.drop()".to_string()
        ]
    );
}

#[tokio::test]
async fn the_driver_receives_the_connection_and_the_query_untouched() {
    // Comment lines and whitespace are exactly what a parser disagreement
    // hides behind, so the host must not clean the text it classifies.
    let query = "db.users\n// comment\n.find({})\n";
    let driver = plugin(true, Guarantee::ReadOnlyQueries, move |rpc| {
        assert_eq!(rpc.method, "classify_query");
        assert_eq!(rpc.params["params"]["connection_id"], "target-connection");
        assert_eq!(rpc.params["query"], query);
        Ok(json!({ "kind": "write" }))
    });
    let params = ConnectionParams {
        connection_id: Some("target-connection".into()),
        ..Default::default()
    };

    // "write", not "unknown": a failed assertion above would read as unknown.
    assert_eq!(classify_query(&driver, &params, query).await, "write");
}
