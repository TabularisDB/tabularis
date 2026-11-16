/// The UI invalidates only discovery-enabled contexts. Emitting for every
/// replacement also covers an update that removes a plugin's discovery opt-in.
pub async fn notify_plugin_reload<R: tauri::Runtime>(app: &tauri::AppHandle<R>, driver_id: &str) {
    use tauri::Emitter;
    let _ = app.emit(
        "connection-metadata-invalidated",
        serde_json::json!({"driverId": driver_id}),
    );
}
