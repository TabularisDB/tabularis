use super::auth::{
    AuthenticatedSession, AuthenticationError, IssuedSession, LocalSessionSecurity,
    LocalSessionSecurityConfig, RemoteAuthentication, RemoteSessionSecurityConfig,
    CSRF_HEADER_NAME, PROXY_SECRET_HEADER_NAME, PROXY_USER_HEADER_NAME, SESSION_COOKIE_NAME,
};
use super::contract::SessionNegotiation;
use super::events::{ClientEventMessage, EventConnection, ServerEventMessage, WebEventBus};
use super::rpc::{RequestId, RpcAccessPolicy, RpcDispatcher};
use crate::application::file_transfers::{
    FileTransferStore, TransferReader, MAX_FILE_TRANSFER_BYTES,
};
use crate::application::{ApplicationApi, AuthorizationLevel};
use crate::cli::WebAuthMode;
use axum::body::{Body, Bytes};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Extension, Path, Query, Request, State};
use axum::http::header::{
    CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_SECURITY_POLICY, CONTENT_TYPE,
    COOKIE, HOST, LOCATION, ORIGIN, REFERRER_POLICY, RETRY_AFTER, SET_COOKIE,
    X_CONTENT_TYPE_OPTIONS,
};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
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
use tokio_util::io::ReaderStream;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::services::{ServeDir, ServeFile};
use url::Host;
use uuid::Uuid;

const BOOTSTRAP_PATH: &str = "/api/v1/auth/bootstrap";
const LOGIN_PATH: &str = "/api/v1/auth/login";
const LOGIN_PAGE_PATH: &str = "/login";
const REQUEST_ID_HEADER_NAME: &str = "x-request-id";
const MAX_EVENT_CONTROL_BYTES: usize = 16 * 1024;
const FILE_NAME_HEADER_NAME: &str = "x-tabularis-file-name";
const FILE_PURPOSE_HEADER_NAME: &str = "x-tabularis-purpose";
const BLOB_TRANSFER_PURPOSE: &str = "blob";
const PLUGIN_ASSET_CSP: &str = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; sandbox";
const CROSS_ORIGIN_RESOURCE_POLICY: HeaderName =
    HeaderName::from_static("cross-origin-resource-policy");

pub struct WebServerOptions {
    pub host: String,
    pub port: u16,
    pub web_root: PathBuf,
    pub data_dir: PathBuf,
    pub open_browser: bool,
    pub auth: Option<WebAuthMode>,
    pub public_url: Option<String>,
    pub allowed_origins: Vec<String>,
    pub allow_high_risk: bool,
    pub application: Arc<dyn ApplicationApi>,
    pub events: WebEventBus,
}

#[derive(Clone)]
struct WebServerState {
    security: LocalSessionSecurity,
    rpc: RpcDispatcher,
    events: WebEventBus,
    transfers: FileTransferStore,
    data_dir: PathBuf,
    mcp_host_configuration: bool,
}

#[derive(Deserialize)]
struct BootstrapQuery {
    token: String,
}

#[derive(Serialize)]
struct IconUploadResponse {
    token: String,
}

#[derive(Serialize)]
struct BlobUploadResponse {
    value: String,
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

    let (security, launch_url, public_url) = match options.auth {
        Some(auth_mode) => {
            let public_url = options.public_url.clone().ok_or_else(|| {
                "Remote Web UI mode requires --public-url with an HTTPS origin".to_string()
            })?;
            let authentication = remote_authentication(auth_mode)?;
            let authorization = if options.allow_high_risk {
                AuthorizationLevel::LocalAdmin
            } else {
                AuthorizationLevel::Database
            };
            let security = LocalSessionSecurity::new_remote(
                RemoteSessionSecurityConfig {
                    public_origin: public_url.clone(),
                    allowed_origins: options.allowed_origins.clone(),
                    session_ttl: LocalSessionSecurityConfig::default().session_ttl,
                    max_body_bytes: LocalSessionSecurityConfig::default().max_body_bytes,
                    authorization,
                    rate_limit: Default::default(),
                },
                authentication,
            )?;
            let launch_url = if auth_mode == WebAuthMode::Password {
                format!("{}{LOGIN_PAGE_PATH}", security.expected_origin())
            } else {
                format!("{}/", security.expected_origin())
            };
            (security, launch_url, public_url)
        }
        None => {
            if !address.ip().is_loopback() {
                return Err(
                    "Non-loopback Web UI binding requires --auth, --public-url, and --allowed-origin"
                        .to_string(),
                );
            }
            let public_url = format!("http://{address}");
            let (security, bootstrap_token) = LocalSessionSecurity::new(
                public_url.clone(),
                LocalSessionSecurityConfig::default(),
            )?;
            let launch_url = format!(
                "{public_url}{BOOTSTRAP_PATH}?token={}",
                bootstrap_token.expose()
            );
            drop(bootstrap_token);
            (security, launch_url, public_url)
        }
    };

    println!("Tabularis Web is available at {public_url}");
    if options.open_browser && open::that(&launch_url).is_err() {
        log::warn!("Failed to open the Web UI in the default browser");
    }
    drop(launch_url);

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

fn remote_authentication(auth_mode: WebAuthMode) -> Result<RemoteAuthentication, String> {
    match auth_mode {
        WebAuthMode::Password => std::env::var("TABULARIS_WEB_PASSWORD")
            .map(|password| RemoteAuthentication::password(&password))
            .map_err(|_| "Password authentication requires TABULARIS_WEB_PASSWORD".to_string()),
        WebAuthMode::Proxy => std::env::var("TABULARIS_WEB_PROXY_SECRET")
            .map(|secret| RemoteAuthentication::proxy(&secret))
            .map_err(|_| "Proxy authentication requires TABULARIS_WEB_PROXY_SECRET".to_string()),
    }
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
    let mcp_host_configuration =
        !security.is_remote() && mcp_host_configuration_enabled(security.expected_origin());
    let state = WebServerState {
        security,
        rpc: RpcDispatcher::with_access_policy(
            application,
            RpcAccessPolicy {
                mcp_host_configuration,
            },
        ),
        events,
        transfers: FileTransferStore::new(&data_dir),
        data_dir,
        mcp_host_configuration,
    };

    let standard_routes = Router::new()
        .route("/api/v1/session", get(session))
        .route(LOGIN_PAGE_PATH, get(login_page))
        .route(LOGIN_PATH, post(login))
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
        .route(
            "/api/v1/assets/plugins/:plugin_id/*asset_path",
            get(plugin_asset),
        )
        .route("/api/*path", any(StatusCode::NOT_FOUND))
        .layer(RequestBodyLimitLayer::new(max_body_bytes));
    let file_routes = Router::new()
        .route("/api/v1/uploads", post(upload_file))
        .route("/api/v1/downloads/:token", get(download_blob))
        .layer(RequestBodyLimitLayer::new(MAX_FILE_TRANSFER_BYTES as usize));
    let blob_routes = Router::new()
        .route("/api/v1/uploads/blobs", post(upload_blob))
        .route("/api/v1/uploads/blobs/:token", get(uploaded_blob))
        .layer(RequestBodyLimitLayer::new(
            crate::application::records::MAX_WEB_BLOB_BYTES as usize,
        ));

    Router::new()
        .route("/healthz", get(health))
        .route(BOOTSTRAP_PATH, get(bootstrap))
        .merge(standard_routes)
        .merge(file_routes)
        .merge(blob_routes)
        .fallback_service(static_files)
        .with_state(state.clone())
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
    Extension(request_id): Extension<RequestId>,
) -> Response {
    let Some(session) = state.security.consume_bootstrap(&query.token) else {
        audit_event(
            "authentication",
            &request_id.0,
            None,
            "method=bootstrap outcome=denied",
        );
        return status_response(StatusCode::UNAUTHORIZED);
    };
    audit_event(
        "authentication",
        &request_id.0,
        Some(session.session_id()),
        "method=bootstrap outcome=success",
    );

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
    response.headers_mut().insert(
        SET_COOKIE,
        session_cookie(&session, state.security.secure_cookie()),
    );
    response
}

async fn login_page(State(state): State<WebServerState>) -> Response {
    if !state.security.password_authentication() {
        return status_response(StatusCode::NOT_FOUND);
    }
    login_page_response(StatusCode::OK, None)
}

async fn login(
    State(state): State<WebServerState>,
    Extension(request_id): Extension<RequestId>,
    body: Bytes,
) -> Response {
    if !state.security.password_authentication() {
        return status_response(StatusCode::NOT_FOUND);
    }
    let Some(password) = form_password(&body) else {
        audit_event(
            "authentication",
            &request_id.0,
            None,
            "method=password outcome=denied",
        );
        return login_page_response(StatusCode::UNAUTHORIZED, Some("Invalid credentials"));
    };
    match state.security.authenticate_password(&password) {
        Ok(session) => {
            audit_event(
                "authentication",
                &request_id.0,
                Some(session.session_id()),
                "method=password outcome=success",
            );
            let mut response = StatusCode::SEE_OTHER.into_response();
            response
                .headers_mut()
                .insert(LOCATION, HeaderValue::from_static("/"));
            response
                .headers_mut()
                .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
            response.headers_mut().insert(
                SET_COOKIE,
                session_cookie(&session, state.security.secure_cookie()),
            );
            response
        }
        Err(error) => {
            audit_authentication_error(&request_id.0, "password", error);
            authentication_error_response(error, true)
        }
    }
}

async fn session(
    State(state): State<WebServerState>,
    Extension(session): Extension<AuthenticatedSession>,
) -> impl IntoResponse {
    (
        [(CACHE_CONTROL, "no-store")],
        Json(SessionNegotiation::authenticated_with_access(
            session.csrf_token.clone(),
            state.mcp_host_configuration,
            session.is_remote(),
            session.authorization(),
        )),
    )
}

pub(crate) fn mcp_host_configuration_enabled(origin: &str) -> bool {
    url::Url::parse(origin)
        .ok()
        .and_then(|url| {
            url.host().map(|host| match host {
                Host::Domain(host) => host.eq_ignore_ascii_case("localhost"),
                Host::Ipv4(host) => host.is_loopback(),
                Host::Ipv6(host) => host.is_loopback(),
            })
        })
        .unwrap_or(false)
}

async fn rpc(
    State(state): State<WebServerState>,
    Path(command): Path<String>,
    Extension(session): Extension<AuthenticatedSession>,
    Extension(request_id): Extension<RequestId>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let session_id = session.event_scope();
    let request_id_text = request_id.0.clone();
    let response = state
        .rpc
        .dispatch_with_authorization(
            &command,
            request_id,
            &headers,
            body,
            Some(session_id),
            session.authorization(),
        )
        .await;
    let audited_command = if response.status() == StatusCode::NOT_FOUND {
        "unknown"
    } else {
        command.as_str()
    };
    audit_event(
        "rpc",
        &request_id_text,
        Some(session_id),
        &format!(
            "command={audited_command} status={}",
            response.status().as_u16()
        ),
    );
    response
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

async fn upload_file(
    State(state): State<WebServerState>,
    Extension(session): Extension<AuthenticatedSession>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let Some(purpose) = header_text(&headers, FILE_PURPOSE_HEADER_NAME) else {
        return upload_error_response("A file transfer purpose is required".to_string());
    };
    let Some(encoded_name) = header_text(&headers, FILE_NAME_HEADER_NAME) else {
        return upload_error_response("A file name is required".to_string());
    };
    let file_name = match urlencoding::decode(encoded_name) {
        Ok(file_name) => file_name,
        Err(_) => return upload_error_response("The file name is invalid".to_string()),
    };
    let content_type = header_text(&headers, CONTENT_TYPE.as_str());
    match state
        .transfers
        .store_upload(
            session.event_scope(),
            purpose,
            &file_name,
            content_type,
            body.into_data_stream(),
        )
        .await
    {
        Ok(metadata) => (
            StatusCode::CREATED,
            [(CACHE_CONTROL, "no-store")],
            Json(metadata),
        )
            .into_response(),
        Err(error) => upload_error_response(error),
    }
}

async fn upload_blob(
    State(state): State<WebServerState>,
    Extension(session): Extension<AuthenticatedSession>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let content_type = header_text(&headers, CONTENT_TYPE.as_str());
    match state
        .transfers
        .store_upload(
            session.event_scope(),
            BLOB_TRANSFER_PURPOSE,
            "blob-upload.bin",
            content_type,
            body.into_data_stream(),
        )
        .await
    {
        Ok(metadata) if metadata.size > 0 => {
            let value = format!(
                "BLOB_UPLOAD_REF:{}:{}:{}",
                metadata.size, metadata.mime_type, metadata.token
            );
            (
                StatusCode::CREATED,
                [(CACHE_CONTROL, "no-store")],
                Json(BlobUploadResponse { value }),
            )
                .into_response()
        }
        Ok(metadata) => {
            let _ = state.transfers.claim_upload(
                session.event_scope(),
                &metadata.token,
                BLOB_TRANSFER_PURPOSE,
            );
            upload_error_response("The uploaded BLOB is empty".to_string())
        }
        Err(error) => upload_error_response(error),
    }
}

async fn uploaded_blob(
    State(state): State<WebServerState>,
    Path(token): Path<String>,
    Extension(session): Extension<AuthenticatedSession>,
) -> Response {
    match state
        .transfers
        .open_upload(session.event_scope(), &token, BLOB_TRANSFER_PURPOSE)
        .await
    {
        Ok(reader) => streaming_transfer_response(reader, false, true),
        Err(_) => status_response(StatusCode::NOT_FOUND),
    }
}

async fn download_blob(
    State(state): State<WebServerState>,
    Path(token): Path<String>,
    Extension(session): Extension<AuthenticatedSession>,
) -> Response {
    match state
        .transfers
        .consume_download(session.event_scope(), &token)
        .await
    {
        Ok(reader) => streaming_transfer_response(reader, true, false),
        Err(_) => status_response(StatusCode::NOT_FOUND),
    }
}

fn streaming_transfer_response(
    reader: TransferReader,
    attachment: bool,
    sandbox: bool,
) -> Response {
    let metadata = reader.metadata().clone();
    let disposition = if attachment { "attachment" } else { "inline" };
    let content_disposition = format!("{disposition}; filename=\"{}\"", metadata.file_name);
    let mut response = Response::new(Body::from_stream(ReaderStream::new(reader)));
    *response.status_mut() = StatusCode::OK;
    let headers = response.headers_mut();
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_str(&metadata.mime_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(
        CONTENT_LENGTH,
        HeaderValue::from_str(&metadata.size.to_string())
            .expect("file transfer sizes are valid header values"),
    );
    headers.insert(
        CONTENT_DISPOSITION,
        HeaderValue::from_str(&content_disposition)
            .expect("sanitized file names are valid header values"),
    );
    headers.insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    if sandbox {
        headers.insert(
            CONTENT_SECURITY_POLICY,
            HeaderValue::from_static("sandbox; default-src 'none'"),
        );
    }
    response
}

fn header_text<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name)?.to_str().ok()
}

fn upload_error_response(error: String) -> Response {
    let status = if error.contains("byte limit") {
        StatusCode::PAYLOAD_TOO_LARGE
    } else {
        StatusCode::BAD_REQUEST
    };
    (status, [(CACHE_CONTROL, "no-store")], error).into_response()
}

async fn plugin_asset(
    State(state): State<WebServerState>,
    Path((plugin_id, asset_path)): Path<(String, String)>,
) -> Response {
    let plugins_dir = state.data_dir.join("plugins");
    let asset = match crate::application::plugin_assets::read_plugin_asset(
        &plugins_dir,
        &plugin_id,
        &asset_path,
    ) {
        Ok(asset) => asset,
        Err(_) => return status_response(StatusCode::NOT_FOUND),
    };

    let mut response = Response::new(Body::from(asset.bytes));
    *response.status_mut() = StatusCode::OK;
    let headers = response.headers_mut();
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static(asset.content_type));
    headers.insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    headers.insert(
        CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(PLUGIN_ASSET_CSP),
    );
    headers.insert(
        CROSS_ORIGIN_RESOURCE_POLICY,
        HeaderValue::from_static("same-origin"),
    );
    response
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
        .connect(session.event_scope(), session.authorization())
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
    Extension(request_id): Extension<RequestId>,
) -> Response {
    let session_id = session.event_scope();
    state.events.remove_session(session_id);
    state.rpc.clear_session(session.event_scope());
    state.transfers.cleanup_session(session.event_scope());
    state.security.logout(&session);
    audit_event("logout", &request_id.0, Some(session_id), "outcome=success");
    let mut response = StatusCode::NO_CONTENT.into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    let secure = if state.security.secure_cookie() {
        "; Secure"
    } else {
        ""
    };
    response.headers_mut().insert(
        SET_COOKIE,
        HeaderValue::from_str(&format!(
            "tabularis_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{secure}"
        ))
        .expect("the session cookie attributes are valid"),
    );
    response
}

async fn security_gate(
    State(state): State<WebServerState>,
    mut request: Request,
    next: Next,
) -> Response {
    let request_id = request
        .extensions()
        .get::<RequestId>()
        .map(|request_id| request_id.0.as_str())
        .unwrap_or("unknown");
    let host = request
        .headers()
        .get(HOST)
        .and_then(|value| value.to_str().ok());
    if !host.is_some_and(|host| state.security.host_allowed(host)) {
        audit_event("request", request_id, None, "outcome=denied reason=host");
        return status_response(StatusCode::FORBIDDEN);
    }

    let origin = request
        .headers()
        .get(ORIGIN)
        .and_then(|value| value.to_str().ok());
    if origin.is_some_and(|value| !state.security.origin_allowed(value)) {
        audit_event("request", request_id, None, "outcome=denied reason=origin");
        return status_response(StatusCode::FORBIDDEN);
    }

    let path = request.uri().path();
    let local_bootstrap =
        !state.security.is_remote() && path == BOOTSTRAP_PATH && request.method() == Method::GET;
    let password_login = state.security.password_authentication()
        && ((path == LOGIN_PAGE_PATH && request.method() == Method::GET)
            || (path == LOGIN_PATH && request.method() == Method::POST));
    if path == "/healthz" || local_bootstrap || password_login {
        if path == LOGIN_PATH && !origin.is_some_and(|origin| state.security.origin_allowed(origin))
        {
            audit_event(
                "authentication",
                request_id,
                None,
                "method=password outcome=denied reason=origin",
            );
            return status_response(StatusCode::FORBIDDEN);
        }
        return next.run(request).await;
    }

    let mut issued_session = None;
    let session = session_cookie_value(request.headers().get(COOKIE))
        .and_then(|cookie_value| state.security.authenticate(cookie_value));
    let session = match session {
        Some(session) => session,
        None if state.security.proxy_authentication() => {
            let secret = request
                .headers()
                .get(PROXY_SECRET_HEADER_NAME)
                .and_then(|value| value.to_str().ok());
            let user = request
                .headers()
                .get(PROXY_USER_HEADER_NAME)
                .and_then(|value| value.to_str().ok());
            let (Some(secret), Some(user)) = (secret, user) else {
                audit_event(
                    "authentication",
                    request_id,
                    None,
                    "method=proxy outcome=denied reason=missing_headers",
                );
                return status_response(StatusCode::UNAUTHORIZED);
            };
            match state.security.authenticate_proxy(secret, user) {
                Ok(issued) => {
                    let session = state
                        .security
                        .authenticate(&issued.cookie_value)
                        .expect("a newly issued proxy session is active");
                    audit_event(
                        "authentication",
                        request_id,
                        Some(issued.session_id()),
                        "method=proxy outcome=success",
                    );
                    issued_session = Some(issued);
                    session
                }
                Err(error) => {
                    audit_authentication_error(request_id, "proxy", error);
                    return authentication_error_response(error, false);
                }
            }
        }
        None if state.security.password_authentication() && request.method() == Method::GET => {
            let mut response = StatusCode::SEE_OTHER.into_response();
            response
                .headers_mut()
                .insert(LOCATION, HeaderValue::from_static(LOGIN_PAGE_PATH));
            return response;
        }
        None => return status_response(StatusCode::UNAUTHORIZED),
    };

    if requires_csrf(request.method()) {
        if !origin.is_some_and(|origin| state.security.origin_allowed(origin))
            || request
                .headers()
                .get(CSRF_HEADER_NAME)
                .and_then(|value| value.to_str().ok())
                != Some(session.csrf_token.as_str())
        {
            audit_event(
                "request",
                request_id,
                Some(session.event_scope()),
                "outcome=denied reason=csrf",
            );
            return status_response(StatusCode::FORBIDDEN);
        }
    }

    request.headers_mut().remove(PROXY_SECRET_HEADER_NAME);
    request.headers_mut().remove(PROXY_USER_HEADER_NAME);
    request.extensions_mut().insert(session);
    let mut response = next.run(request).await;
    if let Some(issued) = issued_session {
        response.headers_mut().insert(
            SET_COOKIE,
            session_cookie(&issued, state.security.secure_cookie()),
        );
    }
    response
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

fn session_cookie(session: &IssuedSession, secure: bool) -> HeaderValue {
    let secure = if secure { "; Secure" } else { "" };
    HeaderValue::from_str(&format!(
        "{SESSION_COOKIE_NAME}={}; Path=/; HttpOnly; SameSite=Strict; Max-Age={}{secure}",
        session.cookie_value, session.max_age_seconds
    ))
    .expect("generated session cookies contain only valid header characters")
}

fn form_password(body: &[u8]) -> Option<String> {
    url::form_urlencoded::parse(body)
        .find_map(|(name, value)| (name == "password").then(|| value.into_owned()))
}

fn login_page_response(status: StatusCode, error: Option<&str>) -> Response {
    let error = error
        .map(|message| format!("<p role=\"alert\">{message}</p>"))
        .unwrap_or_default();
    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Tabularis Web sign in</title></head><body><main><h1>Sign in to Tabularis Web</h1>{error}<form method=\"post\" action=\"{LOGIN_PATH}\"><label>Password <input type=\"password\" name=\"password\" required autofocus autocomplete=\"current-password\"></label><button type=\"submit\">Sign in</button></form></main></body></html>"
    );
    let mut response = (status, body).into_response();
    let headers = response.headers_mut();
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers.insert(REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    headers.insert(
        CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        ),
    );
    response
}

fn authentication_error_response(error: AuthenticationError, html: bool) -> Response {
    match error {
        AuthenticationError::RateLimited => {
            let mut response = if html {
                login_page_response(StatusCode::TOO_MANY_REQUESTS, Some("Too many attempts"))
            } else {
                status_response(StatusCode::TOO_MANY_REQUESTS)
            };
            response
                .headers_mut()
                .insert(RETRY_AFTER, HeaderValue::from_static("300"));
            response
        }
        AuthenticationError::InvalidCredentials | AuthenticationError::UnsupportedMode => {
            if html {
                login_page_response(StatusCode::UNAUTHORIZED, Some("Invalid credentials"))
            } else {
                status_response(StatusCode::UNAUTHORIZED)
            }
        }
    }
}

fn audit_authentication_error(request_id: &str, method: &str, error: AuthenticationError) {
    let outcome = match error {
        AuthenticationError::RateLimited => "rate_limited",
        AuthenticationError::InvalidCredentials | AuthenticationError::UnsupportedMode => "denied",
    };
    audit_event(
        "authentication",
        request_id,
        None,
        &format!("method={method} outcome={outcome}"),
    );
}

fn audit_event(event: &str, request_id: &str, session_id: Option<Uuid>, detail: &str) {
    let session_id = session_id
        .map(|session_id| session_id.to_string())
        .unwrap_or_else(|| "none".to_string());
    log::info!(
        target: "tabularis::web_audit",
        "event={event} request_id={request_id} session_id={session_id} {detail}"
    );
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
