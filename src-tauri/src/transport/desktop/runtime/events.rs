use crate::runtime::events::*;
use serde_json::Value;
use tauri::Emitter;

pub struct TauriRuntimeEvents<R: tauri::Runtime> {
    app: tauri::AppHandle<R>,
}

impl<R: tauri::Runtime> TauriRuntimeEvents<R> {
    pub fn new(app: tauri::AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: tauri::Runtime> RuntimeEvents for TauriRuntimeEvents<R> {
    fn emit(&self, event: &str, payload: Value) -> Result<(), String> {
        self.app
            .emit(event, payload)
            .map_err(|error| error.to_string())
    }
}
