//! Database tab sessions are namespaced independently of authenticated browser sessions.
use crate::drivers::driver_trait::DatabaseDriver;
use crate::runtime::RuntimeContext;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use uuid::Uuid;

struct Session {
    owner: Option<Uuid>,
    connection_id: String,
    tab_id: String,
    driver: Arc<dyn DatabaseDriver>,
    active_runs: usize,
    saw_transaction: bool,
}

fn sessions() -> &'static Mutex<HashMap<String, Session>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
    SESSIONS.get_or_init(Default::default)
}

pub fn key(owner: Option<Uuid>, connection_id: &str, tab_id: &str) -> String {
    serde_json::to_string(&(owner, connection_id, tab_id)).expect("session key is serializable")
}

pub fn register(
    owner: Option<Uuid>,
    connection_id: &str,
    tab_id: &str,
    driver: Arc<dyn DatabaseDriver>,
) -> String {
    let key = key(owner, connection_id, tab_id);
    let mut sessions = sessions().lock().unwrap_or_else(|e| e.into_inner());
    let session = sessions.entry(key.clone()).or_insert_with(|| Session {
        owner,
        connection_id: connection_id.to_string(),
        tab_id: tab_id.to_string(),
        driver,
        active_runs: 0,
        saw_transaction: false,
    });
    session.active_runs += 1;
    key
}

pub fn report(
    runtime: &RuntimeContext,
    owner: Option<Uuid>,
    connection_id: &str,
    tab_id: Option<&str>,
    in_transaction: bool,
) {
    let Some(tab_id) = tab_id else { return };
    {
        let key = key(owner, connection_id, tab_id);
        let mut sessions = sessions().lock().unwrap_or_else(|e| e.into_inner());
        if let Some(session) = sessions.get_mut(&key) {
            session.active_runs = session.active_runs.saturating_sub(1);
            // Parent tasks may report out of order after the driver releases its lock.
            // Retain tabs that used a transaction until explicit tab/session cleanup.
            session.saw_transaction |= in_transaction;
            if session.active_runs == 0 && !session.saw_transaction {
                sessions.remove(&key);
            }
        }
    }
    emit_state(runtime, owner, tab_id, in_transaction);
}

fn emit_state(runtime: &RuntimeContext, owner: Option<Uuid>, tab_id: &str, in_transaction: bool) {
    let payload = serde_json::json!({"session_id": tab_id, "in_transaction": in_transaction});
    let _ = match owner {
        Some(owner) => runtime
            .events
            .emit_to(owner, "session-transaction-state", payload),
        None => runtime.events.emit("session-transaction-state", payload),
    };
}

pub async fn release(
    runtime: &RuntimeContext,
    owner: Option<Uuid>,
    connection_id: &str,
    tab_id: &str,
) -> Result<(), String> {
    let key = key(owner, connection_id, tab_id);
    let session = sessions()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&key);
    if let Some(session) = session {
        session.driver.release_session(&key).await;
    }
    emit_state(runtime, owner, tab_id, false);
    Ok(())
}

fn take_matching(owner: Option<Uuid>, connection_id: Option<&str>) -> Vec<(String, Session)> {
    let mut sessions = sessions().lock().unwrap_or_else(|e| e.into_inner());
    let keys: Vec<_> = sessions
        .iter()
        .filter(|(_, session)| {
            session.owner == owner && connection_id.is_none_or(|id| session.connection_id == id)
        })
        .map(|(key, _)| key.clone())
        .collect();
    keys.into_iter()
        .filter_map(|key| sessions.remove(&key).map(|session| (key, session)))
        .collect()
}

pub async fn release_connection(
    runtime: &RuntimeContext,
    owner: Option<Uuid>,
    connection_id: &str,
) {
    for (key, session) in take_matching(owner, Some(connection_id)) {
        emit_state(runtime, owner, &session.tab_id, false);
        tokio::spawn(async move {
            session.driver.release_session(&key).await;
        });
    }
}

pub fn clear_owner(owner: Uuid) {
    for (key, session) in take_matching(Some(owner), None) {
        tokio::spawn(async move {
            session.driver.release_session(&key).await;
        });
    }
}

#[cfg(test)]
mod tests;
