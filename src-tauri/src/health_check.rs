use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use once_cell::sync::Lazy;

use tokio::sync::{oneshot, Mutex, RwLock};

pub(crate) static ACTIVE_CONNECTIONS: Lazy<Arc<RwLock<HashSet<String>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashSet::new())));

pub(crate) static PING_STOP_TX: Lazy<Mutex<Option<oneshot::Sender<()>>>> = Lazy::new(|| Mutex::new(None));

/// Default ping interval in seconds.
pub const DEFAULT_PING_INTERVAL: u32 = 30;

/// Number of consecutive failures before disconnecting.
pub(crate) const FAILURE_THRESHOLD: u32 = 2;

/// Per-ping timeout.
pub(crate) const PING_TIMEOUT: Duration = Duration::from_secs(5);

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

/// Stop the running ping loop, if any.
pub async fn stop_ping_loop() {
    let mut guard = PING_STOP_TX.lock().await;
    if let Some(tx) = guard.take() {
        let _ = tx.send(());
    }
}

