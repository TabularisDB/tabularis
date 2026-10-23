//! E2E-only mock of the `dialog` plugin.
//!
//! Replaces `tauri_plugin_dialog::init()` under `#[cfg(feature = "e2e-testing")]`
//! so that native OS dialogs — which WebDriverIO cannot click — don't block
//! automated flows. Registered as a same-named `"dialog"` plugin so it replaces
//! the real one at Tauri's IPC dispatch layer (`PluginStore::register` retains
//! only the last plugin of a given name).
//!
//! - `ask` / `confirm` → always `true` (auto-accept), enabling the trigger-save
//!   "Recreate Trigger" confirmation flow (findings #3, #4).
//! - `message` → `Ok(())` (no-op).
//! - `open` → returns the path from `$E2E_DIALOG_OPEN_PATH` (or `null` if unset),
//!   so dump/import tests control the picked file via the environment (findings
//!   #2, #9) without a real native file picker.
//! - `save` → returns the path from `$E2E_DIALOG_SAVE_PATH` (or `null` if unset).
//!
//! The command signatures deliberately accept `serde_json::Value` args (Tauri
//! deserializes the JS `invoke()` payload into them) and return `Value`, so the
//! mock does not couple to the dialog crate's private `OpenResponse`/`FilePath`
//! types. The JS client treats `ask`/`confirm` returns as `bool` and
//! `open`/`save` returns as `string | null`, which `Value::Bool` / `Value::String`
//! / `Value::Null` satisfy.

use serde_json::{json, Value};
use tauri::{plugin::{Builder, TauriPlugin}, Runtime};

fn env_path(var: &str) -> Value {
    match std::env::var(var) {
        Ok(p) if !p.is_empty() => json!(p),
        _ => Value::Null,
    }
}

#[tauri::command]
async fn ask(_message: Value, _title: Option<Value>, _kind: Option<Value>, _yes_button_label: Option<Value>, _no_button_label: Option<Value>) -> Result<Value, String> {
    Ok(json!(true))
}

#[tauri::command]
async fn confirm(_message: Value, _title: Option<Value>, _kind: Option<Value>, _ok_button_label: Option<Value>, _cancel_button_label: Option<Value>) -> Result<Value, String> {
    Ok(json!(true))
}

#[tauri::command]
async fn message(_message: Value, _title: Option<Value>, _kind: Option<Value>, _ok_button_label: Option<Value>, _buttons: Option<Value>) -> Result<Value, String> {
    Ok(Value::Null)
}

#[tauri::command]
async fn open(_options: Value) -> Result<Value, String> {
    Ok(env_path("E2E_DIALOG_OPEN_PATH"))
}

#[tauri::command]
async fn save(_options: Value) -> Result<Value, String> {
    Ok(env_path("E2E_DIALOG_SAVE_PATH"))
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("dialog")
        .invoke_handler(tauri::generate_handler![
            ask, confirm, message, open, save
        ])
        .build()
}
