use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use once_cell::sync::Lazy;
use tauri::Emitter;
use tokio::sync::{oneshot, Mutex, RwLock};

static ACTIVE_CONNECTIONS: Lazy<Arc<RwLock<HashSet<String>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashSet::new())));

static PING_STOP_TX: Lazy<Mutex<Option<oneshot::Sender<()>>>> = Lazy::new(|| Mutex::new(None));

/// Default ping interval in seconds.
pub const DEFAULT_PING_INTERVAL: u32 = 30;

/// Number of consecutive failures before disconnecting.
const FAILURE_THRESHOLD: u32 = 2;

/// Per-ping timeout.
const PING_TIMEOUT: Duration = Duration::from_secs(5);

/// Register a connection ID as active (will be pinged).
pub async fn register_connection(connection_id: String) {
    log::info!("Health check: registering connection {}", connection_id);
    ACTIVE_CONNECTIONS.write().await.insert(connection_id);
}

/// Unregister a connection ID (stop pinging it).
pub async fn unregister_connection(connection_id: &str) {
    log::info!("Health check: unregistering connection {}", connection_id);
    ACTIVE_CONNECTIONS.write().await.remove(connection_id);
}

/// Event broadcast to every window whenever the set of active (open)
/// connections changes. Payload is the full list of active connection ids so
/// each window can reconcile its cross-window view in one shot.
pub const ACTIVE_CONNECTIONS_CHANGED_EVENT: &str = "connections:active-changed";

/// Snapshot the currently active (open) connection ids.
pub async fn active_connections() -> Vec<String> {
    ACTIVE_CONNECTIONS.read().await.iter().cloned().collect()
}

/// Broadcast the current active-connection set to all windows.
pub async fn emit_active_changed<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let ids = active_connections().await;
    if let Err(e) = app.emit(ACTIVE_CONNECTIONS_CHANGED_EVENT, ids) {
        log::error!(
            "Health check: failed to emit {} event: {}",
            ACTIVE_CONNECTIONS_CHANGED_EVENT,
            e
        );
    }
}

/// Start the periodic ping loop. If a loop is already running it is stopped first.
pub async fn start_ping_loop(app: tauri::AppHandle, interval_secs: u64) {
    // Stop any existing loop
    stop_ping_loop().await;

    if interval_secs == 0 {
        log::info!("Health check: disabled (interval = 0)");
        return;
    }

    let (stop_tx, mut stop_rx) = oneshot::channel::<()>();
    {
        let mut guard = PING_STOP_TX.lock().await;
        *guard = Some(stop_tx);
    }

    log::info!(
        "Health check: starting ping loop with interval {}s",
        interval_secs
    );

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(interval_secs));
        let mut failure_counts: HashMap<String, u32> = HashMap::new();

        loop {
            tokio::select! {
                _ = &mut stop_rx => {
                    log::info!("Health check: ping loop stopped");
                    break;
                }
                _ = interval.tick() => {
                    ping_all_connections(&app, &mut failure_counts).await;
                }
            }
        }
    });
}

/// Stop the running ping loop, if any.
pub async fn stop_ping_loop() {
    let mut guard = PING_STOP_TX.lock().await;
    if let Some(tx) = guard.take() {
        let _ = tx.send(());
    }
}

/// Restart the ping loop with a new interval.
pub async fn restart_ping_loop(app: tauri::AppHandle, interval_secs: u64) {
    stop_ping_loop().await;
    start_ping_loop(app, interval_secs).await;
}

/// Ping every registered connection. On failure beyond the threshold,
/// close the pool and emit an event to the frontend.
async fn ping_all_connections(app: &tauri::AppHandle, failure_counts: &mut HashMap<String, u32>) {
    // Snapshot the active set so we don't hold the lock during I/O.
    let active: Vec<String> = ACTIVE_CONNECTIONS.read().await.iter().cloned().collect();

    if active.is_empty() {
        return;
    }

    // Ping each connection concurrently.
    let results = futures::future::join_all(active.iter().map(|conn_id| {
        let app = app.clone();
        let conn_id = conn_id.clone();
        async move {
            let result = ping_single_connection(&app, &conn_id).await;
            (conn_id, result)
        }
    }))
    .await;

    for (conn_id, result) in results {
        match result {
            Ok(()) => {
                // Reset failure counter on success.
                failure_counts.remove(&conn_id);
            }
            Err(err) => {
                let count = failure_counts.entry(conn_id.clone()).or_insert(0);
                *count += 1;
                log::warn!(
                    "Health check: ping failed for {} ({}/{}): {}",
                    conn_id,
                    count,
                    FAILURE_THRESHOLD,
                    err
                );

                if *count >= FAILURE_THRESHOLD {
                    log::error!(
                        "Health check: connection {} exceeded failure threshold, disconnecting",
                        conn_id
                    );
                    failure_counts.remove(&conn_id);
                    handle_connection_failure(app, &conn_id, &err).await;
                }
            }
        }
    }
}

/// Ping a single connection by resolving its params and calling driver.ping().
async fn ping_single_connection(app: &tauri::AppHandle, connection_id: &str) -> Result<(), String> {
    let saved_conn = crate::commands::find_connection_by_id(app, connection_id)?;

    let expanded_params =
        crate::commands::expand_ssh_connection_params(app, &saved_conn.params).await?;
    let expanded_params =
        crate::commands::expand_k8s_connection_params(app, &expanded_params).await?;
    let params =
        crate::commands::resolve_connection_params_with_id(&expanded_params, connection_id)?;

    // Check if pool exists before attempting ping (avoid creating new pools).
    let is_builtin = matches!(params.driver.as_str(), "mysql" | "postgres" | "sqlite");
    if is_builtin && !crate::pool_manager::has_pool(&params, Some(connection_id)).await {
        return Err("No active connection pool".into());
    }

    let driver = crate::drivers::registry::get_driver(&params.driver)
        .await
        .ok_or_else(|| format!("Driver not found: {}", params.driver))?;

    tokio::time::timeout(PING_TIMEOUT, driver.ping(&params))
        .await
        .map_err(|_| "Ping timed out".to_string())?
}

/// Close the pool, unregister the connection, and emit a failure event.
async fn handle_connection_failure(app: &tauri::AppHandle, connection_id: &str, error: &str) {
    // Unregister first to prevent further pings.
    unregister_connection(connection_id).await;

    // Close the pool (best-effort — if params can't be resolved the pool stays orphaned
    // but will be reclaimed on next connect or app shutdown).
    if let Ok(saved_conn) = crate::commands::find_connection_by_id(app, connection_id) {
        if let Ok(expanded) =
            crate::commands::expand_ssh_connection_params(app, &saved_conn.params).await
        {
            let expanded = crate::commands::expand_k8s_connection_params(app, &expanded).await;
            if let Ok(params) = expanded.and_then(|params| {
                crate::commands::resolve_connection_params_with_id(&params, connection_id)
            }) {
                crate::pool_manager::close_pool_with_id(&params, Some(connection_id)).await;
            }
        }
    }

    // Notify frontend.
    let payload = serde_json::json!({
        "connectionId": connection_id,
        "error": error,
    });
    if let Err(e) = app.emit("connection-health-failed", payload) {
        log::error!(
            "Health check: failed to emit connection-health-failed event: {}",
            e
        );
    }

    // Broadcast the updated active-connection set so every window reconciles.
    emit_active_changed(app).await;
}
