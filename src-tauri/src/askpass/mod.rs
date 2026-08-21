//! In-app SSH askpass support.
//!
//! When a connection opts into SSH passphrase/PIN prompts (e.g. FIDO2
//! security keys), the system `ssh` process needs an `SSH_ASKPASS` helper to
//! collect the secret. Instead of depending on a desktop-specific helper
//! being installed (`ksshaskpass`, `seahorse`, ...), Tabularis acts as its
//! own: ssh re-executes this binary in a thin client mode that forwards the
//! prompt to the running app over a private local socket, and the app shows
//! a native modal.
//!
//! Module layout:
//! - `protocol`: pure encode/decode helpers for the wire format
//! - `client`: the helper process ssh spawns (`SSH_ASKPASS` side)
//! - `server`: socket listener living inside the main process

mod client;
mod protocol;
mod server;

#[cfg(test)]
mod tests;

pub use client::maybe_run_askpass_client;
pub use protocol::PromptKind;
pub use server::{AskpassServer, AskpassUi};

use crate::runtime::events::{RuntimeEvents, TauriRuntimeEvents};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use uuid::Uuid;

/// Event emitted to the frontend when ssh needs user input.
pub const REQUEST_EVENT: &str = "ssh-askpass://request";
/// Event emitted to the frontend when a prompt is no longer relevant
/// (notification dismissed, request timed out).
pub const DISMISS_EVENT: &str = "ssh-askpass://dismiss";

/// How long the user gets to answer a prompt before ssh receives a cancel.
const RESPONSE_TIMEOUT_SECS: u64 = 300;

/// Global handle for code paths (the SSH tunnel module) that run without a
/// Tauri context. Set once during application setup.
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

struct PendingResponse {
    session_id: Option<Uuid>,
    sender: SyncSender<Option<String>>,
}

fn pending_responses() -> &'static Mutex<HashMap<u64, PendingResponse>> {
    static PENDING: OnceLock<Mutex<HashMap<u64, PendingResponse>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Store the app handle so SSH tunnel code can reach the frontend.
pub fn set_app_handle(app: AppHandle) {
    let _ = APP_HANDLE.set(app);
}

/// Start an askpass server bridged to the frontend. Fails when the app is not
/// fully initialised (e.g. in unit tests), letting callers fall back to the
/// system askpass behaviour.
pub fn start_frontend_server() -> Result<AskpassServer, String> {
    let app = APP_HANDLE
        .get()
        .ok_or_else(|| "Askpass UI unavailable: application not initialised".to_string())?;
    start_scoped_server(
        Arc::new(TauriRuntimeEvents::new(app.clone())),
        None,
        Duration::from_secs(RESPONSE_TIMEOUT_SECS),
    )
}

pub fn start_scoped_server(
    events: Arc<dyn RuntimeEvents>,
    session_id: Option<Uuid>,
    response_timeout: Duration,
) -> Result<AskpassServer, String> {
    AskpassServer::start(Arc::new(FrontendUi {
        events,
        session_id,
        response_timeout,
    }))
}

#[derive(Serialize, Clone)]
struct AskpassRequestPayload {
    id: u64,
    kind: &'static str,
    prompt: String,
}

/// Bridges askpass exchanges to the initiating frontend session.
struct FrontendUi {
    events: Arc<dyn RuntimeEvents>,
    session_id: Option<Uuid>,
    response_timeout: Duration,
}

impl FrontendUi {
    fn emit(&self, event: &str, payload: serde_json::Value) -> Result<(), String> {
        match self.session_id {
            Some(session_id) => self.events.emit_to(session_id, event, payload),
            None => self.events.emit(event, payload),
        }
    }
}

impl AskpassUi for FrontendUi {
    fn request(&self, kind: PromptKind, prompt: &str) -> Option<String> {
        let id = NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = sync_channel(1);
        pending_responses().lock().unwrap().insert(
            id,
            PendingResponse {
                session_id: self.session_id,
                sender: tx,
            },
        );

        let payload = AskpassRequestPayload {
            id,
            kind: kind.as_str(),
            prompt: prompt.to_string(),
        };
        let payload = serde_json::to_value(payload).unwrap_or(serde_json::Value::Null);
        if let Err(error) = self.emit(REQUEST_EVENT, payload) {
            eprintln!("[Askpass] Failed to notify frontend: {error}");
            pending_responses().lock().unwrap().remove(&id);
            return None;
        }

        let response = rx.recv_timeout(self.response_timeout).ok().flatten();
        // Entry is still present when the wait timed out (the command removes
        // it on a real answer); clean up and close the stale modal.
        if pending_responses().lock().unwrap().remove(&id).is_some() {
            let _ = self.emit(DISMISS_EVENT, serde_json::json!(id));
        }
        response
    }

    fn show_notification(&self, prompt: &str) -> u64 {
        let id = NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
        let payload = AskpassRequestPayload {
            id,
            kind: PromptKind::Notify.as_str(),
            prompt: prompt.to_string(),
        };
        let payload = serde_json::to_value(payload).unwrap_or(serde_json::Value::Null);
        if let Err(error) = self.emit(REQUEST_EVENT, payload) {
            eprintln!("[Askpass] Failed to notify frontend: {error}");
        }
        id
    }

    fn dismiss_notification(&self, id: u64) {
        let _ = self.emit(DISMISS_EVENT, serde_json::json!(id));
    }
}

/// Frontend answer to an askpass prompt. `response = None` means the user
/// cancelled.
#[tauri::command]
pub fn respond_ssh_askpass(id: u64, response: Option<String>) {
    let _ = respond_for_session(None, id, response);
}

pub fn respond_for_session(
    session_id: Option<Uuid>,
    id: u64,
    response: Option<String>,
) -> Result<(), String> {
    let mut pending = pending_responses().lock().unwrap();
    let Some(request) = pending.get(&id) else {
        return Err("SSH askpass prompt is no longer pending".to_string());
    };
    if request.session_id != session_id {
        return Err("SSH askpass prompt belongs to another session".to_string());
    }
    let request = pending.remove(&id).expect("pending response disappeared");
    drop(pending);
    request
        .sender
        .send(response)
        .map_err(|_| "SSH askpass prompt is no longer accepting responses".to_string())
}
