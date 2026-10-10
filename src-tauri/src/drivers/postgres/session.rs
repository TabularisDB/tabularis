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
//!
//! Each session has its own lock, held for a whole run, so two overlapping
//! runs from one tab execute one after the other on the same connection
//! instead of each taking a fresh one.

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, OwnedMutexGuard};

type Client = deadpool_postgres::Client;

/// A pooled client held across `execute_batch` calls because the tab that
/// owns it left an explicit transaction open.
struct PinnedSession {
    client: Client,
    last_used: Instant,
}

/// A session's pinned connection, if any. Holding the guard serializes runs.
#[derive(Default)]
pub struct Slot(Option<PinnedSession>);

/// A slot dropped while still holding a connection closes it rather than
/// returning it to the pool, where the next borrower would inherit its transaction.
impl Drop for Slot {
    fn drop(&mut self) {
        if let Some(pinned) = self.0.take() {
            drop(Client::take(pinned.client));
        }
    }
}

impl Slot {
    /// Take the pinned connection; the caller must [`Slot::pin`] it again or end its transaction.
    pub fn take(&mut self) -> Option<Client> {
        self.0.take().map(|s| s.client)
    }

    /// Borrow the pinned connection without unpinning it.
    pub fn client(&self) -> Option<&Client> {
        self.0.as_ref().map(|s| &s.client)
    }

    /// Mark the session as just used, so the idle sweep counts from now.
    pub fn touch(&mut self) {
        if let Some(s) = self.0.as_mut() {
            s.last_used = Instant::now();
        }
    }

    /// Pin `client` until the tab ends its transaction.
    pub fn pin(&mut self, client: Client) {
        self.0 = Some(PinnedSession {
            client,
            last_used: Instant::now(),
        });
    }
}

/// A pinned connection holds its transaction's locks until the tab ends it.
/// A tab abandoned mid-transaction would hold them indefinitely, so a
/// session untouched for this long is rolled back and released by
/// the periodic [`sweep_idle`].
const MAX_IDLE: Duration = Duration::from_secs(30 * 60);

const SWEEP_INTERVAL: Duration = Duration::from_secs(60);

type SessionMap = HashMap<String, Arc<Mutex<Slot>>>;

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
pub async fn rollback_and_release(client: Client) {
    if let Err(e) = client.batch_execute("ROLLBACK").await {
        log::warn!("PostgreSQL: ROLLBACK while releasing a pinned session failed: {e}");
    }
}

/// Lock `session_id`'s slot, waiting for any run already holding it.
pub async fn lock(session_id: &str) -> OwnedMutexGuard<Slot> {
    // Started on first use; the sweep also forgets the empty slots every run leaves behind.
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
    let slot = sessions()
        .lock()
        .await
        .entry(session_id.to_string())
        .or_default()
        .clone();
    slot.lock_owned().await
}

/// Roll back and release every session idle past [`MAX_IDLE`], and forget
/// slots nothing holds. A slot in use by a run is skipped.
pub async fn sweep_idle() {
    let mut expired = Vec::new();
    {
        let now = Instant::now();
        let mut map = sessions().lock().await;
        map.retain(|_, slot| {
            let Ok(mut guard) = slot.try_lock() else {
                return true;
            };
            if guard
                .0
                .as_ref()
                .is_some_and(|s| now.duration_since(s.last_used) > MAX_IDLE)
            {
                expired.extend(guard.take());
            }
            // Only the map holds it and nothing is pinned, so nobody can be waiting on it.
            guard.0.is_some() || Arc::strong_count(slot) > 1
        });
    }

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

/// Roll back and release the connection pinned to `session_id`, if any,
/// after any run still in flight for it finishes.
///
/// Called when the tab closes or the user discards the transaction.
pub async fn release(session_id: &str) {
    let client = lock(session_id).await.take();
    if let Some(client) = client {
        log::info!("PostgreSQL: releasing pinned session {session_id}");
        rollback_and_release(client).await;
    }
}

/// Roll back and release every pinned connection. Called on shutdown so no
/// transaction is left open on the server. A session a run still holds is
/// skipped rather than waited for; its connection closes with the process.
pub async fn release_all() {
    let mut clients: Vec<Client> = Vec::new();
    // A busy slot stays in the map, so the run holding it can still pin into a tracked slot.
    sessions()
        .lock()
        .await
        .retain(|_, slot| match slot.try_lock() {
            Ok(mut guard) => {
                clients.extend(guard.take());
                false
            }
            Err(_) => true,
        });

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
    let slot = sessions().lock().await.get(session_id).cloned();
    match slot {
        Some(slot) => slot.lock().await.0.is_some(),
        None => false,
    }
}

#[cfg(test)]
#[path = "session_tests.rs"]
mod session_tests;
