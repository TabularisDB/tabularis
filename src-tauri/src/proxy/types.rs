use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Proxy wire protocol. SOCKS4 is intentionally unsupported.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ProxyProtocol {
    #[default]
    Http,
    Socks5,
}

/// How a connection / AI-provider override relates to the global proxy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ProxyMode {
    #[default]
    Inherit,
    Custom,
    Disabled,
}

/// Global routing policy for HTTP traffic managed by Tabularis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum HttpProxyMode {
    #[default]
    System,
    Custom,
    Disabled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HttpProxyPolicy {
    System,
    Custom(ProxyEndpoint),
    Disabled,
}

/// Proxy host configuration. Password is never stored here — see keychain slots.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProxyEndpoint {
    pub protocol: ProxyProtocol,
    pub host: String,
    pub port: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    /// Runtime-only password loaded from the OS keychain. Never persisted.
    #[serde(default, skip_serializing, skip_deserializing)]
    pub password: Option<String>,
}

/// Per-connection or per-provider override of the global proxy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProxyOverride {
    #[serde(default)]
    pub mode: ProxyMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<ProxyEndpoint>,
}

impl ProxyOverride {
    /// True when this override should be omitted from persisted JSON
    /// (inherit with no endpoint is the default).
    pub fn is_default_inherit(&self) -> bool {
        matches!(self.mode, ProxyMode::Inherit) && self.endpoint.is_none()
    }
}

pub fn skip_optional_proxy_override(value: &Option<ProxyOverride>) -> bool {
    value
        .as_ref()
        .map(ProxyOverride::is_default_inherit)
        .unwrap_or(true)
}

/// A route for non-HTTP traffic. Per-connection overrides remain separate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum TcpProxyMode {
    Custom,
    #[default]
    Disabled,
}

/// One explicit routing choice for each global traffic category.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ProxyScopeModes {
    pub app_http: HttpProxyMode,
    pub ai: HttpProxyMode,
    pub database: TcpProxyMode,
    pub ssh_tunnel: TcpProxyMode,
}

impl Default for ProxyScopeModes {
    fn default() -> Self {
        Self {
            app_http: HttpProxyMode::System,
            ai: HttpProxyMode::System,
            database: TcpProxyMode::Disabled,
            ssh_tunnel: TcpProxyMode::Disabled,
        }
    }
}

/// Persist only the shared custom endpoint and effective routes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", from = "GlobalProxySettingsWire")]
pub struct GlobalProxySettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<ProxyEndpoint>,
    pub modes: ProxyScopeModes,
}

/// Accept both the old switches and the first three-mode draft on read.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlobalProxySettingsWire {
    #[serde(default)]
    endpoint: Option<ProxyEndpoint>,
    #[serde(default)]
    modes: Option<ProxyScopeModes>,
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    scopes: Option<HashMap<String, bool>>,
    #[serde(default)]
    app_http_mode: Option<HttpProxyMode>,
    #[serde(default)]
    ai_mode: Option<HttpProxyMode>,
}

impl From<GlobalProxySettingsWire> for GlobalProxySettings {
    fn from(wire: GlobalProxySettingsWire) -> Self {
        let GlobalProxySettingsWire {
            endpoint,
            modes,
            enabled,
            scopes,
            app_http_mode,
            ai_mode,
        } = wire;
        let has_legacy_scopes = enabled.is_some() || scopes.is_some();
        let old_custom = |scope: &str| {
            enabled.unwrap_or(true)
                && scopes
                    .as_ref()
                    .and_then(|scopes| scopes.get(scope))
                    .copied()
                    .unwrap_or(false)
        };
        let old_http_mode = |scope| {
            // Preserve explicit scope choices and keep selected legacy routes off
            // when the master switch was disabled. Untouched scopes use defaults.
            match scopes.as_ref().and_then(|scopes| scopes.get(scope)) {
                Some(true) if enabled != Some(false) => HttpProxyMode::Custom,
                Some(_) => HttpProxyMode::Disabled,
                None => HttpProxyMode::System,
            }
        };
        let old_tcp_mode = |scope| {
            if old_custom(scope) {
                TcpProxyMode::Custom
            } else {
                TcpProxyMode::Disabled
            }
        };
        Self {
            endpoint,
            modes: modes.unwrap_or_else(|| {
                if !has_legacy_scopes && app_http_mode.is_none() && ai_mode.is_none() {
                    return ProxyScopeModes::default();
                }
                ProxyScopeModes {
                    app_http: app_http_mode.unwrap_or_else(|| old_http_mode("app_http")),
                    ai: ai_mode.unwrap_or_else(|| old_http_mode("ai")),
                    database: old_tcp_mode("database"),
                    ssh_tunnel: old_tcp_mode("ssh_tunnel"),
                }
            }),
        }
    }
}

impl GlobalProxySettings {
    pub fn scope_enabled(&self, scope_id: &str) -> bool {
        match scope_id {
            super::registry::SCOPE_APP_HTTP => self.modes.app_http == HttpProxyMode::Custom,
            super::registry::SCOPE_AI => self.modes.ai == HttpProxyMode::Custom,
            super::registry::SCOPE_DATABASE => self.modes.database == TcpProxyMode::Custom,
            super::registry::SCOPE_SSH_TUNNEL => self.modes.ssh_tunnel == TcpProxyMode::Custom,
            _ => false,
        }
    }

    pub fn http_mode(&self, scope_id: &str) -> HttpProxyMode {
        match scope_id {
            super::registry::SCOPE_APP_HTTP => self.modes.app_http,
            super::registry::SCOPE_AI => self.modes.ai,
            _ => HttpProxyMode::Disabled,
        }
    }
}

#[cfg(test)]
mod tests;
