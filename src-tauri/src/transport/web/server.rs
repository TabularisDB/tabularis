use super::contract::SessionNegotiation;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::routing::{any, get};
use axum::{Json, Router};
use std::future::Future;
use std::path::PathBuf;
use tokio::net::TcpListener;
use tower_http::services::{ServeDir, ServeFile};

pub struct WebServerOptions {
    pub host: String,
    pub port: u16,
    pub web_root: PathBuf,
    pub open_browser: bool,
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

    println!("Tabularis Web is available at {url}");
    if options.open_browser {
        if let Err(error) = open::that(&url) {
            log::warn!("Failed to open the Web UI in the default browser: {error}");
        }
    }

    serve(listener, options.web_root, shutdown_signal())
        .await
        .map_err(|error| format!("Web UI server failed: {error}"))
}

pub(crate) async fn serve<F>(
    listener: TcpListener,
    web_root: PathBuf,
    shutdown: F,
) -> std::io::Result<()>
where
    F: Future<Output = ()> + Send + 'static,
{
    axum::serve(listener, router(web_root))
        .with_graceful_shutdown(shutdown)
        .await
}

fn router(web_root: PathBuf) -> Router {
    let index = web_root.join("index.html");
    let static_files = ServeDir::new(web_root).fallback(ServeFile::new(index));

    Router::new()
        .route(
            "/healthz",
            get(|| async {
                (
                    [(CACHE_CONTROL, "no-store"), (CONTENT_TYPE, "text/plain")],
                    "ok",
                )
            }),
        )
        .route(
            "/api/v1/session",
            get(|| async {
                (
                    [(CACHE_CONTROL, "no-store")],
                    Json(SessionNegotiation::skeleton()),
                )
            }),
        )
        .route(
            "/api/*path",
            any(|| async { axum::http::StatusCode::NOT_FOUND }),
        )
        .fallback_service(static_files)
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
