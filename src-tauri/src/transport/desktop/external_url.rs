use url::Url;

fn validate_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "Invalid external URL")?;
    if !["https", "http", "mailto", "tel"].contains(&url.scheme()) {
        return Err("Unsupported external URL protocol".into());
    }
    Ok(url)
}

#[cfg(target_os = "linux")]
fn launch(url: Url) -> Result<(), String> {
    use gtk::gio::{self, prelude::AppInfoExt};
    // Resolve the MIME association directly: KDE's xdg-open path can choose a
    // different browser when the app runs with an isolated XDG configuration.
    let application = gio::AppInfo::default_for_uri_scheme(url.scheme())
        .ok_or("No system application is registered for this URL protocol")?;
    if let Some(id) = application.id() {
        log::info!("Opening external link with system application: {id}");
    }
    application
        .launch_uris(&[url.as_str()], None::<&gio::AppLaunchContext>)
        .map_err(|_| "Could not open the system default application".into())
}

#[cfg(not(target_os = "linux"))]
fn launch(url: Url) -> Result<(), String> {
    tauri_plugin_opener::open_url(url.as_str(), None::<&str>)
        .map_err(|_| "Could not open the system default application".into())
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    let url = validate_url(&url)?;
    tokio::task::spawn_blocking(move || launch(url))
        .await
        .map_err(|_| "System application launcher failed".to_string())?
}

#[cfg(test)]
mod tests;
