//! End-to-end checks of managed mode through the real HTTP server and the
//! runtime application, including credential exposure.

use super::auth::{LocalSessionSecurity, LocalSessionSecurityConfig};
use super::events::WebEventBus;
use super::server;
use crate::application::{
    ApplicationApi, ApplicationRequestContext, AuthorizationLevel, ManagedConnectionPolicy,
    RuntimeApplicationApi,
};
use crate::models::{ConnectionParams, ConnectionsFile, DatabaseSelection, SavedConnection};
use crate::runtime::{
    paths::FixedRuntimePaths, secrets::RuntimeSecrets, state::ApplicationState, RuntimeContext,
};
use reqwest::header::{COOKIE, ORIGIN};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

const CSRF_HEADER: &str = "x-tabularis-csrf";
const DENIED: &str = "managed_connection_denied";

const FILE_PASSWORD: &str = "file-password-9f2a";
const FILE_SSH_PASSWORD: &str = "file-ssh-password-4c1d";
const FILE_SSH_PASSPHRASE: &str = "file-ssh-passphrase-77be";
const FILE_URI: &str = "postgres://reader:file-uri-secret-31aa@db.internal/app";
const KEYCHAIN_PASSWORD: &str = "keychain-password-5d08";
const PLUGIN_SECRET: &str = "plugin-token-e41c";

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

fn saved_connection(id: &str, params: ConnectionParams, marker: bool) -> SavedConnection {
    SavedConnection {
        id: id.to_string(),
        name: format!("Connection {id}"),
        params,
        plugin_secret_keys: Vec::new(),
        group_id: None,
        sort_order: None,
        detect_json_in_text_columns: None,
        appearance: None,
        tag_ids: None,
        environment: None,
        managed: marker,
    }
}

fn base_params() -> ConnectionParams {
    ConnectionParams {
        driver: "postgres".to_string(),
        host: Some("db.internal".to_string()),
        port: Some(5432),
        username: Some("reader".to_string()),
        database: DatabaseSelection::Single("app".to_string()),
        ..ConnectionParams::default()
    }
}

struct ManagedServer {
    base_url: String,
    cookie: String,
    csrf: String,
    client: reqwest::Client,
    events: WebEventBus,
    application: Arc<dyn ApplicationApi>,
    shutdown: Option<oneshot::Sender<()>>,
    _temp: tempfile::TempDir,
}

impl ManagedServer {
    async fn start(policy: ManagedConnectionPolicy) -> Self {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("index.html"), "Tabularis").unwrap();
        let secrets = Arc::new(MemorySecrets::default());
        let runtime = RuntimeContext::new(
            Arc::new(FixedRuntimePaths::new(
                temp.path().to_path_buf(),
                temp.path().to_path_buf(),
            )),
            Arc::new(crate::runtime::events::NoopRuntimeEvents),
            secrets.clone(),
        );

        // Three connections: file-stored secrets, a keychain secret, and one
        // that never received a marker. Managed-only must protect all of them.
        let mut file_params = base_params();
        file_params.password = Some(FILE_PASSWORD.to_string());
        file_params.connection_uri = Some(FILE_URI.to_string());
        file_params.ssh_enabled = Some(true);
        file_params.ssh_password = Some(FILE_SSH_PASSWORD.to_string());
        file_params.ssh_key_passphrase = Some(FILE_SSH_PASSPHRASE.to_string());
        file_params.save_in_keychain = Some(false);
        let mut keychain_params = base_params();
        keychain_params.save_in_keychain = Some(true);
        secrets.set("keychain-1:db", KEYCHAIN_PASSWORD).unwrap();
        let mut plugin = saved_connection("plugin-1", base_params(), false);
        plugin.params.driver = "test-plugin".to_string();
        plugin.plugin_secret_keys = vec!["token".to_string()];
        secrets
            .set("plugin-1:plugin:test-plugin:token", PLUGIN_SECRET)
            .unwrap();
        let file = ConnectionsFile {
            connections: vec![
                saved_connection("file-1", file_params, true),
                saved_connection("keychain-1", keychain_params, true),
                plugin,
            ],
            ..Default::default()
        };
        crate::persistence::save_connections_file(&runtime.paths.connections_file(), &file)
            .unwrap();

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let (security, bootstrap) =
            LocalSessionSecurity::new(base_url.clone(), LocalSessionSecurityConfig::default())
                .unwrap();
        let issued = security.consume_bootstrap(bootstrap.expose()).unwrap();
        let authenticated = security.authenticate(&issued.cookie_value).unwrap();
        let application: Arc<dyn ApplicationApi> = Arc::new(RuntimeApplicationApi::new(
            runtime,
            Arc::new(ApplicationState::default()),
        ));
        let events = WebEventBus::default();
        let (shutdown, shutdown_rx) = oneshot::channel::<()>();
        tokio::spawn(server::serve_with_policy(
            listener,
            temp.path().to_path_buf(),
            temp.path().to_path_buf(),
            temp.path().join("plugins"),
            security,
            application.clone(),
            events.clone(),
            Arc::default(),
            policy,
            async move {
                let _ = shutdown_rx.await;
            },
        ));
        Self {
            base_url,
            cookie: format!("tabularis_session={}", issued.cookie_value),
            csrf: authenticated.csrf_token.clone(),
            client: reqwest::Client::new(),
            events,
            application,
            shutdown: Some(shutdown),
            _temp: temp,
        }
    }

    fn post(&self, path: &str) -> reqwest::RequestBuilder {
        self.client
            .post(format!("{}{path}", self.base_url))
            .header(COOKIE, &self.cookie)
            .header(ORIGIN, &self.base_url)
            .header(CSRF_HEADER, &self.csrf)
    }

    async fn rpc(&self, command: &str, payload: Value) -> (u16, Value) {
        let response = self
            .post(&format!("/api/v1/rpc/{command}"))
            .json(&payload)
            .send()
            .await
            .unwrap();
        let status = response.status().as_u16();
        (status, response.json().await.unwrap())
    }

    async fn session(&self) -> Value {
        self.client
            .get(format!("{}/api/v1/session", self.base_url))
            .header(COOKIE, &self.cookie)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap()
    }
}

impl Drop for ManagedServer {
    fn drop(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
    }
}

fn denied(body: &Value) -> bool {
    body["error"]["code"] == DENIED
}

#[tokio::test]
async fn session_negotiation_reports_the_connection_capabilities() {
    let standalone = ManagedServer::start(ManagedConnectionPolicy::standalone()).await;
    let session = standalone.session().await;
    assert_eq!(session["connections"]["managed"], false);
    assert_eq!(session["connections"]["canCreate"], true);
    assert_eq!(session["connections"]["canEditBranding"], true);

    let managed = ManagedServer::start(
        ManagedConnectionPolicy::managed_only().with_organization_allowed(true),
    )
    .await;
    let connections = &managed.session().await["connections"];
    assert_eq!(connections["managed"], true);
    for denied_capability in [
        "canCreate",
        "canUpdate",
        "canDelete",
        "canDuplicate",
        "canImport",
        "canExport",
        "canTest",
        "canEditBranding",
    ] {
        assert_eq!(connections[denied_capability], false, "{denied_capability}");
    }
    assert_eq!(connections["canEditOrganization"], true);
}

#[tokio::test]
async fn a_forged_capability_request_cannot_bypass_the_backend() {
    let server = ManagedServer::start(ManagedConnectionPolicy::managed_only()).await;
    // The frontend would hide this, but a direct RPC must still fail.
    let (status, body) = server
        .rpc(
            "update_connection",
            json!({"id": "file-1", "name": "x", "params": {"driver": "postgres",
                   "host": "attacker.example", "database": "app"}}),
        )
        .await;
    assert_eq!(status, 403);
    assert!(denied(&body), "{body}");
}

#[tokio::test]
async fn managed_only_protects_connections_whether_or_not_they_carry_the_marker() {
    let server = ManagedServer::start(ManagedConnectionPolicy::managed_only()).await;
    // "plugin-1" was stored with managed = false.
    for id in ["file-1", "keychain-1", "plugin-1"] {
        let (status, body) = server.rpc("delete_connection", json!({"id": id})).await;
        assert_eq!((status, denied(&body)), (403, true), "{id}");
    }
    let (_, listed) = server.rpc("get_connections_with_groups", json!(null)).await;
    assert_eq!(listed["data"]["connections"].as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn icon_and_import_uploads_follow_the_policy() {
    let server = ManagedServer::start(ManagedConnectionPolicy::managed_only()).await;
    let icon = server
        .post("/api/v1/uploads/connection-icons")
        .header("content-type", "image/png")
        .body(vec![0x89, b'P', b'N', b'G'])
        .send()
        .await
        .unwrap();
    assert_eq!(icon.status().as_u16(), 403);
    // JSON, so a client never mistakes the denial for an expired session.
    assert_eq!(
        icon.headers()[reqwest::header::CONTENT_TYPE],
        "application/json"
    );
    assert!(denied(&icon.json().await.unwrap()));

    let import = server
        .post("/api/v1/uploads")
        .header("x-tabularis-purpose", "connection-import")
        .header("x-tabularis-file-name", "connections.json")
        .body("{}")
        .send()
        .await
        .unwrap();
    assert_eq!(import.status().as_u16(), 403);
    assert!(denied(&import.json().await.unwrap()));

    let allowed =
        ManagedServer::start(ManagedConnectionPolicy::managed_only().with_branding_allowed(true))
            .await;
    let icon = allowed
        .post("/api/v1/uploads/connection-icons")
        .header("content-type", "image/png")
        .body(vec![0x89, b'P', b'N', b'G'])
        .send()
        .await
        .unwrap();
    assert_eq!(icon.status().as_u16(), 201);
}

#[tokio::test]
async fn standalone_uploads_are_unchanged() {
    let server = ManagedServer::start(ManagedConnectionPolicy::standalone()).await;
    let icon = server
        .post("/api/v1/uploads/connection-icons")
        .header("content-type", "image/png")
        .body(vec![0x89, b'P', b'N', b'G'])
        .send()
        .await
        .unwrap();
    assert_eq!(icon.status().as_u16(), 201);
}

fn assert_no_secret(label: &str, text: &str) {
    for secret in [
        FILE_PASSWORD,
        FILE_SSH_PASSWORD,
        FILE_SSH_PASSPHRASE,
        "file-uri-secret-31aa",
        KEYCHAIN_PASSWORD,
        PLUGIN_SECRET,
    ] {
        assert!(!text.contains(secret), "{label} exposed {secret}");
    }
}

#[tokio::test]
async fn browser_responses_never_contain_a_stored_credential() {
    let server = ManagedServer::start(ManagedConnectionPolicy::managed_only()).await;
    for (command, payload) in [
        ("get_connections", json!(null)),
        ("get_connections_with_groups", json!(null)),
        ("get_connection_by_id", json!({"id": "file-1"})),
        ("get_connection_by_id", json!({"id": "keychain-1"})),
        ("get_connection_by_id", json!({"id": "plugin-1"})),
        ("get_active_connections", json!(null)),
    ] {
        let (_, body) = server.rpc(command, payload).await;
        assert_no_secret(command, &body.to_string());
    }
}

#[tokio::test]
async fn denied_requests_and_errors_never_echo_credentials() {
    let server = ManagedServer::start(ManagedConnectionPolicy::managed_only()).await;
    // A request that smuggles a credential must not see it again.
    let (_, body) = server
        .rpc(
            "save_connection",
            json!({"name": "n", "params": {"driver": "postgres",
                   "password": "request-password-abc1", "database": "app"}}),
        )
        .await;
    assert!(!body.to_string().contains("request-password-abc1"));

    // A failing operation on a managed connection reports a scrubbed error.
    let (status, body) = server
        .rpc(
            "get_tables",
            json!({"connectionId": "file-1", "schema": null}),
        )
        .await;
    assert_ne!(status, 200);
    assert_no_secret("get_tables error", &body.to_string());
}

#[tokio::test]
async fn pushed_events_are_scrubbed_once_the_redactor_is_refreshed() {
    let server = ManagedServer::start(ManagedConnectionPolicy::managed_only()).await;
    server::refresh_secrets(server.application.as_ref(), server.events.redactor()).await;
    assert!(!server.events.redactor().is_empty());

    let session = server.events.redactor().redact(&format!(
        "connect failed: {FILE_PASSWORD} / {KEYCHAIN_PASSWORD} / {PLUGIN_SECRET} / {FILE_URI}"
    ));
    assert_no_secret("event text", &session);
}

#[tokio::test]
async fn collected_secrets_include_every_stored_credential_kind() {
    let server = ManagedServer::start(ManagedConnectionPolicy::managed_only()).await;
    let context = ApplicationRequestContext {
        request_id: "test".to_string(),
        deadline: std::time::Instant::now() + Duration::from_secs(5),
        cancellation_id: None,
        authorization: AuthorizationLevel::Session,
        session_id: None,
    };
    let values = server
        .application
        .connection_secret_values(context)
        .await
        .unwrap();
    for secret in [
        FILE_PASSWORD,
        FILE_SSH_PASSWORD,
        FILE_SSH_PASSPHRASE,
        FILE_URI,
        KEYCHAIN_PASSWORD,
        PLUGIN_SECRET,
    ] {
        assert!(values.iter().any(|value| value == secret), "{secret}");
    }
}

fn runtime_with_connection(root: &std::path::Path, password: &str) -> Arc<dyn ApplicationApi> {
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            root.to_path_buf(),
            root.to_path_buf(),
        )),
        Arc::new(crate::runtime::events::NoopRuntimeEvents),
        Arc::new(MemorySecrets::default()),
    );
    let mut params = base_params();
    params.password = Some(password.to_string());
    params.save_in_keychain = Some(false);
    let file = ConnectionsFile {
        connections: vec![saved_connection("short-1", params, true)],
        ..Default::default()
    };
    crate::persistence::save_connections_file(&runtime.paths.connections_file(), &file).unwrap();
    Arc::new(RuntimeApplicationApi::new(
        runtime,
        Arc::new(ApplicationState::default()),
    ))
}

async fn start_error(policy: ManagedConnectionPolicy, password: &str) -> String {
    let temp = tempfile::tempdir().unwrap();
    let mut options = options(policy, Some(crate::cli::WebAuthMode::Password), false);
    options.application = runtime_with_connection(temp.path(), password);
    server::run(options).await.unwrap_err()
}

#[tokio::test]
async fn managed_only_refuses_to_start_with_a_short_stored_credential() {
    for password in ["a", "ab", "abc"] {
        let error = start_error(ManagedConnectionPolicy::managed_only(), password).await;
        assert!(error.contains("shorter than 4 characters"), "{error}");
        assert!(!error.contains(&format!("'{password}'")), "{error}");
    }
}

#[tokio::test]
async fn managed_only_accepts_credentials_of_four_characters_or_more() {
    // It then stops for the missing public URL, not for the credential.
    let error = start_error(ManagedConnectionPolicy::managed_only(), "root").await;
    assert!(!error.contains("shorter than"), "{error}");
}

#[tokio::test]
async fn standalone_does_not_inspect_credentials_at_startup() {
    let error = start_error(ManagedConnectionPolicy::standalone(), "a").await;
    assert!(!error.contains("shorter than"), "{error}");
}

#[tokio::test]
async fn a_short_credential_that_appears_after_startup_is_still_scrubbed() {
    let temp = tempfile::tempdir().unwrap();
    let application = runtime_with_connection(temp.path(), "abc");
    let events = WebEventBus::default();

    server::refresh_secrets(application.as_ref(), events.redactor()).await;

    assert!(!events.redactor().is_empty());
    assert_eq!(
        events.redactor().redact("driver rejected password abc"),
        "[redacted]"
    );
}

fn options(
    policy: ManagedConnectionPolicy,
    auth: Option<crate::cli::WebAuthMode>,
    allow_high_risk: bool,
) -> server::WebServerOptions {
    let temp = std::env::temp_dir();
    server::WebServerOptions {
        trusted_proxies: Vec::new(),
        host: "127.0.0.1".to_string(),
        port: 0,
        web_root: temp.clone(),
        data_dir: temp.clone(),
        plugins_dir: temp.join("plugins"),
        open_browser: false,
        auth,
        public_url: None,
        allowed_origins: Vec::new(),
        allow_high_risk,
        connection_policy: policy,
        server_file_browser_roots: Vec::new(),
        application: Arc::new(RuntimeApplicationApi::new(
            RuntimeContext::new(
                Arc::new(FixedRuntimePaths::new(temp.clone(), temp)),
                Arc::new(crate::runtime::events::NoopRuntimeEvents),
                Arc::new(MemorySecrets::default()),
            ),
            Arc::new(ApplicationState::default()),
        )),
        events: WebEventBus::default(),
    }
}

#[tokio::test]
async fn managed_only_refuses_to_start_without_remote_authentication() {
    let error = server::run(options(
        ManagedConnectionPolicy::managed_only(),
        None,
        false,
    ))
    .await
    .unwrap_err();
    assert!(error.contains("requires remote authentication"), "{error}");
}

#[tokio::test]
async fn managed_only_refuses_to_start_with_high_risk_capabilities() {
    let error = server::run(options(
        ManagedConnectionPolicy::managed_only(),
        Some(crate::cli::WebAuthMode::Password),
        true,
    ))
    .await
    .unwrap_err();
    assert!(error.contains("--allow-high-risk"), "{error}");
}
