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

/// Global proxy settings stored on `AppConfig`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GlobalProxySettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<ProxyEndpoint>,
    /// Opt-in per traffic scope. Missing key ⇒ false.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub scopes: HashMap<String, bool>,
}

impl GlobalProxySettings {
    pub fn scope_enabled(&self, scope_id: &str) -> bool {
        self.scopes.get(scope_id).copied().unwrap_or(false)
    }
}
