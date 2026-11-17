use super::*;
use crate::{
    application::{ApplicationApi, ManagedConnectionPolicy, RuntimeApplicationApi},
    runtime::paths::FixedRuntimePaths,
};
use axum::{routing::post, Json, Router};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};

struct Events(AtomicUsize);
impl crate::runtime::events::RuntimeEvents for Events {
    fn emit(&self, _: &str, _: Value) -> Result<(), String> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}
struct Fixture {
    _temp: tempfile::TempDir,
    runtime: RuntimeContext,
    ai: Arc<ScopedAi>,
    calls: Arc<Mutex<Vec<Value>>>,
    delay: Arc<AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
    events: Arc<Events>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn fixture() -> Fixture {
    let temp = tempfile::tempdir().unwrap();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let delay = Arc::new(AtomicUsize::new(0));
    let (captured, paused) = (calls.clone(), delay.clone());
    let router = Router::new().route("/chat/completions",post(move |headers: axum::http::HeaderMap, Json(body):Json<Value>| {
        let (captured,paused)=(captured.clone(),paused.clone());
        async move {
            assert_eq!(headers["authorization"],"Bearer private-provider-key");
            let fail = body.to_string().contains("fail-provider");
            captured.lock().unwrap().push(body);
            if fail {
                return (axum::http::StatusCode::BAD_GATEWAY, Json(json!({"error":"private-provider-key upstream diagnostics"})));
            }
            tokio::time::sleep(Duration::from_millis(paused.load(Ordering::SeqCst) as u64)).await;
            (axum::http::StatusCode::OK, Json(json!({"choices":[{"message":{"content":"SELECT 1; private-provider-key"}}]})))
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let events = Arc::new(Events(AtomicUsize::new(0)));
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().into(),
            temp.path().into(),
        )),
        events.clone(),
        Arc::new(crate::runtime::secrets::KeyringRuntimeSecrets),
    );
    let manifest_path = runtime.paths.plugins_dir().join("ai-assistant/scoped-test");
    std::fs::create_dir_all(&manifest_path).unwrap();
    let mut manifest: Value = serde_json::from_str(include_str!(
        "../../../plugins/ai-assistants/packages/openrouter/.tabularium"
    ))
    .unwrap();
    manifest["ai_assistant"]["generate"]["requests"][0]["url"] = json!(endpoint);
    manifest["ai_assistant"]["direct"] = json!(true);
    manifest["id"] = json!("scoped-test");
    std::fs::write(manifest_path.join(".tabularium"), manifest.to_string()).unwrap();
    let key = temp.path().join("key");
    crate::persistence::write_private_file(&key, "private-provider-key").unwrap();
    let config = temp.path().join("ai.json");
    crate::persistence::write_private_file(&config,json!({"provider":"scoped-test","model":"pinned-model","api_key_file":key,"connections":[{"id":"allowed","database":"app","schemas":["public"]}]}).to_string()).unwrap();
    // Startup precedes machine provisioning: this must work with no saved connections.
    let ai = Arc::new(ScopedAi::load(&runtime, &config).unwrap());
    std::fs::write(runtime.paths.connections_file(),json!({"connections":[{"id":"allowed","name":"Allowed","managed":true,"params":{"driver":"postgres","database":"app","host":"127.0.0.1"}}],"groups":[]}).to_string()).unwrap();
    Fixture {
        _temp: temp,
        runtime,
        ai,
        calls,
        delay,
        task,
        events,
    }
}
fn request() -> Request {
    Request::Explain(ExplainRequest {
        connection_id: "allowed".into(),
        database: "app".into(),
        schema: "public".into(),
        query: "SELECT 1".into(),
        language: "English".into(),
    })
}
fn context(owner: Uuid) -> ApplicationRequestContext {
    ApplicationRequestContext {
        request_id: "fixture".into(),
        deadline: std::time::Instant::now() + Duration::from_secs(30),
        cancellation_id: None,
        authorization: AuthorizationLevel::Database,
        session_id: Some(owner),
    }
}

#[tokio::test]
async fn scoped_ai_fixed_provider_scope_redaction_no_events_and_limits() {
    let f = fixture().await;
    let state = Arc::new(ApplicationState::default());
    let owner = Uuid::new_v4();
    let result =
        f.ai.execute(&f.runtime, &state, context(owner), request())
            .await
            .unwrap();
    assert_eq!(result, "SELECT 1; [redacted]");
    assert_eq!(f.calls.lock().unwrap()[0]["model"], "pinned-model");
    assert_eq!(f.events.0.load(Ordering::SeqCst), 0);
    for (id, db, schema) in [
        ("other", "app", "public"),
        ("allowed", "other", "public"),
        ("allowed", "app", "private"),
    ] {
        let req = Request::Explain(ExplainRequest {
            connection_id: id.into(),
            database: db.into(),
            schema: schema.into(),
            query: "SELECT 1".into(),
            language: "en".into(),
        });
        assert_eq!(
            f.ai.execute(&f.runtime, &state, context(owner), req)
                .await
                .unwrap_err(),
            "AI_SCOPE_DENIED"
        );
    }
    assert_eq!(f.calls.lock().unwrap().len(), 1);
    f.delay.store(5000, Ordering::SeqCst);
    let first = f.ai.execute(&f.runtime, &state, context(owner), request());
    let second = f.ai.execute(&f.runtime, &state, context(owner), request());
    let mut first = Box::pin(first);
    let mut second = Box::pin(second);
    assert!(tokio::time::timeout(Duration::from_millis(30), &mut first)
        .await
        .is_err());
    assert!(tokio::time::timeout(Duration::from_millis(30), &mut second)
        .await
        .is_err());
    assert_eq!(
        f.ai.execute(&f.runtime, &state, context(owner), request())
            .await
            .unwrap_err(),
        "AI_BUSY"
    );
    f.ai.cancel_session(owner);
    assert_eq!(first.await.unwrap_err(), "AI_UNAVAILABLE");
    assert_eq!(second.await.unwrap_err(), "AI_UNAVAILABLE");
    assert_eq!(f.ai.active.lock().unwrap().len(), 0);
}

#[tokio::test]
async fn scoped_ai_rotation_discards_in_flight_result_and_absent_session_denied() {
    let f = fixture().await;
    let state = ApplicationState::default();
    let owner = Uuid::new_v4();
    let mut missing = context(owner);
    missing.session_id = None;
    assert_eq!(
        f.ai.execute(&f.runtime, &state, missing, request())
            .await
            .unwrap_err(),
        "AI_SCOPE_DENIED"
    );
    f.delay.store(100, Ordering::SeqCst);
    let mut pending = Box::pin(f.ai.execute(&f.runtime, &state, context(owner), request()));
    assert!(
        tokio::time::timeout(Duration::from_millis(20), &mut pending)
            .await
            .is_err()
    );
    std::fs::remove_file(f.runtime.paths.connections_file()).unwrap();
    assert_eq!(pending.await.unwrap_err(), "AI_UNAVAILABLE");
}

#[tokio::test]
async fn scoped_ai_http_requires_opt_in_proxy_auth_scope_and_preserves_privileges() {
    use crate::transport::web::{auth::*, base_path::PublicBasePath, events::WebEventBus, server};
    const SECRET: &str = "proxy-secret-for-scoped-ai-fixture-123456789";
    let f = fixture().await;
    for enabled in [false, true] {
        let mut app = RuntimeApplicationApi::new(f.runtime.clone(), Arc::default());
        if enabled {
            app = app.with_scoped_ai_for_test(f.ai.clone());
        }
        let app = Arc::new(app);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let security = LocalSessionSecurity::new_remote(
            RemoteSessionSecurityConfig {
                trusted_proxies: vec![],
                public_origin: origin.clone(),
                allowed_origins: vec![origin.clone()],
                session_ttl: Duration::from_secs(60),
                max_body_bytes: 1024 * 1024,
                authorization: AuthorizationLevel::Database,
                rate_limit: Default::default(),
            },
            RemoteAuthentication::proxy(SECRET),
        )
        .unwrap();
        let issued = security.authenticate_proxy(SECRET, "alice").unwrap();
        let session = security.authenticate(&issued.cookie_value).unwrap();
        let headers = reqwest::header::HeaderMap::from_iter([
            (
                reqwest::header::COOKIE,
                format!("tabularis_session={}", issued.cookie_value)
                    .parse()
                    .unwrap(),
            ),
            (reqwest::header::ORIGIN, origin.parse().unwrap()),
            (
                reqwest::header::HeaderName::from_static(CSRF_HEADER_NAME),
                session.csrf_token.parse().unwrap(),
            ),
            (
                reqwest::header::HeaderName::from_static(PROXY_SECRET_HEADER_NAME),
                SECRET.parse().unwrap(),
            ),
            (
                reqwest::header::HeaderName::from_static(PROXY_USER_HEADER_NAME),
                "alice".parse().unwrap(),
            ),
        ]);
        let (tx, rx) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(server::serve_with_configuration(
            listener,
            f._temp.path().into(),
            f._temp.path().into(),
            f.runtime.paths.plugins_dir(),
            security.clone(),
            app.clone(),
            WebEventBus::default(),
            Arc::default(),
            ManagedConnectionPolicy::managed_only(),
            None,
            PublicBasePath::default(),
            async {
                let _ = rx.await;
            },
        ));
        let client = reqwest::Client::builder()
            .default_headers(headers.clone())
            .build()
            .unwrap();
        let body = json!({"connectionId":"allowed","database":"app","schema":"public","query":"SELECT 1","language":"English"});
        let url = format!("{origin}/api/v1/rpc/scoped_ai_explain");
        let response = client.post(&url).json(&body).send().await.unwrap();
        assert_eq!(response.status().as_u16(), if enabled { 200 } else { 403 });
        let negotiation: Value = client
            .get(format!("{origin}/api/v1/session"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(negotiation["access"]["authorizationLevel"], "database");
        assert_eq!(negotiation["access"]["highRiskCapabilities"], false);
        if enabled {
            assert_eq!(
                negotiation["scopedAi"],
                json!({"provider":"scoped-test","model":"pinned-model"})
            );
        } else {
            assert!(negotiation.get("scopedAi").is_none());
        }
        assert!(!negotiation.to_string().contains("private-provider-key"));
        if enabled {
            for key in [
                "provider", "model", "endpoint", "apiKey", "config", "settings", "extra",
            ] {
                let mut override_body = body.clone();
                override_body[key] = json!("attacker");
                assert_eq!(
                    client
                        .post(&url)
                        .json(&override_body)
                        .send()
                        .await
                        .unwrap()
                        .status(),
                    400
                );
            }
            let mut failed = body.clone();
            failed["query"] = json!("fail-provider");
            let response = client.post(&url).json(&failed).send().await.unwrap();
            assert_eq!(response.status(), 503);
            let error = response.text().await.unwrap();
            assert!(!error.contains("private-provider-key"));
            assert!(!error.contains("upstream diagnostics"));
            let mut oversized = body.clone();
            oversized["query"] = json!("x".repeat(16385));
            assert_eq!(
                client
                    .post(&url)
                    .json(&oversized)
                    .send()
                    .await
                    .unwrap()
                    .status(),
                400
            );
            let mut foreign = body.clone();
            foreign["connectionId"] = json!("other-workspace");
            assert_eq!(
                client
                    .post(&url)
                    .json(&foreign)
                    .send()
                    .await
                    .unwrap()
                    .status(),
                403
            );
            for command in [
                "get_config",
                "save_config",
                "get_ai_providers",
                "set_ai_key",
                "explain_ai_query",
                "respond_ssh_askpass",
            ] {
                assert_eq!(
                    client
                        .post(format!("{origin}/api/v1/rpc/{command}"))
                        .json(&json!({}))
                        .send()
                        .await
                        .unwrap()
                        .status(),
                    403,
                    "{command}"
                );
            }
            let mut direct = headers.clone();
            direct.remove(PROXY_SECRET_HEADER_NAME);
            assert_eq!(
                reqwest::Client::new()
                    .post(&url)
                    .headers(direct)
                    .json(&body)
                    .send()
                    .await
                    .unwrap()
                    .status(),
                401
            );
            f.delay.store(5000, Ordering::SeqCst);
            let previous = f.calls.lock().unwrap().len();
            let pending = tokio::spawn(client.post(&url).json(&body).send());
            tokio::time::timeout(Duration::from_secs(2), async {
                while f.calls.lock().unwrap().len() == previous {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            })
            .await
            .unwrap();
            security.logout(&session);
            app.clear_session(session.event_scope());
            assert_eq!(pending.await.unwrap().unwrap().status(), 401);
            // A revoked cookie cannot recover authority without the gateway.
            let mut revoked = headers.clone();
            revoked.remove(PROXY_SECRET_HEADER_NAME);
            assert_eq!(
                reqwest::Client::new()
                    .post(&url)
                    .headers(revoked)
                    .json(&body)
                    .send()
                    .await
                    .unwrap()
                    .status(),
                401
            );
        }
        let _ = tx.send(());
        server.await.unwrap().unwrap();
    }
}

#[test]
fn scoped_ai_dtos_reject_override_and_overspecified_schema_payload() {
    let valid = json!({"connectionId":"allowed","database":"app","schema":"public","prompt":"count orders"});
    assert!(serde_json::from_value::<GenerateRequest>(valid.clone()).is_ok());
    for key in [
        "provider",
        "model",
        "endpoint",
        "schemaContext",
        "apiKey",
        "rows",
    ] {
        let mut body = valid.clone();
        body[key] = json!("attacker");
        assert!(serde_json::from_value::<GenerateRequest>(body).is_err());
    }
}

#[tokio::test]
async fn scoped_ai_generation_uses_server_schema_without_row_data() {
    if std::env::var("TABULARIS_SCOPED_AI_LIVE_TEST").as_deref() != Ok("1") {
        return;
    }
    crate::drivers::registry::register_driver(crate::drivers::postgres::PostgresDriver::new())
        .await;
    crate::drivers::registry::register_driver(crate::drivers::mysql::MysqlDriver::new()).await;
    for (driver, port, user, schema) in [
        ("postgres", 25432, "postgres", "public"),
        ("mysql", 23306, "root", "app"),
    ] {
        let mut f = fixture().await;
        Arc::get_mut(&mut f.ai).unwrap().config.connections[0].schemas = vec![schema.into()];
        std::fs::write(f.runtime.paths.connections_file(),json!({"connections":[{"id":"allowed","name":"Allowed","managed":true,"params":{"driver":driver,"database":"app","host":"127.0.0.1","port":port,"username":user,"password":"lab-scoped-test","ssl_mode":"disable"}}],"groups":[]}).to_string()).unwrap();
        let result =
            f.ai.execute(
                &f.runtime,
                &ApplicationState::default(),
                context(Uuid::new_v4()),
                Request::Generate(GenerateRequest {
                    connection_id: "allowed".into(),
                    database: "app".into(),
                    schema: schema.into(),
                    prompt: "Count ai_fixture rows".into(),
                }),
            )
            .await
            .unwrap();
        assert!(result.starts_with("SELECT 1"));
        let calls = f.calls.lock().unwrap();
        let payload = calls[0].to_string();
        assert!(payload.contains("ai_fixture"));
        assert!(!payload.contains("private-row-data"));
        assert!(!payload.contains("lab-scoped-test"));
        assert_eq!(f.events.0.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn scoped_ai_provisioning_revision_invalidates_pending_result_without_file_changes() {
    let f = fixture().await;
    let state = Arc::new(ApplicationState::default());
    f.delay.store(100, Ordering::SeqCst);
    let mut pending =
        Box::pin(f.ai.execute(&f.runtime, &state, context(Uuid::new_v4()), request()));
    assert!(
        tokio::time::timeout(Duration::from_millis(20), &mut pending)
            .await
            .is_err()
    );
    // Even a no-op machine mutation changes the revision without relying on file mtime/content.
    super::super::connections::provisioning::execute(
        &f.runtime,
        &state,
        super::super::provisioning::ProvisionCommand::Delete("not-existing".into()),
    )
    .await
    .unwrap();
    assert_eq!(pending.await.unwrap_err(), "AI_UNAVAILABLE");
}

#[tokio::test]
async fn scoped_ai_requires_private_structural_config_and_explicit_key() {
    let f = fixture().await;
    let path = f._temp.path().join("ai.json");
    let valid: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    for field in ["endpoint", "api_key"] {
        let mut invalid = valid.clone();
        invalid[field] = json!("override");
        std::fs::write(&path, invalid.to_string()).unwrap();
        assert!(ScopedAi::load(&f.runtime, &path).is_err());
    }
    let mut missing = valid.clone();
    missing.as_object_mut().unwrap().remove("api_key_file");
    std::fs::write(&path, missing.to_string()).unwrap();
    assert!(ScopedAi::load(&f.runtime, &path).is_err());
    std::fs::write(&path, valid.to_string()).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(ScopedAi::load(&f.runtime, &path).is_err());
    }
    assert!(f.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn scoped_ai_mysql_schema_must_equal_database_and_other_drivers_are_denied() {
    let mut f = fixture().await;
    Arc::get_mut(&mut f.ai).unwrap().config.connections[0].schemas =
        vec!["public".into(), "app".into()];
    let path = f.runtime.paths.connections_file();
    let mut saved: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    let state = ApplicationState::default();
    for driver in ["custom-postgres", "sqlite", "mysql"] {
        saved["connections"][0]["params"]["driver"] = json!(driver);
        std::fs::write(&path, saved.to_string()).unwrap();
        assert_eq!(
            f.ai.execute(&f.runtime, &state, context(Uuid::new_v4()), request())
                .await
                .unwrap_err(),
            "AI_SCOPE_DENIED"
        );
    }
    let Request::Explain(mut same_db) = request() else {
        unreachable!()
    };
    same_db.schema = "app".into();
    assert!(f
        .ai
        .execute(
            &f.runtime,
            &state,
            context(Uuid::new_v4()),
            Request::Explain(same_db)
        )
        .await
        .is_ok());
    assert_eq!(f.calls.lock().unwrap().len(), 1);
}
