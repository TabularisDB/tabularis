use super::*;
use crate::plugins::driver::{test_driver_with_manifest, test_manifest};
use crate::plugins::rpc::JsonRpcRequest;
use crate::runtime::events::NoopRuntimeEvents;
use crate::runtime::paths::FixedRuntimePaths;
use crate::runtime::secrets::RuntimeSecrets;
use bytes::Bytes;
use serde_json::{json, Value};
use std::io;
use std::sync::Mutex;

struct NoSecrets;

impl RuntimeSecrets for NoSecrets {
    fn get(&self, _account: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    fn set(&self, _account: &str, _secret: &str) -> Result<(), String> {
        Ok(())
    }

    fn delete(&self, _account: &str) -> Result<(), String> {
        Ok(())
    }
}

fn fixture() -> (tempfile::TempDir, RuntimeContext) {
    let temp = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().to_path_buf(),
            temp.path().to_path_buf(),
        )),
        Arc::new(NoopRuntimeEvents),
        Arc::new(NoSecrets),
    );
    (temp, runtime)
}

fn data_file_manifest(id: &str, formats: &[&str]) -> PluginManifest {
    let mut manifest = test_manifest();
    manifest.id = id.to_string();
    manifest.capabilities.file_based = true;
    manifest.capabilities.data_files = formats.iter().map(|format| format.to_string()).collect();
    manifest
}

type Requests = Arc<Mutex<Vec<JsonRpcRequest>>>;

/// A data file driver that records every RPC and answers with `reply`.
fn recording_driver(
    reply: impl Fn(&JsonRpcRequest) -> Result<Value, String> + Send + 'static,
) -> (Arc<dyn DatabaseDriver>, Requests) {
    let requests = Requests::default();
    let recorded = requests.clone();
    let driver = test_driver_with_manifest(
        data_file_manifest("duck", &["csv", "parquet"]),
        move |request| {
            let outcome = reply(&request);
            recorded.lock().unwrap().push(request);
            outcome
        },
    );
    (Arc::new(driver), requests)
}

async fn upload(runtime: &RuntimeContext, owner: Uuid, file_name: &str) -> String {
    let chunk: Result<Bytes, io::Error> = Ok(Bytes::from_static(b"id,name\n1,alice\n"));
    FileTransferStore::new(runtime.paths.data_dir())
        .store_upload(
            owner,
            DATA_FILE_PURPOSE,
            file_name,
            Some("text/csv"),
            futures::stream::iter([chunk]),
        )
        .await
        .unwrap()
        .token
}

#[test]
fn formats_come_from_the_extension_whatever_its_case() {
    for (file_name, format) in [
        ("orders.csv", "csv"),
        ("ORDERS.CSV", "csv"),
        ("cities.tsv", "tsv"),
        ("cities.tab", "tsv"),
        ("items.json", "json"),
        ("events.ndjson", "ndjson"),
        ("events.jsonl", "ndjson"),
        ("metrics.parquet", "parquet"),
        ("metrics.pq", "parquet"),
        ("report.xlsx", "xlsx"),
        ("archive.2024.csv", "csv"),
    ] {
        assert_eq!(data_file_format(file_name), Some(format), "{file_name}");
    }
    for file_name in ["notes.txt", "dump.sql", "csv", "no-extension", ""] {
        assert_eq!(data_file_format(file_name), None, "{file_name}");
    }
}

#[test]
fn table_names_can_be_typed_unquoted() {
    for (file_name, table) in [
        ("orders.csv", "orders"),
        ("Order Items (final).csv", "Order_Items_final"),
        ("2024-sales.parquet", "_2024_sales"),
        ("archive.2024.csv", "archive_2024"),
        ("città.json", "città"),
        ("---.csv", "data"),
        (".csv", "csv"),
        ("", "data"),
    ] {
        assert_eq!(data_file_table_name(file_name), table, "{file_name}");
    }
}

#[test]
fn a_driver_is_selected_by_capability_not_by_id() {
    let manifests = vec![
        data_file_manifest("a-network-driver", &[]),
        data_file_manifest("csv-only", &["csv"]),
        data_file_manifest("columnar", &["csv", "parquet"]),
    ];

    let selected = |format: &str| {
        select_data_file_driver(&manifests, format).map(|manifest| manifest.id.as_str())
    };
    assert_eq!(selected("csv"), Some("csv-only"));
    assert_eq!(selected("parquet"), Some("columnar"));
    assert_eq!(selected("xlsx"), None);

    let mut network = data_file_manifest("remote", &["csv"]);
    network.capabilities.file_based = false;
    assert!(select_data_file_driver(&[network], "csv").is_none());
}

#[test]
fn a_workspace_is_recognised_by_driver_and_database() {
    let workspace = ConnectionParams {
        driver: "duck".to_string(),
        database: DatabaseSelection::Single("/data/workspace.db".to_string()),
        ..ConnectionParams::default()
    };
    let mut other_driver = workspace.clone();
    other_driver.driver = "sqlite".to_string();
    let mut other_database = workspace.clone();
    other_database.database = DatabaseSelection::Single("/data/other.db".to_string());

    assert!(is_same_workspace(&workspace.clone(), &workspace));
    assert!(!is_same_workspace(&other_driver, &workspace));
    assert!(!is_same_workspace(&other_database, &workspace));
}

#[tokio::test]
async fn a_host_file_is_opened_in_place_in_the_driver_workspace() {
    let (temp, runtime) = fixture();
    let file = temp.path().join("Order Items.csv");
    fs::write(&file, "id\n1\n").unwrap();
    let (driver, requests) = recording_driver(|_| Ok(Value::Null));

    let prepared = open_with_driver(&runtime, driver, DataFileSource::ServerPath(file.clone()))
        .await
        .unwrap();

    let workspace = temp.path().join("data-files").join("duck");
    assert_eq!(prepared.table, "Order_Items");
    assert_eq!(prepared.format, "csv");
    assert_eq!(prepared.params.driver, "duck");
    assert_eq!(
        prepared.params.database.primary(),
        workspace.join("workspace.db").to_str().unwrap()
    );
    let requests = requests.lock().unwrap();
    assert_eq!(requests.len(), 1, "no upload means nothing to clean up");
    assert_eq!(requests[0].method, "open_data_file");
    assert_eq!(
        requests[0].params["path"],
        json!(fs::canonicalize(&file).unwrap().to_str().unwrap())
    );
    assert_eq!(requests[0].params["format"], "csv");
    assert_eq!(requests[0].params["table"], "Order_Items");
    assert_eq!(
        requests[0].params["params"]["database"],
        json!(workspace.join("workspace.db").to_str().unwrap())
    );
    assert!(file.is_file(), "the original file is left where it is");
}

/// The single upload stored for `table`, as `uploads/<table>/<token>/<file>`.
fn stored_upload(uploads: &Path, table: &str) -> PathBuf {
    let mut directories: Vec<PathBuf> = fs::read_dir(uploads.join(table))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    assert_eq!(directories.len(), 1, "one upload per table");
    let mut files: Vec<PathBuf> = fs::read_dir(directories.remove(0))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    assert_eq!(files.len(), 1);
    files.remove(0)
}

fn listing(
    views: &'static [&'static str],
    tables: &'static [&'static str],
) -> impl Fn(&JsonRpcRequest) -> Result<Value, String> {
    move |request| {
        Ok(match request.method.as_str() {
            "get_views" => json!(views
                .iter()
                .map(|name| json!({"name": name, "definition": null}))
                .collect::<Vec<_>>()),
            "get_tables" => json!(tables
                .iter()
                .map(|name| json!({"name": name}))
                .collect::<Vec<_>>()),
            _ => Value::Null,
        })
    }
}

#[tokio::test]
async fn an_upload_is_kept_beside_the_workspace_and_stale_uploads_are_removed() {
    let (temp, runtime) = fixture();
    let owner = Uuid::new_v4();
    let token = upload(&runtime, owner, "orders.csv").await;
    let uploads = temp.path().join("data-files").join("duck").join("uploads");
    fs::create_dir_all(uploads.join("dropped_table").join("old")).unwrap();
    fs::write(
        uploads.join("dropped_table").join("old").join("old.csv"),
        "x\n",
    )
    .unwrap();
    let (driver, requests) = recording_driver(listing(&["orders"], &[]));

    let prepared = open_with_driver(
        &runtime,
        driver,
        DataFileSource::SessionUpload {
            owner,
            token: token.clone(),
        },
    )
    .await
    .unwrap();

    let stored = stored_upload(&uploads, "orders");
    assert_eq!(prepared.table, "orders");
    assert_eq!(stored.file_name().unwrap(), "orders.csv");
    assert_eq!(fs::read_to_string(&stored).unwrap(), "id,name\n1,alice\n");
    assert_eq!(
        requests.lock().unwrap()[0].params["path"],
        json!(stored.to_str().unwrap())
    );
    assert!(!uploads.join("dropped_table").exists());
    assert!(
        FileTransferStore::new(runtime.paths.data_dir())
            .claim_upload(owner, &token, DATA_FILE_PURPOSE)
            .is_err(),
        "the upload token is consumed"
    );
}

#[tokio::test]
async fn an_upload_survives_when_the_driver_lists_its_relation_as_a_table() {
    let (temp, runtime) = fixture();
    let owner = Uuid::new_v4();
    let token = upload(&runtime, owner, "orders.csv").await;
    let uploads = temp.path().join("data-files").join("duck").join("uploads");
    let (driver, _requests) = recording_driver(listing(&[], &["orders"]));

    open_with_driver(
        &runtime,
        driver,
        DataFileSource::SessionUpload { owner, token },
    )
    .await
    .unwrap();

    assert!(stored_upload(&uploads, "orders").is_file());
}

#[tokio::test]
async fn uploads_are_kept_when_the_driver_cannot_list_its_relations() {
    let (temp, runtime) = fixture();
    let owner = Uuid::new_v4();
    let token = upload(&runtime, owner, "orders.csv").await;
    let uploads = temp.path().join("data-files").join("duck").join("uploads");
    fs::create_dir_all(uploads.join("other").join("one")).unwrap();
    let (driver, _requests) = recording_driver(|request| match request.method.as_str() {
        "get_tables" => Err("catalog unavailable".to_string()),
        "get_views" => Ok(json!([])),
        _ => Ok(Value::Null),
    });

    open_with_driver(
        &runtime,
        driver,
        DataFileSource::SessionUpload { owner, token },
    )
    .await
    .unwrap();

    assert!(stored_upload(&uploads, "orders").is_file());
    assert!(uploads.join("other").join("one").is_dir());
}

#[tokio::test]
async fn a_new_upload_replaces_the_previous_one_only_after_it_opened() {
    let (temp, runtime) = fixture();
    let owner = Uuid::new_v4();
    let uploads = temp.path().join("data-files").join("duck").join("uploads");
    let fail_next = Arc::new(Mutex::new(false));
    let failing = fail_next.clone();
    let (driver, _requests) = recording_driver(move |request| {
        if request.method == "open_data_file" && *failing.lock().unwrap() {
            return Err("Failed to open data file".to_string());
        }
        listing(&["orders"], &[])(request)
    });
    let open = |token: String| {
        open_with_driver(
            &runtime,
            driver.clone(),
            DataFileSource::SessionUpload { owner, token },
        )
    };

    open(upload(&runtime, owner, "orders.csv").await)
        .await
        .unwrap();
    let first = stored_upload(&uploads, "orders");

    // A replacement that does not open leaves the working file in place.
    *fail_next.lock().unwrap() = true;
    open(upload(&runtime, owner, "orders.csv").await)
        .await
        .unwrap_err();
    assert_eq!(stored_upload(&uploads, "orders"), first);

    // One that opens takes its place.
    *fail_next.lock().unwrap() = false;
    open(upload(&runtime, owner, "orders.csv").await)
        .await
        .unwrap();
    let replaced = stored_upload(&uploads, "orders");
    assert_ne!(replaced, first);
    assert!(!first.exists());
}

#[tokio::test]
async fn a_failed_open_removes_the_upload_it_stored() {
    let (temp, runtime) = fixture();
    let owner = Uuid::new_v4();
    let token = upload(&runtime, owner, "broken.csv").await;
    let (driver, _requests) = recording_driver(|_| Err("Failed to open data file".to_string()));

    let error = open_with_driver(
        &runtime,
        driver,
        DataFileSource::SessionUpload { owner, token },
    )
    .await
    .unwrap_err();

    assert!(error.contains("Failed to open data file"));
    assert!(!temp
        .path()
        .join("data-files")
        .join("duck")
        .join("uploads")
        .join("broken")
        .exists());
}

#[tokio::test]
async fn unsupported_and_missing_files_are_rejected_before_reaching_the_driver() {
    let (temp, runtime) = fixture();
    let notes = temp.path().join("notes.txt");
    fs::write(&notes, "hello").unwrap();
    let owner = Uuid::new_v4();
    let token = upload(&runtime, owner, "notes.txt").await;
    let (driver, requests) = recording_driver(|_| Ok(Value::Null));

    let unsupported = open_with_driver(&runtime, driver.clone(), DataFileSource::ServerPath(notes))
        .await
        .unwrap_err();
    let missing = open_with_driver(
        &runtime,
        driver.clone(),
        DataFileSource::ServerPath(temp.path().join("missing.csv")),
    )
    .await
    .unwrap_err();
    let directory = open_with_driver(
        &runtime,
        driver.clone(),
        DataFileSource::ServerPath(temp.path().to_path_buf()),
    )
    .await
    .unwrap_err();
    let unsupported_upload = open_with_driver(
        &runtime,
        driver,
        DataFileSource::SessionUpload { owner, token },
    )
    .await
    .unwrap_err();

    assert_eq!(unsupported, "'notes.txt' is not a supported data file");
    assert!(missing.starts_with("Cannot open"));
    assert!(directory.ends_with("is not a file"));
    assert_eq!(
        unsupported_upload,
        "'notes.txt' is not a supported data file"
    );
    assert!(requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_driver_is_not_called_for_a_format_it_does_not_declare() {
    let (temp, runtime) = fixture();
    let file = temp.path().join("events.ndjson");
    fs::write(&file, "{}\n").unwrap();
    let (driver, requests) = recording_driver(|_| Ok(Value::Null));

    let error = open_with_driver(&runtime, driver, DataFileSource::ServerPath(file))
        .await
        .unwrap_err();

    assert_eq!(
        error,
        "The Test Plugin driver cannot open ndjson data files"
    );
    assert!(requests.lock().unwrap().is_empty());
}

#[test]
fn workspaces_only_live_under_a_plain_driver_id() {
    let data_dir = Path::new("/data");

    assert_eq!(
        workspace_directory(data_dir, "duckdb").unwrap(),
        Path::new("/data/data-files/duckdb")
    );
    for driver_id in ["", "..", "../evil", "a/b", "a\\b"] {
        assert!(
            workspace_directory(data_dir, driver_id).is_err(),
            "{driver_id}"
        );
    }
}

#[test]
fn the_capability_is_optional_and_keeps_legacy_manifests_unchanged() {
    use crate::drivers::driver_trait::DriverCapabilities;

    let legacy = json!({
        "schemas": false, "views": true, "routines": false, "file_based": true
    });
    let capabilities: DriverCapabilities = serde_json::from_value(legacy.clone()).unwrap();
    assert!(capabilities.data_files.is_empty());
    assert!(serde_json::to_value(&capabilities)
        .unwrap()
        .get("data_files")
        .is_none());

    let mut declared = legacy;
    declared["data_files"] = json!(["csv", "parquet"]);
    let capabilities: DriverCapabilities = serde_json::from_value(declared).unwrap();
    assert_eq!(capabilities.data_files, ["csv", "parquet"]);
}
