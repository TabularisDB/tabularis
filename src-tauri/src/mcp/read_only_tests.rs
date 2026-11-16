//! The read-only policies at the MCP `run_query` tool, against plugins whose
//! language is not SQL.
//!
//! One policy question, three places that ask it: the MCP read-only mode, the
//! approval gate, and a saved connection with read-only mode on. Each test
//! reads what the plugin was asked, because "blocked" has to mean that nothing
//! reached its executor.
//!
//! MCP resolves saved connections from a process-global storage location, so
//! the scenarios run in a child test process pointed at a throwaway one (the
//! way `database_scope_is_enforced_before_driver_access` does).

use super::*;
use crate::application::read_only::WRITE_BLOCKED;
use crate::drivers::driver_trait::SqlDialect;
use crate::models::DatabaseSelection;
use crate::plugins::driver::{test_driver_with_manifest, test_manifest};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const CHILD_ENV: &str = "TABULARIS_MCP_READ_ONLY_POLICY_TEST_CHILD";
const TEST: &str =
    "mcp::read_only_tests::read_only_policies_hold_for_plugins_that_classify_their_own_language";

/// Declares a classifier and the database-enforced read-only execution.
const GUARDED: &str = "test-mcp-guarded-document-store";
/// Declares a classifier and nothing that stops a write.
const CLASSIFIER_ONLY: &str = "test-mcp-classifier-only";
/// Declares nothing new: a SQL plugin as it was before read-only mode existed.
const LEGACY_SQL: &str = "test-mcp-legacy-sql";

const READ: &str = "db.users.find({})";
const EDITED_READ: &str = "db.users.find({ active: true })";
const WRITE: &str = "db.users.insertOne({})";
const DDL: &str = "db.users.drop()";
const UNKNOWN: &str = "db.users.aggregate([{ $out: 'copy' }])";
// A SQL read to the host's SQL classifier, and nothing to these plugins.
const LOOKS_LIKE_SQL: &str = "SELECT * FROM users";
const CLASSIFIER_FAILS: &str = "db.classifier.crash()";
const PROTECTION_FAILS: &str = "db.users.find({ protection: 'down' })";

/// Every call a plugin received, as `(method, query)`.
type Calls = Arc<Mutex<Vec<(String, String)>>>;

struct Plugin {
    calls: Calls,
}

impl Plugin {
    fn take(&self) -> Vec<(String, String)> {
        std::mem::take(&mut *self.calls.lock().unwrap())
    }
}

fn methods(calls: &[(String, String)]) -> Vec<&str> {
    calls.iter().map(|(method, _)| method.as_str()).collect()
}

/// Registers a plugin whose queries are not SQL: it classifies them itself.
async fn document_store(id: &str, read_only_queries: bool) -> Plugin {
    let calls = Calls::default();
    let log = calls.clone();
    let mut manifest = test_manifest();
    manifest.id = id.to_string();
    manifest.capabilities.query_classification = true;
    manifest.capabilities.read_only_queries = read_only_queries;
    let driver = test_driver_with_manifest(manifest, move |rpc| {
        let query = rpc.params["query"].as_str().unwrap_or_default().to_string();
        log.lock()
            .unwrap()
            .push((rpc.method.clone(), query.clone()));
        match rpc.method.as_str() {
            "classify_query" if query.starts_with("db.users.find(") => {
                Ok(json!({ "kind": "select" }))
            }
            "classify_query" => match query.as_str() {
                WRITE => Ok(json!({ "kind": "write" })),
                DDL => Ok(json!({ "kind": "ddl" })),
                CLASSIFIER_FAILS => Err("the classifier crashed".into()),
                _ => Ok(json!({ "kind": "unknown" })),
            },
            "execute_read_only_query" if query == PROTECTION_FAILS => {
                Err("read-only protection is unavailable".into())
            }
            // Both executors answer, so a call that should not have happened
            // shows in the log and not as a failure that reads like a refusal.
            "execute_read_only_query" | "execute_query" => {
                Ok(json!({ "columns": ["name"], "rows": [["alice"]], "affected_rows": 0 }))
            }
            other => Err(format!("unexpected method {other}")),
        }
    });
    crate::drivers::registry::register_driver(driver).await;
    Plugin { calls }
}

/// Registers a SQL plugin that declares none of the read-only capabilities.
async fn legacy_sql_plugin(id: &str) -> Plugin {
    let calls = Calls::default();
    let log = calls.clone();
    let mut manifest = test_manifest();
    manifest.id = id.to_string();
    manifest.capabilities.sql_dialect = Some(SqlDialect::Sqlite);
    let driver = test_driver_with_manifest(manifest, move |rpc| {
        let query = rpc.params["query"].as_str().unwrap_or_default().to_string();
        log.lock().unwrap().push((rpc.method.clone(), query));
        match rpc.method.as_str() {
            "execute_query" => Ok(json!({ "columns": ["n"], "rows": [[1]], "affected_rows": 0 })),
            other => Err(format!("unexpected method {other}")),
        }
    });
    crate::drivers::registry::register_driver(driver).await;
    Plugin { calls }
}

struct Outcome {
    result: Result<String, JsonRpcError>,
    audit: CallAudit,
    calls: Vec<(String, String)>,
}

impl Outcome {
    fn methods(&self) -> Vec<&str> {
        methods(&self.calls)
    }

    fn error(&self, label: &str) -> &str {
        match &self.result {
            Ok(text) => panic!("{label}: expected an error, got {text}"),
            Err(error) => &error.message,
        }
    }

    fn text(&self, label: &str) -> &str {
        match &self.result {
            Ok(text) => text,
            Err(error) => panic!("{label}: expected a result, got {}", error.message),
        }
    }
}

async fn run_query(config: &AppConfig, plugin: &Plugin, connection: &str, query: &str) -> Outcome {
    plugin.take();
    let args = json!({ "connection_id": connection, "query": query });
    let mut audit = CallAudit::for_tool("run_query");
    let result = dispatch_tool(
        "run_query",
        args.as_object(),
        config,
        "read-only-policy-test",
        &mut audit,
    )
    .await
    .map(|value| {
        value["content"][0]["text"]
            .as_str()
            .unwrap_or_default()
            .to_string()
    });
    Outcome {
        result,
        audit,
        calls: plugin.take(),
    }
}

fn app_config(readonly: bool, approval_mode: &str) -> AppConfig {
    AppConfig {
        mcp_readonly_default: Some(readonly),
        mcp_approval_mode: Some(approval_mode.to_string()),
        mcp_approval_timeout_seconds: Some(20),
        mcp_preflight_explain: Some(false),
        // `None` keeps the registry as it is: no reconciliation, no sweep.
        active_external_drivers: None,
        ..Default::default()
    }
}

/// Plays the approval UI: waits for the pending request and decides it,
/// optionally replacing the query, the way the approval dialog lets a user.
fn approver(edited_query: Option<&str>) -> tokio::task::JoinHandle<()> {
    let edited_query = edited_query.map(str::to_string);
    heartbeat::write_now().unwrap();
    tokio::spawn(async move {
        for _ in 0..200 {
            if let Some(pending) = ai_approval::list_pending().unwrap().into_iter().next() {
                ai_approval::write_decision(&ai_approval::ApprovalDecision {
                    approval_id: pending.id,
                    decided_at: ai_activity::now_iso8601(),
                    decision: "approve".to_string(),
                    reason: None,
                    edited_query,
                })
                .unwrap();
                return;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        panic!("the query never asked for approval");
    })
}

#[tokio::test]
async fn read_only_policies_hold_for_plugins_that_classify_their_own_language() {
    if std::env::var_os(CHILD_ENV).is_none() {
        run_in_isolated_storage().await;
        return;
    }

    let guarded = document_store(GUARDED, true).await;
    let classifier_only = document_store(CLASSIFIER_ONLY, false).await;
    let legacy = legacy_sql_plugin(LEGACY_SQL).await;

    mcp_read_only_mode(&guarded).await;
    saved_read_only_connection(&guarded).await;
    approval_gate_without_an_approver(&guarded, &classifier_only).await;
    approval_edits(&guarded).await;
    legacy_sql_plugins(&legacy).await;
}

/// The MCP read-only mode, on a connection that is itself writable.
async fn mcp_read_only_mode(plugin: &Plugin) {
    let config = app_config(true, "off");

    let read = run_query(&config, plugin, "doc", READ).await;
    assert!(read
        .text("mcp read-only: a classified read")
        .contains("alice"));
    assert_eq!(
        read.methods(),
        ["classify_query", "execute_read_only_query"],
        "a read goes through the protected call, after its verdict"
    );
    assert_eq!(read.calls[1].1, READ);

    for query in [WRITE, DDL, UNKNOWN, LOOKS_LIKE_SQL, CLASSIFIER_FAILS] {
        let blocked = run_query(&config, plugin, "doc", query).await;
        assert!(
            blocked.error(query).contains("read-only mode"),
            "mcp read-only: {query}: {}",
            blocked.error(query)
        );
        assert_eq!(blocked.audit.status, "blocked_readonly", "{query}");
        assert_eq!(blocked.methods(), ["classify_query"], "{query}");
    }

    let failed = run_query(&config, plugin, "doc", PROTECTION_FAILS).await;
    assert!(failed
        .error("mcp read-only: protection down")
        .contains("protection is unavailable"));
    assert_eq!(
        failed.methods(),
        ["classify_query", "execute_read_only_query"],
        "a failed protected call is not retried through execute_query"
    );
}

/// A saved connection with read-only mode on, while the MCP read-only mode is
/// off: the connection's own policy has to hear the plugin's verdict too.
async fn saved_read_only_connection(plugin: &Plugin) {
    let config = app_config(false, "off");

    let read = run_query(&config, plugin, "doc-saved-ro", READ).await;
    assert!(read
        .text("saved read-only: a classified read")
        .contains("alice"));
    assert_eq!(
        read.methods(),
        ["classify_query", "execute_read_only_query"],
        "one verdict serves every gate: the text is classified once"
    );

    for query in [WRITE, DDL, UNKNOWN, LOOKS_LIKE_SQL, CLASSIFIER_FAILS] {
        let blocked = run_query(&config, plugin, "doc-saved-ro", query).await;
        assert_eq!(blocked.error(query), WRITE_BLOCKED, "{query}");
        assert_eq!(blocked.audit.status, "blocked_readonly", "{query}");
        assert_eq!(blocked.methods(), ["classify_query"], "{query}");
    }

    let failed = run_query(&config, plugin, "doc-saved-ro", PROTECTION_FAILS).await;
    assert!(failed
        .error("saved read-only: protection down")
        .contains("protection is unavailable"));
    assert_eq!(
        failed.methods(),
        ["classify_query", "execute_read_only_query"],
        "a failed protected call is not retried through execute_query"
    );

    // The same plugin on a writable connection is untouched by the policy.
    let writable = run_query(&config, plugin, "doc", WRITE).await;
    assert!(writable.text("writable connection").contains("alice"));
    assert_eq!(writable.methods(), ["classify_query", "execute_query"]);
}

/// The default approval mode with nobody to approve: what is not a trusted
/// read must not run, and what is one needs no approval.
async fn approval_gate_without_an_approver(guarded: &Plugin, classifier_only: &Plugin) {
    heartbeat::clear().unwrap();
    let config = app_config(false, "writes_only");

    let read = run_query(&config, guarded, "doc", READ).await;
    assert!(read.text("approval: a guaranteed read").contains("alice"));
    assert_eq!(
        read.methods(),
        ["classify_query", "execute_read_only_query"],
        "a read the database enforces runs without approval, through that guarantee"
    );

    for query in [WRITE, DDL, UNKNOWN, CLASSIFIER_FAILS] {
        let held = run_query(&config, guarded, "doc", query).await;
        assert!(
            held.error(query).contains("not running"),
            "approval: {query}: {}",
            held.error(query)
        );
        assert_eq!(held.methods(), ["classify_query"], "{query}");
    }

    // A classifier is not an execution guarantee: its `select` still waits.
    let waits = run_query(&config, classifier_only, "classifier-only", READ).await;
    assert!(waits.error("classifier only").contains("not running"));
    assert_eq!(waits.methods(), ["classify_query"]);
}

/// A query the user edits while approving is a different query: it is
/// classified again, and every policy applies to the edited text.
async fn approval_edits(plugin: &Plugin) {
    // Approved as written: classified once, run through the protected call.
    let approved = approver(None);
    let read = run_query(&app_config(false, "all"), plugin, "doc-saved-ro", READ).await;
    approved.await.unwrap();
    assert!(read.text("approved as written").contains("alice"));
    assert_eq!(
        read.methods(),
        ["classify_query", "execute_read_only_query"]
    );

    // Edited into another read: that text is classified and is what runs.
    let approved = approver(Some(EDITED_READ));
    let edited = run_query(&app_config(false, "all"), plugin, "doc-saved-ro", READ).await;
    approved.await.unwrap();
    assert!(edited.text("edited into a read").contains("alice"));
    assert_eq!(
        edited.methods(),
        [
            "classify_query",
            "classify_query",
            "execute_read_only_query"
        ]
    );
    assert_eq!(edited.calls[1].1, EDITED_READ);
    assert_eq!(edited.calls[2].1, EDITED_READ);

    // Edited into a write on a saved read-only connection: refused, unrun.
    for query in [WRITE, DDL, UNKNOWN, CLASSIFIER_FAILS] {
        let approved = approver(Some(query));
        let edited = run_query(&app_config(false, "all"), plugin, "doc-saved-ro", READ).await;
        approved.await.unwrap();
        assert_eq!(
            edited.error(query),
            WRITE_BLOCKED,
            "saved read-only, {query}"
        );
        assert_eq!(
            edited.methods(),
            ["classify_query", "classify_query"],
            "{query}: the edited text is classified and never executed"
        );
        assert_eq!(edited.calls[1].1, query);
    }

    // Edited into a write while the MCP read-only mode is on.
    let approved = approver(Some(WRITE));
    let edited = run_query(&app_config(true, "all"), plugin, "doc", READ).await;
    approved.await.unwrap();
    assert!(
        edited
            .error("mcp read-only edit")
            .contains("read-only mode"),
        "{}",
        edited.error("mcp read-only edit")
    );
    assert_eq!(edited.methods(), ["classify_query", "classify_query"]);
}

/// A plugin that declares none of the new capabilities behaves as it did.
async fn legacy_sql_plugins(plugin: &Plugin) {
    let config = app_config(true, "off");

    let read = run_query(&config, plugin, "legacy-sql", "SELECT 1").await;
    assert!(read.text("legacy sql: read").contains('1'));
    assert_eq!(
        read.methods(),
        ["execute_query"],
        "no classify_query, no protected RPC, and no error for the missing one"
    );

    let write = run_query(&config, plugin, "legacy-sql", "DELETE FROM items").await;
    assert!(write.error("legacy sql: write").contains("read-only mode"));
    assert!(write.calls.is_empty(), "{:?}", write.calls);
}

/// Re-runs this test in a child process whose storage is a fixture holding
/// the saved connections, which MCP reads from the process-global location.
async fn run_in_isolated_storage() {
    let fixture = tempfile::tempdir().unwrap();
    let config_dir = fixture.path().join("config");
    std::fs::create_dir(&config_dir).unwrap();

    let connections: Vec<Value> = [
        ("doc", GUARDED, false),
        ("doc-saved-ro", GUARDED, true),
        ("classifier-only", CLASSIFIER_ONLY, false),
        ("legacy-sql", LEGACY_SQL, false),
    ]
    .into_iter()
    .map(|(id, driver, read_only)| {
        json!({
            "id": id,
            "name": id,
            "params": ConnectionParams {
                driver: driver.to_string(),
                database: DatabaseSelection::Single("app".to_string()),
                read_only,
                ..Default::default()
            }
        })
    })
    .collect();
    std::fs::write(
        config_dir.join("connections.json"),
        serde_json::to_vec(&connections).unwrap(),
    )
    .unwrap();

    let output = tokio::time::timeout(
        Duration::from_secs(90),
        tokio::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", TEST, "--nocapture"])
            .env(CHILD_ENV, "1")
            .env(crate::storage_location::ENV_VAR, &config_dir)
            .current_dir(&config_dir)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .expect("the isolated read-only policy scenarios must finish promptly")
    .unwrap();
    assert!(
        output.status.success(),
        "isolated read-only policy scenarios failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
    assert!(
        String::from_utf8_lossy(&output.stdout).contains("1 passed"),
        "the child process must execute the scenarios",
    );
}
