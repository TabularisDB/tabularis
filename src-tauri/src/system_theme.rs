#[cfg(target_os = "linux")]
mod portal;

/// Linux desktop preference, independent of the GTK theme name.
#[tauri::command]
pub async fn get_linux_system_theme() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        match tokio::time::timeout(std::time::Duration::from_secs(2), portal::read()).await {
            Ok(Ok(theme)) => theme.map(str::to_owned),
            _ => None,
        }
    }
    #[cfg(not(target_os = "linux"))]
    None
}

#[cfg(target_os = "linux")]
pub fn watch(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = portal::watch(move |theme| {
            use tauri::Emitter;
            if let Err(error) = app.emit("linux-system-theme-changed", theme) {
                log::warn!("Failed to emit system theme change: {error}");
            }
        })
        .await
        {
            log::warn!("Desktop settings portal unavailable: {error}");
        }
    });
}
