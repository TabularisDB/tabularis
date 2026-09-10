use super::resolve::{endpoint_to_proxy_url, resolve_global_scope};
use super::types::ProxyEndpoint;
use reqwest::{Client, Proxy};
use std::time::Duration;

/// Build a `reqwest::Client`, optionally routed through `proxy`.
pub fn build_reqwest_client(proxy: Option<&ProxyEndpoint>) -> Result<Client, String> {
    build_reqwest_client_with_timeout(proxy, Duration::from_secs(30))
}

pub fn build_reqwest_client_with_timeout(
    proxy: Option<&ProxyEndpoint>,
    timeout: Duration,
) -> Result<Client, String> {
    let mut builder = Client::builder().timeout(timeout);
    if let Some(endpoint) = proxy {
        let url = endpoint_to_proxy_url(endpoint)?;
        let proxy = Proxy::all(&url).map_err(|e| format!("Invalid proxy URL: {e}"))?;
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

/// Client for the `app_http` scope (updates, plugins, WebDAV, …).
pub fn app_http_client() -> Result<Client, String> {
    let proxy = resolve_global_scope(super::registry::SCOPE_APP_HTTP);
    build_reqwest_client(proxy.as_ref())
}

/// Client for a specific AI provider (provider override > global `ai` scope).
pub fn ai_http_client(provider: &str) -> Result<Client, String> {
    let proxy = super::resolve::resolve_for_ai_provider(provider);
    build_reqwest_client(proxy.as_ref())
}
