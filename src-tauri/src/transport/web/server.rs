use super::auth::{
    AuthenticatedSession, IssuedSession, LocalSessionSecurity, LocalSessionSecurityConfig,
    CSRF_HEADER_NAME, SESSION_COOKIE_NAME,
};
use super::contract::SessionNegotiation;
use axum::extract::{Extension, Query, Request, State};
use axum::http::header::{
    CACHE_CONTROL, CONTENT_TYPE, COOKIE, HOST, LOCATION, ORIGIN, REFERRER_POLICY, SET_COOKIE,
};
use axum::http::{HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use std::future::Future;
use std::path::PathBuf;
use tokio::net::TcpListener;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::services::{ServeDir, ServeFile};
use uuid::Uuid;

const BOOTSTRAP_PATH: &str = "/api/v1/auth/bootstrap";
const REQUEST_ID_HEADER_NAME: &str = "x-request-id";

pub struct WebServerOptions {
    pub host: String,
    pub port: u16,
    pub web_root: PathBuf,
    pub open_browser: bool,
}

#[derive(Clone)]
struct WebServerState {
    security: LocalSessionSecurity,
}

#[derive(Deserialize)]
struct BootstrapQuery {
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

    serve(listener, options.web_root, security, shutdown_signal())
        .await
        .map_err(|error| format!("Web UI server failed: {error}"))
}

pub(crate) async fn serve<F>(
    listener: TcpListener,
    web_root: PathBuf,
    security: LocalSessionSecurity,
    shutdown: F,
) -> std::io::Result<()>
where
    F: Future<Output = ()> + Send + 'static,
{
    axum::serve(listener, router(web_root, security))
        .with_graceful_shutdown(shutdown)
        .await
}

fn router(web_root: PathBuf, security: LocalSessionSecurity) -> Router {
    let index = web_root.join("index.html");
    let static_files = ServeDir::new(web_root).fallback(ServeFile::new(index));
    let max_body_bytes = security.max_body_bytes();
    let state = WebServerState { security };

    Router::new()
        .route("/healthz", get(health))
        .route(BOOTSTRAP_PATH, get(bootstrap))
        .route("/api/v1/session", get(session))
        .route("/api/v1/logout", post(logout))
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

async fn logout(
    State(state): State<WebServerState>,
    Extension(session): Extension<AuthenticatedSession>,
) -> Response {
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

async fn add_request_id(request: Request, next: Next) -> Response {
    let request_id = Uuid::new_v4().to_string();
    let mut response = next.run(request).await;
    if let Ok(value) = HeaderValue::from_str(&request_id) {
        response.headers_mut().insert(REQUEST_ID_HEADER_NAME, value);
    }
    response
}

fn requires_csrf(method: &Method) -> bool {
    !matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
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
