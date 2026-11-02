use super::resolve::{endpoint_to_proxy_url, resolve_http_policy};
use super::types::{HttpProxyPolicy, ProxyEndpoint};
use reqwest::{Client, Proxy};
use std::time::Duration;

/// Build a `reqwest::Client`, optionally routed through `proxy`.
///
/// Always calls `.no_proxy()` first so env/system proxies cannot override an
/// explicit Disabled / no-proxy choice from app settings.
pub fn build_reqwest_client(proxy: Option<&ProxyEndpoint>) -> Result<Client, String> {
    build_reqwest_client_with_timeout(proxy, Duration::from_secs(30))
}

pub fn build_reqwest_client_with_timeout(
    proxy: Option<&ProxyEndpoint>,
    timeout: Duration,
) -> Result<Client, String> {
    let mut builder = Client::builder().timeout(timeout).no_proxy();
    if let Some(endpoint) = proxy {
        let url = endpoint_to_proxy_url(endpoint)?;
        let proxy = Proxy::all(&url).map_err(|e| format!("Invalid proxy URL: {e}"))?;
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

/// Build a reqwest **0.12** client for crates that pin that major
/// (`tabularium-sdk`). Same proxy URL rules as [`build_reqwest_client`].
pub fn build_reqwest_012_client(
    proxy: Option<&ProxyEndpoint>,
    timeout: Duration,
) -> Result<reqwest_012::Client, String> {
    let mut builder = reqwest_012::Client::builder().timeout(timeout).no_proxy();
    if let Some(endpoint) = proxy {
        let url = endpoint_to_proxy_url(endpoint)?;
        let proxy =
            reqwest_012::Proxy::all(&url).map_err(|e| format!("Invalid proxy URL: {e}"))?;
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

fn build_http_client(policy: HttpProxyPolicy, timeout: Duration) -> Result<Client, String> {
    let mut builder = Client::builder().timeout(timeout);
    match policy {
        HttpProxyPolicy::System => {}
        HttpProxyPolicy::Disabled => builder = builder.no_proxy(),
        HttpProxyPolicy::Custom(endpoint) => {
            let url = endpoint_to_proxy_url(&endpoint)?;
            let proxy = Proxy::all(&url).map_err(|e| format!("Invalid proxy URL: {e}"))?;
            builder = builder.no_proxy().proxy(proxy);
        }
    }
    builder
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

fn build_http_client_012(
    policy: HttpProxyPolicy,
    timeout: Duration,
) -> Result<reqwest_012::Client, String> {
    let mut builder = reqwest_012::Client::builder().timeout(timeout);
    match policy {
        HttpProxyPolicy::System => {}
        HttpProxyPolicy::Disabled => builder = builder.no_proxy(),
        HttpProxyPolicy::Custom(endpoint) => {
            let url = endpoint_to_proxy_url(&endpoint)?;
            let proxy =
                reqwest_012::Proxy::all(&url).map_err(|e| format!("Invalid proxy URL: {e}"))?;
            builder = builder.no_proxy().proxy(proxy);
        }
    }
    builder
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

/// Client for the `app_http` scope (updates, plugins, WebDAV, …).
pub fn app_http_client() -> Result<Client, String> {
    let policy = resolve_http_policy(super::registry::SCOPE_APP_HTTP, None)?;
    build_http_client(policy, Duration::from_secs(30))
}

/// `app_http` client on reqwest 0.12 — for `tabularium-sdk` injection.
pub fn app_http_client_012() -> Result<reqwest_012::Client, String> {
    let policy = resolve_http_policy(super::registry::SCOPE_APP_HTTP, None)?;
    build_http_client_012(policy, Duration::from_secs(30))
}

/// Client for a specific AI provider (provider override > global `ai` scope).
pub fn ai_http_client(provider: &str) -> Result<Client, String> {
    let policy = resolve_http_policy(super::registry::SCOPE_AI, Some(provider))?;
    build_http_client(policy, Duration::from_secs(30))
}

/// Unproxied client for loopback targets (e.g. local Ollama).
pub fn direct_http_client() -> Result<Client, String> {
    build_reqwest_client(None)
}

#[cfg(test)]
mod tests;
