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
    if let Ok(Some(pwd)) = keychain_utils::get_proxy_password(slot) {
        if !pwd.is_empty() {
            endpoint.password = Some(pwd);
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

/// Build a reqwest / URL-style proxy URL (`http://…` or `socks5://…`).
pub fn endpoint_to_proxy_url(endpoint: &ProxyEndpoint) -> Result<String, String> {
    let scheme = match endpoint.protocol {
        ProxyProtocol::Http => "http",
        ProxyProtocol::Socks5 => "socks5",
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

    Ok(format!(
        "{}://{}{}:{}",
        scheme, auth, host, endpoint.port
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
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn endpoint(host: &str, port: u16) -> ProxyEndpoint {
        ProxyEndpoint {
            protocol: ProxyProtocol::Http,
            host: host.into(),
            port,
            username: None,
            password: None,
        }
    }

    fn global_on(scopes: &[&str]) -> GlobalProxySettings {
        let mut map = HashMap::new();
        for s in scopes {
            map.insert((*s).to_string(), true);
        }
        GlobalProxySettings {
            enabled: true,
            endpoint: Some(endpoint("proxy.example", 8080)),
            scopes: map,
        }
    }

    #[test]
    fn inherit_uses_global_when_scope_on() {
        let g = global_on(&[registry::SCOPE_APP_HTTP]);
        let got = resolve(&g, registry::SCOPE_APP_HTTP, None, None).unwrap();
        assert_eq!(got.host, "proxy.example");
        assert_eq!(got.port, 8080);
    }

    #[test]
    fn inherit_skips_when_scope_off() {
        let g = global_on(&[registry::SCOPE_AI]);
        assert!(resolve(&g, registry::SCOPE_APP_HTTP, None, None).is_none());
    }

    #[test]
    fn inherit_skips_when_global_disabled() {
        let mut g = global_on(&[registry::SCOPE_APP_HTTP]);
        g.enabled = false;
        assert!(resolve(&g, registry::SCOPE_APP_HTTP, None, None).is_none());
    }

    #[test]
    fn disabled_beats_global() {
        let g = global_on(&[registry::SCOPE_DATABASE]);
        let ov = ProxyOverride {
            mode: ProxyMode::Disabled,
            endpoint: None,
        };
        assert!(resolve(&g, registry::SCOPE_DATABASE, Some(&ov), None).is_none());
    }

    #[test]
    fn custom_beats_global() {
        let g = global_on(&[registry::SCOPE_DATABASE]);
        let ov = ProxyOverride {
            mode: ProxyMode::Custom,
            endpoint: Some(endpoint("custom.proxy", 1080)),
        };
        let got = resolve(&g, registry::SCOPE_DATABASE, Some(&ov), None).unwrap();
        assert_eq!(got.host, "custom.proxy");
        assert_eq!(got.port, 1080);
    }

    #[test]
    fn custom_empty_host_yields_none() {
        let g = global_on(&[registry::SCOPE_AI]);
        let ov = ProxyOverride {
            mode: ProxyMode::Custom,
            endpoint: Some(endpoint("  ", 1080)),
        };
        assert!(resolve(&g, registry::SCOPE_AI, Some(&ov), None).is_none());
    }

    #[test]
    fn proxy_url_http_and_socks() {
        let mut ep = endpoint("127.0.0.1", 7890);
        assert_eq!(
            endpoint_to_proxy_url(&ep).unwrap(),
            "http://127.0.0.1:7890"
        );
        ep.protocol = ProxyProtocol::Socks5;
        ep.username = Some("u".into());
        ep.password = Some("p@ss".into());
        let url = endpoint_to_proxy_url(&ep).unwrap();
        assert!(url.starts_with("socks5://u:p%40ss@127.0.0.1:7890"));
    }
}
