use crate::proxy::HttpProxyPolicy;
use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::{UpdaterBuilder, UpdaterExt};

pub(super) fn app_updater_builder<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<UpdaterBuilder, String> {
    let policy = crate::proxy::resolve_http_policy(crate::proxy::SCOPE_APP_HTTP, None)?;
    with_policy(app.updater_builder(), policy)
}

fn with_policy(builder: UpdaterBuilder, policy: HttpProxyPolicy) -> Result<UpdaterBuilder, String> {
    match policy {
        HttpProxyPolicy::System => Ok(builder),
        HttpProxyPolicy::Disabled => Ok(builder.no_proxy()),
        HttpProxyPolicy::Custom(endpoint) => {
            let url = crate::proxy::endpoint_to_proxy_url(&endpoint)?;
            let proxy = reqwest::Proxy::all(&url)
                .map_err(|error| format!("Invalid updater proxy URL: {error}"))?;
            // The updater logs its proxy URL, which may contain credentials.
            // Its client hook applies to both manifest and package requests.
            Ok(builder.configure_client(move |client| client.no_proxy().proxy(proxy.clone())))
        }
    }
}

#[cfg(test)]
mod tests;
