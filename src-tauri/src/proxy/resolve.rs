use super::registry;
use super::types::{
    GlobalProxySettings, ProxyEndpoint, ProxyMode, ProxyOverride, ProxyProtocol,
};
use crate::keychain_utils;

/// Keychain account for the global proxy password.
pub const KEYCHAIN_GLOBAL: &str = "proxy:global";

/// Keychain account for a per-AI-provider proxy password.
pub fn keychain_ai(provider: &str) -> String {
    format!("proxy:ai:{}", provider)
}

/// Keychain account for a per-connection proxy password.
pub fn keychain_connection(connection_id: &str) -> String {
    format!("proxy:connection:{}", connection_id)
}

/// Attach a keychain password onto an endpoint (mutates in place).
pub fn attach_password(endpoint: &mut ProxyEndpoint, slot: &str) {
    match keychain_utils::get_proxy_password(slot) {
        Ok(Some(pwd)) if !pwd.is_empty() => {
            endpoint.password = Some(pwd);
        }
        Ok(_) => {}
        Err(e) => {
            log::warn!(
                "Failed to read proxy password from keychain slot '{slot}': {e}"
            );
        }
    }
}

/// Resolve the effective proxy for a traffic scope.
///
/// Rules:
/// - `disabled` override → no proxy
/// - `custom` override → that endpoint (with password from `override_slot`)
/// - `inherit` / absent → global endpoint when enabled and the scope checkbox is on
pub fn resolve(
    global: &GlobalProxySettings,
    scope: &str,
    override_cfg: Option<&ProxyOverride>,
    override_slot: Option<&str>,
) -> Option<ProxyEndpoint> {
    let mode = override_cfg.map(|o| o.mode).unwrap_or(ProxyMode::Inherit);

    match mode {
        ProxyMode::Disabled => None,
        ProxyMode::Custom => {
            let mut endpoint = override_cfg?.endpoint.clone()?;
            if let Some(slot) = override_slot {
                attach_password(&mut endpoint, slot);
            }
            if endpoint.host.trim().is_empty() || endpoint.port == 0 {
                return None;
            }
            Some(endpoint)
        }
        ProxyMode::Inherit => {
            if !global.enabled || !global.scope_enabled(scope) {
                return None;
            }
            if !registry::is_known_scope(scope) {
                return None;
            }
            let mut endpoint = global.endpoint.clone()?;
            attach_password(&mut endpoint, KEYCHAIN_GLOBAL);
            if endpoint.host.trim().is_empty() || endpoint.port == 0 {
                return None;
            }
            Some(endpoint)
        }
    }
}

/// Build a reqwest / URL-style proxy URL (`http://…` or `socks5h://…`).
///
/// SOCKS5 uses `socks5h` so the proxy resolves DNS (matches the TCP forwarder
/// ATYP=domain path and avoids local DNS leaks).
pub fn endpoint_to_proxy_url(endpoint: &ProxyEndpoint) -> Result<String, String> {
    let scheme = match endpoint.protocol {
        ProxyProtocol::Http => "http",
        ProxyProtocol::Socks5 => "socks5h",
    };
    let host = endpoint.host.trim();
    if host.is_empty() {
        return Err("Proxy host is empty".into());
    }
    if endpoint.port == 0 {
        return Err("Proxy port is invalid".into());
    }

    let auth = match (
        endpoint.username.as_deref().map(str::trim).filter(|s| !s.is_empty()),
        endpoint.password.as_deref().filter(|s| !s.is_empty()),
    ) {
        (Some(user), Some(pass)) => {
            format!(
                "{}:{}@",
                urlencoding::encode(user),
                urlencoding::encode(pass)
            )
        }
        (Some(user), None) => format!("{}@", urlencoding::encode(user)),
        _ => String::new(),
    };

    let host_part = if host.parse::<std::net::Ipv6Addr>().is_ok() {
        format!("[{host}]")
    } else {
        host.to_string()
    };

    Ok(format!(
        "{}://{}{}:{}",
        scheme, auth, host_part, endpoint.port
    ))
}

/// Resolve using the cached app config for the given scope (no override).
pub fn resolve_global_scope(scope: &str) -> Option<ProxyEndpoint> {
    let config = crate::config::get_cached_config();
    let global = config.proxy.as_ref()?;
    resolve(global, scope, None, None)
}

/// Resolve AI traffic for a provider (provider override > global `ai` scope).
pub fn resolve_for_ai_provider(provider: &str) -> Option<ProxyEndpoint> {
    let config = crate::config::get_cached_config();
    let global = config.proxy.clone().unwrap_or_default();
    let override_cfg = config
        .ai_provider_proxies
        .as_ref()
        .and_then(|m| m.get(provider));
    let slot = keychain_ai(provider);
    resolve(
        &global,
        registry::SCOPE_AI,
        override_cfg,
        Some(slot.as_str()),
    )
}

/// Resolve database / SSH traffic for a connection override.
pub fn resolve_for_connection(
    scope: &str,
    connection_id: Option<&str>,
    override_cfg: Option<&ProxyOverride>,
) -> Option<ProxyEndpoint> {
    let config = crate::config::get_cached_config();
    let global = config.proxy.clone().unwrap_or_default();
    let slot = connection_id.map(keychain_connection);
    resolve(
        &global,
        scope,
        override_cfg,
        slot.as_deref(),
    )
}

#[cfg(test)]
mod tests;
