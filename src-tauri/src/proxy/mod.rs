//! Application proxy configuration and runtime helpers.
//!
//! Global settings + per-scope checkboxes, with connection / AI-provider
//! overrides. HTTP callers use [`http`]; TCP (DB / SSH) uses [`tcp_forward`].

pub mod http;
pub mod registry;
pub mod resolve;
pub mod tcp_forward;
pub mod types;

pub use http::{
    ai_http_client, app_http_client, app_http_client_012, build_reqwest_012_client,
    build_reqwest_client, build_reqwest_client_with_timeout,
};
pub use registry::{
    PROXY_SCOPES, SCOPE_AI, SCOPE_APP_HTTP, SCOPE_DATABASE, SCOPE_SSH_TUNNEL,
};
pub use resolve::{
    endpoint_to_proxy_url, keychain_ai, keychain_connection, resolve, resolve_for_ai_provider,
    resolve_for_connection, resolve_global_scope, KEYCHAIN_GLOBAL,
};
pub use tcp_forward::{ensure_forward, stop_all_forwards};
pub use types::{
    GlobalProxySettings, ProxyEndpoint, ProxyMode, ProxyOverride, ProxyProtocol,
};

use crate::keychain_utils;

#[tauri::command]
pub fn set_proxy_password(slot: String, password: String) -> Result<(), String> {
    if !is_valid_proxy_slot(&slot) {
        return Err(format!("Invalid proxy password slot: {slot}"));
    }
    if password.is_empty() {
        keychain_utils::delete_proxy_password(&slot)
    } else {
        keychain_utils::set_proxy_password(&slot, &password)
    }
}

#[tauri::command]
pub fn proxy_password_is_set(slot: String) -> Result<bool, String> {
    if !is_valid_proxy_slot(&slot) {
        return Err(format!("Invalid proxy password slot: {slot}"));
    }
    Ok(keychain_utils::get_proxy_password(&slot)?
        .map(|p| !p.is_empty())
        .unwrap_or(false))
}

#[tauri::command]
pub fn delete_proxy_password(slot: String) -> Result<(), String> {
    if !is_valid_proxy_slot(&slot) {
        return Err(format!("Invalid proxy password slot: {slot}"));
    }
    keychain_utils::delete_proxy_password(&slot)
}

fn is_valid_proxy_slot(slot: &str) -> bool {
    if slot == KEYCHAIN_GLOBAL {
        return true;
    }
    if let Some(rest) = slot.strip_prefix("proxy:ai:") {
        return !rest.is_empty() && !rest.contains('/');
    }
    if let Some(rest) = slot.strip_prefix("proxy:connection:") {
        return !rest.is_empty() && !rest.contains('/');
    }
    false
}
