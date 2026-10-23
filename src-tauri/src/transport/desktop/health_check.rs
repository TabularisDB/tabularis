pub(crate) use crate::health_check::*;
use std::collections::HashMap;
use std::time::Duration;
use tauri::Emitter;
use tokio::sync::oneshot;

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
    let saved_conn =
        crate::transport::desktop::commands::find_connection_by_id(app, connection_id)?;

    let expanded_params =
        crate::transport::desktop::commands::expand_ssh_connection_params(app, &saved_conn.params)
            .await?;
    let expanded_params =
        crate::transport::desktop::commands::expand_k8s_connection_params(app, &expanded_params)
            .await?;
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

    // Close all pools for the connection before resolving SSH params. Pool
    // keys depend only on connection_id (plus driver/database/TLS), not the
    // tunnel's local port, so `close_pools_for_connection_id` matches by
    // connection_id prefix — it subsumes the single-key close and closes
    // per-database override pools too (#1063). A dead bastion / unreachable
    // cluster must not prevent pool cleanup (#1065).
    let mut params = None;
    if let Ok(saved_conn) =
        crate::transport::desktop::commands::find_connection_by_id(app, connection_id)
    {
        crate::pool_manager::close_pools_for_connection_id(
            &saved_conn.params.driver,
            connection_id,
        )
        .await;

        // release_connection_sessions only needs params.driver to look up the
        // driver for rollback — the same driver regardless of tunnel expansion.
        // Since params_for_pool_close already disabled all tunnel types,
        // close_params has the right driver and connection_id, so re-expanding
        // SSH would only add a redundant keychain lookup that produces the same
        // result. If even tunnel-free resolution fails, fall back to the saved
        // params with just the connection_id set.
        let close_params = match crate::commands::params_for_pool_close(
            &saved_conn.params,
            connection_id,
        ) {
            Ok(p) => p,
            Err(e) => {
                log::warn!(
                    "Health check: failed to resolve tunnel-free params for session release on {connection_id}: {e}"
                );
                let mut fallback = saved_conn.params.clone();
                fallback.connection_id = Some(connection_id.to_string());
                fallback
            }
        };
        params = Some(close_params);
    }
    // Release pinned transaction sessions after closing the pool. A checked-out
    // pinned client survives pool.close() (which only blocks new checkouts), so
    // ROLLBACK still runs; the connection is discarded when the client drops.
    crate::transport::desktop::commands::release_connection_sessions(
        app,
        connection_id,
        params.as_ref(),
    )
    .await;

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
