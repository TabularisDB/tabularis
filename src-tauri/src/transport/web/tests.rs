use super::auth::{LocalSessionSecurity, LocalSessionSecurityConfig};
use super::contract::{SessionNegotiation, WEB_API_VERSION};
use super::events::{EventBusConfig, WebEventBus};
use super::rpc::{RPC_CANCELLATION_HEADER_NAME, RPC_DEADLINE_HEADER_NAME};
use super::{server, static_assets};
use crate::application::{ApplicationApi, RuntimeApplicationApi};
use crate::runtime::{paths::FixedRuntimePaths, state::ApplicationState, RuntimeContext};
use futures::{SinkExt, StreamExt};
use reqwest::header::{COOKIE, HOST, LOCATION, ORIGIN, SET_COOKIE};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::{Error as WebSocketError, Message as WebSocketMessage};

const CSRF_HEADER: &str = "x-tabularis-csrf";
const REQUEST_ID_HEADER: &str = "x-request-id";

fn test_application(root: &Path) -> Arc<dyn ApplicationApi> {
    test_application_with_state(root, Arc::new(ApplicationState::default()))
}

fn test_application_with_state(
    root: &Path,
    state: Arc<ApplicationState>,
) -> Arc<dyn ApplicationApi> {
    let context = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            root.to_path_buf(),
            root.to_path_buf(),
        )),
        Arc::new(crate::runtime::events::NoopRuntimeEvents),
        Arc::new(crate::runtime::secrets::KeyringRuntimeSecrets),
    );
    Arc::new(RuntimeApplicationApi::new(context, state))
}

#[tokio::test]
async fn requires_a_single_use_bootstrap_and_authenticated_session() {
    let temp = tempfile::tempdir().unwrap();
    let assets = temp.path();
    std::fs::create_dir_all(assets.join("assets")).unwrap();
    std::fs::write(assets.join("index.html"), "<main>Tabularis Web</main>").unwrap();
    std::fs::write(assets.join("assets/app.js"), "window.tabularis = true;").unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let base_url = format!("http://{address}");
    let (security, bootstrap_token) =
        LocalSessionSecurity::new(base_url.clone(), LocalSessionSecurityConfig::default()).unwrap();
    let bootstrap_url = format!(
        "{base_url}/api/v1/auth/bootstrap?token={}",
        bootstrap_token.expose()
    );
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let server = tokio::spawn(server::serve(
        listener,
        assets.to_path_buf(),
        security,
        test_application(assets),
        async move {
            let _ = shutdown_rx.await;
        },
    ));
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();

    let health = client
        .get(format!("{base_url}/healthz"))
        .send()
        .await
        .unwrap();
    assert_eq!(health.status(), reqwest::StatusCode::OK);
    assert_eq!(health.text().await.unwrap(), "ok");

    let unauthorized = client
        .get(format!("{base_url}/api/v1/session"))
        .send()
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), reqwest::StatusCode::UNAUTHORIZED);
    assert!(uuid::Uuid::parse_str(
        unauthorized
            .headers()
            .get(REQUEST_ID_HEADER)
            .unwrap()
            .to_str()
            .unwrap()
    )
    .is_ok());

    let invalid_bootstrap = client
        .get(format!("{base_url}/api/v1/auth/bootstrap?token=invalid"))
        .send()
        .await
        .unwrap();
    assert_eq!(
        invalid_bootstrap.status(),
        reqwest::StatusCode::UNAUTHORIZED
    );

    let cross_origin_bootstrap = client
        .get(&bootstrap_url)
        .header(ORIGIN, "https://attacker.invalid")
        .send()
        .await
        .unwrap();
    assert_eq!(
        cross_origin_bootstrap.status(),
        reqwest::StatusCode::FORBIDDEN
    );

    let bootstrap = client.get(&bootstrap_url).send().await.unwrap();
    assert_eq!(bootstrap.status(), reqwest::StatusCode::SEE_OTHER);
    assert_eq!(bootstrap.headers().get(LOCATION).unwrap(), "/");
    assert_eq!(
        bootstrap.headers().get("referrer-policy").unwrap(),
        "no-referrer"
    );
    let set_cookie = bootstrap
        .headers()
        .get(SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap();
    assert!(set_cookie.contains("HttpOnly"));
    assert!(set_cookie.contains("SameSite=Strict"));
    assert!(set_cookie.contains("Path=/"));
    let cookie = set_cookie.split(';').next().unwrap().to_string();

    let replay = client.get(&bootstrap_url).send().await.unwrap();
    assert_eq!(replay.status(), reqwest::StatusCode::UNAUTHORIZED);

    let session = client
        .get(format!("{base_url}/api/v1/session"))
        .header(COOKIE, &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(session.status(), reqwest::StatusCode::OK);
    let session: SessionNegotiation = session.json().await.unwrap();
    assert_eq!(session.api_version, WEB_API_VERSION);
    assert_eq!(session.server_version, env!("CARGO_PKG_VERSION"));
    assert!(session.authenticated);
    assert!(!session.csrf_token.is_empty());
    assert!(session.capabilities.rpc);
    assert!(session.capabilities.events);

    let index = client
        .get(&base_url)
        .header(COOKIE, &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(index.status(), reqwest::StatusCode::OK);
    assert_eq!(index.text().await.unwrap(), "<main>Tabularis Web</main>");

    let asset = client
        .get(format!("{base_url}/assets/app.js"))
        .header(COOKIE, &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(asset.status(), reqwest::StatusCode::OK);
    assert_eq!(asset.text().await.unwrap(), "window.tabularis = true;");

    let spa_route = client
        .get(format!("{base_url}/connections/example"))
        .header(COOKIE, &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(spa_route.status(), reqwest::StatusCode::OK);
    assert_eq!(
        spa_route.text().await.unwrap(),
        "<main>Tabularis Web</main>"
    );

    let cross_origin = client
        .get(format!("{base_url}/api/v1/session"))
        .header(COOKIE, &cookie)
        .header(ORIGIN, "https://attacker.invalid")
        .send()
        .await
        .unwrap();
    assert_eq!(cross_origin.status(), reqwest::StatusCode::FORBIDDEN);

    let bad_host = client
        .get(format!("{base_url}/api/v1/session"))
        .header(COOKIE, &cookie)
        .header(HOST, "attacker.invalid")
        .send()
        .await
        .unwrap();
    assert_eq!(bad_host.status(), reqwest::StatusCode::FORBIDDEN);

    let missing_csrf = client
        .post(format!("{base_url}/api/v1/logout"))
        .header(COOKIE, &cookie)
        .header(ORIGIN, &base_url)
        .send()
        .await
        .unwrap();
    assert_eq!(missing_csrf.status(), reqwest::StatusCode::FORBIDDEN);

    let oversized = client
        .post(format!("{base_url}/api/v1/not-implemented"))
        .header(COOKIE, &cookie)
        .header(ORIGIN, &base_url)
        .header(CSRF_HEADER, &session.csrf_token)
        .header(reqwest::header::CONTENT_LENGTH, 1_048_577)
        .body("x")
        .send()
        .await
        .unwrap();
    assert_eq!(oversized.status(), reqwest::StatusCode::PAYLOAD_TOO_LARGE);

    let logout = client
        .post(format!("{base_url}/api/v1/logout"))
        .header(COOKIE, &cookie)
        .header(ORIGIN, &base_url)
        .header(CSRF_HEADER, &session.csrf_token)
        .send()
        .await
        .unwrap();
    assert_eq!(logout.status(), reqwest::StatusCode::NO_CONTENT);
    assert!(logout
        .headers()
        .get(SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .contains("Max-Age=0"));

    let logged_out = client
        .get(format!("{base_url}/api/v1/session"))
        .header(COOKIE, cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(logged_out.status(), reqwest::StatusCode::UNAUTHORIZED);

    shutdown_tx.send(()).unwrap();
    server.await.unwrap().unwrap();
}

#[tokio::test]
async fn expires_bootstrap_tokens_and_sessions() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("index.html"), "Tabularis").unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let base_url = format!("http://{address}");
    let (security, expired_bootstrap) = LocalSessionSecurity::new(
        base_url.clone(),
        LocalSessionSecurityConfig {
            bootstrap_ttl: Duration::from_millis(20),
            session_ttl: Duration::from_secs(1),
            max_body_bytes: 1_048_576,
        },
    )
    .unwrap();
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert!(security
        .consume_bootstrap(expired_bootstrap.expose())
        .is_none());

    let (security, bootstrap_token) = LocalSessionSecurity::new(
        base_url.clone(),
        LocalSessionSecurityConfig {
            bootstrap_ttl: Duration::from_secs(1),
            session_ttl: Duration::from_millis(20),
            max_body_bytes: 1_048_576,
        },
    )
    .unwrap();
    let bootstrap_url = format!(
        "{base_url}/api/v1/auth/bootstrap?token={}",
        bootstrap_token.expose()
    );
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let server = tokio::spawn(server::serve(
        listener,
        temp.path().to_path_buf(),
        security,
        test_application(temp.path()),
        async move {
            let _ = shutdown_rx.await;
        },
    ));
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let bootstrap = client.get(bootstrap_url).send().await.unwrap();
    let cookie = bootstrap
        .headers()
        .get(SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();

    tokio::time::sleep(Duration::from_millis(30)).await;
    let expired_session = client
        .get(format!("{base_url}/api/v1/session"))
        .header(COOKIE, cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(expired_session.status(), reqwest::StatusCode::UNAUTHORIZED);

    shutdown_tx.send(()).unwrap();
    server.await.unwrap().unwrap();
}

#[test]
fn redacts_generated_security_tokens() {
    let (security, bootstrap_token) = LocalSessionSecurity::new(
        "http://127.0.0.1:8080".to_string(),
        LocalSessionSecurityConfig::default(),
    )
    .unwrap();
    let token = bootstrap_token.expose().to_string();

    assert!(token.len() >= 43);
    assert!(!format!("{bootstrap_token:?}").contains(&token));
    assert!(!format!("{security:?}").contains(&token));
}

#[test]
fn resolves_explicit_and_packaged_web_roots() {
    let temp = tempfile::tempdir().unwrap();
    let explicit = temp.path().join("explicit");
    std::fs::create_dir_all(&explicit).unwrap();
    std::fs::write(explicit.join("index.html"), "Tabularis").unwrap();

    assert_eq!(
        static_assets::resolve_web_root(Some(&explicit)).unwrap(),
        explicit.canonicalize().unwrap()
    );

    let candidates = static_assets::candidate_web_roots(
        Path::new("/opt/Tabularis.app/Contents/MacOS/tabularis"),
        Path::new("/workspace/packages/web-ui/dist"),
    );
    assert!(candidates
        .contains(&Path::new("/opt/Tabularis.app/Contents/Resources/web-ui").to_path_buf()));
    assert!(candidates.contains(&Path::new("/workspace/packages/web-ui/dist").to_path_buf()));

    let linux_candidates = static_assets::candidate_web_roots(
        Path::new("/usr/bin/tabularis"),
        Path::new("/workspace/packages/web-ui/dist"),
    );
    assert!(linux_candidates.contains(&Path::new("/usr/lib/tabularis/web-ui").to_path_buf()));
}

#[test]
fn rejects_a_web_root_without_an_index() {
    let temp = tempfile::tempdir().unwrap();
    let error = static_assets::resolve_web_root(Some(temp.path())).unwrap_err();

    assert!(error.contains("index.html"));
}

#[tokio::test]
async fn executes_representative_commands_over_versioned_rpc() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("index.html"), "Tabularis").unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let base_url = format!("http://{address}");
    let (security, bootstrap_token) =
        LocalSessionSecurity::new(base_url.clone(), LocalSessionSecurityConfig::default()).unwrap();
    let bootstrap_url = format!(
        "{base_url}/api/v1/auth/bootstrap?token={}",
        bootstrap_token.expose()
    );
    let application_state = Arc::new(ApplicationState::default());
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let server = tokio::spawn(server::serve(
        listener,
        temp.path().to_path_buf(),
        security,
        test_application_with_state(temp.path(), application_state.clone()),
        async move {
            let _ = shutdown_rx.await;
        },
    ));
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let bootstrap = client.get(bootstrap_url).send().await.unwrap();
    let cookie = bootstrap
        .headers()
        .get(SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let session: SessionNegotiation = client
        .get(format!("{base_url}/api/v1/session"))
        .header(COOKIE, &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let debug = client
        .post(format!("{base_url}/api/v1/rpc/is_debug_mode"))
        .header(COOKIE, &cookie)
        .header(ORIGIN, &base_url)
        .header(CSRF_HEADER, &session.csrf_token)
        .json(&serde_json::Value::Null)
        .send()
        .await
        .unwrap();
    assert_eq!(debug.status(), reqwest::StatusCode::OK);
    assert_eq!(debug.json::<serde_json::Value>().await.unwrap()["ok"], true);

    let connections = client
        .post(format!("{base_url}/api/v1/rpc/get_connections"))
        .header(COOKIE, &cookie)
        .header(ORIGIN, &base_url)
        .header(CSRF_HEADER, &session.csrf_token)
        .json(&serde_json::Value::Null)
        .send()
        .await
        .unwrap();
    assert_eq!(connections.status(), reqwest::StatusCode::OK);
    let direct_connections = crate::application::connections::load_connections(
        &crate::paths::resolve_connections_path(temp.path()),
    )
    .unwrap();
    assert_eq!(
        connections.json::<serde_json::Value>().await.unwrap(),
        serde_json::json!({"ok": true, "data": direct_connections})
    );

    let query_task = tokio::spawn(std::future::pending::<()>());
    crate::commands::register_abort_handle(
        &application_state.query_cancellation.handles,
        "connection-1".to_string(),
        Arc::new(query_task.abort_handle()),
    );
    let cancellation = client
        .post(format!("{base_url}/api/v1/rpc/cancel_query"))
        .header(COOKIE, &cookie)
        .header(ORIGIN, &base_url)
        .header(CSRF_HEADER, &session.csrf_token)
        .header(RPC_DEADLINE_HEADER_NAME, "1000")
        .header(RPC_CANCELLATION_HEADER_NAME, "query-1")
        .json(&serde_json::json!({"connectionId": "connection-1"}))
        .send()
        .await
        .unwrap();
    assert_eq!(cancellation.status(), reqwest::StatusCode::OK);
    assert_eq!(
        cancellation.json::<serde_json::Value>().await.unwrap(),
        serde_json::json!({"ok": true, "data": null})
    );
    assert!(query_task.await.is_err());

    let request_id = "request-http".to_string();
    let cancellation_error = client
        .post(format!("{base_url}/api/v1/rpc/cancel_query"))
        .header(COOKIE, &cookie)
        .header(ORIGIN, &base_url)
        .header(CSRF_HEADER, &session.csrf_token)
        .header(REQUEST_ID_HEADER, &request_id)
        .json(&serde_json::json!({"connectionId": "connection-1"}))
        .send()
        .await
        .unwrap();
    assert_eq!(cancellation_error.status(), reqwest::StatusCode::CONFLICT);
    assert_eq!(
        cancellation_error.headers().get(REQUEST_ID_HEADER).unwrap(),
        request_id.as_str()
    );
    let cancellation_error = cancellation_error
        .json::<serde_json::Value>()
        .await
        .unwrap();
    assert_eq!(
        cancellation_error["error"]["code"],
        "QUERY_CANCELLATION_FAILED"
    );
    assert_eq!(cancellation_error["error"]["requestId"], request_id);

    shutdown_tx.send(()).unwrap();
    server.await.unwrap().unwrap();
}

#[tokio::test]
async fn authenticates_websockets_and_delivers_scoped_events_with_heartbeat() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("index.html"), "Tabularis").unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let base_url = format!("http://{address}");
    let websocket_url = format!("ws://{address}/api/v1/events");
    let (security, bootstrap_token) =
        LocalSessionSecurity::new(base_url.clone(), LocalSessionSecurityConfig::default()).unwrap();
    let issued = security
        .consume_bootstrap(bootstrap_token.expose())
        .unwrap();
    let event_scope = security
        .authenticate(&issued.cookie_value)
        .unwrap()
        .event_scope();
    let events = WebEventBus::new(EventBusConfig {
        connection_queue_capacity: 4,
        session_history_capacity: 4,
        max_sessions: 4,
        max_connections_per_session: 2,
        disconnected_session_ttl: Duration::from_secs(1),
        heartbeat_interval: Duration::from_millis(20),
        heartbeat_timeout: Duration::from_millis(80),
    });
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let server = tokio::spawn(server::serve_with_events(
        listener,
        temp.path().to_path_buf(),
        security,
        test_application(temp.path()),
        events.clone(),
        async move {
            let _ = shutdown_rx.await;
        },
    ));

    let unauthorized = tokio_tungstenite::connect_async(&websocket_url)
        .await
        .unwrap_err();
    assert!(matches!(
        unauthorized,
        WebSocketError::Http(response)
            if response.status() == reqwest::StatusCode::UNAUTHORIZED
    ));

    let mut request = websocket_url.into_client_request().unwrap();
    request.headers_mut().insert(
        "cookie",
        format!("tabularis_session={}", issued.cookie_value)
            .parse()
            .unwrap(),
    );
    request
        .headers_mut()
        .insert("origin", base_url.parse().unwrap());
    let (mut websocket, response) = tokio_tungstenite::connect_async(request).await.unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::SWITCHING_PROTOCOLS);

    websocket
        .send(WebSocketMessage::Text(
            serde_json::json!({
                "type": "subscribe",
                "events": ["connection-health-failed"]
            })
            .to_string(),
        ))
        .await
        .unwrap();
    let acknowledgement = websocket.next().await.unwrap().unwrap();
    let WebSocketMessage::Text(acknowledgement) = acknowledgement else {
        panic!("expected a subscription acknowledgement");
    };
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&acknowledgement).unwrap()["type"],
        "subscribed"
    );

    let heartbeat = websocket.next().await.unwrap().unwrap();
    let WebSocketMessage::Ping(payload) = heartbeat else {
        panic!("expected a heartbeat ping");
    };
    websocket
        .send(WebSocketMessage::Pong(payload))
        .await
        .unwrap();

    events
        .emit_to(
            event_scope,
            "connection-health-failed",
            serde_json::json!({"connectionId": "connection-1", "error": "offline"}),
        )
        .unwrap();
    let event = loop {
        match websocket.next().await.unwrap().unwrap() {
            WebSocketMessage::Text(event) => break event,
            WebSocketMessage::Ping(payload) => {
                websocket
                    .send(WebSocketMessage::Pong(payload))
                    .await
                    .unwrap();
            }
            message => panic!("expected an event message, received {message:?}"),
        }
    };
    let event: serde_json::Value = serde_json::from_str(&event).unwrap();
    assert_eq!(event["type"], "event");
    assert_eq!(event["event"], "connection-health-failed");
    assert_eq!(event["payload"]["connectionId"], "connection-1");

    websocket.close(None).await.unwrap();
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert_eq!(events.connection_count(event_scope), 0);

    shutdown_tx.send(()).unwrap();
    server.await.unwrap().unwrap();
}
