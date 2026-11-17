use super::{
    auth::{LocalSessionSecurity, LocalSessionSecurityConfig},
    events::WebEventBus,
    provisioning::ProvisioningToken,
    server,
};
use crate::{
    application::{ManagedConnectionPolicy, RuntimeApplicationApi},
    runtime::{paths::FixedRuntimePaths, state::ApplicationState, RuntimeContext},
};
use serde_json::{json, Value};
use std::sync::Arc;

use crate::runtime::secrets::RuntimeSecrets;
use std::collections::HashMap;
use std::sync::Mutex;
#[derive(Default)]
struct MemorySecrets(Mutex<HashMap<String, String>>);

impl RuntimeSecrets for MemorySecrets {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap().get(account).cloned())
    }
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        self.0
            .lock()
            .unwrap()
            .insert(account.to_string(), secret.to_string());
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}

const TOKEN: &str = "machine-secret-for-integration-tests-123456";

#[tokio::test]
async fn machine_crud_retries_secrets_and_browser_separation() {
    crate::drivers::registry::register_driver(crate::drivers::postgres::PostgresDriver::new())
        .await;
    crate::drivers::registry::register_driver(crate::drivers::mysql::MysqlDriver::new()).await;
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("index.html"), "app").unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().into(),
            temp.path().into(),
        )),
        Arc::new(crate::runtime::events::NoopRuntimeEvents),
        Arc::new(MemorySecrets::default()),
    );
    let connections_path = runtime.paths.connections_file();
    let application = Arc::new(RuntimeApplicationApi::new(
        runtime,
        Arc::new(ApplicationState::default()),
    ));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let (security, bootstrap) =
        LocalSessionSecurity::new(base.clone(), LocalSessionSecurityConfig::default()).unwrap();
    let session = security.consume_bootstrap(bootstrap.expose()).unwrap();
    let events = WebEventBus::default();
    let redactor = events.redactor().clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(server::serve_with_configuration(
        listener,
        temp.path().into(),
        temp.path().into(),
        temp.path().join("plugins"),
        security,
        application,
        events,
        Arc::default(),
        ManagedConnectionPolicy::managed_only(),
        Some(ProvisioningToken::new(TOKEN).unwrap()),
        super::base_path::PublicBasePath::default(),
        async {
            let _ = rx.await;
        },
    ));
    let client = reqwest::Client::new();
    let collection = format!("{base}/api/v1/provisioning/connections");
    assert_eq!(client.get(&collection).send().await.unwrap().status(), 401);
    assert_eq!(
        client
            .get(&collection)
            .header(
                "Cookie",
                format!("tabularis_session={}", session.cookie_value)
            )
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        client
            .get(&collection)
            .bearer_auth(TOKEN)
            .header("Origin", &base)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        client
            .get(&collection)
            .bearer_auth("incorrect")
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    for driver in ["postgres", "mysql"] {
        let url = format!("{collection}/{driver}-database");
        let mut body = json!({"name":"Managed database","params":{"driver":driver,"database":"app","host":"127.0.0.1","username":"reader","password":"first-credential","read_only":true},"plugin_secret_changes":{"token":"plugin-credential"}});
        let first: Value = client
            .put(&url)
            .bearer_auth(TOKEN)
            .json(&body)
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(first["managed"], true);
        let retries = futures::future::join_all(
            (0..4).map(|_| client.put(&url).bearer_auth(TOKEN).json(&body).send()),
        )
        .await;
        for retry in retries {
            assert_eq!(retry.unwrap().json::<Value>().await.unwrap(), first);
        }
        assert_eq!(first["external_ref"], format!("{driver}-database"));
        for _ in 0..3 {
            let retry: Value = client
                .put(&url)
                .bearer_auth(TOKEN)
                .json(&body)
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap()
                .json()
                .await
                .unwrap();
            assert_eq!(first, retry);
        }
        body["params"].as_object_mut().unwrap().remove("password");
        assert_eq!(
            client
                .put(&url)
                .bearer_auth(TOKEN)
                .json(&body)
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        let stored = crate::persistence::load_connections_file(&connections_path).unwrap();
        let saved = stored
            .connections
            .iter()
            .find(|c| c.id == first["id"].as_str().unwrap())
            .unwrap();
        assert_eq!(saved.params.password.as_deref(), Some("first-credential"));
        assert_eq!(saved.plugin_secret_keys, vec!["token"]);
        assert!(!saved.params.extra.contains_key("token"));
        body["params"]["password"] = json!("rotated-credential");
        assert_eq!(
            client
                .put(&url)
                .bearer_auth(TOKEN)
                .json(&body)
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        for endpoint in [&collection, &url] {
            let text = client
                .get(endpoint)
                .bearer_auth(TOKEN)
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap();
            assert!(!text.contains("credential"));
            assert!(!text.contains("password"));
        }
        assert_eq!(
            redactor.redact("first-credential rotated-credential"),
            "[redacted] [redacted]"
        );
        for _ in 0..2 {
            assert_eq!(
                client
                    .delete(&url)
                    .bearer_auth(TOKEN)
                    .send()
                    .await
                    .unwrap()
                    .status(),
                204
            );
        }
        assert_eq!(
            client
                .get(&url)
                .bearer_auth(TOKEN)
                .send()
                .await
                .unwrap()
                .status(),
            404
        );
        assert!(crate::persistence::load_connections_file(&connections_path)
            .unwrap()
            .connections
            .is_empty());
    }
    let invalid = client
        .put(format!("{collection}/bad"))
        .bearer_auth(TOKEN)
        .body("{\"password\":\"secret-payload\"}")
        .header("Content-Type", "application/json")
        .send()
        .await
        .unwrap();
    assert_eq!(invalid.status(), 400);
    assert!(!invalid.text().await.unwrap().contains("secret-payload"));
    let _ = tx.send(());
    task.await.unwrap().unwrap();
}

#[test]
fn provisioning_token_validation_and_reference_contract() {
    assert!(ProvisioningToken::new("").is_err());
    assert!(ProvisioningToken::new("short").is_err());
    for reference in ["", "a/b", "..", "x%2fy", "x?y"] {
        assert!(crate::application::provisioning::connection_id(reference).is_err());
    }
    assert_eq!(
        crate::application::provisioning::connection_id("plesk_42-db").unwrap(),
        "provisioned-plesk_42-db"
    );
}

#[tokio::test]
async fn provisioning_validation_and_body_limits_preserve_error_statuses() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    crate::drivers::registry::register_driver(crate::drivers::postgres::PostgresDriver::new())
        .await;
    let temp = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().into(),
            temp.path().into(),
        )),
        Arc::new(crate::runtime::events::NoopRuntimeEvents),
        Arc::new(MemorySecrets::default()),
    );
    let path = runtime.paths.connections_file();
    let application = Arc::new(RuntimeApplicationApi::new(
        runtime,
        Arc::new(ApplicationState::default()),
    ));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let base = format!("http://{address}");
    let (security, _) =
        LocalSessionSecurity::new(base.clone(), LocalSessionSecurityConfig::default()).unwrap();
    let router = super::provisioning::routes(
        ProvisioningToken::new(TOKEN).unwrap(),
        security,
        application,
        Default::default(),
    );
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let client = reqwest::Client::new();
    let collection = format!("{base}/api/v1/provisioning/connections");
    let baseline = json!({"name":"Original", "params":{"driver":"postgres", "database":"app", "password":"original-secret"}});
    assert_eq!(
        client
            .put(format!("{collection}/existing"))
            .bearer_auth(TOKEN)
            .json(&baseline)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    let original_file = std::fs::read(&path).unwrap();

    for reference in ["new", "existing"] {
        let mut uri = baseline.clone();
        uri["name"] = json!("Should not persist");
        uri["params"]["connection_uri"] = json!("postgres://user:private-secret@example/app");
        let mut plugin = baseline.clone();
        plugin["plugin_secret_changes"] = json!({"invalid/key": "private-secret"});
        for body in [uri, plugin] {
            let response = client
                .put(format!("{collection}/{reference}"))
                .bearer_auth(TOKEN)
                .json(&body)
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), 400);
            assert_eq!(
                response.json::<Value>().await.unwrap(),
                json!({"error":{"code":"invalid_connection"}})
            );
            assert_eq!(std::fs::read(&path).unwrap(), original_file);
        }
    }

    // A known Content-Length is rejected by the layer before JSON extraction.
    let oversized = "x".repeat(1024 * 1024 + 1);
    assert_eq!(
        client
            .put(format!("{collection}/large"))
            .bearer_auth(TOKEN)
            .header("Content-Type", "application/json")
            .body(oversized.clone())
            .send()
            .await
            .unwrap()
            .status(),
        413
    );
    // Without Content-Length, the limit is encountered during Json extraction.
    let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
    stream.write_all(format!(
        "PUT /api/v1/provisioning/connections/large HTTP/1.1\r\nHost: {address}\r\nAuthorization: Bearer {TOKEN}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n{oversized}\r\n0\r\n\r\n", oversized.len()
    ).as_bytes()).await.unwrap();
    let mut response = String::new();
    tokio::time::timeout(
        std::time::Duration::from_secs(3),
        stream.read_to_string(&mut response),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(response.starts_with("HTTP/1.1 413"), "{response}");
    assert!(response.contains("payload_too_large"), "{response}");
    assert_eq!(std::fs::read(&path).unwrap(), original_file);

    // An actual filesystem failure must not be mislabeled as caller validation.
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir(&path).unwrap();
    let response = client
        .put(format!("{collection}/existing"))
        .bearer_auth(TOKEN)
        .json(&baseline)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 500);
    assert_eq!(
        response.json::<Value>().await.unwrap(),
        json!({"error":{"code":"provisioning_failed"}})
    );
    server.abort();
    let _ = server.await;
}

#[tokio::test]
async fn provisioning_delete_waits_for_in_flight_saved_connection_open() {
    use crate::application::{
        connections::ConnectionCommand, provisioning::ProvisionCommand, ApplicationApi,
        ApplicationRequestContext, AuthorizationLevel,
    };
    use std::time::{Duration, Instant};

    crate::drivers::registry::register_driver(crate::drivers::postgres::PostgresDriver::new())
        .await;
    let temp = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().into(),
            temp.path().into(),
        )),
        Arc::new(crate::runtime::events::NoopRuntimeEvents),
        Arc::new(MemorySecrets::default()),
    );
    let application = Arc::new(RuntimeApplicationApi::new(runtime, Arc::default()));
    // Accept the PostgreSQL connection but hold the handshake. The accept is a
    // deterministic barrier proving OpenSavedConnection reached network work.
    let database = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = database.local_addr().unwrap().port();
    let input = serde_json::from_value(json!({"name":"Blocked handshake", "params":{
        "driver":"postgres", "host":"127.0.0.1", "port":port,
        "database":"app", "username":"user", "password":"private-secret", "ssl_mode":"disable"
    }}))
    .unwrap();
    application
        .provision_connection(ProvisionCommand::Put("blocked".into(), input))
        .await
        .unwrap();
    let context = || ApplicationRequestContext {
        request_id: "lifecycle-ordering".into(),
        deadline: Instant::now() + Duration::from_secs(10),
        cancellation_id: None,
        authorization: AuthorizationLevel::Database,
        session_id: None,
    };
    let opening_application = application.clone();
    let opening = tokio::spawn(async move {
        opening_application
            .execute_connection_command(
                context(),
                ConnectionCommand::OpenSavedConnection {
                    connection_id: "provisioned-blocked".into(),
                },
            )
            .await
    });
    let (_socket, _) = tokio::time::timeout(Duration::from_secs(3), database.accept())
        .await
        .unwrap()
        .unwrap();
    let deleting_application = application.clone();
    let mut deleting = tokio::spawn(async move {
        deleting_application
            .provision_connection(ProvisionCommand::Delete("blocked".into()))
            .await
    });
    assert!(
        tokio::time::timeout(Duration::from_millis(100), &mut deleting)
            .await
            .is_err(),
        "deletion must not overtake opening with stored credentials"
    );
    opening.abort();
    assert!(opening.await.unwrap_err().is_cancelled());
    tokio::time::timeout(Duration::from_secs(3), deleting)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(application
        .execute_connection_command(
            context(),
            ConnectionCommand::OpenSavedConnection {
                connection_id: "provisioned-blocked".into(),
            }
        )
        .await
        .is_err());
}

/// Run with TABULARIS_PROVISIONING_LIVE_TEST=1 against the documented disposable lab ports.
#[tokio::test]
async fn provisioned_mysql_and_postgres_reach_real_databases() {
    if std::env::var("TABULARIS_PROVISIONING_LIVE_TEST").as_deref() != Ok("1") {
        return;
    }
    use crate::application::{
        connections::ConnectionCommand,
        provisioning::{ProvisionCommand, ProvisionConnection},
        ApplicationApi, ApplicationRequestContext, AuthorizationLevel,
    };
    crate::drivers::registry::register_driver(crate::drivers::postgres::PostgresDriver::new())
        .await;
    crate::drivers::registry::register_driver(crate::drivers::mysql::MysqlDriver::new()).await;
    let temp = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().into(),
            temp.path().into(),
        )),
        Arc::new(crate::runtime::events::NoopRuntimeEvents),
        Arc::new(MemorySecrets::default()),
    );
    let application = RuntimeApplicationApi::new(runtime, Arc::new(ApplicationState::default()));
    for (driver, port, user) in [("postgres", 25432, "postgres"), ("mysql", 23306, "root")] {
        let params = json!({"name": "Live lab", "params": {"driver":driver,"host":"127.0.0.1","port":port,
            "database":"example","username":user,"password":"lab-provision-secret","ssl_mode":"disable"}});
        let input: ProvisionConnection = serde_json::from_value(params).unwrap();
        let result = application
            .provision_connection(ProvisionCommand::Put(driver.into(), input))
            .await
            .unwrap();
        let id = result["id"].as_str().unwrap().to_owned();
        let context = || ApplicationRequestContext {
            request_id: "live-provision".into(),
            deadline: std::time::Instant::now() + std::time::Duration::from_secs(30),
            cancellation_id: None,
            authorization: AuthorizationLevel::Database,
            session_id: None,
        };
        application
            .execute_connection_command(
                context(),
                ConnectionCommand::OpenSavedConnection {
                    connection_id: id.clone(),
                },
            )
            .await
            .unwrap();
        application
            .provision_connection(ProvisionCommand::Delete(driver.into()))
            .await
            .unwrap();
        assert!(application
            .execute_connection_command(
                context(),
                ConnectionCommand::OpenSavedConnection { connection_id: id }
            )
            .await
            .is_err());
    }
}
