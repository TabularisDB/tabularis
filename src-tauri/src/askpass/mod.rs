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

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

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

fn pending_responses() -> &'static Mutex<HashMap<u64, SyncSender<Option<String>>>> {
    static PENDING: OnceLock<Mutex<HashMap<u64, SyncSender<Option<String>>>>> = OnceLock::new();
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
    AskpassServer::start(Arc::new(FrontendUi { app: app.clone() }))
}

#[derive(Serialize, Clone)]
struct AskpassRequestPayload {
    id: u64,
    kind: &'static str,
    prompt: String,
}

/// Bridges askpass exchanges to the webview via Tauri events.
struct FrontendUi {
    app: AppHandle,
}

impl AskpassUi for FrontendUi {
    fn request(&self, kind: PromptKind, prompt: &str) -> Option<String> {
        let id = NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = sync_channel(1);
        pending_responses().lock().unwrap().insert(id, tx);

        let payload = AskpassRequestPayload {
            id,
            kind: kind.as_str(),
            prompt: prompt.to_string(),
        };
        if let Err(e) = self.app.emit(REQUEST_EVENT, payload) {
            eprintln!("[Askpass] Failed to notify frontend: {}", e);
            pending_responses().lock().unwrap().remove(&id);
            return None;
        }

        let response = rx
            .recv_timeout(Duration::from_secs(RESPONSE_TIMEOUT_SECS))
            .ok()
            .flatten();
        // Entry is still present when the wait timed out (the command removes
        // it on a real answer); clean up and close the stale modal.
        if pending_responses().lock().unwrap().remove(&id).is_some() {
            let _ = self.app.emit(DISMISS_EVENT, id);
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
        if let Err(e) = self.app.emit(REQUEST_EVENT, payload) {
            eprintln!("[Askpass] Failed to notify frontend: {}", e);
        }
        id
    }

    fn dismiss_notification(&self, id: u64) {
        let _ = self.app.emit(DISMISS_EVENT, id);
    }
}

/// Frontend answer to an askpass prompt. `response = None` means the user
/// cancelled.
#[tauri::command]
pub fn respond_ssh_askpass(id: u64, response: Option<String>) {
    if let Some(tx) = pending_responses().lock().unwrap().remove(&id) {
        let _ = tx.send(response);
    }
}
