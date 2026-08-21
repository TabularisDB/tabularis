use super::auth::{
    AuthenticatedSession, IssuedSession, LocalSessionSecurity, LocalSessionSecurityConfig,
    CSRF_HEADER_NAME, SESSION_COOKIE_NAME,
};
use super::contract::SessionNegotiation;
use super::events::{ClientEventMessage, EventConnection, ServerEventMessage, WebEventBus};
use super::rpc::{RequestId, RpcDispatcher};
use crate::application::{ApplicationApi, AuthorizationLevel};
use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Extension, Path, Query, Request, State};
use axum::http::header::{
    CACHE_CONTROL, CONTENT_TYPE, COOKIE, HOST, LOCATION, ORIGIN, REFERRER_POLICY, SET_COOKIE,
};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post};
use axum::{Json, Router};
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::time::{Instant, MissedTickBehavior};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::services::{ServeDir, ServeFile};
use uuid::Uuid;

const BOOTSTRAP_PATH: &str = "/api/v1/auth/bootstrap";
const REQUEST_ID_HEADER_NAME: &str = "x-request-id";
const MAX_EVENT_CONTROL_BYTES: usize = 16 * 1024;

pub struct WebServerOptions {
    pub host: String,
    pub port: u16,
    pub web_root: PathBuf,
    pub data_dir: PathBuf,
    pub open_browser: bool,
    pub application: Arc<dyn ApplicationApi>,
    pub events: WebEventBus,
}

#[derive(Clone)]
struct WebServerState {
    security: LocalSessionSecurity,
    rpc: RpcDispatcher,
    events: WebEventBus,
    data_dir: PathBuf,
}

#[derive(Deserialize)]
struct BootstrapQuery {
    token: String,
}

#[derive(Serialize)]
struct IconUploadResponse {
    token: String,
}

pub async fn run(options: WebServerOptions) -> Result<(), String> {
    let listener = TcpListener::bind((options.host.as_str(), options.port))
        .await
        .map_err(|error| {
            format!(
                "Failed to bind the Web UI server to {}:{}: {error}",
                options.host, options.port
            )
        })?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("Failed to read the Web UI server address: {error}"))?;
    let url = format!("http://{address}");
    let (security, bootstrap_token) =
        LocalSessionSecurity::new(url.clone(), LocalSessionSecurityConfig::default())?;
    let bootstrap_url = format!("{url}{BOOTSTRAP_PATH}?token={}", bootstrap_token.expose());

    println!("Tabularis Web is available at {url}");
    if options.open_browser && open::that(&bootstrap_url).is_err() {
        log::warn!("Failed to open the Web UI in the default browser");
    }
    drop(bootstrap_url);
    drop(bootstrap_token);

    serve_with_events(
        listener,
        options.web_root,
        options.data_dir,
        security,
        options.application,
        options.events,
        shutdown_signal(),
    )
    .await
    .map_err(|error| format!("Web UI server failed: {error}"))
}

#[cfg(test)]
pub(crate) async fn serve<F>(
    listener: TcpListener,
    web_root: PathBuf,
    security: LocalSessionSecurity,
    application: Arc<dyn ApplicationApi>,
    shutdown: F,
) -> std::io::Result<()>
where
    F: Future<Output = ()> + Send + 'static,
{
    let data_dir = web_root.clone();
    serve_with_events(
        listener,
        web_root,
        data_dir,
        security,
        application,
        WebEventBus::default(),
        shutdown,
    )
    .await
}

pub(crate) async fn serve_with_events<F>(
    listener: TcpListener,
    web_root: PathBuf,
    data_dir: PathBuf,
    security: LocalSessionSecurity,
    application: Arc<dyn ApplicationApi>,
    events: WebEventBus,
    shutdown: F,
) -> std::io::Result<()>
where
    F: Future<Output = ()> + Send + 'static,
{
    axum::serve(
        listener,
        router(web_root, data_dir, security, application, events),
    )
    .with_graceful_shutdown(shutdown)
    .await
}

fn router(
    web_root: PathBuf,
    data_dir: PathBuf,
    security: LocalSessionSecurity,
    application: Arc<dyn ApplicationApi>,
    events: WebEventBus,
) -> Router {
    let index = web_root.join("index.html");
    let static_files = ServeDir::new(web_root).fallback(ServeFile::new(index));
    let max_body_bytes = security.max_body_bytes();
    let state = WebServerState {
        security,
        rpc: RpcDispatcher::new(application),
        events,
        data_dir,
    };

    Router::new()
        .route("/healthz", get(health))
        .route(BOOTSTRAP_PATH, get(bootstrap))
        .route("/api/v1/session", get(session))
        .route("/api/v1/logout", post(logout))
        .route("/api/v1/events", get(event_stream))
        .route("/api/v1/rpc/:command", post(rpc))
        .route(
            "/api/v1/uploads/connection-icons",
            post(upload_connection_icon),
        )
        .route(
            "/api/v1/assets/connection-icons/:filename",
            get(connection_icon_asset),
        )
        .route("/api/*path", any(StatusCode::NOT_FOUND))
        .fallback_service(static_files)
        .with_state(state.clone())
        .layer(RequestBodyLimitLayer::new(max_body_bytes))
        .layer(middleware::from_fn_with_state(state, security_gate))
        .layer(middleware::from_fn(add_request_id))
}

async fn health() -> impl IntoResponse {
    (
        [(CACHE_CONTROL, "no-store"), (CONTENT_TYPE, "text/plain")],
        "ok",
    )
}

async fn bootstrap(
    State(state): State<WebServerState>,
    Query(query): Query<BootstrapQuery>,
) -> Response {
    let Some(session) = state.security.consume_bootstrap(&query.token) else {
        return status_response(StatusCode::UNAUTHORIZED);
    };

    let mut response = StatusCode::SEE_OTHER.into_response();
    response
        .headers_mut()
        .insert(LOCATION, HeaderValue::from_static("/"));
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
        .headers_mut()
        .insert(REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    response
        .headers_mut()
        .insert(SET_COOKIE, session_cookie(&session));
    response
}

async fn session(Extension(session): Extension<AuthenticatedSession>) -> impl IntoResponse {
    (
        [(CACHE_CONTROL, "no-store")],
        Json(SessionNegotiation::authenticated(session.csrf_token)),
    )
}

async fn rpc(
    State(state): State<WebServerState>,
    Path(command): Path<String>,
    Extension(session): Extension<AuthenticatedSession>,
    Extension(request_id): Extension<RequestId>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    state
        .rpc
        .dispatch(
            &command,
            request_id,
            &headers,
            body,
            Some(session.event_scope()),
        )
        .await
}

async fn upload_connection_icon(
    State(state): State<WebServerState>,
    Extension(session): Extension<AuthenticatedSession>,
    body: Bytes,
) -> Response {
    match crate::application::connections::store_icon_upload(
        &state.data_dir,
        session.event_scope(),
        &body,
    ) {
        Ok(token) => (
            StatusCode::CREATED,
            [(CACHE_CONTROL, "no-store")],
            Json(IconUploadResponse { token }),
        )
            .into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            [(CACHE_CONTROL, "no-store")],
            error,
        )
            .into_response(),
    }
}

async fn connection_icon_asset(
    State(state): State<WebServerState>,
    Path(filename): Path<String>,
) -> Response {
    let relative_path = format!("connection-icons/{filename}");
    let path = match crate::application::connections::resolve_icon_asset(
        &state.data_dir,
        &relative_path,
    ) {
        Ok(path) => path,
        Err(_) => return status_response(StatusCode::NOT_FOUND),
    };
    let bytes = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(_) => return status_response(StatusCode::NOT_FOUND),
    };
    let content_type = match path.extension().and_then(|extension| extension.to_str()) {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    };
    (
        StatusCode::OK,
        [
            (CACHE_CONTROL, "private, max-age=300"),
            (CONTENT_TYPE, content_type),
        ],
        bytes,
    )
        .into_response()
}

async fn event_stream(
    State(state): State<WebServerState>,
    Extension(session): Extension<AuthenticatedSession>,
    websocket: WebSocketUpgrade,
) -> Response {
    let connection = match state
        .events
        .connect(session.event_scope(), AuthorizationLevel::LocalAdmin)
    {
        Ok(connection) => connection,
        Err(error) => {
            log::warn!("Rejected WebSocket event connection: {error}");
            return status_response(StatusCode::SERVICE_UNAVAILABLE);
        }
    };
    let events = state.events.clone();
    websocket.on_upgrade(move |socket| event_socket(socket, connection, events))
}

async fn event_socket(socket: WebSocket, mut connection: EventConnection, events: WebEventBus) {
    let (mut sender, mut receiver) = socket.split();
    let mut heartbeat = tokio::time::interval(events.heartbeat_interval());
    heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
    heartbeat.tick().await;
    let mut last_pong = Instant::now();

    loop {
        tokio::select! {
            event = connection.recv() => {
                let Some(event) = event else {
                    let _ = sender.send(Message::Close(None)).await;
                    break;
                };
                let message = ServerEventMessage::Event { envelope: &event };
                if send_event_message(&mut sender, &message).await.is_err() {
                    break;
                }
            }
            _ = heartbeat.tick() => {
                if last_pong.elapsed() >= events.heartbeat_timeout() {
                    let _ = sender.send(Message::Close(None)).await;
                    break;
                }
                if sender.send(Message::Ping(Vec::new())).await.is_err() {
                    break;
                }
            }
            message = receiver.next() => {
                let Some(Ok(message)) = message else {
                    break;
                };
                match message {
                    Message::Text(text) => {
                        if text.len() > MAX_EVENT_CONTROL_BYTES {
                            let message = ServerEventMessage::Error {
                                code: "CONTROL_MESSAGE_TOO_LARGE",
                                message: "The WebSocket control message is too large",
                            };
                            if send_event_message(&mut sender, &message).await.is_err() {
                                break;
                            }
                            continue;
                        }
                        let control = match serde_json::from_str::<ClientEventMessage>(&text) {
                            Ok(control) => control,
                            Err(_) => {
                                let message = ServerEventMessage::Error {
                                    code: "INVALID_CONTROL_MESSAGE",
                                    message: "The WebSocket control message is invalid",
                                };
                                if send_event_message(&mut sender, &message).await.is_err() {
                                    break;
                                }
                                continue;
                            }
                        };
                        if handle_event_control(&mut sender, &mut connection, control).await.is_err() {
                            break;
                        }
                    }
                    Message::Ping(payload) => {
                        if sender.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Message::Pong(_) => last_pong = Instant::now(),
                    Message::Close(_) => break,
                    Message::Binary(_) => {
                        let message = ServerEventMessage::Error {
                            code: "INVALID_CONTROL_MESSAGE",
                            message: "WebSocket control messages must be JSON text",
                        };
                        if send_event_message(&mut sender, &message).await.is_err() {
                            break;
                        }
                    }
                }
            }
        }
    }
}

async fn handle_event_control<S>(
    sender: &mut S,
    connection: &mut EventConnection,
    control: ClientEventMessage,
) -> Result<(), ()>
where
    S: futures::Sink<Message> + Unpin,
{
    match control {
        ClientEventMessage::Subscribe { events, since } => {
            match connection.subscribe(&events, since) {
                Ok(replay) => {
                    let acknowledgement = ServerEventMessage::Subscribed {
                        events: &events,
                        replayed: replay.len(),
                    };
                    send_event_message(sender, &acknowledgement).await?;
                    for event in &replay {
                        send_event_message(sender, &ServerEventMessage::Event { envelope: event })
                            .await?;
                    }
                }
                Err(error) => {
                    send_event_message(
                        sender,
                        &ServerEventMessage::Error {
                            code: "SUBSCRIPTION_REJECTED",
                            message: &error,
                        },
                    )
                    .await?;
                }
            }
        }
        ClientEventMessage::Unsubscribe { events } => match connection.unsubscribe(&events) {
            Ok(()) => {
                send_event_message(
                    sender,
                    &ServerEventMessage::Unsubscribed { events: &events },
                )
                .await?;
            }
            Err(error) => {
                send_event_message(
                    sender,
                    &ServerEventMessage::Error {
                        code: "SUBSCRIPTION_REJECTED",
                        message: &error,
                    },
                )
                .await?;
            }
        },
    }
    Ok(())
}

async fn send_event_message<S>(sender: &mut S, message: &ServerEventMessage<'_>) -> Result<(), ()>
where
    S: futures::Sink<Message> + Unpin,
{
    let text = serde_json::to_string(message).map_err(|_| ())?;
    sender.send(Message::Text(text)).await.map_err(|_| ())
}

async fn logout(
    State(state): State<WebServerState>,
    Extension(session): Extension<AuthenticatedSession>,
) -> Response {
    state.events.remove_session(session.event_scope());
    state.security.logout(&session);
    let mut response = StatusCode::NO_CONTENT.into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        SET_COOKIE,
        HeaderValue::from_static(
            "tabularis_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
        ),
    );
    response
}

async fn security_gate(
    State(state): State<WebServerState>,
    mut request: Request,
    next: Next,
) -> Response {
    if request
        .headers()
        .get(HOST)
        .and_then(|value| value.to_str().ok())
        != Some(state.security.expected_host())
    {
        return status_response(StatusCode::FORBIDDEN);
    }

    let origin = request
        .headers()
        .get(ORIGIN)
        .and_then(|value| value.to_str().ok());
    if origin.is_some_and(|value| value != state.security.expected_origin()) {
        return status_response(StatusCode::FORBIDDEN);
    }

    let path = request.uri().path();
    if path == "/healthz" || (path == BOOTSTRAP_PATH && request.method() == Method::GET) {
        return next.run(request).await;
    }

    let Some(cookie_value) = session_cookie_value(request.headers().get(COOKIE)) else {
        return status_response(StatusCode::UNAUTHORIZED);
    };
    let Some(session) = state.security.authenticate(cookie_value) else {
        return status_response(StatusCode::UNAUTHORIZED);
    };

    if requires_csrf(request.method()) {
        if origin != Some(state.security.expected_origin())
            || request
                .headers()
                .get(CSRF_HEADER_NAME)
                .and_then(|value| value.to_str().ok())
                != Some(session.csrf_token.as_str())
        {
            return status_response(StatusCode::FORBIDDEN);
        }
    }

    request.extensions_mut().insert(session);
    next.run(request).await
}

async fn add_request_id(mut request: Request, next: Next) -> Response {
    let request_id = request
        .headers()
        .get(REQUEST_ID_HEADER_NAME)
        .and_then(|value| value.to_str().ok())
        .filter(|value| valid_request_id(value))
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    request
        .extensions_mut()
        .insert(RequestId(request_id.clone()));
    let mut response = next.run(request).await;
    if let Ok(value) = HeaderValue::from_str(&request_id) {
        response.headers_mut().insert(REQUEST_ID_HEADER_NAME, value);
    }
    response
}

fn requires_csrf(method: &Method) -> bool {
    !matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
}

fn valid_request_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

fn session_cookie_value(cookie_header: Option<&HeaderValue>) -> Option<&str> {
    cookie_header?
        .to_str()
        .ok()?
        .split(';')
        .filter_map(|cookie| cookie.trim().split_once('='))
        .find_map(|(name, value)| (name == SESSION_COOKIE_NAME).then_some(value))
}

fn session_cookie(session: &IssuedSession) -> HeaderValue {
    HeaderValue::from_str(&format!(
        "{SESSION_COOKIE_NAME}={}; Path=/; HttpOnly; SameSite=Strict; Max-Age={}",
        session.cookie_value, session.max_age_seconds
    ))
    .expect("generated session cookies contain only valid header characters")
}

fn status_response(status: StatusCode) -> Response {
    let mut response = status.into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            log::error!("Failed to install the Ctrl+C shutdown handler: {error}");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => {
                log::error!("Failed to install the terminate shutdown handler: {error}");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }

    log::info!("Web UI shutdown signal received");
}
