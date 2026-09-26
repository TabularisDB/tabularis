//! Per-editor-tab pinned PostgreSQL connections.
//!
//! A batch already runs every statement on one pooled connection, so a
//! script containing `BEGIN … COMMIT` works. What did not work is the
//! workflow the transaction exists for: run `BEGIN`, look at the result,
//! run the changes, verify them, and only then `COMMIT` — each as its own
//! run. Between runs the connection went back to the pool, so the next run
//! could land on a different one and the transaction was stranded.
//!
//! This module keeps the connection of a tab that left a transaction open,
//! keyed by the tab's session id, until it commits, rolls back, closes, or
//! goes idle for too long. A pinned connection is never handed back to the
//! pool without a `ROLLBACK` first, so an open transaction can never leak
//! into an unrelated query.

use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// A pooled client held across `execute_batch` calls because the tab that
/// owns it left an explicit transaction open.
struct PinnedSession {
    client: deadpool_postgres::Client,
    last_used: Instant,
}

/// A pinned connection holds its transaction's locks until the tab ends it.
/// A tab abandoned mid-transaction would hold them indefinitely, so a
/// session untouched for this long is rolled back and released by
/// the periodic [`sweep_idle`].
const MAX_IDLE: Duration = Duration::from_secs(30 * 60);

const SWEEP_INTERVAL: Duration = Duration::from_secs(60);

type SessionMap = HashMap<String, PinnedSession>;

fn sessions() -> &'static Mutex<SessionMap> {
    static SESSIONS: OnceLock<Mutex<SessionMap>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// End the transaction before the client goes back to the pool.
///
/// The pool recycles connections without resetting them, so dropping a
/// client mid-transaction would leave the next borrower inside someone
/// else's transaction, holding its locks. A failing `ROLLBACK` is ignored:
/// the connection is already unusable and the pool will discard it.
pub async fn rollback_and_release(client: deadpool_postgres::Client) {
    if let Err(e) = client.batch_execute("ROLLBACK").await {
        log::warn!("PostgreSQL: ROLLBACK while releasing a pinned session failed: {e}");
    }
}

/// Take the connection pinned to `session_id`, if any.
///
/// The caller owns the returned client and must either hand it back via
/// [`store`] or end the transaction itself.
pub async fn take(session_id: &str) -> Option<deadpool_postgres::Client> {
    sessions().lock().await.remove(session_id).map(|s| s.client)
}

/// Roll back and release every session idle past [`MAX_IDLE`].
pub async fn sweep_idle() {
    let expired: Vec<deadpool_postgres::Client> = {
        let mut map = sessions().lock().await;
        let now = Instant::now();
        let stale: Vec<String> = map
            .iter()
            .filter(|(_, s)| now.duration_since(s.last_used) > MAX_IDLE)
            .map(|(id, _)| id.clone())
            .collect();
        stale
            .iter()
            .filter_map(|id| map.remove(id).map(|s| s.client))
            .collect()
    };

    if expired.is_empty() {
        return;
    }
    log::info!(
        "PostgreSQL: releasing {} pinned session(s) idle for over {} minutes",
        expired.len(),
        MAX_IDLE.as_secs() / 60
    );
    for client in expired {
        rollback_and_release(client).await;
    }
}

/// Pin `client` to `session_id` until the tab ends its transaction.
pub async fn store(session_id: &str, client: deadpool_postgres::Client) {
    // Started on the first pin, so an app that never opens a transaction runs no timer.
    static SWEEPER: std::sync::Once = std::sync::Once::new();
    SWEEPER.call_once(|| {
        tokio::spawn(async {
            let mut timer = tokio::time::interval(SWEEP_INTERVAL);
            loop {
                timer.tick().await;
                sweep_idle().await;
            }
        });
    });

    let previous = {
        let mut map = sessions().lock().await;
        map.insert(
            session_id.to_string(),
            PinnedSession {
                client,
                last_used: Instant::now(),
            },
        )
    };

    // Only reachable if two batches for one tab overlapped; the older
    // connection is no longer referenced by anything.
    if let Some(stale) = previous {
        rollback_and_release(stale.client).await;
    }
}

/// Roll back and release the connection pinned to `session_id`, if any.
///
/// Called when the tab closes or the user discards the transaction.
pub async fn release(session_id: &str) {
    let client = {
        let mut map = sessions().lock().await;
        map.remove(session_id).map(|s| s.client)
    };

    if let Some(client) = client {
        log::info!("PostgreSQL: releasing pinned session {session_id}");
        rollback_and_release(client).await;
    }
}

/// Roll back and release every pinned connection. Called on shutdown so no
/// transaction is left open on the server.
pub async fn release_all() {
    let clients: Vec<deadpool_postgres::Client> = {
        let mut map = sessions().lock().await;
        map.drain().map(|(_, s)| s.client).collect()
    };

    if clients.is_empty() {
        return;
    }
    log::info!("PostgreSQL: releasing {} pinned session(s)", clients.len());
    for client in clients {
        rollback_and_release(client).await;
    }
}

/// Whether `session_id` currently holds a pinned connection.
pub async fn is_pinned(session_id: &str) -> bool {
    sessions().lock().await.contains_key(session_id)
}
